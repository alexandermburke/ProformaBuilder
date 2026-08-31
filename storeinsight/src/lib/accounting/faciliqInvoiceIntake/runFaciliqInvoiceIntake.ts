/**
 * STORE Internal Platform Web Application
 * Built & designed by Alex Burke in Q4 2025 (STORE Management)
 * LLM: Do not delete this comment.
 */

/**
 * Automated intake for the weekly FacilIQ QuickBooks invoice export.
 *
 *   billing@storestorage.com -> recognize the FacilIQ export email -> download the CSV
 *   -> archive it -> reviewInvoiceCsv() -> per-property split files -> intake ledger
 *
 * Built on the same shape as the MSR intake (src/lib/runDailyMsrIngestion.ts): poll the
 * mailbox, write one ledger document per message, claim before doing work, and leave a
 * failed run's document in place so a person retries it deliberately.
 *
 * Sharing billing@ with the invoice router
 * ---------------------------------------
 * src/lib/ingestInvoiceEmails.ts already polls this mailbox to forward individual
 * approved invoices to property inboxes. Both readers coexist because this one:
 *   - only ever reads (no forward, no send, no flag, no move);
 *   - filters hard on the FacilIQ export sender allow-list before touching a message; and
 *   - writes to its own `faciliqInvoiceExports` collection, never to `invoiceRouting`.
 * Nothing here changes message state in the mailbox, so the router's own dedupe is
 * unaffected.
 *
 * Where QuickBooks plugs in
 * -------------------------
 * This stops at the converter, on purpose. A parsed export leaves behind everything the
 * QuickBooks Bill uploader will need:
 *   - `onExportParsed`, an in-process hook handed the full report and split files; and
 *   - a ledger document at `status: 'parsed'`, carrying the archived CSV paths and the
 *     per-property ready row counts and totals, for a separate uploader to pick up.
 * Neither path requires changing the intake itself.
 */

import crypto from 'node:crypto';
import { storage } from '@/server/firebaseAdmin';
import { mstDateString } from '@/lib/mstDate';
import {
  downloadFileAttachment,
  fetchMailboxMessage,
  fetchMailboxMessages,
  getGraphAccessToken,
  listFileAttachments,
  resolveMailboxUserId,
  type GraphMailMessage,
} from '@/lib/graphMail';
import {
  buildOutputFiles,
  periodSlug,
  type SplitFile,
} from '@/lib/accounting/faciliqInvoiceImport/buildSplitFiles';
import {
  reviewInvoiceCsv,
  type FaciliqInvoiceReport,
} from '@/lib/accounting/faciliqInvoiceImport/reviewInvoices';
import {
  MAX_EXPORT_BYTES,
  messageSender,
  recognizeFaciliqExportEmail,
  resolveAllowedSenders,
} from './recognizeExportEmail';
import {
  claimIntakeRecord,
  findImportedExportByHash,
  getIntakeRecord,
  reclaimIntakeRecord,
  recordIntakeDuplicate,
  recordIntakeFailed,
  recordIntakeParsed,
  recordIntakeRejected,
  type FaciliqIntakePropertySummary,
  type FaciliqIntakeStatus,
  type IntakeClaimInput,
  type IntakeParsedInput,
} from './records';

const LOG = '[faciliq-intake]';
const DEFAULT_MAX_MESSAGES = 100;
const STORAGE_PREFIX = 'faciliq_invoice_exports';

/** Everything a QuickBooks uploader needs from one successfully parsed export. */
export type FaciliqParsedExport = {
  messageId: string;
  mailbox: string;
  receivedAt: string;
  sourceFilename: string;
  contentSha256: string;
  /** The archived original CSV, or null when Firebase Storage is not configured. */
  storagePath: string | null;
  report: FaciliqInvoiceReport;
  files: SplitFile[];
};

export type FaciliqIntakeOptions = {
  mailbox?: string;
  maxMessages?: number;
  allowedSenders?: string[];
  /** Read and convert, but claim nothing, archive nothing, and record nothing. */
  dryRun?: boolean;
  /** Re-run one message that already has a ledger document (operator retry). */
  retryMessageId?: string;
  /** Today as yyyy-mm-dd, injected so a run is reproducible. */
  asOfIso?: string;
  now?: Date;
  onExportParsed?: (parsed: FaciliqParsedExport) => Promise<void> | void;
};

