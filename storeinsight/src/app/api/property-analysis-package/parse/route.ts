import { NextRequest, NextResponse } from 'next/server';
import { parsePropertyAnalysisWorkbook } from '@/lib/propertyAnalysisPackage';

export const runtime = 'nodejs';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const form = await request.formData();
  const file = form.get('file');

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Upload an Excel workbook as 'file'." }, { status: 400 });
  }

  const lowerName = (file.name || '').toLowerCase();
  if (!lowerName.endsWith('.xlsx') && !lowerName.endsWith('.xls')) {
    return NextResponse.json({ error: 'Upload must be a supported proforma Excel workbook (.xlsx or .xls).' }, { status: 400 });
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const parsed = await parsePropertyAnalysisWorkbook(buffer, file.name || 'property-analysis.xlsx');
    return NextResponse.json(parsed);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to parse the property analysis workbook.' },
      { status: 400 },
    );
  }
}
