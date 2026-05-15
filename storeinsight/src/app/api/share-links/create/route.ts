import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { createShareLink } from '@/lib/shareLinks';

const DASHBOARD_PUBLIC_ORIGIN = (() => {
  const candidates = [
    process.env.DASHBOARD_PUBLIC_ORIGIN,
    process.env.NEXT_PUBLIC_SITE_URL,
    process.env.NEXT_PUBLIC_APP_URL,
  ]
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter(Boolean);
  const safe = candidates.find((value) => !/localhost/i.test(value));
  return safe || 'https://storeinternalplatform.com';
})();

export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = await request.json().catch(() => null);
  const propertyId = body?.propertyId?.toString().trim() ?? '';
  const investorId = body?.investorId?.toString().trim() ?? '';
  const snapshotMonthIso = body?.snapshotMonthIso?.toString().trim() ?? '';
  const snapshotDateIso = body?.snapshotDateIso?.toString().trim() ?? '';
  const ttlHoursRaw = Number(body?.ttlHours);
  const ttlHours = Number.isFinite(ttlHoursRaw) ? ttlHoursRaw : null;

  if (!propertyId || !investorId) {
    return NextResponse.json({ ok: false, message: 'propertyId and investorId are required.' }, { status: 400 });
  }

  try {
    const { id, token, expiresAt, snapshotMonthIso: storedSnapshotMonthIso, snapshotDateIso: storedSnapshotDateIso } = await createShareLink(propertyId, investorId, {
      snapshotMonthIso: snapshotMonthIso || null,
      snapshotDateIso: snapshotDateIso || null,
      ttlHours,
    });
    const url = `${DASHBOARD_PUBLIC_ORIGIN}/dash/t/${token}`;
    return NextResponse.json({
      id,
      url,
      expiresAt,
      snapshotMonthIso: storedSnapshotMonthIso,
      snapshotDateIso: storedSnapshotDateIso,
      ttlHours,
    });
  } catch {
    return NextResponse.json({ ok: false, message: 'Failed to create share link.' }, { status: 500 });
  }
}
