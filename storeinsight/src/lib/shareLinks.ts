/**
 * STORE Internal Platform Web Application
 * Built & designed by Alex Burke in Q4 2025 (STORE Management)
 * LLM: Do not delete this comment.
 */

import crypto from 'crypto';
import admin from 'firebase-admin';
import {
  DEFAULT_OVERVIEW_WIDGETS,
  filterOverviewWidgets,
  getOverviewWidgetsOrDefault,
  type OverviewWidgetKey,
} from '@/lib/overviewWidgets';
import { firestore } from '@/server/firebaseAdmin';

const COLLECTION = 'dashboard_share_links';
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_TOKEN_TTL_MS = 365 * 24 * 60 * 60 * 1000;

export type ShareLinkStatus = 'VALID' | 'EXPIRED' | 'REVOKED' | 'NOT_FOUND' | 'INVALID';

export type ShareLinkRecord = {
  id: string;
  token: string | null;
  propertyId: string;
  investorId: string;
  snapshotMonthIso: string | null;
  snapshotDateIso: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string | null;
  lastUsedAt: string | null;
  useCount: number;
  overviewWidgets: OverviewWidgetKey[];
};

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

const toMillis = (value: unknown): number | null => {
  if (!value) return null;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return new Date(value).getTime();
  if (typeof (value as { toDate?: () => Date }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate().getTime();
  }
  return null;
};

const buildRecord = (id: string, data: Record<string, unknown>): ShareLinkRecord => ({
  id,
  token: typeof data.token === 'string' && data.token.trim() ? data.token : null,
  propertyId: (data.property_id ?? '').toString(),
  investorId: (data.investor_id ?? '').toString(),
  snapshotMonthIso: typeof data.snapshot_month_iso === 'string' ? data.snapshot_month_iso : null,
  snapshotDateIso: typeof data.snapshot_date_iso === 'string' ? data.snapshot_date_iso : null,
  expiresAt: toIsoString(data.expires_at),
  revokedAt: toIsoString(data.revoked_at),
  createdAt: toIsoString(data.created_at),
  lastUsedAt: toIsoString(data.last_used_at),
  useCount: Number(data.use_count ?? 0),
  overviewWidgets: getOverviewWidgetsOrDefault(data.overview_widgets),
});

const normalizeSnapshotMonthIso = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const normalized = value.trim();
  return /^\d{4}-\d{2}$/.test(normalized) ? normalized : null;
};

const normalizeSnapshotDateIso = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const normalized = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null;
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== normalized ? null : normalized;
};

const normalizeTtlMs = (ttlHours?: number | null): number => {
  if (!Number.isFinite(ttlHours)) return TOKEN_TTL_MS;
  const ttlMs = Math.round(Number(ttlHours) * 60 * 60 * 1000);
  if (!Number.isFinite(ttlMs)) return TOKEN_TTL_MS;
  return Math.min(Math.max(ttlMs, 60 * 60 * 1000), MAX_TOKEN_TTL_MS);
};

const generateToken = (): string => crypto.randomBytes(32).toString('hex');
const hashToken = (token: string): string => crypto.createHash('sha256').update(token).digest('hex');

