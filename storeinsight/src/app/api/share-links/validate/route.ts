import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { extractTokenFromInput, validateShareToken } from '@/lib/shareLinks';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = await request.json().catch(() => null);
  const input = body?.token ?? body?.url ?? '';
  const token = extractTokenFromInput(typeof input === 'string' ? input : '');

  if (!token) {
    return NextResponse.json({ status: 'INVALID' }, { status: 400 });
  }

  try {
    const result = await validateShareToken(token, { markUsed: false });
    return NextResponse.json({ status: result.status, record: result.record ?? null });
  } catch (error) {
    return NextResponse.json({ status: 'INVALID' }, { status: 500 });
  }
}

