import { NextResponse } from 'next/server';
import { firestore } from '@/server/firebaseAdmin';
import type { SnapshotRowLite } from '@/lib/types';

export const runtime = 'nodejs';

const SNAP_COLLECTION = 'snapshots';

const toSnapshotRow = (id: string, data: Record<string, unknown>): SnapshotRowLite => {
  const createdAtRaw = data.createdAt;
  const createdAt =
    typeof createdAtRaw === 'string'
      ? createdAtRaw
      : createdAtRaw instanceof Date
        ? createdAtRaw.toISOString()
        : typeof (createdAtRaw as { toDate?: () => Date } | null | undefined)?.toDate === 'function'
          ? (createdAtRaw as { toDate: () => Date }).toDate().toISOString()
          : new Date().toISOString();

  return {
    id: typeof data.id === 'string' && data.id.trim() ? data.id : id,
    facility: typeof data.facility === 'string' && data.facility.trim() ? data.facility : 'Unknown Facility',
    period: typeof data.period === 'string' && data.period.trim() ? data.period : 'Unknown Period',
    noi: typeof data.noi === 'number' && Number.isFinite(data.noi) ? data.noi : Number(data.noi) || 0,
    createdBy: typeof data.createdBy === 'string' && data.createdBy.trim() ? data.createdBy : 'User',
    createdAt,
  };
};

export async function GET(request: Request): Promise<Response> {
  if (!firestore) {
    return NextResponse.json({ ok: false, message: 'Firestore unavailable.' }, { status: 500 });
  }

  const url = new URL(request.url);
  const takeRaw = Number(url.searchParams.get('take') ?? 12);
  const take = Number.isFinite(takeRaw) && takeRaw > 0 ? Math.min(Math.floor(takeRaw), 100) : 12;

  try {
    const snapshot = await firestore.collection(SNAP_COLLECTION).orderBy('createdAt', 'desc').limit(take).get();
    const rows = snapshot.docs.map((doc) => toSnapshotRow(doc.id, doc.data() as Record<string, unknown>));
    return NextResponse.json({ ok: true, rows });
  } catch (error) {
    console.error('[api/snapshots] GET failed', error);
    return NextResponse.json({ ok: false, message: 'Unable to load snapshots.' }, { status: 500 });
  }
}

export async function POST(request: Request): Promise<Response> {
  if (!firestore) {
    return NextResponse.json({ ok: false, message: 'Firestore unavailable.' }, { status: 500 });
  }

  const body = await request.json().catch(() => null);
  const row = body?.row as Partial<SnapshotRowLite> | undefined;
  if (!row) {
    return NextResponse.json({ ok: false, message: 'Snapshot row is required.' }, { status: 400 });
  }

  const id = typeof row.id === 'string' && row.id.trim() ? row.id.trim() : '';
  const facility = typeof row.facility === 'string' && row.facility.trim() ? row.facility.trim() : '';
  const period = typeof row.period === 'string' && row.period.trim() ? row.period.trim() : '';
  const createdBy = typeof row.createdBy === 'string' && row.createdBy.trim() ? row.createdBy.trim() : 'User';
  const createdAt =
    typeof row.createdAt === 'string' && row.createdAt.trim() ? row.createdAt.trim() : new Date().toISOString();
  const noi = typeof row.noi === 'number' && Number.isFinite(row.noi) ? row.noi : Number(row.noi);

  if (!id || !facility || !period || !Number.isFinite(noi)) {
    return NextResponse.json({ ok: false, message: 'Invalid snapshot row.' }, { status: 400 });
  }

  try {
    await firestore.collection(SNAP_COLLECTION).add({
      id,
      facility,
      period,
      noi,
      createdBy,
      createdAt,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[api/snapshots] POST failed', error);
    return NextResponse.json({ ok: false, message: 'Unable to save snapshot.' }, { status: 500 });
  }
}
