import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { getOverviewWidgetsOrDefault, type OverviewWidgetKey } from '@/lib/overviewWidgets';
import { firestore } from '@/server/firebaseAdmin';

export const runtime = 'nodejs';

const COLLECTION = 'dashboard_share_links';

type ShareLinkRecord = {
  id: string;
  propertyId: string;
  investorId: string;
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
  propertyId: (data.property_id ?? '').toString(),
  investorId: (data.investor_id ?? '').toString(),
  expiresAt: toIsoString(data.expires_at),
  revokedAt: toIsoString(data.revoked_at),
  createdAt: toIsoString(data.created_at),
  lastUsedAt: toIsoString(data.last_used_at),
  useCount: Number(data.use_count ?? 0),
  overviewWidgets: getOverviewWidgetsOrDefault(data.overview_widgets),
});

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!firestore) {
    return NextResponse.json({ ok: false, message: 'Firebase is not configured.' }, { status: 500 });
  }

  const { searchParams } = new URL(request.url);
  const propertyId = searchParams.get('propertyId')?.toString().trim() ?? '';
  const limitRaw = Number(searchParams.get('limit') ?? 50);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50;

  try {
    let query = firestore.collection(COLLECTION).orderBy('created_at', 'desc').limit(limit);
    if (propertyId) {
      query = query.where('property_id', '==', propertyId);
    }

    const snapshot = await query.get();
    const now = Date.now();
    const tokens = snapshot.docs
      .map((doc) => buildRecord(doc.id, doc.data() as Record<string, unknown>))
      .filter((record) => {
        const expiresAtMs = toMillis(record.expiresAt);
        const revokedAtMs = toMillis(record.revokedAt);
        if (revokedAtMs) return false;
        if (expiresAtMs && expiresAtMs < now) return false;
        return true;
      });

    return NextResponse.json({ ok: true, tokens, count: tokens.length });
  } catch {
    return NextResponse.json({ ok: false, message: 'Failed to load active tokens.' }, { status: 500 });
  }
}