export type FaciliqIntakeResult = {
  messageId: string;
  subject: string;
  from: string;
  receivedAt: string;
  status: FaciliqIntakeStatus;
  attachmentName: string | null;
  periodStartIso: string | null;
  periodEndIso: string | null;
  readyRows: number;
  readyAmount: number;
  reviewRows: number;
  unresolvedRows: number;
  storagePath: string | null;
  /** Why it was rejected, or what failed. Null on a clean parse. */
  detail: string | null;
};

export type FaciliqIntakeSummary = {
  mailbox: string;
  dryRun: boolean;
  /** Messages read from the mailbox this run. */
  messagesScanned: number;
  /** Messages skipped before any work because the sender is not FacilIQ. */
  skippedOtherSenders: number;
  /** FacilIQ messages that already had a ledger document. */
  alreadyRecorded: number;
  parsed: number;
  duplicates: number;
  rejected: number;
  failed: number;
  results: FaciliqIntakeResult[];
};

const utcDateString = (date: Date): string => date.toISOString().slice(0, 10);

const errorText = (err: unknown): string =>
  err instanceof Error ? `${err.name}: ${err.message}` : String(err);

const sha256 = (buffer: Buffer): string =>
  crypto.createHash('sha256').update(buffer).digest('hex');

const emptyResult = (
  message: GraphMailMessage,
  status: FaciliqIntakeStatus,
  detail: string | null,
): FaciliqIntakeResult => ({
  messageId: message.id ?? '',
  subject: message.subject ?? '',
  from: message.from?.emailAddress?.address ?? '',
  receivedAt: message.receivedDateTime ?? '',
  status,
  attachmentName: null,
  periodStartIso: null,
  periodEndIso: null,
  readyRows: 0,
  readyAmount: 0,
  reviewRows: 0,
  unresolvedRows: 0,
  storagePath: null,
  detail,
});

/**
 * Archives a CSV under a period- and content-addressed path. The SHA prefix keeps a
 * corrected re-send for the same week from overwriting the copy that was already
 * imported, without putting a timestamp in the path -- re-running one message must land
 * on the same object.
 */
const archiveCsv = async (path: string, csv: string): Promise<void> => {
  if (!storage) return;
  await storage.file(path).save(Buffer.from(csv, 'utf8'), {
    contentType: 'text/csv; charset=utf-8',
    resumable: false,
    metadata: { cacheControl: 'private,max-age=0' },
  });
};

const toPropertySummaries = (
  report: FaciliqInvoiceReport,
  files: readonly SplitFile[],
  storagePathByFilename: ReadonlyMap<string, string>,
): FaciliqIntakePropertySummary[] => {
  const fileByCode = new Map(
    files.filter((file) => file.kind === 'property' && file.propertyCode).map((file) => [file.propertyCode, file]),
  );

  return report.properties.map((bucket) => {
    const file = fileByCode.get(bucket.code) ?? null;
    return {
      code: bucket.code,
      name: bucket.name,
      readyRows: bucket.readyRows.length,
      readyAmount: bucket.readyAmount,
      reviewRows: bucket.reviewRows.length,
      reviewAmount: bucket.reviewAmount,
      storagePath: file ? (storagePathByFilename.get(file.filename) ?? null) : null,
      filename: file?.filename ?? null,
    };
  });
};

/**
 * Polls the billing mailbox, converts every new FacilIQ export it finds, and records the
 * outcome of each one.
 *
 * Requires the Graph application permission Mail.Read on the billing mailbox. Nothing in
 * here sends or modifies mail.
 */
