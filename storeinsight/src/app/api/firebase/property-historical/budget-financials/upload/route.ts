import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import type { MsrSnapshotPayload } from '@/lib/historical/msrSnapshotParser';
import { saveBudgetFinancialSnapshotToFirebase } from '@/lib/historical/firebaseStore';

export const runtime = 'nodejs';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = await request.json().catch(() => null);
  const propertyId = body?.propertyId?.toString().trim() ?? '';
  const overwrite = Boolean(body?.overwrite);
  const snapshot = body?.snapshot as MsrSnapshotPayload | undefined;

  if (!propertyId) {
    return NextResponse.json({ ok: false, message: 'propertyId is required.' }, { status: 400 });
  }
  if (!snapshot || typeof snapshot !== 'object') {
    return NextResponse.json({ ok: false, message: 'snapshot payload is required.' }, { status: 400 });
  }
  if (!snapshot.financials || typeof snapshot.financials !== 'object') {
    return NextResponse.json({ ok: false, message: 'snapshot financials are required.' }, { status: 400 });
  }

  try {
    const result = await saveBudgetFinancialSnapshotToFirebase(propertyId, snapshot, { overwrite });
    return NextResponse.json({
      ok: true,
      updatedAt: result.updatedAt,
      overwritten: result.overwritten,
      created: result.created,
      merged: result.merged,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to upload financial snapshot.';
    const status = message.toLowerCase().includes('already exists') ? 409 : 500;
    return NextResponse.json({ ok: false, message }, { status });
  }
}
