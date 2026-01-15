import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';

export const runtime = 'nodejs';

const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  const precision = value >= 10 || index === 0 ? 0 : 1;
  return `${value.toFixed(precision)} ${units[index]}`;
};

const summarizeWorkbook = (buffer: Buffer): { sheetNames: string[]; sheetCount: number } => {
  try {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheetNames = workbook.SheetNames.filter(Boolean);
    return { sheetNames, sheetCount: sheetNames.length };
  } catch (err) {
    console.warn('[comp-sets/manual] unable to parse workbook', err);
    return { sheetNames: [], sheetCount: 0 };
  }
};

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const propertyId = String(formData.get('propertyId') ?? '').trim();
  const propertyName = String(formData.get('propertyName') ?? '').trim();
  const propertyCode = String(formData.get('propertyCode') ?? '').trim();
  const asOfDate = String(formData.get('asOfDate') ?? '').trim();
  const notes = String(formData.get('notes') ?? '').trim();
  const file = formData.get('file');

  if (!propertyId) {
    return NextResponse.json({ error: 'propertyId is required' }, { status: 400 });
  }

  if (!asOfDate) {
    return NextResponse.json({ error: 'asOfDate is required' }, { status: 400 });
  }

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file is required' }, { status: 400 });
  }

  if (!file.name.toLowerCase().endsWith('.xlsx')) {
    return NextResponse.json({ error: 'Upload must be a .xlsx file.' }, { status: 400 });
  }

  const workbookBuffer = Buffer.from(await file.arrayBuffer());
  const workbookSummary = summarizeWorkbook(workbookBuffer);

  const PptxGenJS = (await import('pptxgenjs')).default;
  const deck = new PptxGenJS();
  deck.layout = '16x9';

  const titleSlide = deck.addSlide();
  titleSlide.background = { color: 'F8FAFC' };

  titleSlide.addText('STORE Comp Set Report', {
    x: 0.6,
    y: 0.4,
    w: 12,
    fontSize: 34,
    bold: true,
    color: '0B1120',
    fontFace: 'Segoe UI',
  });

  titleSlide.addText(propertyName || propertyId, {
    x: 0.6,
    y: 1.25,
    w: 12,
    fontSize: 24,
    bold: true,
    color: '2563EB',
    fontFace: 'Segoe UI',
  });

  titleSlide.addText(asOfDate ? `As of ${asOfDate}` : 'As of latest', {
    x: 0.6,
    y: 1.85,
    fontSize: 14,
    color: '475569',
    fontFace: 'Segoe UI',
  });

  const sheetPreview = workbookSummary.sheetNames.slice(0, 6);
  const sheetSuffix =
    workbookSummary.sheetCount > sheetPreview.length
      ? ` +${workbookSummary.sheetCount - sheetPreview.length} more`
      : '';
  const infoLines = [
    `Property ID: ${propertyId}`,
    `Property code: ${propertyCode || propertyId}`,
    `Source workbook: ${file.name}`,
    `Workbook size: ${formatBytes(file.size)}`,
    workbookSummary.sheetCount > 0
      ? `Sheets: ${sheetPreview.join(', ')}${sheetSuffix}`
      : 'Sheets: (not detected)',
  ];
  if (notes) {
    infoLines.push(`Notes: ${notes}`);
  }

  titleSlide.addText(infoLines.join('\n'), {
    x: 0.6,
    y: 2.4,
    w: 12,
    h: 3.2,
    fontSize: 13,
    color: '1F2937',
    fontFace: 'Segoe UI',
  });

  const placeholderSlide = deck.addSlide();
  placeholderSlide.background = { color: 'FFFFFF' };
  placeholderSlide.addText('Benchmark summary (coming soon)', {
    x: 0.6,
    y: 0.6,
    w: 12,
    fontSize: 26,
    bold: true,
    color: '0B1120',
    fontFace: 'Segoe UI',
  });
  placeholderSlide.addText(
    'This section will compare pricing, occupancy, and availability changes against the selected comp set.',
    {
      x: 0.6,
      y: 1.4,
      w: 12,
      fontSize: 14,
      color: '475569',
      fontFace: 'Segoe UI',
    },
  );

  const pptxBuffer = (await deck.write({ outputType: 'nodebuffer' })) as Buffer;
  const safeProperty = (propertyCode || propertyName || propertyId).replace(/[^A-Za-z0-9._-]+/g, '_');
  const safeAsOfSegment = (asOfDate || 'latest').replace(/[^0-9A-Za-z._-]+/g, '_');
  const filename = `CompSet-${safeProperty}-${safeAsOfSegment}.pptx`;

  return new NextResponse(pptxBuffer as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
