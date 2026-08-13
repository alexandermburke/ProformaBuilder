/**
 * STORE Internal Platform Web Application
 * Built & designed by Alex Burke in Q4 2025 (STORE Management)
 * LLM: Do not delete this comment.
 */

/**
 * The intake ledger for the weekly FacilIQ QuickBooks export.
 *
 * One document per FacilIQ message, keyed by the Graph message id, in its own collection
 * so it never mixes with `invoiceRouting` (the per-invoice forwarder that reads the same
 * billing@ mailbox) or `msrEmails`.
 *
 * Duplicate protection is two-layered, because either layer alone has a hole:
 *   - the message-id document is created with `create()`, which fails if the document
 *     already exists, so two concurrent runs cannot both claim one message; and
 *   - the SHA-256 of the CSV bytes is recorded, so a re-sent or forwarded copy of an
 *     export that already imported is caught even though it arrives as a new message.
 *
 * A failed intake keeps its document. Nothing retries on its own -- an operator re-runs
 * it deliberately from /accounting/faciliq-invoice-import once the cause is understood.
 */

import admin from 'firebase-admin';
import { firestore } from '@/server/firebaseAdmin';
import type { QuickBooksPropertyCode } from '@/lib/accounting/faciliqInvoiceImport/properties';
import type { ReportTotals } from '@/lib/accounting/faciliqInvoiceImport/reviewInvoices';
import type { BillStatusCounts } from '@/lib/accounting/quickbooks/billRecords';
import type { ExportEmailSignals, ExportRejectionReason } from './recognizeExportEmail';

export const FACILIQ_INTAKE_COLLECTION = 'faciliqInvoiceExports';

/**
 * `claimed` is the in-flight state written before the attachment is downloaded. A document
 * still sitting at `claimed` means a run died mid-flight; it is retryable exactly like
 * `failed`, which is why both are listed by `isRetryableStatus`.
 */
export type FaciliqIntakeStatus =
  | 'claimed'
  | 'parsed'
  | 'duplicate'
  | 'rejected'
  | 'failed';

export const isRetryableStatus = (status: FaciliqIntakeStatus): boolean =>
  status === 'failed' || status === 'claimed';

export type FaciliqIntakePropertySummary = {
  code: QuickBooksPropertyCode;
  name: string;
  readyRows: number;
  readyAmount: number;
  reviewRows: number;
  reviewAmount: number;
  /** The per-property split CSV in Firebase Storage; null when archiving was skipped. */
  storagePath: string | null;
  filename: string | null;
};

export type FaciliqIntakeFlagSummary = {
  code: string;
  severity: string;
  label: string;
  rows: number;
};

/**
 * QuickBooks upload state for an export, tracked BESIDE `status` rather than folded into
 * it. Two reasons: re-running the intake must not clobber upload progress, and an export
 * whose bills partly succeeded is neither "uploaded" nor "failed". `partial` exists so a
 * mixed result can never be reported as a clean one.
 */
export type FaciliqExportUploadStatus =
  | 'not_started'
  | 'uploading'
  | 'uploaded'
  /** No clean rows, so there is nothing to send. Terminal, and not retried every run. */
  | 'nothing_to_upload'
  | 'partial'
  | 'needs_mapping'
  | 'upload_failed';

