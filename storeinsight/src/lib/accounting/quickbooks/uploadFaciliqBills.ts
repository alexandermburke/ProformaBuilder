/**
 * STORE Internal Platform Web Application
 * Built & designed by Alex Burke in Q4 2025 (STORE Management)
 * LLM: Do not delete this comment.
 */

/**
 * Creates QuickBooks Bills from a FacilIQ export that the intake already parsed.
 *
 *   intake record (status: parsed) -> archived CSV -> converter -> bill drafts
 *   -> resolve vendor and account IN THE DESTINATION COMPANY -> create Bill -> record
 *
 * Deliberately decoupled from the mailbox: this reads the archived CSV and the intake
 * ledger, never Microsoft Graph. The intake can run without QuickBooks configured at all,
 * and this can re-run without touching email.
 *
 * Safety model:
 *   - Live creation requires BOTH an explicit request and QUICKBOOKS_LIVE_CREATE=true.
 *     Asking for live without the flag downgrades to a dry run and says so, rather than
 *     silently doing nothing or silently doing it.
 *   - Every bill is claimed transactionally, and a bill already `uploaded` is refused, so
 *     a cron, a retry, or two concurrent runs cannot create it twice.
 *   - Before creating, QuickBooks itself is asked whether a bill with that DocNumber and
 *     vendor already exists, which catches bills created outside this ledger.
 *   - A vendor or account that does not resolve exactly stops that bill as `needs_mapping`.
 *     Nothing is guessed.
 *   - Payments are never created. This produces bills for accounting to review, which
 *     leaves Kathy's approval and bill-pay controls exactly where they are.
 */

import { storage } from '@/server/firebaseAdmin';
import type { QuickBooksPropertyCode } from '@/lib/accounting/faciliqInvoiceImport/properties';
import { reviewInvoiceCsv } from '@/lib/accounting/faciliqInvoiceImport/reviewInvoices';
import {
  getIntakeRecord,
  updateExportUploadState,
  type FaciliqExportUploadStatus,
} from '@/lib/accounting/faciliqInvoiceIntake/records';
import { isLiveCreateEnabled, resolveEnvironment, type QuickBooksEnvironment } from './config';
import {
  QBO_DUPLICATE_REQUEST_ID_CODE,
  QBO_REQUEST_ID_MAX,
  QuickBooksApiError,
  QuickBooksNotConnectedError,
  getQuickBooksClient,
} from './client';
import { createRefResolver, escapeQueryValue } from './resolveRefs';
import { buildBillDrafts, buildBillPayload, type BillDraft } from './buildBills';
import {
  claimBillForUpload,
  countBillStatuses,
  emptyBillCounts,
  listBillsForExport,
  recordBillDryRunReady,
  recordBillDuplicate,
  recordBillFailed,
  recordBillNeedsMapping,
  recordBillUploaded,
  upsertBillDraft,
  type BillStatusCounts,
  type BillUploadStatus,
} from './billRecords';

const LOG = '[quickbooks-upload]';

export type BillUploadResult = {
  billKey: string;
  propertyCode: QuickBooksPropertyCode;
  invoiceNumber: string;
  vendorName: string;
  amount: number;
  lineCount: number;
  status: BillUploadStatus;
  quickBooksBillId: string | null;
  detail: string | null;
};

export type ExportUploadSummary = {
  messageId: string;
  sourceFilename: string;
  environment: QuickBooksEnvironment;
  dryRun: boolean;
  /** True when live creation was asked for but QUICKBOOKS_LIVE_CREATE is not enabled. */
  liveCreateSuppressed: boolean;
  billsConsidered: number;
  uploaded: number;
  duplicates: number;
  needsMapping: number;
  failed: number;
  skippedAlreadyUploaded: number;
  uploadStatus: FaciliqExportUploadStatus;
  counts: BillStatusCounts;
  results: BillUploadResult[];
};

export type UploadExportOptions = {
  /** The FacilIQ intake record to upload. Must be at status `parsed`. */
  messageId: string;
  /** Pass false to attempt real creation. Ignored unless QUICKBOOKS_LIVE_CREATE=true. */
  dryRun?: boolean;
  /** Restrict to one property's bills. */
  propertyCode?: QuickBooksPropertyCode;
  /** Restrict to one bill, for a retry or the first single-bill proof run. */
  billKey?: string;
  /** Hard cap on bills attempted this run. Use 1 to prove the flow end to end. */
  limit?: number;
  now?: Date;
};

