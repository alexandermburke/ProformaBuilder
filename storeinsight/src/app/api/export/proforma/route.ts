// src/app/api/export/proforma/route.ts
import { NextRequest } from 'next/server';
import ExcelJS from 'exceljs';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';

export const runtime = 'nodejs';

/** ------------------------------ Types --------------------------------- */
type SeriesByLabel = Record<string, number[]>;

type SeriesAgg = {
  toi: number[];
  toe: number[];
  noi: number[];
};

type ProformaExportPayload = {
  id: string;
  facility: string;
  period: string;
  seriesByLabel: SeriesByLabel | null;
  series?: SeriesAgg | null;
};

type ExcelCellValue =
  | string
  | number
  | Date
  | boolean
  | null
  | undefined
  | { text?: string; richText?: { text?: string }[]; result?: string | number; [k: string]: unknown };

type FormulaLike = ExcelJS.CellFormulaValue | ExcelJS.CellSharedFormulaValue;

const isFormulaLike = (value: ExcelJS.CellValue | ExcelCellValue | undefined): value is FormulaLike =>
  Boolean(value && typeof value === 'object' && ('formula' in value || 'sharedFormula' in value));

/** --------------------------- Label aliases ---------------------------- */

const CANON_KEY_TO_TEMPLATE_LABELS: Record<string, string[]> = {
  // Income
  'Rental Income (1% monthly increase)': ['Rental Income (1% monthly increase)', 'Rental Income'],
  // ---- Inserted mappings below ----
  'Rental Income': ['Rental Income', 'Rental Income (1% monthly increase)'],
  'Discounts Given (Accrued per Month)': ['Discounts', 'Discounts Given (Accrued per Month)'],
  'Bad Debt': ['Bad Debt/Rental Refunds', 'Bad Debt / Rental Refunds', 'Bad Debt'],
  'Store Tenant Protection Split': ['STORE Tenant Protection Split', 'Store Tenant Protection Split'],
  'Store Credit Card Merchant Fees': ['STORE Credit Card Merchant Fees', 'Store Credit Card Merchant Fees'],
  'Current Management Fees': ['Current Management Fees (5.25%)', 'Current Management Fees'],
  // ---- End inserted mappings ----
  'STORE Rate Mgmt. Rev. (+0.5%)': ['STORE Rate Mgmt. Rev. (+0.5%)', 'Store Rate Mgmt. Rev. (+0.5%)'],
  Discounts: ['Discounts', 'Discounts Given (Accrued per Month)'],
  'Bad Debt/Rental Refunds': ['Bad Debt/Rental Refunds', 'Bad Debt / Rental Refunds', 'Bad Debt'],
  'Admin Fee Income': ['Admin Fee Income'],
  'Late Fee Income': ['Late Fee Income'],
  'Current Tenant Protection Split': ['Current Tenant Protection Split'],
  'STORE Tenant Protection Split': ['STORE Tenant Protection Split', 'Store Tenant Protection Split'],
  'Other Tenant Income': ['Other Tenant Income'],
  'Retail Sales Income': ['Retail Sales Income'],
  'Net Rental Income': ['Net Rental Income'],

  // Expenses
  'Advertising & Marketing': ['Advertising & Marketing', 'Advertising and Marketing'],
  'Credit Card Merchant Fees': ['Credit Card Merchant Fees'],
  'STORE Credit Card Merchant Fees': ['STORE Credit Card Merchant Fees', 'Store Credit Card Merchant Fees'],
  Auction: ['Auction'],
  'Fire Prevention': ['Fire Prevention'],
  'Current Management Fees (5.25%)': ['Current Management Fees (5.25%)', 'Current Management Fees'],
  'STORE Management Fees (4.0%)': [
    'STORE Management Fees (4.0%)',
    'Store Management Fees (4.0%)',
    'Store Mgmt Fees',
    'Mgmt Fees – STORE 4%',
  ],
  Payroll: ['Payroll'],
  'Office Supplies': ['Office Supplies'],
  'Repairs & Maintenance': ['Repairs & Maintenance', 'Repairs and Maintenance'],
  Security: ['Security'],
  Recruiting: ['Recruiting'],
  'Retail Products': ['Retail Products'],
  'Telephone & Internet': ['Telephone & Internet', 'Telephone and Internet'],
  Software: ['Software'],
  Travel: ['Travel'],
  Electricity: ['Electricity'],
  Refuse: ['Refuse'],
  'Water & Sewer': ['Water & Sewer', 'Water and Sewer'],

  // Totals (write only from series or recompute)
  'Total Operating Income': ['Total Operating Income'],
  'Total Operating Expense': ['Total Operating Expense'],
  'Net Operating Income': ['Net Operating Income'],
};

const NEGATIVE_KEYS = new Set<string>(['Discounts', 'Bad Debt/Rental Refunds']);

