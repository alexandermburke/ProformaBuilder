// src/app/api/normalize/route.ts
import { NextRequest } from 'next/server';

export const runtime = 'nodejs';

/** ----------------------------- Types ---------------------------------- */
type Sheet2D = (string | number | null | undefined)[][];
type Normalized = {
  facility?: string | null;
  period?: string | null;
  detected: {
    sheetName: string;
    monthRow: number;        // 1-based
    monthStartCol: number;   // 1-based, already shifted if $ spacer detected
    months: string[];        // 12 tokens like 'oct-2025'
    labelCol: number;        // 1-based
  } | null;
  seriesByLabel: Record<string, number[]>;
  series: {
    toi: number[];
    toe: number[];
    noi: number[];
  };
};

type NormalizeSheetPayload = { name?: string; grid?: unknown };
type NormalizeRequestBody = {
  facility?: string | null;
  period?: string | null;
  sheets?: NormalizeSheetPayload[];
  grid?: unknown;
  name?: string;
};

/** --------------------------- Month helpers ---------------------------- */

// Excel serial (1900 system) -> JS Date
function excelSerialToDate(n: number): Date {
  const ms = Math.round((n - 25569) * 86400 * 1000);
  return new Date(ms);
}

const MMM = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];

function normMonthToken(raw: unknown): string {
  if (raw == null) return '';
  if (typeof raw === 'number' && isFinite(raw)) {
    // plausible Excel serial
    if (raw > 20000 && raw < 60000) {
      const d = excelSerialToDate(raw);
      return `${MMM[d.getUTCMonth()]}-${d.getUTCFullYear()}`.toLowerCase();
    }
    return '';
  }
  const s = String(raw).trim();
  if (!s) return '';

  // "Oct 2025", "Oct-25"
  const m1 = s.match(/^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[ \-]?(\d{2,4})$/i);
  if (m1) {
    const mm = m1[1].slice(0,3).toLowerCase();
    const yy = m1[2].length === 2 ? `20${m1[2]}` : m1[2];
    return `${mm}-${yy}`;
  }
  // "10/2025" or "10-2025"
  const m2 = s.match(/^(\d{1,2})[\/\-](\d{4})$/);
  if (m2) {
    const mi = Math.max(1, Math.min(12, +m2[1])) - 1;
    return `${MMM[mi]}-${m2[2]}`;
  }
  // "2025-10" or "2025/10"
  const m3 = s.match(/^(\d{4})[\/\-](\d{1,2})$/);
  if (m3) {
    const mi = Math.max(1, Math.min(12, +m3[2])) - 1;
    return `${MMM[mi]}-${m3[1]}`;
  }
  return '';
}

function toMonthIndex(tok: string): number | null {
  const m = tok.match(/^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)-(\d{4})$/);
  if (!m) return null;
  const mi = MMM.indexOf(m[1]);
  return +m[2] * 12 + mi;
}

function isSequential12(tokens: string[]): boolean {
  const idx = tokens.map(toMonthIndex);
  if (idx.some(v => v == null)) return false;
  // allow up to 2 gaps (be tolerant)
  let ok = 0;
  for (let i = 1; i < idx.length; i++) if ((idx[i]! - idx[i-1]!) === 1) ok++;
  return ok >= 9;
}

/** --------------------------- Sheet scanning --------------------------- */

type Band = { sheetName: string; monthRow: number; startCol: number; months: string[] };

function detectMonthBandInSheet(name: string, grid: Sheet2D): Band | null {
  const R = Math.min(grid.length, 100);
  const C = grid.reduce((m, r) => Math.max(m, r?.length ?? 0), 0);
  for (let r = 0; r < Math.min(R, 80); r++) {
    for (let c = 0; c < Math.min(C, 60); c++) {
      const toks: string[] = [];
      for (let k = 0; k < 12; k++) {
        const tok = normMonthToken(grid[r]?.[c + k]);
        if (!tok) break;
        toks.push(tok);
      }
      if (toks.length === 12 && isSequential12(toks)) {
        console.log('[normalize] month band', { sheet: name, row: r+1, startCol: c+1, months: toks });
        return { sheetName: name, monthRow: r, startCol: c, months: toks };
      }
    }
  }
  return null;
}

function chooseSheetWithBand(sheets: { name: string; grid: Sheet2D }[]): Band | null {
  for (const s of sheets) {
    const b = detectMonthBandInSheet(s.name, s.grid);
    if (b) return b;
  }
  return null;
}

/** Label column = first stable text column left of band */
function detectLabelCol(grid: Sheet2D, monthRow: number, bandStartCol: number): number {
  for (let c = bandStartCol - 1; c >= 0; c--) {
    let hits = 0;
    for (let r = monthRow + 1; r < Math.min(grid.length, monthRow + 60); r++) {
      const v = grid[r]?.[c];
      if (v && String(v).trim()) hits++;
      if (hits >= 6) {
        console.log('[normalize] label column chosen', { oneBased: c + 1 });
        return c;
      }
    }
  }
  console.log('[normalize] label column fallback to B');
  return 1;
}

