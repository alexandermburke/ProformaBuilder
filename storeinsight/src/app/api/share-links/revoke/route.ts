import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { revokeShareLink } from '@/lib/shareLinks';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = await request.json().catch(() => null);
  const id = body?.id?.toString().trim() ?? '';

  if (!id) {
    return NextResponse.json({ ok: false, message: 'id is required.' }, { status: 400 });
  }

  try {
    const ok = await revokeShareLink(id);
    if (!ok) {
      return NextResponse.json({ ok: false, message: 'Share link not found.' }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, message: 'Failed to revoke share link.' }, { status: 500 });
  }
}