export async function runFaciliqInvoiceIntake(
  options: FaciliqIntakeOptions = {},
): Promise<FaciliqIntakeSummary> {
  const mailbox = resolveMailboxUserId({
    explicit: options.mailbox,
    envKeys: ['FACILIQ_MAILBOX_USER_ID', 'INVOICE_MAILBOX_USER_ID', 'MS_GRAPH_USER_ID'],
    label: 'FacilIQ invoice',
  });
  const dryRun = options.dryRun === true;
  const now = options.now ?? new Date();
  // The manual upload route dates its report in UTC; the automated path uses the same
  // basis so the same file produces the same report either way.
  const asOfIso = options.asOfIso ?? utcDateString(now);
  const nowIso = now.toISOString();
  const allowedSenders = resolveAllowedSenders(options.allowedSenders);
  // Logged every run because a mistyped allow-list is indistinguishable from a quiet
  // mailbox in the summary: both report zero. Seeing the parsed list makes it obvious.
  console.info(`${LOG} allowed senders`, { mailbox, allowedSenders: [...allowedSenders] });
  const accessToken = await getGraphAccessToken();

  const summary: FaciliqIntakeSummary = {
    mailbox,
    dryRun,
    messagesScanned: 0,
    skippedOtherSenders: 0,
    alreadyRecorded: 0,
    parsed: 0,
    duplicates: 0,
    rejected: 0,
    failed: 0,
    results: [],
  };

  let messages: GraphMailMessage[];
  if (options.retryMessageId) {
    // Fetched by id rather than found in the listing: a message worth retrying is often
    // older than the poll window.
    const single = await fetchMailboxMessage({
      mailbox,
      messageId: options.retryMessageId,
      accessToken,
    });
    if (!single) {
      throw new Error(
        `Message ${options.retryMessageId} is no longer in ${mailbox}. It may have been deleted or moved.`,
      );
    }
    messages = [single];
  } else {
    messages = await fetchMailboxMessages({
      mailbox,
      accessToken,
      // Filtered to the allowed senders by Graph itself, so the cap is spent on mail that
      // could actually be an export instead of on whatever else landed in billing@ today.
      fromAddresses: [...allowedSenders],
      maxMessages: options.maxMessages ?? DEFAULT_MAX_MESSAGES,
    });
  }
  summary.messagesScanned = messages.length;

  // Graph now filters by sender, so `messagesScanned` counts candidate exports rather than
  // everything in the mailbox, and `skippedOtherSenders` should be ~0. That makes an empty
  // result ambiguous between "no mail from FacilIQ" and "the sender list is wrong", and the
  // second used to be caught by seeing 100 scanned and 100 skipped. Say so loudly instead.
  if (messages.length === 0 && !options.retryMessageId) {
    console.warn(`${LOG} no mail from any allowed sender`, {
      mailbox,
      allowedSenders: [...allowedSenders],
    });
  }

  for (const message of messages) {
    const messageId = message.id;
    if (!messageId) continue;

    const isRetry = options.retryMessageId === messageId;

    // Sender check first, before any per-message Graph call: billing@ is a busy shared
    // mailbox and everything else in it belongs to the invoice router, not here.
    if (!allowedSenders.has(messageSender(message))) {
      summary.skippedOtherSenders += 1;
      continue;
    }

    if (!dryRun && !isRetry) {
      const existing = await getIntakeRecord(messageId);
      if (existing) {
        summary.alreadyRecorded += 1;
        continue;
      }
    }

    const receivedAt = message.receivedDateTime ?? nowIso;
    const receivedDateMst = mstDateString(new Date(receivedAt));
    const from = message.from?.emailAddress?.address ?? '';
    const subject = message.subject ?? '';

    try {
      const attachments = message.hasAttachments === false
        ? []
        : await listFileAttachments({ mailbox, messageId, accessToken });

      const match = recognizeFaciliqExportEmail({
        message,
        attachments,
        allowedSenders,
        maxAttachmentBytes: MAX_EXPORT_BYTES,
      });

      if (!match.matched) {
        console.warn(`${LOG} message is not a usable export`, {
          messageId,
          subject,
          reason: match.reason,
          detail: match.detail,
        });
        if (!dryRun) {
          await recordIntakeRejected({
            messageId,
            mailbox,
            receivedAt,
            receivedDateMst,
            from,
            subject,
            reason: match.reason,
            detail: match.detail,
            signals: match.signals,
            nowIso,
          });
        }
        summary.rejected += 1;
        summary.results.push(emptyResult(message, 'rejected', match.detail));
        continue;
      }

      const { attachment, window } = match;
      const claim: IntakeClaimInput = {
        messageId,
        mailbox,
        receivedAt,
        receivedDateMst,
        from,
        subject,
        attachmentId: attachment.id,
        attachmentName: attachment.name,
        attachmentBytes: attachment.size,
        signals: match.signals,
        periodStartIso: window?.startIso ?? null,
        periodEndIso: window?.endIso ?? null,
        nowIso,
      };

      if (!dryRun) {
        if (isRetry) {
          await reclaimIntakeRecord(claim);
        } else {
          // Atomic: a concurrent run that already claimed this message keeps it.
          const claimed = await claimIntakeRecord(claim);
          if (!claimed) {
            summary.alreadyRecorded += 1;
            continue;
          }
        }
      }

      const result = await convertClaimedExport({
        message,
        messageId,
        mailbox,
        receivedAt,
        accessToken,
        attachmentId: attachment.id,
        attachmentName: attachment.name,
        asOfIso,
        dryRun,
        onExportParsed: options.onExportParsed,
      });

      if (result.status === 'parsed') summary.parsed += 1;
      else if (result.status === 'duplicate') summary.duplicates += 1;
      else summary.failed += 1;
      summary.results.push(result);
    } catch (err) {
      const detail = errorText(err);
      console.error(`${LOG} intake failed`, { messageId, subject }, err);
      if (!dryRun) {
        await recordIntakeFailed({ messageId, error: detail }).catch((writeErr) => {
          console.error(`${LOG} could not record the failure`, { messageId }, writeErr);
        });
      }
      summary.failed += 1;
      summary.results.push(emptyResult(message, 'failed', detail));
    }
  }

  console.info(`${LOG} run complete`, {
    mailbox,
    dryRun,
    scanned: summary.messagesScanned,
    skippedOtherSenders: summary.skippedOtherSenders,
    alreadyRecorded: summary.alreadyRecorded,
    parsed: summary.parsed,
    duplicates: summary.duplicates,
    rejected: summary.rejected,
    failed: summary.failed,
  });

  return summary;
}

