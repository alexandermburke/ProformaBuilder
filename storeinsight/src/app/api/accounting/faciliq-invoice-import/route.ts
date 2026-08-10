/**
 * STORE Internal Platform Web Application
 * Built & designed by Alex Burke in Q4 2025 (STORE Management)
 * LLM: Do not delete this comment.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { buildOutputFiles } from '@/lib/accounting/faciliqInvoiceImport/buildSplitFiles';
import { toClientReport, type FaciliqInvoiceResponse } from '@/lib/accounting/faciliqInvoiceImport/clientReport';
import { reviewInvoiceCsv } from '@/lib/accounting/faciliqInvoiceImport/reviewInvoices';

export const runtime = 'nodejs';

const MAX_BYTES = 10 * 1024 * 1024;

/**
 * Reads the weekly FacilIQ export, returns the review report, and returns the split
 * files inline. Stateless on purpose: a weekly invoice CSV is small, so there is no job
 * store to go stale and no second request that could hand back a different split than
 * the one the operator just reviewed.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const form = await request.formData().catch(() => null);
  if (!form) {
    return NextResponse.json({ error: 'Expected a multipart form upload.' }, { status: 400 });
  }

  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Attach the FacilIQ CSV as "file".' }, { status: 400 });
  }
  if (!/\.csv$/i.test(file.name)) {
    return NextResponse.json(
      { error: `Expected a .csv export, got "${file.name}".` },
      { status: 400 },
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB; the limit is 10 MB.` },
      { status: 413 },
    );
  }

  const text = new TextDecoder('utf-8').decode(await file.arrayBuffer());

  // UTC date. Only used for the "invoice date is in the future" check, where erring one
  // day late is better than flagging a same-day invoice for an operator on Pacific time.
  const asOfIso = new Date().toISOString().slice(0, 10);

  const report = reviewInvoiceCsv(text, { sourceFilename: file.name, asOfIso });
  const payload: FaciliqInvoiceResponse = {
    report: toClientReport(report),
    files: buildOutputFiles(report),
  };

  return NextResponse.json(payload);
}