/** ----------------------------- Helpers -------------------------------- */

async function ensureTemplatePath(): Promise<string | null> {
  const preferred = join(process.cwd(), 'templates', 'STORE_Proforma_v4.xlsx');
  const fallback = join(process.cwd(), 'templates', 'STORE_Proforma_v3.xlsx');
  try {
    await fs.access(preferred);
    console.log('[export] template path OK (preferred)', { path: preferred });
    return preferred;
  } catch {}
  try {
    await fs.access(fallback);
    console.log('[export] template path OK (fallback)', { path: fallback });
    return fallback;
  } catch {
    console.log('[export] template path NOT found', { preferred, fallback });
    return null;
  }
}

function cellText(c: ExcelJS.Cell | undefined): string {
  if (!c) return '';
  const v = c.value as ExcelCellValue;
  if (v == null) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number') return String(v);
  if (v instanceof Date) {
    return new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric' }).format(v);
  }
  if (typeof v === 'object') {
    const obj = v as { text?: string; richText?: { text?: string }[]; result?: string | number };
    if (typeof obj.text === 'string') return obj.text.trim();
    if (Array.isArray(obj.richText)) return obj.richText.map((r) => r?.text ?? '').join('').trim();
    if (obj.result != null) return String(obj.result).trim();
  }
  try {
    return String(v).trim();
  } catch {
    return '';
  }
}

