/**
 * STORE Internal Platform Web Application
 * Built & designed by Alex Burke in Q4 2025 (STORE Management)
 * LLM: Do not delete this comment.
 */

/**
 * Microsoft Graph mailbox reads shared by the automated email intakes.
 *
 * `ingestMsrEmails` and `ingestInvoiceEmails` each predate this file and still carry
 * their own copy of the message fetch. New intakes read through here so a third copy
 * of the paging and attachment logic does not appear; those two are left alone rather
 * than refactored, because both run in production on a schedule.
 *
 * Requires the Graph application permission Mail.Read on the target mailbox.
 */

import { getGraphAccessToken } from './graph';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
/** Graph caps $top at 999 for messages; 100 keeps each page small and predictable. */
const PAGE_SIZE = 100;

export type GraphMailMessage = {
  id?: string;
  receivedDateTime?: string;
  subject?: string;
  from?: { emailAddress?: { address?: string; name?: string } };
  hasAttachments?: boolean;
  bodyPreview?: string;
  body?: { contentType?: string; content?: string };
};

export type MailboxBodyContentType = 'text' | 'html';

/**
 * Resolves which mailbox to read. Kept explicit rather than defaulted, so a misconfigured
 * environment fails loudly instead of quietly polling the wrong inbox.
 */
export function resolveMailboxUserId(params: {
  explicit?: string;
  envKeys: readonly string[];
  label: string;
}): string {
  const fromEnv = params.envKeys.map((key) => process.env[key]).find((value) => Boolean(value?.trim()));
  const mailbox = params.explicit?.trim() || fromEnv?.trim();
  if (!mailbox) {
    throw new Error(
      `Missing ${params.label} mailbox user id (set ${params.envKeys.join(' or ')}).`,
    );
  }
  return mailbox;
}

const graphFetch = async (url: string, accessToken: string, extraHeaders?: HeadersInit): Promise<Response> =>
  fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}`, ...extraHeaders },
  });

const failed = async (res: Response, what: string): Promise<never> => {
  const text = await res.text().catch(() => '');
  throw new Error(`${what} failed (${res.status} ${res.statusText}): ${text.slice(0, 300)}`);
};

/**
 * Newest-first messages from a mailbox, following `@odata.nextLink` so a backlog larger
 * than one page is not silently dropped.
 */
/** OData string literals escape a single quote by doubling it. */
const odataString = (value: string): string => `'${value.replace(/'/g, "''")}'`;

/**
 * Page cap for a sender-filtered read. One vendor sending weekly needs a page every two
 * years, so this is a runaway guard rather than a real limit.
 */
const MAX_FILTERED_PAGES = 20;

export async function fetchMailboxMessages(params: {
  mailbox: string;
  accessToken: string;
  maxMessages?: number;
  select?: readonly string[];
  bodyContentType?: MailboxBodyContentType;
  /**
   * Restrict to these senders SERVER SIDE.
   *
   * Worth the special case because the alternative loses mail. Without it this reads the N
   * newest messages in the mailbox and filters afterwards, and billing@ is a busy shared
   * inbox: a real run on 2026-08-31 scanned 100 messages to find 7 that mattered, with 93
   * discarded as other senders. One busy week and a weekly export falls off the end of that
   * page, with no error anywhere, which for an invoice pipeline means a payable that simply
   * never happens.
   *
   * Graph will NOT accept a sender filter alongside `$orderby: receivedDateTime desc`; it
   * answers 400 InefficientFilter (verified against this mailbox). So the ordering is dropped
   * for the filtered request and reapplied here instead, which is safe because filtering to
   * one vendor's mail leaves few enough messages to fetch all of them.
   */
  fromAddresses?: readonly string[];
}): Promise<GraphMailMessage[]> {
  const {
    mailbox,
    accessToken,
    maxMessages = 100,
    select = ['id', 'receivedDateTime', 'subject', 'from', 'hasAttachments'],
    bodyContentType,
    fromAddresses,
  } = params;

  const senders = (fromAddresses ?? []).map((value) => value.trim()).filter(Boolean);
  const limit = Math.max(1, maxMessages);
  const query = new URLSearchParams({
    $top: String(Math.min(limit, PAGE_SIZE)),
    $select: select.join(','),
  });
  if (senders.length > 0) {
    query.set(
      '$filter',
      senders.map((address) => `from/emailAddress/address eq ${odataString(address)}`).join(' or '),
    );
  } else {
    query.set('$orderby', 'receivedDateTime desc');
  }

  const collected: GraphMailMessage[] = [];
  let nextUrl: string | null = `${GRAPH_BASE}/users/${encodeURIComponent(mailbox)}/messages?${query}`;
  let pages = 0;

  /**
   * A filtered request cannot be sorted by Graph, so stopping at `limit` mid-collection would
   * keep an ARBITRARY subset and only then sort it. Graph returns unsorted results oldest
   * first in this mailbox, so that would quietly keep the oldest messages and drop the newest
   * the moment a sender's history exceeded the limit. Read every page instead and let the
   * sort below decide what `limit` keeps. Safe to do because the filter is one vendor's mail.
   */
  const readEveryPage = senders.length > 0;

  while (nextUrl && (readEveryPage ? pages < MAX_FILTERED_PAGES : collected.length < limit)) {
    pages += 1;
    const res: Response = await graphFetch(
      nextUrl,
      accessToken,
      bodyContentType ? { Prefer: `outlook.body-content-type="${bodyContentType}"` } : undefined,
    );
    if (!res.ok) return failed(res, 'Graph messages fetch');

    const json = (await res.json()) as { value?: GraphMailMessage[]; '@odata.nextLink'?: string };
    if (Array.isArray(json.value)) collected.push(...json.value);
    nextUrl = json['@odata.nextLink'] ?? null;
  }

  // The filtered request could not ask Graph to sort, so restore newest-first here. Callers
  // rely on that order to decide what a truncating limit keeps.
  if (senders.length > 0) {
    collected.sort((a, b) => (b.receivedDateTime ?? '').localeCompare(a.receivedDateTime ?? ''));
  }

  return collected.slice(0, limit);
}

