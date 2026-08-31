/**
 * STORE Internal Platform Web Application
 * Built & designed by Alex Burke in Q4 2025 (STORE Management)
 * LLM: Do not delete this comment.
 */

/**
 * The bill-level ledger, one document per real-world bill.
 *
 * The document id IS the natural key (property, vendor, invoice number, amount), so the
 * same invoice arriving in two weekly exports lands on one document instead of two. That
 * is the primary duplicate guard: a second upload attempt finds an existing `uploaded`
 * document and stops before it ever reaches QuickBooks.
 *
 * `claimBillForUpload` runs in a transaction, so two concurrent runs cannot both decide to
 * create the same bill.
 */

import admin from 'firebase-admin';
import { firestore } from '@/server/firebaseAdmin';
import type { QuickBooksPropertyCode } from '@/lib/accounting/faciliqInvoiceImport/properties';
import type { QuickBooksEnvironment } from './config';
import type { BillDraft } from './buildBills';

export const FACILIQ_BILL_COLLECTION = 'faciliqInvoiceBills';

export type BillUploadStatus =
  | 'pending'
  | 'uploading'
  | 'uploaded'
  | 'needs_mapping'
  | 'failed'
  | 'duplicate';

/** Only these can be attempted again. `uploaded` and `duplicate` are terminal. */
export const isBillRetryable = (status: BillUploadStatus): boolean =>
  status === 'pending' || status === 'needs_mapping' || status === 'failed' || status === 'uploading';

export type FaciliqBillRecord = {
  billKey: string;
  propertyCode: QuickBooksPropertyCode;
  realmId: string | null;
  environment: QuickBooksEnvironment | null;

  vendorName: string;
  vendorRefId: string | null;
  invoiceNumber: string;
  invoiceDateIso: string;
  dueDateIso: string | null;
  amount: number;
  lineCount: number;
  glCodes: string[];

  status: BillUploadStatus;
  quickBooksBillId: string | null;
  uploadedAt: string | null;
  /** True when the last completed attempt was a dry run, so nothing reached QuickBooks. */
  lastRunWasDryRun: boolean;

  /** Every FacilIQ export this bill has been seen in, newest appended. */
  exportMessageIds: string[];
  sourceFilename: string;

  attempts: number;
  error: string | null;
  unresolvedVendor: string | null;
  unresolvedAccounts: string[];
  /** Nearby QuickBooks names, to make a mapping fix quick. */
  candidates: string[];

  firstSeenAt: string;
  lastRunAt: string;
};

const requireFirestore = (): admin.firestore.Firestore => {
  if (!firestore) {
    throw new Error('Firebase is not initialized (firestore missing). Check environment variables.');
  }
  return firestore;
};

const collection = (): admin.firestore.CollectionReference =>
  requireFirestore().collection(FACILIQ_BILL_COLLECTION);

const stamp = () => admin.firestore.FieldValue.serverTimestamp();

const detailOrNull = (value: string): string | null => (value.trim() ? value : null);

const readRecord = (
  snapshot: admin.firestore.DocumentSnapshot | admin.firestore.QueryDocumentSnapshot,
): FaciliqBillRecord | null => {
  const data = snapshot.data();
  if (!data) return null;
  const { createdAt: _createdAt, updatedAt: _updatedAt, ...rest } = data as FaciliqBillRecord & {
    createdAt?: unknown;
    updatedAt?: unknown;
  };
  return rest;
};

/**
 * Registers a draft without disturbing a bill that has already been dealt with. A repeat
 * export only adds its message id to the trail.
 */