function findAnchorRow(grid: Sheet2D, labelCol: number, target: string): number | null {
  const want = target.toLowerCase().replace(/\s+/g, ' ').trim();
  for (let r = 0; r < grid.length; r++) {
    const s = String(grid[r]?.[labelCol] ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
    if (s === want) return r;
  }
  return null;
}

/** ----------------------------- Value utils --------------------------- */

function parseMoney(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === 'number' && isFinite(v)) return v;
  const s = String(v).trim();
  if (!s) return 0;
  // ($1,234) or -1,234.00
  const neg = /^\(.*\)$/.test(s);
  const num = Number(s.replace(/[^\d.\-]/g, ''));
  if (!isFinite(num)) return 0;
  return neg ? -Math.abs(num) : num;
}

/** ----------------------- Canonical alias mapping ---------------------- */

const ALIAS: Record<string, string> = {
  // Income
  'rental income': 'Rental Income (1% monthly increase)',
  'rental income (1% monthly increase)': 'Rental Income (1% monthly increase)',
  'discounts': 'Discounts',
  'discounts given (accrued per month)': 'Discounts',
  'bad debt': 'Bad Debt/Rental Refunds',
  'bad debt/rental refunds': 'Bad Debt/Rental Refunds',
  'bad debt / rental refunds': 'Bad Debt/Rental Refunds',
  'admin fee income': 'Admin Fee Income',
  'late fee income': 'Late Fee Income',
  'current tenant protection split': 'Current Tenant Protection Split',
  'store tenant protection split': 'STORE Tenant Protection Split',
  'store tenant protection split (store)': 'STORE Tenant Protection Split',
  'other tenant income': 'Other Tenant Income',
  'retail sales income': 'Retail Sales Income',
  'net rental income': 'Net Rental Income',

  // Expenses
  'advertising & marketing': 'Advertising & Marketing',
  'advertising and marketing': 'Advertising & Marketing',
  'credit card merchant fees': 'Credit Card Merchant Fees',
  'store credit card merchant fees': 'STORE Credit Card Merchant Fees',
  'auction': 'Auction',
  'fire prevention': 'Fire Prevention',
  'current management fees (5.25%)': 'Current Management Fees (5.25%)',
  'current management fees': 'Current Management Fees (5.25%)',
  'store management fees (4.0%)': 'STORE Management Fees (4.0%)',
  'store mgmt fees': 'STORE Management Fees (4.0%)',
  'mgmt fees – store 4%': 'STORE Management Fees (4.0%)',
  'payroll': 'Payroll',
  'office supplies': 'Office Supplies',
  'repairs & maintenance': 'Repairs & Maintenance',
  'repairs and maintenance': 'Repairs & Maintenance',
  'security': 'Security',
  'recruiting': 'Recruiting',
  'retail products': 'Retail Products',
  'telephone & internet': 'Telephone & Internet',
  'telephone and internet': 'Telephone & Internet',
  'software': 'Software',
  'travel': 'Travel',
  'electricity': 'Electricity',
  'refuse': 'Refuse',
  'water & sewer': 'Water & Sewer',
  'water and sewer': 'Water & Sewer',
};

function canon(label: string): string {
  const k = label.toLowerCase().replace(/\s+/g, ' ').trim();
  return ALIAS[k] ?? label;
}

const NEGATE = new Set(['Discounts', 'Bad Debt/Rental Refunds']);

/** --------------------------- Core extraction -------------------------- */

