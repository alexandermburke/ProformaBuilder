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
 *   - Live creation requires BOTH an explicit request and QUICKBOOKS_LIVE_CREATE allowing
 *     THAT PROPERTY, and it is refused off Vercel. Asking for live without it downgrades to
 *     a dry run and says so, rather than silently doing nothing or silently doing it. The
 *     decision is per property so one facility can go live while the others stay dry.
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
  // Whether anything at all may be created. The decision that matters is per property, and
  // is taken inside the loop below, so one facility can go live while the rest stay dry.
  const liveAllowed = isLiveCreateEnabled();
  const liveCreateSuppressed = requestedLive && !liveAllowed;
  /** Properties this run was actually allowed to write to, so the summary can tell the truth. */
  const liveProperties = new Set<QuickBooksPropertyCode>();
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
  // A filtered run sees a subset on purpose, so it must never conclude the whole export
  // has nothing to send.
  const isFilteredRun = Boolean(options.propertyCode || options.billKey || options.limit);
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
  // Counted at the create sites rather than derived from the results list. A bill skipped
  // because it was already in QuickBooks still carries status 'uploaded', so filtering the
  // results would report it as work this run did, which is exactly the opposite of true.
  let createdThisRun = 0;

  const byProperty = new Map<QuickBooksPropertyCode, BillDraft[]>();
  for (const draft of drafts) {
    const existing = byProperty.get(draft.propertyCode);
    if (existing) existing.push(draft);
    else byProperty.set(draft.propertyCode, [draft]);
  }

  for (const [propertyCode, propertyDrafts] of byProperty) {
    // Per property, so QUICKBOOKS_LIVE_CREATE=W003 sends W003's bills for real and leaves
    // every other property's as a dry run in the same pass.
    const propertyDryRun = !requestedLive || !isLiveCreateEnabled(propertyCode);
    if (!propertyDryRun) liveProperties.add(propertyCode);

    let client;
    let resolver;
    try {
      client = await getQuickBooksClient(propertyCode);

      // The API host comes from the connection, not from QUICKBOOKS_ENVIRONMENT, so a
      // property still connected to a sandbox company would happily accept writes while
      // this run believes it is working in production. Those bills would come back with
      // real ids, be recorded `uploaded`, and settle the export, so nothing would ever
      // revisit them once the property was reconnected properly. Refuse instead: this is
      // retryable, it alerts, and it self-heals the moment the property is reconnected.
      if (client.environment !== environment) {
        throw new QuickBooksNotConnectedError(
          propertyCode,
          `${propertyCode} is connected to a ${client.environment} QuickBooks company (${
            client.companyName || client.realmId
          }) but this deployment is configured for ${environment}. Reconnect ${propertyCode} before its bills can be sent.`,
        );
      }

      resolver = await createRefResolver(client);
    } catch (err) {
      // No usable connection: fail this property's bills with the reason, and carry on to
      // the next property rather than abandoning the whole export.
      const detail =
        err instanceof QuickBooksNotConnectedError ? err.message : errorText(err);
      console.error(`${LOG} property unavailable`, { propertyCode, messageId: options.messageId }, err);
      for (const draft of propertyDrafts) {
        // A bill already settled in QuickBooks keeps its status: the property being
        // unreachable today says nothing about a bill created last week. recordBillFailed
        // makes that decision inside a transaction, because a concurrent operator-triggered
        // upload can settle a bill between a read and a write here.
        const { settled } = await recordBillFailed({
          billKey: draft.billKey,
          realmId: null,
          error: detail,
          dryRun: propertyDryRun,
          nowIso,
        });
        if (!settled) {
          results.push(toResult(draft, 'failed', null, detail));
          continue;
        }
        skippedAlreadyUploaded += 1;
        results.push(
          toResult(
            draft,
            settled.status,
            settled.quickBooksBillId,
            `Already settled as bill ${settled.quickBooksBillId ?? 'unknown'}; ${propertyCode} was unreachable this run.`,
          ),
        );
      }
      continue;
    }

    for (const draft of propertyDrafts) {
      const claim = await claimBillForUpload({
        billKey: draft.billKey,
        nowIso,
        realmId: client.realmId,
      });
      if (!claim.claimed) {
        if (claim.reason === 'already_uploaded' || claim.reason === 'already_duplicate') {
          skippedAlreadyUploaded += 1;
          results.push(
            toResult(
              draft,
              claim.record?.status ?? 'uploaded',
              claim.record?.quickBooksBillId ?? null,
              claim.reason === 'already_uploaded'
                ? `Already in ${client.companyName || propertyCode}; not created again.`
                : `Already recorded as a duplicate in ${client.companyName || propertyCode}.`,
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
            dryRun: propertyDryRun,
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
            dryRun: propertyDryRun,
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
        const sameDocAndVendor = existingBills.filter(
          (bill) => bill.VendorRef?.value === vendor.ref.id && Boolean(bill.Id),
        );
        // Matching on DocNumber and vendor alone is not enough to call it the same bill. A
        // vendor that reissues an invoice at a corrected amount keeps the number, and
        // recording that as `duplicate` is TERMINAL: the corrected amount would never post
        // and nothing would retry. An amount mismatch is a question for a person.
        const alreadyThere = sameDocAndVendor.find(
          (bill) => Math.abs((bill.TotalAmt ?? 0) - draft.amount) < 0.005,
        );
        const mismatched = alreadyThere ? null : sameDocAndVendor[0];
        if (mismatched?.Id) {
          const reason = `QuickBooks already holds bill ${mismatched.Id} with DocNumber ${
            draft.invoiceNumber
          } for ${vendor.ref.label}, but at $${(mismatched.TotalAmt ?? 0).toFixed(
            2,
          )} rather than $${draft.amount.toFixed(
            2,
          )}. Check which amount is right before this is sent.`;
          await recordBillFailed({
            billKey: draft.billKey,
            realmId: client.realmId,
            error: reason,
            dryRun: propertyDryRun,
            nowIso,
          });
          results.push(toResult(draft, 'failed', mismatched.Id, reason));
          continue;
        }
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

        if (propertyDryRun) {
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
            // Amount included for the same reason as the probe above: a bill sharing this
            // DocNumber and vendor at a different total is somebody else's, not ours.
            const landed = recheck.find(
              (bill) =>
                bill.VendorRef?.value === vendor.ref.id &&
                Boolean(bill.Id) &&
                Math.abs((bill.TotalAmt ?? 0) - draft.amount) < 0.005,
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
              createdThisRun += 1;
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
        createdThisRun += 1;
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
          dryRun: propertyDryRun,
          nowIso,
        }).catch(() => {});
        results.push(toResult(draft, 'failed', null, detail));
      }
    }
  }

  const allBills = await listBillsForExport(options.messageId).catch(() => []);
  const counts = allBills.length > 0 ? countBillStatuses(allBills) : emptyBillCounts();
  // An export whose every row was held for review yields no bills at all. Marking that
  // terminal stops the scheduled pass from reconsidering it every day forever.
  const uploadStatus: FaciliqExportUploadStatus =
    drafts.length === 0 && allBills.length === 0 && !isFilteredRun
      ? 'nothing_to_upload'
      : deriveExportUploadStatus(counts);
  const firstError = results.find((result) => result.status === 'failed')?.detail ?? null;
  // Reported per run rather than from the flag: with a per-property allowlist, an export
  // whose properties are all still dry is a dry run even when live creation is enabled
  // somewhere. Saying otherwise would claim bills reached QuickBooks that never did.
  const ranDry = liveProperties.size === 0;

  await updateExportUploadState({
    messageId: options.messageId,
    uploadStatus,
    uploadCounts: counts,
    lastUploadError: firstError,
    dryRun: ranDry,
    nowIso,
  });

  const summary: ExportUploadSummary = {
    messageId: options.messageId,
    sourceFilename,
    environment,
    dryRun: ranDry,
    liveCreateSuppressed,
    billsConsidered: drafts.length,
    uploaded: createdThisRun,
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
    dryRun: ranDry,
    liveProperties: [...liveProperties],
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