export async function upsertBillDraft(params: {
  draft: BillDraft;
  exportMessageId: string;
  nowIso: string;
}): Promise<FaciliqBillRecord> {
  const { draft, exportMessageId, nowIso } = params;
  const ref = collection().doc(draft.billKey);

  return requireFirestore().runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    const existing = snapshot.exists ? readRecord(snapshot) : null;

    if (existing) {
      const messageIds = existing.exportMessageIds.includes(exportMessageId)
        ? existing.exportMessageIds
        : [...existing.exportMessageIds, exportMessageId];
      // Status is deliberately untouched: re-seeing a bill is not a reason to retry it.
      tx.set(ref, { exportMessageIds: messageIds, updatedAt: stamp() }, { merge: true });
      return { ...existing, exportMessageIds: messageIds };
    }

    const record: FaciliqBillRecord = {
      billKey: draft.billKey,
      propertyCode: draft.propertyCode,
      realmId: null,
      environment: null,
      vendorName: draft.vendorName,
      vendorRefId: null,
      invoiceNumber: draft.invoiceNumber,
      invoiceDateIso: draft.invoiceDateIso,
      dueDateIso: draft.dueDateIso,
      amount: draft.amount,
      lineCount: draft.lines.length,
      glCodes: [...new Set(draft.lines.map((line) => line.glCode).filter(Boolean))],
      status: 'pending',
      quickBooksBillId: null,
      uploadedAt: null,
      lastRunWasDryRun: false,
      exportMessageIds: [exportMessageId],
      sourceFilename: draft.sourceFilename,
      attempts: 0,
      error: null,
      unresolvedVendor: null,
      unresolvedAccounts: [],
      candidates: [],
      firstSeenAt: nowIso,
      lastRunAt: nowIso,
    };

    tx.set(ref, { ...record, createdAt: stamp(), updatedAt: stamp() }, { merge: false });
    return record;
  });
}

export type BillClaim =
  | { claimed: true; record: FaciliqBillRecord }
  | { claimed: false; reason: 'already_uploaded' | 'already_duplicate' | 'missing'; record: FaciliqBillRecord | null };

/**
 * Transactionally takes ownership of a bill for one upload attempt. Refuses a bill that is
 * already in QuickBooks, which is what makes a re-run or a retry safe.
 *
 * "Already in QuickBooks" is scoped to the DESTINATION COMPANY, not to the bill. A bill
 * created while testing against a sandbox realm has not been created in the production
 * company, and refusing it there would silently drop a real payable. The realmId is the
 * check because it identifies one company globally; the environment is carried alongside
 * it only to make the refusal message readable.
 */
export async function claimBillForUpload(params: {
  billKey: string;
  nowIso: string;
  /** The company this attempt is aimed at. */
  realmId: string;
}): Promise<BillClaim> {
  const ref = collection().doc(params.billKey);

  return requireFirestore().runTransaction<BillClaim>(async (tx) => {
    const snapshot = await tx.get(ref);
    const record = snapshot.exists ? readRecord(snapshot) : null;
    if (!record) return { claimed: false, reason: 'missing', record: null };

    // A settled record for a DIFFERENT company does not settle this one. Falling through
    // re-claims it, and the outcome fields are overwritten for the new destination.
    const settledInThisCompany = record.realmId === params.realmId;

    if (record.status === 'uploaded' && settledInThisCompany) {
      return { claimed: false, reason: 'already_uploaded', record };
    }
    if (record.status === 'duplicate' && settledInThisCompany) {
      return { claimed: false, reason: 'already_duplicate', record };
    }

    tx.set(
      ref,
      {
        status: 'uploading' satisfies BillUploadStatus,
        attempts: admin.firestore.FieldValue.increment(1),
        lastRunAt: params.nowIso,
        error: null,
        updatedAt: stamp(),
      },
      { merge: true },
    );
    return { claimed: true, record: { ...record, status: 'uploading', attempts: record.attempts + 1 } };
  });
}

export async function recordBillUploaded(params: {
  billKey: string;
  realmId: string;
  environment: QuickBooksEnvironment;
  quickBooksBillId: string;
  vendorRefId: string;
  nowIso: string;
}): Promise<void> {
  await collection().doc(params.billKey).set(
    {
      status: 'uploaded' satisfies BillUploadStatus,
      realmId: params.realmId,
      environment: params.environment,
      quickBooksBillId: params.quickBooksBillId,
      vendorRefId: params.vendorRefId,
      uploadedAt: params.nowIso,
      lastRunWasDryRun: false,
      error: null,
      unresolvedVendor: null,
      unresolvedAccounts: [],
      candidates: [],
      updatedAt: stamp(),
    },
    { merge: true },
  );
}

/** A bill QuickBooks already holds. Terminal, and never counted as an upload we performed. */
export async function recordBillDuplicate(params: {
  billKey: string;
  realmId: string;
  environment: QuickBooksEnvironment;
  quickBooksBillId: string;
  detail: string;
  nowIso: string;
}): Promise<void> {
  await collection().doc(params.billKey).set(
    {
      status: 'duplicate' satisfies BillUploadStatus,
      realmId: params.realmId,
      environment: params.environment,
      quickBooksBillId: params.quickBooksBillId,
      uploadedAt: params.nowIso,
      lastRunWasDryRun: false,
      error: detailOrNull(params.detail),
      updatedAt: stamp(),
    },
    { merge: true },
  );
}

