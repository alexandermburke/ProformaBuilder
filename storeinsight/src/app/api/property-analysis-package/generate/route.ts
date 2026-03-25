import { NextRequest, NextResponse } from 'next/server';
import {
  buildFinalTokenMap,
  buildPackageFileName,
  parsePropertyAnalysisWorkbook,
  renderPropertyAnalysisPackage,
} from '@/lib/propertyAnalysisPackage';

export const runtime = 'nodejs';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const form = await request.formData();
  const file = form.get('file');
  const overridesRaw = form.get('overrides');

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Upload an Excel workbook as 'file'." }, { status: 400 });
  }

  let overrides: Record<string, string> = {};
  if (typeof overridesRaw === 'string' && overridesRaw.trim().length > 0) {
    try {
      const parsedOverrides = JSON.parse(overridesRaw) as Record<string, unknown>;
      overrides = Object.fromEntries(
        Object.entries(parsedOverrides).map(([key, value]) => [key, typeof value === 'string' ? value : String(value ?? '')]),
      );
    } catch {
      return NextResponse.json({ error: 'Invalid overrides payload.' }, { status: 400 });
    }
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const parsed = await parsePropertyAnalysisWorkbook(buffer, file.name || 'property-analysis.xlsx');
    const mergedTokens = buildFinalTokenMap(parsed, overrides);
    const rendered = await renderPropertyAnalysisPackage(mergedTokens);
    const fileName = buildPackageFileName(parsed.metadata.propertyName);

    return new NextResponse(new Uint8Array(rendered), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'Content-Disposition': `attachment; filename="${fileName}"`,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to generate the property analysis package.' },
      { status: 400 },
    );
  }
}