export type FaciliqIntakeRecord = {
  messageId: string;
  mailbox: string;
  receivedAt: string;
  receivedDateMst: string;
  from: string;
  subject: string;
  status: FaciliqIntakeStatus;
  /** True only once the CSV has been read and converted. Mirrors msrEmails.processed. */
  processed: boolean;
  attempts: number;

  attachmentId: string | null;
  attachmentName: string | null;
  attachmentBytes: number | null;
  contentSha256: string | null;
  signals: ExportEmailSignals | null;

  periodStartIso: string | null;
  periodEndIso: string | null;
  /**
   * The date the converter treated as "today" for this export. Stored so the QuickBooks
   * uploader can re-read the archived CSV and reproduce byte-identical results instead of
   * a report shaped by whenever the upload happens to run.
   */
  asOfIso: string | null;

  /** The untouched CSV as FacilIQ sent it, so a re-run never depends on the mailbox. */
  storagePath: string | null;
  reviewStoragePath: string | null;
  properties: FaciliqIntakePropertySummary[];
  totals: ReportTotals | null;
  flagSummary: FaciliqIntakeFlagSummary[];

  /** Set when FacilIQ's header changed and no rows could be read. */
  headerError: string | null;
  rejectionReason: ExportRejectionReason | null;
  error: string | null;
  /** Operator-facing notes, e.g. that archiving was skipped. Never silently dropped. */
  notes: string[];

  uploadStatus: FaciliqExportUploadStatus;
  uploadCounts: BillStatusCounts | null;
  lastUploadAt: string | null;
  lastUploadError: string | null;
  /** True when the last upload attempt was a dry run, so nothing reached QuickBooks. */
  lastUploadWasDryRun: boolean;

  firstSeenAt: string;
  lastRunAt: string;
};

/**
 * Graph message ids are base64-flavoured and can legally contain `/`, which Firestore
 * forbids in a document id. The raw id is kept in the `messageId` field; only the key is
 * rewritten, and the mapping is deterministic so a lookup by message id still resolves.
 */