/**
 * Downloads, validates, converts, and archives one claimed export. Split out so the
 * claim/skip decisions above stay readable next to the mailbox loop.
 */
async function convertClaimedExport(params: {
  message: GraphMailMessage;
  messageId: string;
  mailbox: string;
  receivedAt: string;
  accessToken: string;
  attachmentId: string;
  attachmentName: string;
  asOfIso: string;
  dryRun: boolean;
  onExportParsed?: FaciliqIntakeOptions['onExportParsed'];
}): Promise<FaciliqIntakeResult> {
  const { message, messageId, mailbox, receivedAt, attachmentName, asOfIso, dryRun } = params;

  const buffer = await downloadFileAttachment({
    mailbox,
    messageId,
    attachmentId: params.attachmentId,
    accessToken: params.accessToken,
  });

  if (buffer.length === 0) {
    throw new Error(`"${attachmentName}" downloaded as 0 bytes.`);
  }
  // A CSV never contains a NUL. Catching it here means a mislabelled XLSX or PDF fails
  // with a readable message instead of becoming thousands of nonsense flags.
  if (buffer.includes(0)) {
    throw new Error(
      `"${attachmentName}" is not text (it contains null bytes), so it was not read as a CSV.`,
    );
  }

  const contentSha256 = sha256(buffer);

  if (!dryRun) {
    const alreadyImported = await findImportedExportByHash({
      contentSha256,
      excludeMessageId: messageId,
    });
    if (alreadyImported) {
      console.info(`${LOG} identical export already imported`, {
        messageId,
        originalMessageId: alreadyImported.messageId,
        contentSha256,
      });
      await recordIntakeDuplicate({
        messageId,
        contentSha256,
        originalMessageId: alreadyImported.messageId,
        storagePath: alreadyImported.storagePath,
      });
      return {
        ...emptyResult(message, 'duplicate', null),
        attachmentName,
        storagePath: alreadyImported.storagePath,
        periodStartIso: alreadyImported.periodStartIso,
        periodEndIso: alreadyImported.periodEndIso,
        detail: `Identical to the export already imported from message ${alreadyImported.messageId}.`,
      };
    }
  }

  const text = new TextDecoder('utf-8').decode(buffer);
  const report = reviewInvoiceCsv(text, { sourceFilename: attachmentName, asOfIso });

  if (!report.ok) {
    const detail = report.headerError ?? 'The export could not be read.';
    console.error(`${LOG} export header unusable`, { messageId, attachmentName, detail });
    if (!dryRun) {
      await recordIntakeFailed({
        messageId,
        error: detail,
        headerError: report.headerError,
        contentSha256,
      });
    }
    return { ...emptyResult(message, 'failed', detail), attachmentName };
  }

  const files = buildOutputFiles(report);
  const notes: string[] = [];
  const storagePathByFilename = new Map<string, string>();
  let sourcePath: string | null = null;

  if (dryRun) {
    notes.push('Dry run: nothing was archived or recorded.');
  } else if (!storage) {
    // Explicit rather than silent: the conversion still stands, but the operator needs to
    // know the original is only in the mailbox.
    notes.push(
      'Firebase Storage is not configured, so the original CSV and the split files were not archived. Re-running this message downloads it from the mailbox again.',
    );
    console.warn(`${LOG} storage not configured; skipping archive`, { messageId });
  } else {
    const base = `${STORAGE_PREFIX}/${periodSlug(report)}/${contentSha256.slice(0, 8)}`;
    sourcePath = `${base}/source/${attachmentName}`;
    await archiveCsv(sourcePath, text);
    for (const file of files) {
      const path = `${base}/split/${file.filename}`;
      await archiveCsv(path, file.csv);
      storagePathByFilename.set(file.filename, path);
    }
  }

  const reviewFile = files.find((file) => file.kind === 'review') ?? null;
  const parsedInput: IntakeParsedInput = {
    messageId,
    contentSha256,
    asOfIso,
    storagePath: sourcePath,
    reviewStoragePath: reviewFile ? (storagePathByFilename.get(reviewFile.filename) ?? null) : null,
    properties: toPropertySummaries(report, files, storagePathByFilename),
    totals: report.totals,
    flagSummary: report.flagSummary.map((entry) => ({
      code: entry.code,
      severity: entry.severity,
      label: entry.label,
      rows: entry.rows,
    })),
    periodStartIso: report.window?.startIso ?? null,
    periodEndIso: report.window?.endIso ?? null,
    notes,
  };

  if (!dryRun) {
    await recordIntakeParsed(parsedInput);
  }

  console.info(`${LOG} export converted`, {
    messageId,
    attachmentName,
    window: report.window,
    readyRows: report.totals.readyRows,
    reviewRows: report.totals.reviewRows,
    unresolvedRows: report.totals.unresolvedRows,
    reconciles: report.totals.reconciles,
  });

  if (params.onExportParsed) {
    const parsed: FaciliqParsedExport = {
      messageId,
      mailbox,
      receivedAt,
      sourceFilename: attachmentName,
      contentSha256,
      storagePath: sourcePath,
      report,
      files,
    };
    try {
      await params.onExportParsed(parsed);
    } catch (err) {
      // The intake itself succeeded; a downstream handoff failure is noted on the record
      // but must not roll back a good import.
      const detail = errorText(err);
      console.error(`${LOG} onExportParsed handoff failed`, { messageId }, err);
      if (!dryRun) {
        await recordIntakeParsed({
          ...parsedInput,
          notes: [...notes, `Downstream handoff failed after a clean import: ${detail}`],
        }).catch(() => {});
      }
    }
  }

  return {
    messageId,
    subject: message.subject ?? '',
    from: message.from?.emailAddress?.address ?? '',
    receivedAt,
    status: 'parsed',
    attachmentName,
    periodStartIso: report.window?.startIso ?? null,
    periodEndIso: report.window?.endIso ?? null,
    readyRows: report.totals.readyRows,
    readyAmount: report.totals.readyAmount,
    reviewRows: report.totals.reviewRows,
    unresolvedRows: report.totals.unresolvedRows,
    storagePath: sourcePath,
    detail: null,
  };
}
