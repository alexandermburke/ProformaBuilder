import admin from 'firebase-admin';
import { NextRequest, NextResponse } from 'next/server';
import { firestore, storage } from '@/server/firebaseAdmin';
import { parseOperatorPlWorkbook, type PublicPlVerticalRow } from '@/lib/parsers/publicPlParser';

export const runtime = 'nodejs';

type CoaMappingDoc = {
  operatorType?: string;
  operatorAccountName?: string;
  standardizedCoaName?: string;
};

type ParsedRowResponse = PublicPlVerticalRow & {
  standardizedCoaName: string | null;
};

function normalizeKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]+/g, '_');
}

async function loadMappings(operatorType: string): Promise<Map<string, string>> {
  if (!firestore) return new Map();

  const snapshot = await firestore.collection('coaMappings').where('operatorType', '==', operatorType).get();
  const map = new Map<string, string>();

  snapshot.docs.forEach((doc) => {
    const data = doc.data() as CoaMappingDoc;
    const accountName = (data.operatorAccountName ?? '').toString().trim();
    const standardized = (data.standardizedCoaName ?? '').toString().trim();
    if (!accountName || !standardized) return;
    map.set(normalizeKey(accountName), standardized);
  });

  return map;
}

async function loadCoaOptions(): Promise<string[]> {
  if (!firestore) return [];
  const snapshot = await firestore.collection('coaMappings').limit(1000).get();
  const unique = new Set<string>();

  snapshot.docs.forEach((doc) => {
    const data = doc.data() as CoaMappingDoc;
    const value = (data.standardizedCoaName ?? '').toString().trim();
    if (value) unique.add(value);
  });

  return Array.from(unique).sort((a, b) => a.localeCompare(b));
}

async function storeRawFile(buffer: Buffer, originalName: string): Promise<string | null> {
  if (!storage) return null;

  const safeName = sanitizeFileName(originalName || 'proforma-upload.xlsx');
  const objectPath = `finance/proforma-import/raw/${Date.now()}-${safeName}`;
  await storage.file(objectPath).save(buffer, {
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    resumable: false,
    metadata: {
      cacheControl: 'private,max-age=0,no-cache',
    },
  });

  return objectPath;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const form = await request.formData();
  const file = form.get('file');
  const operatorTypeRaw = String(form.get('operatorType') ?? 'public').trim();
  const operatorType = operatorTypeRaw ? operatorTypeRaw.toLowerCase() : 'public';

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file is required' }, { status: 400 });
  }

  const filename = file.name || 'upload.xlsx';
  const lowerName = filename.toLowerCase();
  if (!lowerName.endsWith('.xlsx') && !lowerName.endsWith('.xls')) {
    return NextResponse.json({ error: 'Upload must be an Excel file (.xlsx or .xls).' }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    const storagePath = await storeRawFile(buffer, filename);
    const parsed = parseOperatorPlWorkbook(buffer, operatorType);
    const mappingMap = await loadMappings(operatorType);
    const coaOptions = await loadCoaOptions();

    const unmapped = new Set<string>();
    const parsedRows: ParsedRowResponse[] = parsed.rows.map((row) => {
      const standardized = mappingMap.get(normalizeKey(row.operatorAccount)) ?? null;
      if (!standardized) unmapped.add(row.operatorAccount);
      return {
        ...row,
        standardizedCoaName: standardized,
      };
    });

    return NextResponse.json({
      entity: parsed.entity,
      monthsDetected: parsed.monthsDetected,
      totalRows: parsedRows.length,
      parsedRows,
      unmappedAccounts: Array.from(unmapped).sort((a, b) => a.localeCompare(b)),
      operatorType,
      storagePath,
      coaOptions,
    });
  } catch (error) {
    console.error('[finance/proforma-import] parse failed', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to parse uploaded workbook.' },
      { status: 500 },
    );
  }
}

export async function PUT(request: NextRequest): Promise<NextResponse> {
  if (!firestore) {
    return NextResponse.json({ error: 'Firestore is not configured.' }, { status: 500 });
  }

  const body = (await request.json().catch(() => null)) as
    | {
        operatorType?: string;
        operatorAccountName?: string;
        standardizedCoaName?: string;
      }
    | null;

  const operatorType = (body?.operatorType ?? 'public').toString().trim().toLowerCase();
  const operatorAccountName = (body?.operatorAccountName ?? '').toString().trim();
  const standardizedCoaName = (body?.standardizedCoaName ?? '').toString().trim();

  if (!operatorAccountName || !standardizedCoaName) {
    return NextResponse.json(
      { error: 'operatorAccountName and standardizedCoaName are required.' },
      { status: 400 },
    );
  }

  const docId = `${operatorType}__${normalizeKey(operatorAccountName).replace(/[^a-z0-9]+/g, '_')}`;

  const docRef = firestore.collection('coaMappings').doc(docId);
  const existing = await docRef.get();

  await docRef.set(
    {
      operatorType,
      operatorAccountName,
      standardizedCoaName,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      ...(existing.exists ? {} : { createdAt: admin.firestore.FieldValue.serverTimestamp() }),
    },
    { merge: true },
  );

  return NextResponse.json({ ok: true });
}