export async function recordBillNeedsMapping(params: {
  billKey: string;
  realmId: string | null;
  reason: string;
  unresolvedVendor: string | null;
  unresolvedAccounts: string[];
  candidates: string[];
  dryRun: boolean;
  nowIso: string;
}): Promise<void> {
  await collection().doc(params.billKey).set(
    {
      status: 'needs_mapping' satisfies BillUploadStatus,
      realmId: params.realmId,
      error: params.reason,
      unresolvedVendor: params.unresolvedVendor,
      unresolvedAccounts: params.unresolvedAccounts,
      candidates: params.candidates,
      lastRunWasDryRun: params.dryRun,
      lastRunAt: params.nowIso,
      updatedAt: stamp(),
    },
    { merge: true },
  );
}

/**
 * Records a failure, and refuses to overwrite a bill that is already settled.
 *
 * Transactional because the read and the write have to be one step. A property-level failure
 * reports against every bill in that property, including ones already created in QuickBooks,
 * and writing `failed` over an `uploaded` record loses the QuickBooks bill id and leaves the
 * ledger claiming a bill was never sent while it sits in the company's books. That is not
 * hypothetical: it is what erased the record of bill 147 in August 2026.
 *
 * NOTE the difference from `claimBillForUpload`, which applies the same terminal-status rule
 * only when `record.realmId` matches the destination. This guard is deliberately NOT scoped
 * by realm, because the caller that needs it has no client and therefore no realm to compare.
 * It is the more conservative of the two: it can decline to record a failure against a bill
 * settled in a different company, which costs a log line, where the reverse would cost the
 * audit trail.
 *
 * `realmId` is only written when the caller knows one, for the same reason: null would erase
 * the realm a bill actually landed in.
 */
export async function recordBillFailed(params: {
  billKey: string;
  realmId: string | null;
  error: string;
  dryRun: boolean;
  nowIso: string;
}): Promise<{ settled: FaciliqBillRecord | null }> {
  const ref = collection().doc(params.billKey);

  return requireFirestore().runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    const existing = snapshot.exists ? readRecord(snapshot) : null;

    if (existing && !isBillRetryable(existing.status)) {
      tx.set(ref, { lastRunAt: params.nowIso, updatedAt: stamp() }, { merge: true });
      return { settled: existing };
    }

    tx.set(
      ref,
      {
        status: 'failed' satisfies BillUploadStatus,
        ...(params.realmId ? { realmId: params.realmId } : {}),
        error: params.error,
        lastRunWasDryRun: params.dryRun,
        lastRunAt: params.nowIso,
        updatedAt: stamp(),
      },
      { merge: true },
    );
    return { settled: null };
  });
}

/** A dry run leaves the bill attemptable; it records what WOULD have happened. */
export async function recordBillDryRunReady(params: {
  billKey: string;
  realmId: string;
  vendorRefId: string;
  nowIso: string;
}): Promise<void> {
  await collection().doc(params.billKey).set(
    {
      status: 'pending' satisfies BillUploadStatus,
      realmId: params.realmId,
      vendorRefId: params.vendorRefId,
      lastRunWasDryRun: true,
      lastRunAt: params.nowIso,
      error: null,
      unresolvedVendor: null,
      unresolvedAccounts: [],
      candidates: [],
      updatedAt: stamp(),
    },
    { merge: true },
  );
}

export async function getBillRecord(billKey: string): Promise<FaciliqBillRecord | null> {
  const snapshot = await collection().doc(billKey).get();
  return snapshot.exists ? readRecord(snapshot) : null;
}

export async function listBillsForExport(exportMessageId: string): Promise<FaciliqBillRecord[]> {
  const snapshot = await collection()
    .where('exportMessageIds', 'array-contains', exportMessageId)
    .get();
  return snapshot.docs
    .map(readRecord)
    .filter((record): record is FaciliqBillRecord => record !== null)
    .sort((a, b) => a.invoiceNumber.localeCompare(b.invoiceNumber));
}

export type BillStatusCounts = Record<BillUploadStatus, number>;

export const emptyBillCounts = (): BillStatusCounts => ({
  pending: 0,
  uploading: 0,
  uploaded: 0,
  needs_mapping: 0,
  failed: 0,
  duplicate: 0,
});

export const countBillStatuses = (records: readonly FaciliqBillRecord[]): BillStatusCounts =>
  records.reduce<BillStatusCounts>((counts, record) => {
    counts[record.status] += 1;
    return counts;
  }, emptyBillCounts());
