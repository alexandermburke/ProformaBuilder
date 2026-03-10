import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { getPropertyBudgetFinancialStatus } from '@/lib/historical/firebaseStore';
import { parseBudgetFinancialWorkbook } from '@/lib/historical/budgetFinancialParser';

export const runtime = 'nodejs';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const formData = await request.formData().catch(() => null);
  if (!formData) {
    return NextResponse.json({ ok: false, message: 'Invalid form data.' }, { status: 400 });
  }

  const propertyId = formData.get('propertyId')?.toString().trim() ?? '';
  const file = formData.get('file');

  if (!propertyId) {
    return NextResponse.json({ ok: false, message: 'propertyId is required.' }, { status: 400 });
  }

  if (!file || !(file instanceof Blob)) {
    return NextResponse.json({ ok: false, message: 'Upload a .xlsx file.' }, { status: 400 });
  }

  const filename = 'name' in file ? String(file.name) : '';
  if (!filename.toLowerCase().endsWith('.xlsx')) {
    return NextResponse.json({ ok: false, message: 'Upload must be a .xlsx file.' }, { status: 400 });
  }

  let parsed;
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    parsed = await parseBudgetFinancialWorkbook(buffer);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unable to parse the budget workbook.';
    return NextResponse.json({ ok: false, message }, { status: 400 });
  }

  const snapshot = {
    ...parsed.snapshot,
    propertyId,
  };

  if (!snapshot.reportMonthIso) {
    return NextResponse.json(
      { ok: false, message: 'Unable to determine reportMonthIso from the workbook.' },
      { status: 400 },
    );
  }

  const status = await getPropertyBudgetFinancialStatus(propertyId, snapshot.reportMonthIso);

  return NextResponse.json({
    ok: true,
    snapshot,
    warnings: parsed.warnings,
    sourceSheet: parsed.sourceSheet,
    sources: parsed.sources,
    exists: status.exists,
    hasFinancials: status.hasFinancials,
    updatedAt: status.updatedAt,
  });
}