function normLabel(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\([^)]*\)/g, (m) => m) // keep parentheses so exact labels still match
    .replace(/[^\w\s&().\/-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function findRowByExact(ws: ExcelJS.Worksheet, label: string): number | null {
  // Search B..D for safety (some templates shift label one column)
  const want = normLabel(label);
  for (let r = 1; r <= 500; r++) {
    for (let col = 2; col <= 4; col++) {
      const got = normLabel(cellText(ws.getCell(r, col)));
      if (got && got === want) return r;
    }
  }
  return null;
}

function findRowForAnyAlias(ws: ExcelJS.Worksheet, key: string): { row: number | null; matched?: string } {
  const aliases = CANON_KEY_TO_TEMPLATE_LABELS[key] ?? [key];
  for (const a of aliases) {
    const r = findRowByExact(ws, a);
    if (r) return { row: r, matched: a };
  }
  return { row: null };
}

const MONTH_RE = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s\-]?\d{2,4}$/i;

function detectMonthBand(ws: ExcelJS.Worksheet): { row: number; startCol: number; labels: string[] } | null {
  for (let r = 2; r <= 80; r++) {
    for (let c = 2; c <= 45; c++) {
      const labels: string[] = [];
      for (let k = 0; k < 12; k++) {
        const t = cellText(ws.getCell(r, c + k));
        if (!MONTH_RE.test(t)) {
          labels.length = 0;
          break;
        }
        labels.push(t);
      }
      if (labels.length === 12) {
        console.log('[export] month band selected', { row: r, startCol: c, labels });
        return { row: r, startCol: c, labels };
      }
    }
  }
  return null;
}

function to12(vs: unknown[]): number[] {
  const out = new Array(12).fill(0);
  for (let i = 0; i < 12; i++) {
    const v = vs[i];
    if (typeof v === 'number' && Number.isFinite(v)) out[i] = v;
    else if (typeof v === 'string') {
      const neg = /^\(.*\)$/.test(v);
      const n = Number(v.replace(/[^\d.\-]/g, ''));
      out[i] = Number.isFinite(n) ? (neg ? -Math.abs(n) : n) : 0;
    }
  }
  return out;
}

/** Detect if each month column has a preceding `$` spacer column, or if values/numbers start at startCol+1. */
function detectStrideAndOffset(
  ws: ExcelJS.Worksheet,
  startCol: number,
  sampleRows: number[]
): { stride: number; valueOffset: number } {
  // Case A: value columns are at startCol and there's a preceding "$" column at startCol-1
  const caseA = sampleRows.some((r) => {
    const left = cellText(ws.getCell(r, startCol - 1)).trim();
    const cur = cellText(ws.getCell(r, startCol)).trim();
    return (left === '$' || left === '＄') && cur !== '$';
  });
  if (caseA) return { stride: 2, valueOffset: 0 };

  // Case B: "$" is at startCol and real numbers start at startCol+1
  const caseB = sampleRows.some((r) => {
    const cur = cellText(ws.getCell(r, startCol)).trim();
    const right = cellText(ws.getCell(r, startCol + 1)).trim();
    return (cur === '$' || cur === '＄') && right !== '$';
  });
  if (caseB) return { stride: 2, valueOffset: 1 };

  // Case C: no "$" spacers; values begin at startCol
  return { stride: 1, valueOffset: 0 };
}

// Helper to clear shared formulas in a set of cells
function clearSharedFormulasInCells(ws: ExcelJS.Worksheet, rows: number[], cols: number[]) {
  for (const r of rows) {
    for (const c of cols) {
      const cell = ws.getCell(r, c);
      const value = cell.value;
      if (isFormulaLike(value)) {
        cell.value = value.result ?? null;
      }
    }
  }
}

// Helper to clear all shared formulas in the entire worksheet
function clearAllSharedFormulas(ws: ExcelJS.Worksheet): number {
  let cleared = 0;
  ws.eachRow({ includeEmpty: true }, (_row, rNum) => {
    ws.getRow(rNum).eachCell({ includeEmpty: true }, (cell) => {
      const value = cell.value;
      if (isFormulaLike(value) && 'sharedFormula' in value) {
        cell.value = value.result ?? null;
        cleared++;
      }
    });
  });
  return cleared;
}

/** ------------------------------- Build -------------------------------- */

async function build(payload: ProformaExportPayload): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  const path = await ensureTemplatePath();

  if (!path) {
    const ws = wb.addWorksheet('Proforma');
    ws.getCell('B2').value = payload.facility;
    ws.getCell('B3').value = payload.period;
    return wb;
  }

  await wb.xlsx.readFile(path);
  const ws = wb.worksheets[0];
  const clearedShared = clearAllSharedFormulas(ws);
  if (clearedShared) console.log('[export] cleared shared formulas (global)', { clearedShared });
  console.log('[export] template loaded via readFile', { path });

  ws.getCell('B2').value = payload.facility;
  ws.getCell('B3').value = payload.period;
  console.log('[export] set B2/B3', payload.facility, payload.period);

  const band = detectMonthBand(ws);
  if (!band) return wb;

  // Anchors (allow defaults but log what we found)
  const incomeStart = findRowByExact(ws, 'Income') ?? 18;
  const toiRowFound = findRowByExact(ws, 'Total Operating Income') ?? 39;
  const expenseStart = findRowByExact(ws, 'Expenses') ?? 41;
  const toeRow = findRowByExact(ws, 'Total Operating Expense') ?? 63;
  const noiRow = findRowByExact(ws, 'Net Operating Income') ?? 65;

  console.log('[export] anchors', { incomeStart, toiRow: toiRowFound, expenseStart, toeRow, noiRow });

  // Per-month layout
  const layout = detectStrideAndOffset(ws, band.startCol, [toiRowFound, toeRow, noiRow, incomeStart + 1, expenseStart + 1]);

  // Preempt ExcelJS shared formula errors by clearing shared formulas only where we will write
  const monthCols: number[] = Array.from({ length: 12 }, (_, i) => band.startCol + layout.valueOffset + layout.stride * i);
  const incomeRows = Array.from({ length: Math.max(0, toiRowFound - incomeStart - 1) }, (_, i) => incomeStart + 1 + i);
  const expenseRows = Array.from({ length: Math.max(0, toeRow - expenseStart - 1) }, (_, i) => expenseStart + 1 + i);
  clearSharedFormulasInCells(ws, [...incomeRows, ...expenseRows, toiRowFound, toeRow, noiRow], monthCols);

  /** ---------------- write detail rows ---------------- */
  const input = payload.seriesByLabel ?? {};
  const entries = Object.entries(input);

  console.log('[export] incoming canonical/label series', {
    count: entries.length,
    keys: entries.slice(0, 50).map(([k]) => k),
  });

  type Write = { row: number; key: string; values: number[]; matched: string; isNewRow: boolean };
  const writes: Write[] = [];
  const skipped: string[] = [];

  for (const [key, vals] of entries) {
    const values = to12(vals);
    const normKey = key; // already normalized by /api/normalize
    const { row, matched } = findRowForAnyAlias(ws, normKey);

    if (row) {
      // enforce negative for contra-lines
      if (NEGATIVE_KEYS.has(normKey)) {
        for (let i = 0; i < 12; i++) if (values[i] > 0) values[i] = -values[i];
      }
      writes.push({ row, key: normKey, values, matched: matched ?? normKey, isNewRow: false });
    } else {
      skipped.push(key);
    }
  }

  if (skipped.length > 0) {
    console.log('[export] skipped (no matching row in template, not appending rows)', { count: skipped.length, keys: skipped });
  }

  // Sort by row to keep write order predictable
  writes.sort((a, b) => a.row - b.row);

  // Write ALL lines (no filtering). Use stride/offset aware columns.
  for (const w of writes) {
    for (let i = 0; i < 12; i++) {
      const col = band.startCol + layout.valueOffset + layout.stride * i;
      (ws.getCell(w.row, col) as unknown as ExcelJS.Cell).value = Math.round(w.values[i] ?? 0);
    }
    console.log('[export] wrote row OK', {
      row: w.row,
      key: w.key,
      via: w.isNewRow ? 'appended' : 'exact',
      startCol: band.startCol + layout.valueOffset,
      rbSample: w.values.slice(0, 3),
    });
  }

  console.log('[export] wrote lines', {
    wrote: writes.length,
    have: entries.length,
    skipped: skipped.length ? skipped : [],
  });

  /** ---------------- totals ---------------- */
  const agg = payload.series ?? null;
  if (agg && Array.isArray(agg.toi) && Array.isArray(agg.toe) && Array.isArray(agg.noi)) {
    for (let i = 0; i < 12; i++) {
      const cBase = band.startCol + layout.valueOffset + layout.stride * i;
      (ws.getCell(toiRowFound, cBase) as unknown as ExcelJS.Cell).value = Math.round(agg.toi[i] ?? 0);
      (ws.getCell(toeRow, cBase) as unknown as ExcelJS.Cell).value = Math.round(agg.toe[i] ?? 0);
      (ws.getCell(noiRow, cBase) as unknown as ExcelJS.Cell).value = Math.round(agg.noi[i] ?? 0);
    }
    console.log('[export] totals written from aggregated series');
  } else {
    // Fallback: recompute from what we wrote in visible ranges
    const isIncomeRow = (r: number) => r > incomeStart && r < toiRowFound;
    const isExpenseRow = (r: number) => r > expenseStart && r < toeRow;
    const toi = new Array(12).fill(0);
    const toe = new Array(12).fill(0);
    for (const w of writes) {
      if (isIncomeRow(w.row)) for (let i = 0; i < 12; i++) toi[i] += w.values[i] ?? 0;
      if (isExpenseRow(w.row)) for (let i = 0; i < 12; i++) toe[i] += w.values[i] ?? 0;
    }
    const noi = toi.map((v, i) => v - toe[i]);
    for (let i = 0; i < 12; i++) {
      const cBase = band.startCol + layout.valueOffset + layout.stride * i;
      (ws.getCell(toiRowFound, cBase) as unknown as ExcelJS.Cell).value = Math.round(toi[i]);
      (ws.getCell(toeRow, cBase) as unknown as ExcelJS.Cell).value = Math.round(toe[i]);
      (ws.getCell(noiRow, cBase) as unknown as ExcelJS.Cell).value = Math.round(noi[i]);
    }
    console.log('[export] totals computed from written rows');
  }

  // Optional readback sample for sanity
  const rb = (r: number) => [
    Number((ws.getCell(r, band.startCol + layout.valueOffset) as unknown as ExcelJS.Cell).value ?? 0),
    Number((ws.getCell(r, band.startCol + layout.valueOffset + layout.stride) as unknown as ExcelJS.Cell).value ?? 0),
    Number((ws.getCell(r, band.startCol + layout.valueOffset + layout.stride * 2) as unknown as ExcelJS.Cell).value ?? 0),
  ];
  console.log('[export] totals readback sample', {
    toiBack: rb(toiRowFound),
    toeBack: rb(toeRow),
    noiBack: rb(noiRow),
  });

  return wb;
}

