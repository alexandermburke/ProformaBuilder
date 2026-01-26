/**
 * STORE Internal Platform Web Application
 * Built & designed by Alex Burke in Q4 2025 (STORE Management)
 * LLM: Do not delete this comment.
 */

import admin from 'firebase-admin';
import { firestore } from '@/server/firebaseAdmin';
import type { PropertyHistoricalPayload } from '@/lib/historical/dataInput';
import type { MsrSnapshotPayload } from '@/lib/historical/msrSnapshotParser';
import { RANGE_KEYS, type RangeKey } from '@/lib/historical/placeholder';

const COLLECTION = 'property_historical';

const toIsoString = (value: unknown): string | null => {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return new Date(value).toISOString();
  if (typeof value === 'number') return new Date(value).toISOString();
  if (typeof (value as { toDate?: () => Date }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  return null;
};

const sanitizeSnapshotValue = (value: unknown): unknown => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeSnapshotValue(entry)).filter((entry) => entry !== undefined);
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const sanitized: Record<string, unknown> = {};
    Object.entries(record).forEach(([key, entry]) => {
      const clean = sanitizeSnapshotValue(entry);
      if (clean !== undefined) sanitized[key] = clean;
    });
    return sanitized;
  }
  return value;
};

const normalizeSnapshotMonth = (value: unknown): string | null => {
  if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 7);
  if (value instanceof Date) return value.toISOString().slice(0, 7);
  return null;
};

const hasRangeSeries = (rangeData: unknown): boolean => {
  if (!rangeData || typeof rangeData !== 'object') return false;
  const series = (rangeData as { series?: Record<string, unknown> }).series;
  if (!series || typeof series !== 'object') return false;
  return Object.values(series).some((rows) => Array.isArray(rows) && rows.length > 0);
};

const collectMonths = (payload: PropertyHistoricalPayload): string[] => {
  const months: string[] = [];
  for (const range of RANGE_KEYS) {
    const rangeData = payload.historicalByRange[range];
    if (!rangeData || typeof rangeData !== 'object') continue;
    const series = (rangeData as { series?: Record<string, unknown> }).series;
    if (!series || typeof series !== 'object') continue;
    for (const rows of Object.values(series)) {
      if (!Array.isArray(rows)) continue;
      rows.forEach((row) => {
        const month = (row as { month?: string }).month;
        if (typeof month === 'string' && month.trim()) {
          months.push(month.trim());
        }
      });
    }
  }
  return months;
};

