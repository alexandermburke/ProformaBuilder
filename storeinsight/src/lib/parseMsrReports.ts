import admin from 'firebase-admin';
import * as XLSX from 'xlsx';
import { firestore, storage } from '@/server/firebaseAdmin';

export type ParseOutcome = {
  docId: string;
  propertyCode: string;
  reportDate: string;
  parseStatus: 'parsed' | 'failed';
};

type ParseOptions = {
  limit?: number;
  docId?: string;
  forceReparse?: boolean;
};

type ParsedTokens = Record<string, string | number>;

const getSheetCell = (sheet: XLSX.Sheet, cellRef: string): string | number | null => {
  const cell = sheet[cellRef];
  if (!cell) return null;
  return cell.v ?? null;
};

const parseNumber = (value: unknown): number => {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const cleaned = value.replace(/[^0-9.-]/g, '');
    const num = Number(cleaned);
    return Number.isFinite(num) ? num : NaN;
  }
  return NaN;
};

// Helper to extract the metrics we care about for PPT generation.
export const mapWorkbookToTokens = (workbook: XLSX.WorkBook): { tokens: ParsedTokens; summary: ParsedTokens } => {
  const sheet = workbook.Sheets['MSR'];
  if (!sheet) {
    throw new Error('MSR worksheet not found');
  }

  const asOfRaw = getSheetCell(sheet, 'A3');
  const occupancyPctRaw = getSheetCell(sheet, 'E8');
  const arTotalRaw = getSheetCell(sheet, 'F47');
  const ar30PlusRaw = getSheetCell(sheet, 'F48') ?? getSheetCell(sheet, 'L75'); // fallback

  const tokens: ParsedTokens = {
    ASOFDATE: typeof asOfRaw === 'string' ? asOfRaw : '',
    OCCUPANCYPCT: parseNumber(occupancyPctRaw),
    TOTALARALL: parseNumber(arTotalRaw),
    AR30PLUS: parseNumber(ar30PlusRaw),
    AROVER30DAYSPCT:
      parseNumber(arTotalRaw) > 0 && parseNumber(ar30PlusRaw) >= 0
        ? parseNumber(ar30PlusRaw) / parseNumber(arTotalRaw)
        : 0,
  };

  return {
    tokens,
    summary: {
      occupancyPct: tokens.OCCUPANCYPCT,
      totalAr: tokens.TOTALARALL,
      arOver30Pct: tokens.AROVER30DAYSPCT,
    },
  };
};

export async function parseMsrReports(options: ParseOptions = {}): Promise<ParseOutcome[]> {
  if (!firestore || !storage) {
    throw new Error('Firebase is not initialized (firestore/storage missing). Check environment variables.');
  }
  const storageClient = storage;

  const outcomes: ParseOutcome[] = [];

  if (options.docId) {
    const docRef = firestore.collection('msrReports').doc(options.docId);
    const snap = await docRef.get();
    if (!snap.exists) {
      return outcomes;
    }
    const data = snap.data() as {
      propertyCode?: string;
      reportDate?: string;
      parseStatus?: string;
      storagePath?: string;
    };
    const shouldProcess = options.forceReparse || data.parseStatus === 'pending';
    if (!shouldProcess) {
      return outcomes;
    }
    await processDoc({ docRef, data }, outcomes, storageClient);
    return outcomes;
  }

  let query = firestore.collection('msrReports').where('parseStatus', '==', 'pending');
  if (options.limit && options.limit > 0) {
    query = query.limit(options.limit);
  }

  const snap = await query.get();
  for (const doc of snap.docs) {
    const data = doc.data() as {
      propertyCode?: string;
      reportDate?: string;
      storagePath?: string;
    };
    await processDoc({ docRef: doc.ref, data }, outcomes, storageClient);
  }

  return outcomes;
}

async function processDoc(
  input: {
    docRef: FirebaseFirestore.DocumentReference<FirebaseFirestore.DocumentData>;
    data: {
      propertyCode?: string;
      reportDate?: string;
      storagePath?: string;
    };
  },
  outcomes: ParseOutcome[],
  storageClient: NonNullable<typeof storage>,
): Promise<void> {
  const { docRef, data } = input;
  const docId = docRef.id;
  const propertyCode = data.propertyCode ?? '';
  const reportDate = data.reportDate ?? '';
  const storagePath = data.storagePath;

  if (!storagePath) {
    console.error('[msr-parse] missing storagePath', { docId, propertyCode, reportDate });
    await docRef.set(
      {
        parseStatus: 'failed',
        parseError: 'Missing storagePath',
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    outcomes.push({ docId, propertyCode, reportDate, parseStatus: 'failed' });
    return;
  }

  try {
    const [buffer] = await storageClient.file(storagePath).download();
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const { tokens, summary } = mapWorkbookToTokens(workbook);

    await docRef.set(
      {
        parseStatus: 'parsed',
        parsedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        tokens,
        summary,
        parseError: admin.firestore.FieldValue.delete(),
      },
      { merge: true },
    );

    outcomes.push({ docId, propertyCode, reportDate, parseStatus: 'parsed' });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown parse error';
    console.error('[msr-parse] failed to parse workbook', { docId, propertyCode, reportDate }, err);
    await docRef.set(
      {
        parseStatus: 'failed',
        parseError: message.slice(0, 500),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    outcomes.push({ docId, propertyCode, reportDate, parseStatus: 'failed' });
  }
}