export const intakeDocId = (messageId: string): string =>
  messageId.replace(/\//g, '_').replace(/\+/g, '-');

const requireFirestore = (): admin.firestore.Firestore => {
  if (!firestore) {
    throw new Error('Firebase is not initialized (firestore missing). Check environment variables.');
  }
  return firestore;
};

const collection = (): admin.firestore.CollectionReference =>
  requireFirestore().collection(FACILIQ_INTAKE_COLLECTION);

const docRef = (messageId: string): admin.firestore.DocumentReference =>
  collection().doc(intakeDocId(messageId));

const stamp = () => admin.firestore.FieldValue.serverTimestamp();

export const isAlreadyExists = (err: unknown): boolean => {
  const code = (err as { code?: number })?.code;
  const message = (err as { message?: string })?.message ?? '';
  return code === 6 || /already exists/i.test(message);
};

export type IntakeClaimInput = {
  messageId: string;
  mailbox: string;
  receivedAt: string;
  receivedDateMst: string;
  from: string;
  subject: string;
  attachmentId: string;
  attachmentName: string;
  attachmentBytes: number;
  signals: ExportEmailSignals;
  periodStartIso: string | null;
  periodEndIso: string | null;
  nowIso: string;
};

/**
 * Parse-outcome fields only. Upload state is NOT reset here: re-running the intake for a
 * message must not make an export look un-uploaded when its bills are already in
 * QuickBooks.
 */
const emptyOutcomeFields = () => ({
  contentSha256: null,
  asOfIso: null,
  storagePath: null,
  reviewStoragePath: null,
  properties: [],
  totals: null,
  flagSummary: [],
  headerError: null,
  rejectionReason: null,
  error: null,
  notes: [],
});

const initialUploadFields = () => ({
  uploadStatus: 'not_started' satisfies FaciliqExportUploadStatus,
  uploadCounts: null,
  lastUploadAt: null,
  lastUploadError: null,
  lastUploadWasDryRun: false,
});

/**
 * Atomically claims a message. Returns false when another run already holds it, so the
 * caller moves on instead of downloading and converting the same export twice.
 */
export async function claimIntakeRecord(input: IntakeClaimInput): Promise<boolean> {
  try {
    await docRef(input.messageId).create({
      ...emptyOutcomeFields(),
      ...initialUploadFields(),
      messageId: input.messageId,
      mailbox: input.mailbox,
      receivedAt: input.receivedAt,
      receivedDateMst: input.receivedDateMst,
      from: input.from,
      subject: input.subject,
      status: 'claimed' satisfies FaciliqIntakeStatus,
      processed: false,
      attempts: 1,
      attachmentId: input.attachmentId,
      attachmentName: input.attachmentName,
      attachmentBytes: input.attachmentBytes,
      signals: input.signals,
      periodStartIso: input.periodStartIso,
      periodEndIso: input.periodEndIso,
      firstSeenAt: input.nowIso,
      lastRunAt: input.nowIso,
      createdAt: stamp(),
      updatedAt: stamp(),
    });
    return true;
  } catch (err) {
    if (isAlreadyExists(err)) return false;
    throw err;
  }
}

/**
 * Re-claims a message that already has a document, for an operator-triggered retry. The
 * attempt counter and the run timestamp move; the original `firstSeenAt` does not.
 */
export async function reclaimIntakeRecord(input: IntakeClaimInput): Promise<void> {
  await docRef(input.messageId).set(
    {
      ...emptyOutcomeFields(),
      messageId: input.messageId,
      mailbox: input.mailbox,
      receivedAt: input.receivedAt,
      receivedDateMst: input.receivedDateMst,
      from: input.from,
      subject: input.subject,
      status: 'claimed' satisfies FaciliqIntakeStatus,
      processed: false,
      attempts: admin.firestore.FieldValue.increment(1),
      attachmentId: input.attachmentId,
      attachmentName: input.attachmentName,
      attachmentBytes: input.attachmentBytes,
      signals: input.signals,
      periodStartIso: input.periodStartIso,
      periodEndIso: input.periodEndIso,
      lastRunAt: input.nowIso,
      updatedAt: stamp(),
    },
    { merge: true },
  );
}

export type IntakeParsedInput = {
  messageId: string;
  contentSha256: string;
  asOfIso: string;
  storagePath: string | null;
  reviewStoragePath: string | null;
  properties: FaciliqIntakePropertySummary[];
  totals: ReportTotals;
  flagSummary: FaciliqIntakeFlagSummary[];
  periodStartIso: string | null;
  periodEndIso: string | null;
  notes: string[];
};

export async function recordIntakeParsed(input: IntakeParsedInput): Promise<void> {
  const { messageId, ...rest } = input;
  await docRef(messageId).set(
    {
      ...rest,
      status: 'parsed' satisfies FaciliqIntakeStatus,
      processed: true,
      headerError: null,
      error: null,
      rejectionReason: null,
      updatedAt: stamp(),
    },
    { merge: true },
  );
}

export async function recordIntakeFailed(input: {
  messageId: string;
  error: string;
  headerError?: string | null;
  contentSha256?: string | null;
  storagePath?: string | null;
  notes?: string[];
}): Promise<void> {
  await docRef(input.messageId).set(
    {
      status: 'failed' satisfies FaciliqIntakeStatus,
      processed: false,
      error: input.error,
      headerError: input.headerError ?? null,
      contentSha256: input.contentSha256 ?? null,
      storagePath: input.storagePath ?? null,
      notes: input.notes ?? [],
      updatedAt: stamp(),
    },
    { merge: true },
  );
}

export async function recordIntakeDuplicate(input: {
  messageId: string;
  contentSha256: string;
  originalMessageId: string;
  storagePath: string | null;
}): Promise<void> {
  await docRef(input.messageId).set(
    {
      status: 'duplicate' satisfies FaciliqIntakeStatus,
      processed: false,
      contentSha256: input.contentSha256,
      storagePath: input.storagePath,
      error: null,
      notes: [
        `The same CSV was already imported from message ${input.originalMessageId}, so this copy was not imported again.`,
      ],
      updatedAt: stamp(),
    },
    { merge: true },
  );
}

/**
 * Written for messages from an allowed FacilIQ sender that turned out not to carry a
 * usable export. Mail from every other sender is skipped without a document, so the
 * collection stays a FacilIQ ledger rather than a copy of the mailbox.
 */
export async function recordIntakeRejected(input: {
  messageId: string;
  mailbox: string;
  receivedAt: string;
  receivedDateMst: string;
  from: string;
  subject: string;
  reason: ExportRejectionReason;
  detail: string;
  signals: ExportEmailSignals;
  nowIso: string;
}): Promise<void> {
  await docRef(input.messageId).set(
    {
      ...emptyOutcomeFields(),
      ...initialUploadFields(),
      messageId: input.messageId,
      mailbox: input.mailbox,
      receivedAt: input.receivedAt,
      receivedDateMst: input.receivedDateMst,
      from: input.from,
      subject: input.subject,
      status: 'rejected' satisfies FaciliqIntakeStatus,
      processed: false,
      attachmentId: null,
      attachmentName: null,
      attachmentBytes: null,
      signals: input.signals,
      periodStartIso: null,
      periodEndIso: null,
      rejectionReason: input.reason,
      error: input.detail,
      firstSeenAt: input.nowIso,
      lastRunAt: input.nowIso,
      createdAt: stamp(),
      updatedAt: stamp(),
    },
    { merge: true },
  );
}

const readRecord = (
  snapshot: admin.firestore.DocumentSnapshot | admin.firestore.QueryDocumentSnapshot,
): FaciliqIntakeRecord | null => {
  const data = snapshot.data();
  if (!data) return null;
  // Server timestamps are dropped here on purpose: this shape is what the API hands to
  // the browser, and a Firestore Timestamp does not survive JSON.
  const {
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    ...rest
  } = data as FaciliqIntakeRecord & { createdAt?: unknown; updatedAt?: unknown };
  return rest;
};

export async function getIntakeRecord(messageId: string): Promise<FaciliqIntakeRecord | null> {
  const snapshot = await docRef(messageId).get();
  return snapshot.exists ? readRecord(snapshot) : null;
}

export async function listRecentIntakes(limit = 25): Promise<FaciliqIntakeRecord[]> {
  const snapshot = await collection()
    .orderBy('receivedAt', 'desc')
    .limit(Math.min(Math.max(limit, 1), 100))
    .get();
  return snapshot.docs
    .map(readRecord)
    .filter((record): record is FaciliqIntakeRecord => record !== null);
}

/**
 * Records the QuickBooks upload outcome for an export. Called by the uploader only; the
 * intake never writes these fields after the initial default.
 */
export async function updateExportUploadState(input: {
  messageId: string;
  uploadStatus: FaciliqExportUploadStatus;
  uploadCounts: BillStatusCounts;
  lastUploadError: string | null;
  dryRun: boolean;
  nowIso: string;
}): Promise<void> {
  await docRef(input.messageId).set(
    {
      uploadStatus: input.uploadStatus,
      uploadCounts: input.uploadCounts,
      lastUploadAt: input.nowIso,
      lastUploadError: input.lastUploadError,
      lastUploadWasDryRun: input.dryRun,
      updatedAt: stamp(),
    },
    { merge: true },
  );
}

/**
 * Every export whose CSV was read cleanly, newest first. The uploader's work queue.
 *
 * The status filter and the newest-first sort cannot be combined in one Firestore query
 * without a composite index, so a bounded page is read and ordered here. Applying `limit`
 * to the query instead would hand back an arbitrary subset and only then sort it, which
 * makes "newest" a lie.
 */
export async function listParsedExports(limit = 25): Promise<FaciliqIntakeRecord[]> {
  const snapshot = await collection().where('status', '==', 'parsed').limit(200).get();
  return snapshot.docs
    .map(readRecord)
    .filter((record): record is FaciliqIntakeRecord => record !== null)
    .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
    .slice(0, Math.min(Math.max(limit, 1), 100));
}

/**
 * Finds an earlier import of the same CSV bytes. Only `parsed` documents count: a failed
 * or rejected sibling should not block a genuine retry.
 */
export async function findImportedExportByHash(params: {
  contentSha256: string;
  excludeMessageId: string;
}): Promise<FaciliqIntakeRecord | null> {
  const snapshot = await collection()
    .where('contentSha256', '==', params.contentSha256)
    .where('status', '==', 'parsed')
    .limit(2)
    .get();

  for (const doc of snapshot.docs) {
    const record = readRecord(doc);
    if (record && record.messageId !== params.excludeMessageId) return record;
  }
  return null;
}
