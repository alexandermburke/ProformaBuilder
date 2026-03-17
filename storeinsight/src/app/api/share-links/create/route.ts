import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { createShareLink } from '@/lib/shareLinks';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = await request.json().catch(() => null);
  const propertyId = body?.propertyId?.toString().trim() ?? '';
  const investorId = body?.investorId?.toString().trim() ?? '';
  const snapshotMonthIso = body?.snapshotMonthIso?.toString().trim() ?? '';
  const ttlHoursRaw = Number(body?.ttlHours);
  const ttlHours = Number.isFinite(ttlHoursRaw) ? ttlHoursRaw : null;

  if (!propertyId || !investorId) {
    return NextResponse.json({ ok: false, message: 'propertyId and investorId are required.' }, { status: 400 });
  }

  try {
    const { id, token, expiresAt } = await createShareLink(propertyId, investorId, {
      snapshotMonthIso: snapshotMonthIso || null,
      ttlHours,
    });
    const url = `${request.nextUrl.origin}/dash/t/${token}`;
    return NextResponse.json({ id, url, expiresAt, snapshotMonthIso: snapshotMonthIso || null, ttlHours });
  } catch {
    return NextResponse.json({ ok: false, message: 'Failed to create share link.' }, { status: 500 });
  }
}

