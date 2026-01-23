import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { createShareLink } from '@/lib/shareLinks';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = await request.json().catch(() => null);
  const propertyId = body?.propertyId?.toString().trim() ?? '';
  const investorId = body?.investorId?.toString().trim() ?? '';

  if (!propertyId || !investorId) {
    return NextResponse.json({ ok: false, message: 'propertyId and investorId are required.' }, { status: 400 });
  }

  try {
    const { id, token, expiresAt } = await createShareLink(propertyId, investorId);
    const url = `${request.nextUrl.origin}/dash/t/${token}`;
    return NextResponse.json({ id, url, expiresAt });
  } catch {
    return NextResponse.json({ ok: false, message: 'Failed to create share link.' }, { status: 500 });
  }
}

