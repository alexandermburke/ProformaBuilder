/**
 * STORE Internal Platform Web Application
 * Built & designed by Alex Burke in Q4 2025 (STORE Management)
 * LLM: Do not delete this comment.
 */

/**
 * The scheduled side of the QuickBooks uploader: walk every parsed FacilIQ export that
 * still has bills to send, and send them.
 *
 * Safe to run on a schedule because the guards live one level down, in
 * uploadFaciliqExportBills and the bill ledger:
 *   - a bill already `uploaded` or `duplicate` is refused by the claim transaction, so a
 *     daily run never re-creates yesterday's bills;
 *   - QUICKBOOKS_LIVE_CREATE gates real creation, so this is a dry run everywhere it is
 *     not explicitly enabled; and
 *   - an export with no connected property fails its bills and moves on rather than
 *     stopping the run.
 *
 * Exports at `needs_mapping` and `upload_failed` are deliberately retried on every pass.
 * That is the recovery path: once someone adds the missing vendor or account in
 * QuickBooks, the next scheduled run picks it up with no further action.
 */

import {
  listParsedExports,
  type FaciliqExportUploadStatus,
} from '@/lib/accounting/faciliqInvoiceIntake/records';
import { isLiveCreateEnabled } from './config';
import { uploadFaciliqExportBills, type ExportUploadSummary } from './uploadFaciliqBills';

const LOG = '[quickbooks-upload-pending]';

/** Bounded so one bad day cannot turn into an unbounded run against the QuickBooks API. */
const DEFAULT_MAX_EXPORTS = 10;

/** Everything except a fully settled export is worth another pass. */
const NEEDS_ANOTHER_PASS: readonly FaciliqExportUploadStatus[] = [
  'not_started',
  'uploading',
  'partial',
  'needs_mapping',
  'upload_failed',
];

/**
 * The scheduled path ignores exports received before this date.
 *
 * This exists for one moment: the switch from a sandbox company to a real one. The ledger
 * still holds every export from the sandbox period, and the ones that never fully settled are
 * exactly the ones this function retries. Without a floor, the first scheduled run after
 * QUICKBOOKS_LIVE_CREATE names a real property would post months of already-hand-keyed
 * invoices into the real books, unattended, on a timer.
 *
 * Set it to the cutover date. Older exports stay reachable through an explicit single-export
 * run, which is a person choosing to send them.
 */
const uploadFromIso = (): string | null => {
  const raw = process.env.QUICKBOOKS_UPLOAD_FROM?.trim();
  if (!raw) return null;
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) {
    console.warn(`${LOG} QUICKBOOKS_UPLOAD_FROM is not a readable date; ignoring it`, { raw });
    return null;
  }
  return new Date(parsed).toISOString();
};

export type PendingUploadSummary = {
  dryRun: boolean;
  /** Exports skipped because they predate QUICKBOOKS_UPLOAD_FROM. Never silently dropped. */
  exportsBeforeCutover: number;
  exportsConsidered: number;
  exportsRun: number;
  billsUploaded: number;
  billsDuplicate: number;
  billsNeedingMapping: number;
  billsFailed: number;
  /** Exports skipped because the cap was hit. Never silently dropped. */
  exportsDeferred: number;
  results: ExportUploadSummary[];
  errors: Array<{ messageId: string; error: string }>;
};

export async function uploadPendingFaciliqExports(options?: {
  /** Pass false to attempt real creation. Ignored unless QUICKBOOKS_LIVE_CREATE=true. */
  dryRun?: boolean;
  maxExports?: number;
}): Promise<PendingUploadSummary> {
  const requestedLive = options?.dryRun === false;
  const dryRun = !requestedLive || !isLiveCreateEnabled();
  const maxExports = options?.maxExports ?? DEFAULT_MAX_EXPORTS;

  const parsed = await listParsedExports(50);
  const retryable = parsed.filter((record) => NEEDS_ANOTHER_PASS.includes(record.uploadStatus));

  const cutoff = uploadFromIso();
  const pending = cutoff ? retryable.filter((record) => record.receivedAt >= cutoff) : retryable;
  const beforeCutover = retryable.length - pending.length;
  if (beforeCutover > 0) {
    console.warn(`${LOG} skipped exports received before the upload cutover`, {
      cutoff,
      skipped: beforeCutover,
      messageIds: retryable.filter((record) => record.receivedAt < cutoff!).map((r) => r.messageId),
    });
  }

  const batch = pending.slice(0, maxExports);

  const summary: PendingUploadSummary = {
    dryRun,
    exportsBeforeCutover: beforeCutover,
    exportsConsidered: pending.length,
    exportsRun: 0,
    billsUploaded: 0,
    billsDuplicate: 0,
    billsNeedingMapping: 0,
    billsFailed: 0,
    exportsDeferred: Math.max(0, pending.length - batch.length),
    results: [],
    errors: [],
  };

  for (const record of batch) {
    try {
      const result = await uploadFaciliqExportBills({ messageId: record.messageId, dryRun });
      summary.exportsRun += 1;
      summary.billsUploaded += result.uploaded;
      summary.billsDuplicate += result.duplicates;
      summary.billsNeedingMapping += result.needsMapping;
      summary.billsFailed += result.failed;
      summary.results.push(result);
    } catch (err) {
      // One unusable export must not stop the others.
      const error = err instanceof Error ? err.message : String(err);
      console.error(`${LOG} export failed`, { messageId: record.messageId }, err);
      summary.errors.push({ messageId: record.messageId, error });
    }
  }

  if (summary.exportsDeferred > 0) {
    console.warn(`${LOG} deferred exports past the per-run cap`, {
      cap: maxExports,
      deferred: summary.exportsDeferred,
    });
  }

  console.info(`${LOG} run complete`, {
    dryRun,
    exportsBeforeCutover: summary.exportsBeforeCutover,
    exportsConsidered: summary.exportsConsidered,
    exportsRun: summary.exportsRun,
    billsUploaded: summary.billsUploaded,
    billsDuplicate: summary.billsDuplicate,
    billsNeedingMapping: summary.billsNeedingMapping,
    billsFailed: summary.billsFailed,
    exportsDeferred: summary.exportsDeferred,
    errors: summary.errors.length,
  });

  return summary;
}