function extractSeriesFromSheet(name: string, grid: Sheet2D): Normalized {
  const band = detectMonthBandInSheet(name, grid);
  if (!band) {
    return {
      facility: null,
      period: null,
      detected: null,
      seriesByLabel: {},
      series: { toi: Array(12).fill(0), toe: Array(12).fill(0), noi: Array(12).fill(0) },
    };
  }

  const labelCol = detectLabelCol(grid, band.monthRow, band.startCol);

  // Anchors
  const incomeRow = findAnchorRow(grid, labelCol, 'Income');
  const toiRow    = findAnchorRow(grid, labelCol, 'Total Operating Income');
  const expRow    = findAnchorRow(grid, labelCol, 'Expenses');
  const toeRow    = findAnchorRow(grid, labelCol, 'Total Operating Expense');

  if (incomeRow == null || toiRow == null || expRow == null || toeRow == null) {
    console.log('[normalize] anchors not found in sheet', { name, incomeRow, toiRow, expRow, toeRow });
    return {
      facility: null,
      period: null,
      detected: {
        sheetName: name,
        monthRow: band.monthRow + 1,
        monthStartCol: band.startCol + 1,
        months: band.months,
        labelCol: labelCol + 1,
      },
      seriesByLabel: {},
      series: { toi: Array(12).fill(0), toe: Array(12).fill(0), noi: Array(12).fill(0) },
    };
  }

  // Handle "$" spacer column to the left of the month band
  const maybeDollar = String(grid[band.monthRow + 1]?.[band.startCol - 1] ?? '').trim();
  const current     = String(grid[band.monthRow + 1]?.[band.startCol] ?? '').trim();
  let startCol = band.startCol;
  if ((maybeDollar === '$' || maybeDollar === '＄') && current === '') {
    startCol = band.startCol + 1;
    console.log('[normalize] shifted band start due to currency spacer', { from: band.startCol + 1, to: startCol + 1 });
  }

  const seriesByLabel: Record<string, number[]> = {};
  const collect = (r: number) => {
    const rawLabel = String(grid[r]?.[labelCol] ?? '').trim();
    if (!rawLabel) return;
    if (/^income$/i.test(rawLabel) || /^expenses$/i.test(rawLabel)) return;
    const label = canon(rawLabel);
    const vals: number[] = [];
    for (let k = 0; k < 12; k++) vals.push(parseMoney(grid[r]?.[startCol + k]));
    if (NEGATE.has(label)) for (let i = 0; i < 12; i++) if (vals[i] > 0) vals[i] = -vals[i];
    if (vals.some(v => v !== 0)) seriesByLabel[label] = vals;
  };

  for (let r = incomeRow + 1; r < toiRow; r++) collect(r);
  for (let r = expRow + 1; r < toeRow; r++) collect(r);

  // Aggregates by summing the ranges we just harvested
  const toi = Array(12).fill(0);
  const toe = Array(12).fill(0);
  const addRange = (from: number, to: number, acc: number[]) => {
    for (let r = from + 1; r < to; r++) {
      const rawLabel = String(grid[r]?.[labelCol] ?? '').trim();
      const label = canon(rawLabel);
      const vals = seriesByLabel[label];
      if (!vals) continue;
      for (let i = 0; i < 12; i++) acc[i] += vals[i];
    }
  };
  addRange(incomeRow, toiRow, toi);
  addRange(expRow, toeRow, toe);
  const noi = toi.map((v, i) => v - toe[i]);

  const out: Normalized = {
    facility: null,
    period: null,
    detected: {
      sheetName: name,
      monthRow: band.monthRow + 1,
      monthStartCol: startCol + 1,
      months: band.months,
      labelCol: labelCol + 1,
    },
    seriesByLabel,
    series: { toi, toe, noi },
  };

  console.log('[normalize] result summary', {
    sheet: out.detected?.sheetName,
    labelCol: out.detected?.labelCol,
    months: out.detected?.months?.slice(0,3),
    keys: Object.keys(out.seriesByLabel).slice(0,15),
    counts: Object.keys(out.seriesByLabel).length,
  });

  return out;
}

/** ------------------------------- Route -------------------------------- */

export async function POST(req: NextRequest): Promise<Response> {
  // Accepts:
  // 1) { sheets: [{name, grid}], facility?, period? }
  // 2) { grid, name? }
  const body = (await req.json()) as NormalizeRequestBody;

  let sheets: { name: string; grid: Sheet2D }[] = [];
  if (Array.isArray(body?.sheets)) {
    sheets = body.sheets.map((s, i) => ({
      name: String(s?.name ?? `Sheet${i + 1}`),
      grid: Array.isArray(s?.grid) ? (s.grid as Sheet2D) : [],
    }));
  } else if (Array.isArray(body?.grid)) {
    sheets = [
      {
        name: String(body?.name ?? 'Sheet1'),
        grid: body.grid as Sheet2D,
      },
    ];
  } else {
    return Response.json({ error: 'No sheet data provided' }, { status: 400 });
  }

  // Pick the first sheet that contains a 12-month run
  const band = chooseSheetWithBand(sheets);
  if (!band) {
    console.log('[normalize] no 12-month band found in any sheet');
    const empty: Normalized = {
      facility: body.facility ?? null,
      period: body.period ?? null,
      detected: null,
      seriesByLabel: {},
      series: { toi: Array(12).fill(0), toe: Array(12).fill(0), noi: Array(12).fill(0) },
    };
    return Response.json(empty, { status: 200 });
  }

  const chosen = sheets.find(s => s.name === band.sheetName)!;
  const normalized = extractSeriesFromSheet(chosen.name, chosen.grid);

  return Response.json(
    {
      facility: body.facility ?? null,
      period: body.period ?? null,
      ...normalized,
    } as Normalized,
    { status: 200 }
  );
}
