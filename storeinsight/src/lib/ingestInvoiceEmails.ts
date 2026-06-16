/**
 * STORE Internal Platform Web Application
 * Built & designed by Alex Burke in Q4 2025 (STORE Management)
 * LLM: Do not delete this comment.
 */

import admin from 'firebase-admin';
import { firestore } from '@/server/firebaseAdmin';
import { getGraphAccessToken } from './graph';
import { parseInvoiceEmail } from './invoiceRouting/parseInvoiceEmail';
import { listRules } from '@/app/api/invoice-routing/rules/store';
import { deriveRoutedEmail, INVOICE_ROUTING_COLLECTION } from '@/types/invoiceRouting';

const DEFAULT_MAX_MESSAGES = 250;
const PAGE_SIZE = 100;

type GraphMessage = {
  id?: string;
  receivedDateTime?: string;
  subject?: string;
  from?: { emailAddress?: { address?: string } };
  body?: { contentType?: string; content?: string };
  hasAttachments?: boolean;
};

export type InvoiceIngestOutcome =
  | 'forwarded'
  | 'dry_run'
  | 'skipped_disabled'
  | 'unrouted'
  | 'error';

export type InvoiceIngestResult = {
  messageId: string;
  subject: string;
  from: string;
  siteCode: string | null;
  ticketNumber: string | null;
  invoiceType: string | null;
  destination: string | null;
  outcome: InvoiceIngestOutcome;
  error?: string;
};

export type InvoiceIngestSummary = {
  mailbox: string;
  dryRun: boolean;
  /** True when forwarding was requested but suppressed because no allow-list is set. */
  forwardingSuppressed: boolean;
  emailsScanned: number;
  newEmails: number;
  forwarded: number;
  dryRunMatched: number;
  skipped: number;
  unrouted: number;
  errors: number;
  results: InvoiceIngestResult[];
};

const slugify = (value: string): string => value.trim().toLowerCase().replace(/[^a-z0-9]/g, '');

const isAlreadyExists = (err: unknown): boolean => {
  const code = (err as { code?: number })?.code;
  const message = (err as { message?: string })?.message ?? '';
  return code === 6 || /already exists/i.test(message);
};

/** Convert an HTML email body to rough plain text so the field regexes still match. */
const htmlToText = (html: string): string =>
  html
    .replace(/<\s*(br|\/p|\/div|\/tr|\/li|\/h[1-6])\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+\n/g, '\n')
    .trim();

const messageToText = (message: GraphMessage): string => {
  const subject = message.subject ?? '';
  const raw = message.body?.content ?? '';
  const isHtml = (message.body?.contentType ?? '').toLowerCase() === 'html' || /<[a-z][\s\S]*>/i.test(raw);
  return `${subject}\n${isHtml ? htmlToText(raw) : raw}`;
};

function getInvoiceMailboxUserId(userId?: string): string {
  const mailbox = userId ?? process.env.INVOICE_MAILBOX_USER_ID ?? process.env.MS_GRAPH_USER_ID;
  if (!mailbox) {
    throw new Error('Missing invoice mailbox user id (set INVOICE_MAILBOX_USER_ID).');
  }
  return mailbox;
}

async function fetchInvoiceMessages(params: {
  mailbox: string;
  maxMessages: number;
  accessToken: string;
}): Promise<GraphMessage[]> {
  const { mailbox, maxMessages, accessToken } = params;
  const collected: GraphMessage[] = [];
  const initialQuery = new URLSearchParams({
    $top: String(Math.min(maxMessages, PAGE_SIZE)),
    $select: 'id,receivedDateTime,subject,from,body,hasAttachments',
    $orderby: 'receivedDateTime desc',
  });
  let nextUrl: string | null = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/messages?${initialQuery}`;

  // Page through @odata.nextLink so a backlog larger than one page is not silently dropped.
  while (nextUrl && collected.length < maxMessages) {
    const res: Response = await fetch(nextUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        // Plain text bodies parse more cleanly; htmlToText covers the HTML-only case.
        Prefer: 'outlook.body-content-type="text"',
      },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Graph messages fetch failed (${res.status} ${res.statusText}): ${text.slice(0, 300)}`);
    }
    const json = (await res.json()) as { value?: GraphMessage[]; '@odata.nextLink'?: string };
    if (Array.isArray(json.value)) collected.push(...json.value);
    nextUrl = json['@odata.nextLink'] ?? null;
  }

  return collected.slice(0, maxMessages);
}

