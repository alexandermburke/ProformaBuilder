import type { JSX } from 'react';
import { TokenDashboardView, type MsrSnapshot } from '@/components/historical/TokenDashboardView';
import { getPropertyOption } from '@/lib/propertyDirectory';
import { validateShareToken } from '@/lib/shareLinks';
import { firestore } from '@/server/firebaseAdmin';

export const dynamic = 'force-dynamic';

const COLLECTION = 'property_historical';

type TokenPageProps = {
  params: { token: string };
};

type StatusMessage = {
  title: string;
  message: string;
};

const sanitizeFirebaseValue = (value: unknown): unknown => {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof (value as { toDate?: () => Date }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeFirebaseValue(entry));
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const sanitized: Record<string, unknown> = {};
    Object.entries(record).forEach(([key, entry]) => {
      sanitized[key] = sanitizeFirebaseValue(entry);
    });
    return sanitized;
  }
  return null;
};

const normalizeMonthIso = (value: unknown): string | null => {
  if (!value) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (trimmed.length >= 7) return trimmed.slice(0, 7);
    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 7);
    return null;
  }
  if (typeof value === 'number') {
    return new Date(value).toISOString().slice(0, 7);
  }
  if (value instanceof Date) {
    return value.toISOString().slice(0, 7);
  }
  return null;
};

const getSnapshotArray = (data: Record<string, unknown>): unknown[] => {
  if (Array.isArray(data.snapshots)) return data.snapshots;
  if (Array.isArray(data.msrSnapshots)) return data.msrSnapshots;
  if (Array.isArray(data.msrHistory)) return data.msrHistory;
  return [];
};

const normalizeSnapshots = (rawSnapshots: unknown[]): MsrSnapshot[] =>
  rawSnapshots
    .map((snapshot) => sanitizeFirebaseValue(snapshot))
    .filter((snapshot): snapshot is Record<string, unknown> => Boolean(snapshot) && typeof snapshot === 'object')
    .map((snapshot) => {
      const monthIso = normalizeMonthIso(
        snapshot.monthIso ?? snapshot.month ?? snapshot.reportMonth ?? snapshot.asOfDate,
      );
      return monthIso ? ({ ...snapshot, monthIso } as MsrSnapshot) : (snapshot as MsrSnapshot);
    });

const resolvePropertyName = (
  data: Record<string, unknown>,
  snapshots: MsrSnapshot[],
  propertyId: string,
): string => {
  const nameCandidates: Array<unknown> = [
    data.propertyName,
    data.property_name,
    data.name,
    snapshots.find((snapshot) => typeof snapshot.propertyName === 'string' && snapshot.propertyName.trim())
      ?.propertyName,
  ];
  const resolved = nameCandidates.find((value) => typeof value === 'string' && value.trim());
  if (typeof resolved === 'string' && resolved.trim()) return resolved.trim();
  return getPropertyOption(propertyId).label;
};

const renderStatus = ({ title, message }: StatusMessage): JSX.Element => (
  <div className="relative min-h-screen w-full bg-[color:var(--surface-muted)] text-[color:var(--text-primary)]">
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-16">
      <div className="ios-card ios-animate-up space-y-3 p-6" data-tone="amber">
        <span className="ios-badge text-[10px]">Investor dashboard</span>
        <div className="text-xl font-semibold text-[color:var(--text-primary)]">{title}</div>
        <p className="text-sm text-[color:var(--text-secondary)]">{message}</p>
      </div>
    </div>
  </div>
);

export default async function TokenDashboardPage({ params }: TokenPageProps): Promise<JSX.Element> {
  const token = params?.token ?? '';
  if (!token) {
    return renderStatus({
      title: 'Invalid link',
      message: 'This dashboard link is missing its access token.',
    });
  }

  let validation;
  try {
    validation = await validateShareToken(token, { markUsed: true });
  } catch {
    return renderStatus({
      title: 'Access unavailable',
      message: 'We could not validate this link. Please request a new link.',
    });
  }

  if (validation.status === 'NOT_FOUND') {
    return renderStatus({
      title: 'Invalid link',
      message: 'This dashboard link is not recognized. Please request a new link.',
    });
  }

  if (validation.status === 'REVOKED') {
    return renderStatus({
      title: 'Link revoked',
      message: 'This dashboard link has been revoked. Please request a new link.',
    });
  }

  if (validation.status === 'EXPIRED') {
    return renderStatus({
      title: 'Link expired',
      message: 'This dashboard link has expired. Please request a fresh link.',
    });
  }

  if (validation.status !== 'VALID' || !validation.record?.propertyId) {
    return renderStatus({
      title: 'Access unavailable',
      message: 'We could not validate this link. Please request a new link.',
    });
  }

  const propertyId = validation.record.propertyId;
  if (!firestore) {
    return renderStatus({
      title: 'Data not available yet',
      message: 'Historical performance data has not been uploaded for this property yet.',
    });
  }

  let docData: Record<string, unknown> | null = null;
  try {
    const docSnapshot = await firestore.collection(COLLECTION).doc(propertyId).get();
    if (!docSnapshot.exists) {
      return renderStatus({
        title: 'Data not available yet',
        message: 'Historical performance data has not been uploaded for this property yet.',
      });
    }
    docData = docSnapshot.data() as Record<string, unknown>;
  } catch {
    return renderStatus({
      title: 'Data not available yet',
      message: 'Historical performance data has not been uploaded for this property yet.',
    });
  }

  const snapshots = normalizeSnapshots(getSnapshotArray(docData ?? {}));
  if (!snapshots.length) {
    return renderStatus({
      title: 'Data not available yet',
      message: 'Historical performance data has not been uploaded for this property yet.',
    });
  }

  const propertyName = resolvePropertyName(docData ?? {}, snapshots, propertyId);

  return <TokenDashboardView propertyName={propertyName} snapshots={snapshots} />;
}