type QboBillRow = {
  Id?: string;
  DocNumber?: string;
  TotalAmt?: number;
  VendorRef?: { value?: string };
};

type QboCreatedBill = { Id?: string; DocNumber?: string };

const errorText = (err: unknown): string =>
  err instanceof Error ? `${err.name}: ${err.message}` : String(err);

async function readArchivedCsv(storagePath: string): Promise<string> {
  if (!storage) {
    throw new Error('Firebase Storage is not configured, so the archived export cannot be read.');
  }
  const [buffer] = await storage.file(storagePath).download();
  return new TextDecoder('utf-8').decode(buffer);
}

/**
 * An export counts as uploaded only when every one of its bills is settled in QuickBooks.
 * A mixed result is `partial`, never `uploaded`.
 */
export function deriveExportUploadStatus(counts: BillStatusCounts): FaciliqExportUploadStatus {
  const total =
    counts.pending + counts.uploading + counts.uploaded + counts.needs_mapping + counts.failed + counts.duplicate;
  if (total === 0) return 'not_started';

  const settled = counts.uploaded + counts.duplicate;
  if (settled === total) return 'uploaded';
  if (settled > 0) return 'partial';
  if (counts.uploading > 0) return 'uploading';
  if (counts.failed > 0) return 'upload_failed';
  if (counts.needs_mapping > 0) return 'needs_mapping';
  return 'not_started';
}

