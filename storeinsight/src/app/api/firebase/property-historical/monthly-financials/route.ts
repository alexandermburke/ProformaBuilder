import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import {
  getPropertyMonthlyFinancialRows,
  updatePropertyMonthlyFinancialRow,
} from '@/lib/historical/firebaseStore';

const parseNullableNumber = (value: unknown): number | null | typeof Number.NaN => {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : Number.NaN;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed.replace(/,/g, ''));
    return Number.isFinite(parsed) ? parsed : Number.NaN;
  }
  return Number.NaN;
};

export async function GET(request: NextRequest): Promise<NextResponse> {
  const propertyId = request.nextUrl.searchParams.get('propertyId')?.trim() ?? '';
  if (!propertyId) {
    return NextResponse.json({ ok: false, message: 'propertyId is required.' }, { status: 400 });
  }

  try {
    const result = await getPropertyMonthlyFinancialRows(propertyId);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error('[property-historical/monthly-financials] GET failed', { propertyId }, error);
    return NextResponse.json({ ok: false, message: 'Failed to load monthly financials.' }, { status: 500 });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = (await request.json().catch(() => null)) as
    | { propertyId?: string; monthIso?: string; expenses?: unknown; noi?: unknown }
    | null;

  const propertyId = body?.propertyId?.trim() ?? '';
  const monthIso = body?.monthIso?.trim() ?? '';
  if (!propertyId || !monthIso) {
    return NextResponse.json(
      { ok: false, message: 'propertyId and monthIso are required.' },
      { status: 400 },
    );
  }

  const expenses = parseNullableNumber(body?.expenses);
  const noi = parseNullableNumber(body?.noi);
  if (Number.isNaN(expenses) || Number.isNaN(noi)) {
    return NextResponse.json(
      { ok: false, message: 'Expenses and NOI must be valid numbers or blank.' },
      { status: 400 },
    );
  }

  try {
    const result = await updatePropertyMonthlyFinancialRow(propertyId, monthIso, { expenses, noi });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update monthly financials.';
    console.error('[property-historical/monthly-financials] POST failed', { propertyId, monthIso }, error);
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