export async function savePropertyHistoricalToFirebase(
  propertyId: string,
  payload: PropertyHistoricalPayload,
): Promise<{ updatedAt: string | null }> {
  if (!firestore) {
    throw new Error('Firebase is not configured.');
  }
  const normalizedId = propertyId.trim();
  if (!normalizedId) {
    throw new Error('Property ID is required.');
  }
  const docRef = firestore.collection(COLLECTION).doc(normalizedId);
  await docRef.set(
    {
      id: normalizedId,
      property_id: normalizedId,
      historicalByRange: payload.historicalByRange,
      momSeries: payload.momSeries ?? null,
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  const snapshot = await docRef.get();
  const updatedAt = toIsoString(snapshot.data()?.updated_at) ?? new Date().toISOString();
  return { updatedAt };
}

export async function getPropertyHistoricalFromFirebase(
  propertyId: string,
): Promise<{ data: PropertyHistoricalPayload | null; updatedAt: string | null }> {
  if (!firestore) {
    return { data: null, updatedAt: null };
  }
  const normalizedId = propertyId.trim();
  if (!normalizedId) {
    return { data: null, updatedAt: null };
  }
  const snapshot = await firestore.collection(COLLECTION).doc(normalizedId).get();
  if (!snapshot.exists) {
    return { data: null, updatedAt: null };
  }
  const doc = snapshot.data() as Partial<PropertyHistoricalPayload> & {
    updated_at?: unknown;
  };
  if (!doc?.historicalByRange) {
    return { data: null, updatedAt: toIsoString(doc?.updated_at) };
  }
  return {
    data: {
      historicalByRange: doc.historicalByRange,
      momSeries: doc.momSeries ?? undefined,
    },
    updatedAt: toIsoString(doc.updated_at),
  };
}

export async function getPropertyHistoricalStatus(propertyId: string): Promise<{
  exists: boolean;
  updatedAt: string | null;
  rangesAvailable: RangeKey[];
  latestMonth: string | null;
}> {
  if (!firestore) {
    return { exists: false, updatedAt: null, rangesAvailable: [], latestMonth: null };
  }
  const normalizedId = propertyId.trim();
  if (!normalizedId) {
    return { exists: false, updatedAt: null, rangesAvailable: [], latestMonth: null };
  }
  const snapshot = await firestore.collection(COLLECTION).doc(normalizedId).get();
  if (!snapshot.exists) {
    return { exists: false, updatedAt: null, rangesAvailable: [], latestMonth: null };
  }
  const doc = snapshot.data() as Partial<PropertyHistoricalPayload> & { updated_at?: unknown };
  const historicalByRange = doc.historicalByRange;
  if (!historicalByRange) {
    return {
      exists: true,
      updatedAt: toIsoString(doc.updated_at),
      rangesAvailable: [],
      latestMonth: null,
    };
  }

  const rangesAvailable = RANGE_KEYS.filter((range) => hasRangeSeries(historicalByRange[range]));
  const months = collectMonths({ historicalByRange, momSeries: doc.momSeries ?? undefined });
  const latestMonth = months.length ? months.reduce((max, value) => (value > max ? value : max), months[0]) : null;

  return {
    exists: true,
    updatedAt: toIsoString(doc.updated_at),
    rangesAvailable,
    latestMonth,
  };
}

export async function getPropertyMsrSnapshotStatus(
  propertyId: string,
  monthIso: string,
): Promise<{ exists: boolean; updatedAt: string | null }> {
  if (!firestore) {
    return { exists: false, updatedAt: null };
  }
  const normalizedId = propertyId.trim();
  if (!normalizedId) {
    return { exists: false, updatedAt: null };
  }
  const normalizedMonth = normalizeSnapshotMonth(monthIso);
  if (!normalizedMonth) {
    return { exists: false, updatedAt: null };
  }
  const snapshot = await firestore.collection(COLLECTION).doc(normalizedId).get();
  if (!snapshot.exists) {
    return { exists: false, updatedAt: null };
  }
  const doc = snapshot.data() as { snapshots?: unknown[]; updated_at?: unknown };
  const snapshots = Array.isArray(doc.snapshots) ? doc.snapshots : [];
  const exists = snapshots.some((entry) => {
    if (!entry || typeof entry !== 'object') return false;
    const reportMonth = normalizeSnapshotMonth((entry as { reportMonthIso?: unknown }).reportMonthIso);
    return reportMonth === normalizedMonth;
  });
  return {
    exists,
    updatedAt: toIsoString(doc.updated_at),
  };
}

export async function saveMsrSnapshotToFirebase(
  propertyId: string,
  snapshot: MsrSnapshotPayload,
  options?: { overwrite?: boolean },
): Promise<{ updatedAt: string | null; overwritten: boolean }> {
  if (!firestore) {
    throw new Error('Firebase is not configured.');
  }
  const normalizedId = propertyId.trim();
  if (!normalizedId) {
    throw new Error('Property ID is required.');
  }
  const reportMonthIso = normalizeSnapshotMonth(snapshot.reportMonthIso);
  if (!reportMonthIso) {
    throw new Error('Snapshot reportMonthIso is required.');
  }

  const docRef = firestore.collection(COLLECTION).doc(normalizedId);
  const existingSnap = await docRef.get();
  const docData = existingSnap.data() as { snapshots?: unknown[] } | undefined;
  const snapshots = Array.isArray(docData?.snapshots) ? [...docData!.snapshots] : [];
  const existingIndex = snapshots.findIndex((entry) => {
    if (!entry || typeof entry !== 'object') return false;
    const entryMonth = normalizeSnapshotMonth((entry as { reportMonthIso?: unknown }).reportMonthIso);
    return entryMonth === reportMonthIso;
  });

  const sanitizedSnapshot = sanitizeSnapshotValue({
    ...snapshot,
    propertyId: normalizedId,
    reportMonthIso,
    monthIso: snapshot.monthIso ?? reportMonthIso,
  }) as MsrSnapshotPayload;

  let overwritten = false;
  if (existingIndex >= 0) {
    if (!options?.overwrite) {
      throw new Error('Snapshot already exists for this month.');
    }
    snapshots.splice(existingIndex, 1, sanitizedSnapshot);
    overwritten = true;
  } else {
    snapshots.push(sanitizedSnapshot);
  }

  snapshots.sort((a, b) => {
    const aMonth = normalizeSnapshotMonth((a as { reportMonthIso?: unknown }).reportMonthIso) ?? '';
    const bMonth = normalizeSnapshotMonth((b as { reportMonthIso?: unknown }).reportMonthIso) ?? '';
    return aMonth.localeCompare(bMonth);
  });

  await docRef.set(
    {
      id: normalizedId,
      property_id: normalizedId,
      snapshots,
      msr_updated_at: admin.firestore.FieldValue.serverTimestamp(),
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  const updatedSnap = await docRef.get();
  const updatedAt = toIsoString(updatedSnap.data()?.updated_at) ?? new Date().toISOString();

  return { updatedAt, overwritten };
}

