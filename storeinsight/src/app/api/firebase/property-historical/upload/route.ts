import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import {
  validatePropertyHistoricalPayload,
  type PropertyHistoricalPayload,
} from '@/lib/historical/dataInput';
import { savePropertyHistoricalToFirebase } from '@/lib/historical/firebaseStore';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = await request.json().catch(() => null);
  const propertyId = body?.propertyId?.toString().trim() ?? '';
  const payload = body?.payload as PropertyHistoricalPayload | undefined;

  if (!propertyId) {
    return NextResponse.json({ ok: false, message: 'propertyId is required.' }, { status: 400 });
  }
  if (!payload || typeof payload !== 'object') {
    return NextResponse.json({ ok: false, message: 'payload is required.' }, { status: 400 });
  }

  const validation = validatePropertyHistoricalPayload(payload);
  if (!validation.ok) {
    return NextResponse.json({ ok: false, validation }, { status: 400 });
  }

  try {
    const result = await savePropertyHistoricalToFirebase(propertyId, payload);
    return NextResponse.json({ ok: true, updatedAt: result.updatedAt, validation });
  } catch (error) {
    return NextResponse.json({ ok: false, message: 'Failed to upload data.' }, { status: 500 });
  }
}

