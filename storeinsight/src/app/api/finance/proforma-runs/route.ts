import { NextRequest, NextResponse } from 'next/server';
import { createProformaRun, type SupportedProformaWorkbookFamily } from '@/lib/proformaRuns';
import { getSupabaseAdmin } from '@/server/supabase';

export const runtime = 'nodejs';

function parseOperatorType(value: FormDataEntryValue | null): SupportedProformaWorkbookFamily | 'auto' {
  const normalized = cleanCell(value).toLowerCase();
  switch (normalized) {
    case 'extra-space':
    case 'cubesmart':
    case 'public':
      return normalized;
    default:
      return 'auto';
  }
}

function cleanCell(value: FormDataEntryValue | null): string {
  return String(value ?? '')
    .replace(/\u00A0/g, ' ')
    .replace(/\r?\n/g, ' ')
    .trim();
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const form = await request.formData();
  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file is required' }, { status: 400 });
  }

  const fileName = cleanCell(file.name);
  if (!/\.(xlsx|xls|xlsm)$/i.test(fileName)) {
    return NextResponse.json({ error: 'Upload must be an Excel workbook (.xlsx, .xls, .xlsm).' }, { status: 400 });
  }

  try {
    const supabase = getSupabaseAdmin();
    const run = await createProformaRun(supabase, {
      buffer: Buffer.from(await file.arrayBuffer()),
      fileName,
      operatorTypeHint: parseOperatorType(form.get('operatorType')),
      propertyNameOverride: cleanCell(form.get('propertyName')) || null,
      reportMonthRaw: cleanCell(form.get('reportMonth')) || null,
    });
    return NextResponse.json(run);
  } catch (error) {
    console.error('[finance/proforma-runs] create failed', error);
    const message = error instanceof Error ? error.message : 'Unable to create proforma run.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