export async function uploadFaciliqExportBills(
  options: UploadExportOptions,
): Promise<ExportUploadSummary> {
  const now = options.now ?? new Date();
  const nowIso = now.toISOString();
  const environment = resolveEnvironment();

  const requestedLive = options.dryRun === false;
  const liveAllowed = isLiveCreateEnabled();
  const liveCreateSuppressed = requestedLive && !liveAllowed;
  const dryRun = !requestedLive || !liveAllowed;
  if (liveCreateSuppressed) {
    console.warn(
      `${LOG} live creation requested but QUICKBOOKS_LIVE_CREATE is not true; running as a dry run`,
      { messageId: options.messageId },
    );
  }

  const record = await getIntakeRecord(options.messageId);
  if (!record) {
    throw new Error(`No FacilIQ intake record for message ${options.messageId}.`);
  }
  if (record.status !== 'parsed') {
    throw new Error(
      `Export ${options.messageId} is at status "${record.status}", not "parsed", so there is nothing to upload.`,
    );
  }
  if (!record.storagePath) {
    throw new Error(
      `Export ${options.messageId} has no archived CSV, so its bills cannot be rebuilt. Re-run the intake for it first.`,
    );
  }

  const sourceFilename = record.attachmentName ?? record.storagePath.split('/').pop() ?? 'export.csv';
  const csv = await readArchivedCsv(record.storagePath);
  // The stored asOfIso reproduces the exact report the intake produced. Without it a later
  // run could reach a different ready/held split for the same file.
  const asOfIso = record.asOfIso ?? nowIso.slice(0, 10);
  const report = reviewInvoiceCsv(csv, { sourceFilename, asOfIso });

  if (!report.ok) {
    throw new Error(`The archived export could not be re-read: ${report.headerError ?? 'unknown reason'}.`);
  }

  let drafts = buildBillDrafts(report);
  if (options.propertyCode) {
    drafts = drafts.filter((draft) => draft.propertyCode === options.propertyCode);
  }
  if (options.billKey) {
    drafts = drafts.filter((draft) => draft.billKey === options.billKey);
  }
  if (typeof options.limit === 'number' && options.limit > 0) {
    drafts = drafts.slice(0, options.limit);
  }

  for (const draft of drafts) {
    await upsertBillDraft({ draft, exportMessageId: options.messageId, nowIso });
  }

  const results: BillUploadResult[] = [];
  let skippedAlreadyUploaded = 0;

  const byProperty = new Map<QuickBooksPropertyCode, BillDraft[]>();
  for (const draft of drafts) {
    const existing = byProperty.get(draft.propertyCode);
    if (existing) existing.push(draft);
    else byProperty.set(draft.propertyCode, [draft]);
  }

  for (const [propertyCode, propertyDrafts] of byProperty) {
    let client;
    let resolver;
    try {
      client = await getQuickBooksClient(propertyCode);
      resolver = await createRefResolver(client);
    } catch (err) {
      // No usable connection: fail this property's bills with the reason, and carry on to
      // the next property rather than abandoning the whole export.
      const detail =
        err instanceof QuickBooksNotConnectedError ? err.message : errorText(err);
      console.error(`${LOG} property unavailable`, { propertyCode, messageId: options.messageId }, err);
      for (const draft of propertyDrafts) {
        await recordBillFailed({ billKey: draft.billKey, realmId: null, error: detail, dryRun, nowIso });
        results.push(toResult(draft, 'failed', null, detail));
      }
      continue;
    }

    for (const draft of propertyDrafts) {
      const claim = await claimBillForUpload({ billKey: draft.billKey, nowIso });
      if (!claim.claimed) {
        if (claim.reason === 'already_uploaded' || claim.reason === 'already_duplicate') {
          skippedAlreadyUploaded += 1;
          results.push(
            toResult(
              draft,
              claim.record?.status ?? 'uploaded',
              claim.record?.quickBooksBillId ?? null,
              claim.reason === 'already_uploaded'
                ? 'Already in QuickBooks; not created again.'
                : 'Already recorded as a QuickBooks duplicate.',
            ),
          );
        }
        continue;
      }

      try {
        const vendor = await resolver.resolveVendor(draft.vendorName);
        const accountIdBySourceLine = new Map<number, string>();
        const unresolvedAccounts: string[] = [];
        const candidates: string[] = [...(vendor.resolved ? [] : vendor.candidates)];

        for (const line of draft.lines) {
          const account = await resolver.resolveAccount(line.glCode, line.item);
          if (account.resolved) {
            accountIdBySourceLine.set(line.sourceLine, account.ref.id);
          } else {
            unresolvedAccounts.push(line.glCode);
            candidates.push(...account.candidates);
          }
        }

        if (!vendor.resolved || unresolvedAccounts.length > 0) {
          const reason = [
            vendor.resolved ? null : vendor.reason,
            unresolvedAccounts.length > 0
              ? `Unresolved GL code(s): ${[...new Set(unresolvedAccounts)].join(', ')}.`
              : null,
          ]
            .filter(Boolean)
            .join(' ');
          await recordBillNeedsMapping({
            billKey: draft.billKey,
            realmId: client.realmId,
            reason,
            unresolvedVendor: vendor.resolved ? null : draft.vendorName,
            unresolvedAccounts: [...new Set(unresolvedAccounts)],
            candidates: [...new Set(candidates)].slice(0, 10),
            dryRun,
            nowIso,
          });
          results.push(toResult(draft, 'needs_mapping', null, reason));
          continue;
        }

        const payload = buildBillPayload({
          draft,
          vendorId: vendor.ref.id,
          accountIdBySourceLine,
        });
        if (!payload.ok) {
          await recordBillFailed({
            billKey: draft.billKey,
            realmId: client.realmId,
            error: payload.reason,
            dryRun,
            nowIso,
          });
          results.push(toResult(draft, 'failed', null, payload.reason));
          continue;
        }

        // Ask QuickBooks directly, so a bill created by hand or by an earlier run outside
        // this ledger is still caught.
        const existingBills = await client.query<QboBillRow>(
          'Bill',
          `SELECT Id, DocNumber, TotalAmt, VendorRef FROM Bill WHERE DocNumber = '${escapeQueryValue(draft.invoiceNumber)}'`,
        );
        const alreadyThere = existingBills.find(
          (bill) => bill.VendorRef?.value === vendor.ref.id && Boolean(bill.Id),
        );
        if (alreadyThere?.Id) {
          const detail = `QuickBooks already holds bill ${alreadyThere.Id} with DocNumber ${draft.invoiceNumber} for ${vendor.ref.label}.`;
          await recordBillDuplicate({
            billKey: draft.billKey,
            realmId: client.realmId,
            environment: client.environment,
            quickBooksBillId: alreadyThere.Id,
            detail,
            nowIso,
          });
          results.push(toResult(draft, 'duplicate', alreadyThere.Id, detail));
          continue;
        }

        if (dryRun) {
          await recordBillDryRunReady({
            billKey: draft.billKey,
            realmId: client.realmId,
            vendorRefId: vendor.ref.id,
            nowIso,
          });
          results.push(
            toResult(
              draft,
              'pending',
              null,
              `Dry run: would create a ${draft.lines.length}-line bill for ${vendor.ref.label} in ${client.companyName || propertyCode}.`,
            ),
          );
          continue;
        }

        // QuickBooks' own idempotency key. Derived from the bill's natural key and stable
        // across retries, so replaying an attempt returns the original bill rather than
        // creating a second one.
        const requestId = draft.billKey.slice(0, QBO_REQUEST_ID_MAX);

        let created: QboCreatedBill;
        try {
          created = await client.create<QboCreatedBill>('Bill', payload.payload, { requestId });
        } catch (err) {
          // Error 600 means this request id already reached QuickBooks. The write may well
          // have succeeded, so the bill is looked up rather than retried blindly.
          if (err instanceof QuickBooksApiError && err.code === QBO_DUPLICATE_REQUEST_ID_CODE) {
            const recheck = await client.query<QboBillRow>(
              'Bill',
              `SELECT Id, DocNumber, TotalAmt, VendorRef FROM Bill WHERE DocNumber = '${escapeQueryValue(draft.invoiceNumber)}'`,
            );
            const landed = recheck.find(
              (bill) => bill.VendorRef?.value === vendor.ref.id && Boolean(bill.Id),
            );
            if (landed?.Id) {
              await recordBillUploaded({
                billKey: draft.billKey,
                realmId: client.realmId,
                environment: client.environment,
                quickBooksBillId: landed.Id,
                vendorRefId: vendor.ref.id,
                nowIso,
              });
              results.push(
                toResult(draft, 'uploaded', landed.Id, 'An earlier attempt had already created this bill.'),
              );
              continue;
            }
          }
          throw err;
        }

        if (!created.Id) {
          throw new QuickBooksApiError('QuickBooks created a bill but returned no Id.', { status: 200 });
        }

        await recordBillUploaded({
          billKey: draft.billKey,
          realmId: client.realmId,
          environment: client.environment,
          quickBooksBillId: created.Id,
          vendorRefId: vendor.ref.id,
          nowIso,
        });
        console.info(`${LOG} bill created`, {
          propertyCode,
          realmId: client.realmId,
          environment: client.environment,
          invoiceNumber: draft.invoiceNumber,
          vendor: vendor.ref.label,
          amount: draft.amount,
          quickBooksBillId: created.Id,
        });
        results.push(toResult(draft, 'uploaded', created.Id, null));
      } catch (err) {
        const detail = errorText(err);
        console.error(
          `${LOG} bill failed`,
          { propertyCode, invoiceNumber: draft.invoiceNumber, billKey: draft.billKey },
          err,
        );
        await recordBillFailed({
          billKey: draft.billKey,
          realmId: client.realmId,
          error: detail,
          dryRun,
          nowIso,
        }).catch(() => {});
        results.push(toResult(draft, 'failed', null, detail));
      }
    }
  }

  const allBills = await listBillsForExport(options.messageId).catch(() => []);
  const counts = allBills.length > 0 ? countBillStatuses(allBills) : emptyBillCounts();
  const uploadStatus = deriveExportUploadStatus(counts);
  const firstError = results.find((result) => result.status === 'failed')?.detail ?? null;

  await updateExportUploadState({
    messageId: options.messageId,
    uploadStatus,
    uploadCounts: counts,
    lastUploadError: firstError,
    dryRun,
    nowIso,
  });

  const summary: ExportUploadSummary = {
    messageId: options.messageId,
    sourceFilename,
    environment,
    dryRun,
    liveCreateSuppressed,
    billsConsidered: drafts.length,
    uploaded: results.filter((result) => result.status === 'uploaded').length,
    duplicates: results.filter((result) => result.status === 'duplicate').length,
    needsMapping: results.filter((result) => result.status === 'needs_mapping').length,
    failed: results.filter((result) => result.status === 'failed').length,
    skippedAlreadyUploaded,
    uploadStatus,
    counts,
    results,
  };

  console.info(`${LOG} run complete`, {
    messageId: options.messageId,
    environment,
    dryRun,
    liveCreateSuppressed,
    billsConsidered: summary.billsConsidered,
    uploaded: summary.uploaded,
    duplicates: summary.duplicates,
    needsMapping: summary.needsMapping,
    failed: summary.failed,
    skippedAlreadyUploaded,
    uploadStatus,
  });

  return summary;
}

const toResult = (
  draft: BillDraft,
  status: BillUploadStatus,
  quickBooksBillId: string | null,
  detail: string | null,
): BillUploadResult => ({
  billKey: draft.billKey,
  propertyCode: draft.propertyCode,
  invoiceNumber: draft.invoiceNumber,
  vendorName: draft.vendorName,
  amount: draft.amount,
  lineCount: draft.lines.length,
  status,
  quickBooksBillId,
  detail,
});
