import admin from 'firebase-admin';
import { firestore, storage } from '@/server/firebaseAdmin';
import { parseMsrWorkbook } from '@/lib/historical/msrSnapshotParser';
import { saveMsrSnapshotToFirebase } from '@/lib/historical/firebaseStore';

const PROPERTY_COLLECTION = 'dailySummaryProperties';
const MSR_REPORTS_COLLECTION = 'msrReports';
const HISTORICAL_COLLECTION = 'property_historical';

type PropertyConfigDoc = {
  propertyId?: string;
  tenantPropertyId?: string;
  propertyCode?: string;
  name?: string;
};

type MsrReportDoc = {
  propertyCode?: string;
  reportDate?: string;
  storagePath?: string;
  emailDate?: string;
};

const normalizeCode = (value: unknown): string => String(value ?? '').trim().toLowerCase();

const resolvePropertyConfig = async (propertyId: string): Promise<PropertyConfigDoc | null> => {
  if (!firestore) return null;
  const normalizedId = propertyId.trim();
  if (!normalizedId) return null;

  const byId = await firestore.collection(PROPERTY_COLLECTION).doc(normalizedId).get();
  if (byId.exists) return byId.data() as PropertyConfigDoc;

  const byPropertyId = await firestore
    .collection(PROPERTY_COLLECTION)
    .where('propertyId', '==', normalizedId)
    .limit(1)
    .get();
  if (!byPropertyId.empty) return byPropertyId.docs[0].data() as PropertyConfigDoc;

  const byTenantId = await firestore
    .collection(PROPERTY_COLLECTION)
    .where('tenantPropertyId', '==', normalizedId)
    .limit(1)
    .get();
  if (!byTenantId.empty) return byTenantId.docs[0].data() as PropertyConfigDoc;

  return null;
};

const getLatestMsrReport = async (propertyCode: string): Promise<{
  id: string;
  data: MsrReportDoc;
} | null> => {
  if (!firestore) return null;
  const normalized = normalizeCode(propertyCode);
  if (!normalized) return null;

  const snap = await firestore
    .collection(MSR_REPORTS_COLLECTION)
    .where('propertyCode', '==', normalized)
    .orderBy('reportDate', 'desc')
    .limit(1)
    .get();

  if (snap.empty) return null;
  return { id: snap.docs[0].id, data: snap.docs[0].data() as MsrReportDoc };
};

const needsSync = async (
  propertyId: string,
  reportDocId: string,
  reportDate?: string,
): Promise<boolean> => {
  if (!firestore) return false;
  const current = await firestore.collection(HISTORICAL_COLLECTION).doc(propertyId).get();
  if (!current.exists) return true;
  const data = current.data() as {
    latest_msr_doc_id?: string;
    latest_msr_report_date?: string;
  };
  if (data.latest_msr_doc_id !== reportDocId) return true;
  if ((data.latest_msr_report_date ?? '') !== (reportDate ?? '')) return true;
  return false;
};

export async function syncLatestMsrSnapshotForProperty(propertyId: string): Promise<{
  synced: boolean;
  reason?: string;
}> {
  if (!firestore || !storage) {
    return { synced: false, reason: 'firebase-unavailable' };
  }

  const normalizedId = propertyId.trim();
  if (!normalizedId) {
    return { synced: false, reason: 'missing-property-id' };
  }

  const config = await resolvePropertyConfig(normalizedId);
  const propertyCode = normalizeCode(config?.propertyCode);
  if (!propertyCode) {
    return { synced: false, reason: 'missing-property-code' };
  }

  const latest = await getLatestMsrReport(propertyCode);
  if (!latest) {
    return { synced: false, reason: 'no-msr-report' };
  }

  const reportDate = latest.data.reportDate;
  const storagePath = latest.data.storagePath;
  if (!storagePath) {
    return { synced: false, reason: 'missing-storage-path' };
  }

  const shouldSync = await needsSync(normalizedId, latest.id, reportDate);
  if (!shouldSync) {
    return { synced: false, reason: 'already-synced' };
  }

  const [buffer] = await storage.file(storagePath).download();
  const parsed = parseMsrWorkbook(buffer);
  const snapshot = {
    ...parsed.snapshot,
    propertyId: normalizedId,
    propertyName: parsed.snapshot.propertyName ?? config?.name ?? undefined,
    reportDate: parsed.snapshot.reportDate ?? reportDate,
  };

  await saveMsrSnapshotToFirebase(normalizedId, snapshot, { overwrite: true });

  await firestore
    .collection(HISTORICAL_COLLECTION)
    .doc(normalizedId)
    .set(
      {
        latest_msr_doc_id: latest.id,
        latest_msr_report_date: reportDate ?? null,
        latest_msr_storage_path: storagePath,
        latest_msr_synced_at: admin.firestore.FieldValue.serverTimestamp(),
        updated_at: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

  return { synced: true };
}
