import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { filterOverviewWidgets } from '@/lib/overviewWidgets';
import { extractTokenFromInput, updateShareLinkOverviewWidgets } from '@/lib/shareLinks';

export const runtime = 'nodejs';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = await request.json().catch(() => null);
  const input = body?.token ?? body?.url ?? '';
  const token = extractTokenFromInput(typeof input === 'string' ? input : '');
  const overviewWidgets = filterOverviewWidgets(body?.overviewWidgets);

  if (!token) {
    return NextResponse.json({ ok: false, message: 'token is required.' }, { status: 400 });
  }

  if (!overviewWidgets.length) {
    return NextResponse.json({ ok: false, message: 'Select at least one graph.' }, { status: 400 });
  }

  try {
    const result = await updateShareLinkOverviewWidgets(token, overviewWidgets);

    if (result.status === 'NOT_FOUND') {
      return NextResponse.json({ ok: false, message: 'Share link not found.' }, { status: 404 });
    }
    if (result.status === 'REVOKED') {
      return NextResponse.json({ ok: false, message: 'This link has been revoked.' }, { status: 410 });
    }
    if (result.status === 'EXPIRED') {
      return NextResponse.json({ ok: false, message: 'This link has expired.' }, { status: 410 });
    }
    if (result.status !== 'VALID' || !result.record) {
      return NextResponse.json({ ok: false, message: 'Unable to save graph preferences.' }, { status: 400 });
    }

    return NextResponse.json({
      ok: true,
      overviewWidgets: result.record.overviewWidgets,
      record: result.record,
    });
  } catch {
    return NextResponse.json({ ok: false, message: 'Failed to save graph preferences.' }, { status: 500 });
  }
}