export const extractTokenFromInput = (input: string): string | null => {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/\/dash\/t\/([^?#/]+)/i);
  if (match?.[1]) return match[1];
  return trimmed;
};

const resolveShareLinkByToken = async (
  token: string,
): Promise<{
  status: ShareLinkStatus;
  record?: ShareLinkRecord;
  doc?: FirebaseFirestore.QueryDocumentSnapshot<FirebaseFirestore.DocumentData>;
}> => {
  if (!firestore) {
    throw new Error('Firebase is not configured.');
  }
  const normalizedToken = token.trim();
  if (!normalizedToken) {
    return { status: 'INVALID' };
  }
  const tokenHash = hashToken(normalizedToken);
  const snapshot = await firestore.collection(COLLECTION).where('token_hash', '==', tokenHash).limit(1).get();
  if (snapshot.empty) {
    return { status: 'NOT_FOUND' };
  }

  const doc = snapshot.docs[0];
  const data = doc.data();
  const record = buildRecord(doc.id, data);
  const expiresAtMs = toMillis(data.expires_at);
  const revokedAtMs = toMillis(data.revoked_at);
  const now = Date.now();

  if (revokedAtMs) {
    return { status: 'REVOKED', record, doc };
  }
  if (expiresAtMs && expiresAtMs < now) {
    return { status: 'EXPIRED', record, doc };
  }

  return { status: 'VALID', record, doc };
};

export async function createShareLink(
  propertyId: string,
  investorId: string,
  options?: { snapshotMonthIso?: string | null; snapshotDateIso?: string | null; ttlHours?: number | null },
): Promise<{ id: string; token: string; expiresAt: string; snapshotMonthIso: string | null; snapshotDateIso: string | null }> {
  if (!firestore) {
    throw new Error('Firebase is not configured.');
  }
  const normalizedProperty = propertyId.trim();
  const normalizedInvestor = investorId.trim();
  const snapshotDateIso = normalizeSnapshotDateIso(options?.snapshotDateIso);
  const snapshotMonthIso = snapshotDateIso?.slice(0, 7) ?? normalizeSnapshotMonthIso(options?.snapshotMonthIso);
  if (!normalizedProperty || !normalizedInvestor) {
    throw new Error('propertyId and investorId are required.');
  }
  const token = generateToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + normalizeTtlMs(options?.ttlHours));

  const docRef = firestore.collection(COLLECTION).doc();
  await docRef.set({
    id: docRef.id,
    token,
    token_hash: tokenHash,
    property_id: normalizedProperty,
    investor_id: normalizedInvestor,
    snapshot_month_iso: snapshotMonthIso,
    snapshot_date_iso: snapshotDateIso,
    expires_at: admin.firestore.Timestamp.fromDate(expiresAt),
    revoked_at: null,
    created_at: admin.firestore.FieldValue.serverTimestamp(),
    last_used_at: null,
    use_count: 0,
    overview_widgets: DEFAULT_OVERVIEW_WIDGETS,
  });

  return {
    id: docRef.id,
    token,
    expiresAt: expiresAt.toISOString(),
    snapshotMonthIso,
    snapshotDateIso,
  };
}

export async function validateShareToken(
  token: string,
  options?: { markUsed?: boolean },
): Promise<{ status: ShareLinkStatus; record?: ShareLinkRecord }> {
  const resolved = await resolveShareLinkByToken(token);
  if (resolved.status !== 'VALID' || !resolved.doc || !resolved.record) {
    return { status: resolved.status, record: resolved.record };
  }

  if (options?.markUsed) {
    await resolved.doc.ref.set(
      {
        last_used_at: admin.firestore.FieldValue.serverTimestamp(),
        use_count: admin.firestore.FieldValue.increment(1),
      },
      { merge: true },
    );
  }

  return { status: 'VALID', record: resolved.record };
}

export async function updateShareLinkOverviewWidgets(
  token: string,
  overviewWidgets: OverviewWidgetKey[],
): Promise<{ status: ShareLinkStatus; record?: ShareLinkRecord }> {
  const nextWidgets = filterOverviewWidgets(overviewWidgets);
  if (!nextWidgets.length) {
    return { status: 'INVALID' };
  }

  const resolved = await resolveShareLinkByToken(token);
  if (resolved.status !== 'VALID' || !resolved.doc || !resolved.record) {
    return { status: resolved.status, record: resolved.record };
  }

  await resolved.doc.ref.set(
    {
      overview_widgets: nextWidgets,
    },
    { merge: true },
  );

  return {
    status: 'VALID',
    record: {
      ...resolved.record,
      overviewWidgets: nextWidgets,
    },
  };
}

export async function revokeShareLink(id: string): Promise<boolean> {
  if (!firestore) {
    throw new Error('Firebase is not configured.');
  }
  const normalizedId = id.trim();
  if (!normalizedId) return false;
  const docRef = firestore.collection(COLLECTION).doc(normalizedId);
  const snapshot = await docRef.get();
  if (!snapshot.exists) return false;
  await docRef.set(
    {
      revoked_at: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  return true;
}