/** -------------------------------- Route ------------------------------- */

export async function POST(req: NextRequest): Promise<Response> {
  const body = (await req.json()) as ProformaExportPayload;

  const count = body.seriesByLabel ? Object.keys(body.seriesByLabel).length : 0;
  const hasAgg = !!(body.series && Array.isArray(body.series.toi));

  console.log('[export] request payload', {
    id: body.id,
    facility: body.facility,
    period: body.period,
    hasSeriesByLabel: count > 0,
    seriesByLabelCount: count,
    hasAggSeries: hasAgg,
    keysPreview: count ? Object.keys(body.seriesByLabel as SeriesByLabel).slice(0, 10) : [],
  });

  if (count === 0 && !hasAgg) {
    return Response.json({ error: 'No data' }, { status: 400 });
  }

  const wb = await build(body);
  const buf = (await wb.xlsx.writeBuffer()) as ArrayBuffer | ArrayBufferView | string;
  const ab: ArrayBuffer =
    buf instanceof ArrayBuffer
      ? buf
      : ArrayBuffer.isView(buf)
      ? (() => {
          const view = buf as ArrayBufferView;
          const copy = new ArrayBuffer(view.byteLength);
          new Uint8Array(copy).set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
          return copy;
        })()
      : new TextEncoder().encode(String(buf ?? '')).buffer;

  const safeFacility = body.facility.replace(/\s+/g, '_');
  const safePeriod = body.period.replace(/\s+/g, '-');
  const fileName = `Proforma_${safeFacility}_${safePeriod}.xlsx`;
  console.log('[export] sending response', { fileName, size: ab.byteLength });

  return new Response(ab, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Cache-Control': 'no-store',
    },
  });
}