/**
 * One message by id. Returns null on 404 so an operator retrying a message that has since
 * been deleted or moved out of the mailbox gets a clear "gone", not a 500.
 */
export async function fetchMailboxMessage(params: {
  mailbox: string;
  messageId: string;
  accessToken: string;
  select?: readonly string[];
}): Promise<GraphMailMessage | null> {
  const {
    mailbox,
    messageId,
    accessToken,
    select = ['id', 'receivedDateTime', 'subject', 'from', 'hasAttachments'],
  } = params;

  const query = new URLSearchParams({ $select: select.join(',') });
  const url = `${GRAPH_BASE}/users/${encodeURIComponent(mailbox)}/messages/${encodeURIComponent(
    messageId,
  )}?${query}`;

  const res = await graphFetch(url, accessToken);
  if (res.status === 404) return null;
  if (!res.ok) return failed(res, 'Graph message fetch');

  return (await res.json()) as GraphMailMessage;
}

export type GraphFileAttachment = {
  id: string;
  name: string;
  contentType: string;
  size: number;
  isInline: boolean;
};

type GraphAttachmentListItem = {
  '@odata.type'?: string;
  id?: string;
  name?: string;
  contentType?: string;
  size?: number;
  isInline?: boolean;
};

const FILE_ATTACHMENT_TYPE = '#microsoft.graph.fileAttachment';

/**
 * File attachments only. `$select` keeps `contentBytes` out of the listing response, so a
 * large attachment is not pulled into memory just to learn its name -- the bytes are
 * fetched deliberately by `downloadFileAttachment`.
 *
 * Item attachments (a forwarded email) and reference attachments (a OneDrive link) are
 * dropped here: neither carries a CSV this workflow can read. Graph reports the concrete
 * type in `@odata.type`; an entry missing that field is kept and left to the caller's
 * filename/size checks rather than being silently discarded.
 */
export async function listFileAttachments(params: {
  mailbox: string;
  messageId: string;
  accessToken: string;
}): Promise<GraphFileAttachment[]> {
  const { mailbox, messageId, accessToken } = params;
  const query = new URLSearchParams({ $select: 'id,name,contentType,size,isInline' });
  const url = `${GRAPH_BASE}/users/${encodeURIComponent(mailbox)}/messages/${encodeURIComponent(
    messageId,
  )}/attachments?${query}`;

  const res = await graphFetch(url, accessToken);
  if (!res.ok) return failed(res, 'Graph attachment list');

  const json = (await res.json()) as { value?: GraphAttachmentListItem[] };
  const items = Array.isArray(json.value) ? json.value : [];

  return items
    .filter((item) => item['@odata.type'] === undefined || item['@odata.type'] === FILE_ATTACHMENT_TYPE)
    .filter((item): item is GraphAttachmentListItem & { id: string } => Boolean(item.id))
    .map((item) => ({
      id: item.id,
      name: item.name ?? '',
      contentType: item.contentType ?? '',
      size: typeof item.size === 'number' ? item.size : 0,
      isInline: item.isInline === true,
    }));
}

/**
 * Raw attachment bytes via `/$value`, which avoids the base64 round trip that reading
 * `contentBytes` would require.
 */
export async function downloadFileAttachment(params: {
  mailbox: string;
  messageId: string;
  attachmentId: string;
  accessToken: string;
}): Promise<Buffer> {
  const { mailbox, messageId, attachmentId, accessToken } = params;
  const url = `${GRAPH_BASE}/users/${encodeURIComponent(mailbox)}/messages/${encodeURIComponent(
    messageId,
  )}/attachments/${encodeURIComponent(attachmentId)}/$value`;

  const res = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` },
    redirect: 'follow',
  });
  if (!res.ok) return failed(res, 'Graph attachment download');

  return Buffer.from(await res.arrayBuffer());
}

export { getGraphAccessToken };
