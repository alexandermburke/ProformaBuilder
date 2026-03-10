import * as XLSX from 'xlsx';
import { extractBudgetTableFields } from '@/lib/extractBudget';
import type { MsrSnapshotPayload } from '@/lib/historical/msrSnapshotParser';

type WorkbookInput = ArrayBuffer | Uint8Array | Buffer;
type GridValue = string | number | boolean | Date | null | undefined;
type Grid = GridValue[][];

type BudgetValueSource = {
  token: string;
  cell: string | null;
  sheet: string | null;
  fallback?: boolean;
  formula?: string;
};

export type BudgetFinancialParseResult = {
  snapshot: MsrSnapshotPayload;
  warnings: string[];
  sourceSheet: string;
  sources: {
    expenses: BudgetValueSource;
    noi: BudgetValueSource;
  };
};

const MONTH_NAMES: Record<string, string> = {
  jan: '01',
  january: '01',
  feb: '02',
  february: '02',
  mar: '03',
  march: '03',
  apr: '04',
  april: '04',
  may: '05',
  jun: '06',
  june: '06',
  jul: '07',
  july: '07',
  aug: '08',
  august: '08',
  sep: '09',
  sept: '09',
  september: '09',
  oct: '10',
  october: '10',
  nov: '11',
  november: '11',
  dec: '12',
  december: '12',
};

function toWorkbookSource(input: WorkbookInput): { data: Uint8Array | Buffer; type: 'array' | 'buffer' } {
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(input)) {
    return { data: input, type: 'buffer' };
  }
  if (input instanceof ArrayBuffer) {
    return { data: new Uint8Array(input), type: 'array' };
  }
  if (input instanceof Uint8Array) {
    return { data: input, type: 'array' };
  }
  throw new TypeError('Unsupported workbook input type');
}

function readWorkbook(input: WorkbookInput): XLSX.WorkBook {
  const source = toWorkbookSource(input);
  return XLSX.read(source.data, {
    type: source.type,
    cellDates: true,
    cellNF: false,
    cellText: false,
  });
}

function sheetToGrid(sheet: XLSX.WorkSheet): Grid {
  return XLSX.utils.sheet_to_json<GridValue[]>(sheet, { header: 1, raw: false, defval: null });
}

function findBudgetSheet(workbook: XLSX.WorkBook): { name: string; grid: Grid } | null {
  const preferred = workbook.SheetNames.find((name) => name.toLowerCase().includes('budget comparison'));
  const candidates = preferred ? [preferred, ...workbook.SheetNames.filter((name) => name !== preferred)] : workbook.SheetNames;

  for (const name of candidates) {
    const sheet = workbook.Sheets[name];
    if (!sheet) continue;
    const grid = sheetToGrid(sheet);
    const hasMonthRow = grid.slice(0, 12).some((row) =>
      row.some((value) => typeof value === 'string' && /month\s*=/i.test(value)),
    );
    if (hasMonthRow) {
      return { name, grid };
    }
  }

  return null;
}

function parseMonthIso(grid: Grid): string | null {
  const monthRegex = /month\s*=\s*([a-z]+)\s+(\d{4})/i;
  for (const row of grid.slice(0, 12)) {
    for (const value of row.slice(0, 8)) {
      if (typeof value !== 'string') continue;
      const match = value.match(monthRegex);
      if (!match) continue;
      const month = MONTH_NAMES[match[1].trim().toLowerCase()];
      const year = match[2];
      if (month && year) {
        return `${year}-${month}`;
      }
    }
  }
  return null;
}

function parsePropertyName(grid: Grid): string | undefined {
  for (const row of grid.slice(0, 6)) {
    for (const value of row.slice(0, 4)) {
      if (typeof value !== 'string') continue;
      const trimmed = value.trim();
      if (!trimmed) continue;
      if (/budget comparison/i.test(trimmed)) continue;
      if (/month\s*=|book\s*=/i.test(trimmed)) continue;
      return trimmed;
    }
  }
  return undefined;
}

export async function parseBudgetFinancialWorkbook(input: WorkbookInput): Promise<BudgetFinancialParseResult> {
  const workbook = readWorkbook(input);
  const located = findBudgetSheet(workbook);
  if (!located) {
    throw new Error('Unable to locate a Budget Comparison sheet.');
  }

  const reportMonthIso = parseMonthIso(located.grid);
  if (!reportMonthIso) {
    throw new Error('Unable to determine report month from the budget workbook.');
  }

  const extraction = await extractBudgetTableFields(input, undefined);
  const warnings: string[] = [];

  const incomeToken = 'TOTALINCCM';
  const propertyExpenseToken = 'TOTALPROPCM';
  const expenseToken = 'TOTEXPCM';
  const incomeValue = extraction.tokens[incomeToken];
  if (!Number.isFinite(incomeValue)) {
    throw new Error('Unable to extract TOTAL INCOME from the PTD Actual column.');
  }
  const propertyExpenseValue = extraction.tokens[propertyExpenseToken];
  if (!Number.isFinite(propertyExpenseValue)) {
    throw new Error('Unable to extract TOTAL PROPERTY EXPENSES from the PTD Actual column.');
  }
  const expenseValue = extraction.tokens[expenseToken];
  if (!Number.isFinite(expenseValue)) {
    throw new Error('Unable to extract TOTAL EXPENSES from the PTD Actual column.');
  }

  const noiToken = `${incomeToken} - ${propertyExpenseToken}`;
  const noiValue = Math.round((incomeValue - propertyExpenseValue) * 100) / 100;
  warnings.push('NOI is calculated from PTD Actual values: Total Income minus Total Property Expenses.');

  const expenseDetail = extraction.details[expenseToken];
  const incomeDetail = extraction.details[incomeToken];
  const propertyExpenseDetail = extraction.details[propertyExpenseToken];
  const propertyName = parsePropertyName(located.grid);

  return {
    snapshot: {
      propertyName,
      reportMonthIso,
      monthIso: reportMonthIso,
      financials: {
        totalOperatingExpenseMtd: expenseValue,
        expensesMtd: expenseValue,
        totalOperatingExpense: expenseValue,
        expenses: expenseValue,
        noiMtd: noiValue,
        noi: noiValue,
        netOperatingIncomeMtd: noiValue,
        netOperatingIncome: noiValue,
      },
    },
    warnings,
    sourceSheet: located.name,
    sources: {
      expenses: {
        token: expenseToken,
        cell: expenseDetail?.cell ?? null,
        sheet: expenseDetail?.sheet ?? located.name,
      },
      noi: {
        token: noiToken,
        cell:
          incomeDetail?.cell && propertyExpenseDetail?.cell
            ? `${incomeDetail.cell} - ${propertyExpenseDetail.cell}`
            : null,
        sheet: incomeDetail?.sheet ?? propertyExpenseDetail?.sheet ?? located.name,
        formula: 'NOI = Total Income - Total Property Expenses',
      },
    },
  };
}