async function forwardMessage(params: {
  mailbox: string;
  messageId: string;
  to: string;
  accessToken: string;
  comment: string;
}): Promise<void> {
  const { mailbox, messageId, to, accessToken, comment } = params;
  // /forward carries the original body and attachments (the invoice file) to the property inbox.
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/messages/${encodeURIComponent(messageId)}/forward`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ comment, toRecipients: [{ emailAddress: { address: to } }] }),
    },
  );
  // Graph returns 202 Accepted with an empty body on success.
  if (!res.ok && res.status !== 202) {
    const text = await res.text().catch(() => '');
    throw new Error(`Graph forward failed (${res.status} ${res.statusText}): ${text.slice(0, 300)}`);
  }
}

/**
 * Poll the billing@ landing mailbox, parse each approved invoice, resolve the property
 * inbox from the saved routing registry (falling back to the derived address), and
 * forward the original email there.
 *
 * Safety model:
 * - Forwarding only happens when a positive invoice signal is present (a ticket number
 *   or a label-anchored "Site:" code) — a bare site-shaped token never auto-forwards.
 * - Forwarding is suppressed (forced to dry-run) when no sender allow-list is configured,
 *   so unrestricted mail is never routed.
 * - Each forward is guarded by an atomic Firestore create() claim, so a message is
 *   forwarded at most once even if a later write fails. Failed forwards are recorded as
 *   'error' and are NOT auto-retried (re-trigger manually after investigating).
 *
 * Requires Graph application permission Mail.Read; forwarding additionally needs Mail.Send.
 */
export async function ingestInvoiceEmails(options?: {
  mailbox?: string;
  maxMessages?: number;
  dryRun?: boolean;
  allowedSenders?: string[];
}): Promise<InvoiceIngestSummary> {
  if (!firestore) {
    throw new Error('Firebase is not initialized (firestore missing). Check environment variables.');
  }

  const mailbox = getInvoiceMailboxUserId(options?.mailbox);
  const accessToken = await getGraphAccessToken();

  const envAllowed = (process.env.INVOICE_ALLOWED_SENDERS || '')
    .split(',')
    .map((value) => value.toLowerCase().trim())
    .filter(Boolean);
  const allowedSenders = new Set(
    (options?.allowedSenders ?? envAllowed).map((s) => s.toLowerCase().trim()).filter(Boolean),
  );

  // Fail closed: never forward unrestricted mail. If forwarding was requested but no
  // allow-list is configured, drop to dry-run instead of routing every sender's mail.
  const requestedDryRun = options?.dryRun ?? false;
  const forwardingSuppressed = !requestedDryRun && allowedSenders.size === 0;
  if (forwardingSuppressed) {
    console.warn(
      '[invoice-ingest] forwarding requested but INVOICE_ALLOWED_SENDERS is empty; staying in dry-run to avoid forwarding unrestricted mail',
    );
  }
  const dryRun = requestedDryRun || forwardingSuppressed;

  const messages = await fetchInvoiceMessages({
    mailbox,
    maxMessages: options?.maxMessages ?? DEFAULT_MAX_MESSAGES,
    accessToken,
  });

  const rules = await listRules();
  const rulesByCode = new Map(rules.map((rule) => [slugify(rule.propertyCode), rule]));

  const summary: InvoiceIngestSummary = {
    mailbox,
    dryRun,
    forwardingSuppressed,
    emailsScanned: messages.length,
    newEmails: 0,
    forwarded: 0,
    dryRunMatched: 0,
    skipped: 0,
    unrouted: 0,
    errors: 0,
    results: [],
  };

  for (const message of messages) {
    const messageId = message.id;
    if (!messageId) continue;

    const fromAddress = message.from?.emailAddress?.address?.toLowerCase().trim() ?? '';
    if (allowedSenders.size > 0 && !allowedSenders.has(fromAddress)) {
      continue;
    }

    const docRef = firestore.collection(INVOICE_ROUTING_COLLECTION).doc(messageId);
    // A record only exists once we have claimed/handled this message on a prior run, so
    // its presence means: forwarded, errored, or in-flight. Skip in all cases (no re-send).
    const existing = await docRef.get();
    if (existing.exists) {
      continue;
    }
    summary.newEmails += 1;

    const parsed = parseInvoiceEmail(messageToText(message));
    const rule = parsed.siteCode ? rulesByCode.get(slugify(parsed.siteCode)) : undefined;
    // Only route on a confident signal: an OBR/RNM ticket, or a "Site:"-labeled code.
    const hasPositiveSignal = Boolean(parsed.ticketNumber) || parsed.siteCodeSource === 'labeled';

    let destination: string | null = null;
    let outcome: InvoiceIngestOutcome;
    let errorMessage: string | undefined;

    if (rule && !rule.enabled) {
      outcome = 'skipped_disabled';
    } else if (parsed.siteCode && hasPositiveSignal) {
      destination = (rule?.routedEmail || deriveRoutedEmail(parsed.siteCode)) || null;
      if (!destination) {
        outcome = 'unrouted';
      } else if (dryRun) {
        outcome = 'dry_run';
      } else {
        // Atomic claim before sending: create() fails if a doc already exists, so a
        // concurrent run cannot also forward this message.
        let claimed = false;
        try {
          await docRef.create({
            messageId,
            receivedAt: message.receivedDateTime ?? new Date().toISOString(),
            from: message.from?.emailAddress?.address ?? '',
            subject: message.subject ?? '',
            siteCode: parsed.siteCode,
            ticketNumber: parsed.ticketNumber,
            invoiceType: parsed.invoiceType,
            glCode: parsed.glCode,
            amount: parsed.amount,
            serviceDate: parsed.serviceDate,
            workDetails: parsed.workDetails,
            destination,
            hasAttachments: Boolean(message.hasAttachments),
            outcome: 'forwarding',
            processed: false,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          claimed = true;
        } catch (err) {
          if (isAlreadyExists(err)) {
            // Another run claimed it between our get() and create(); leave it to them.
            continue;
          }
          throw err;
        }

        if (claimed) {
          try {
            await forwardMessage({
              mailbox,
              messageId,
              to: destination,
              accessToken,
              comment: 'Auto-routed by Store Insights invoice routing.',
            });
            outcome = 'forwarded';
            await docRef.set(
              { outcome: 'forwarded', processed: true, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
              { merge: true },
            );
          } catch (err) {
            outcome = 'error';
            errorMessage = err instanceof Error ? err.message : 'forward failed';
            // Record the failure; the claim doc stays so we do NOT re-forward automatically.
            await docRef
              .set(
                { outcome: 'error', error: errorMessage, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
                { merge: true },
              )
              .catch(() => {});
          }
        } else {
          continue;
        }
      }
    } else {
      // No site code, or only a bare fallback token with no ticket: hold for manual review.
      outcome = 'unrouted';
    }

    if (outcome === 'forwarded') summary.forwarded += 1;
    else if (outcome === 'dry_run') summary.dryRunMatched += 1;
    else if (outcome === 'skipped_disabled') summary.skipped += 1;
    else if (outcome === 'unrouted') summary.unrouted += 1;
    else summary.errors += 1;

    summary.results.push({
      messageId,
      subject: message.subject ?? '',
      from: message.from?.emailAddress?.address ?? '',
      siteCode: parsed.siteCode,
      ticketNumber: parsed.ticketNumber,
      invoiceType: parsed.invoiceType,
      destination,
      outcome,
      error: errorMessage,
    });
  }

  console.info('[invoice-ingest] run complete', {
    mailbox,
    dryRun,
    forwardingSuppressed,
    scanned: summary.emailsScanned,
    newEmails: summary.newEmails,
    forwarded: summary.forwarded,
    dryRunMatched: summary.dryRunMatched,
    skipped: summary.skipped,
    unrouted: summary.unrouted,
    errors: summary.errors,
  });

  return summary;
}
