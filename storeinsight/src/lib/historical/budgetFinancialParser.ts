import * as XLSX from 'xlsx';
import { extractBudgetTableFields } from '@/lib/extractBudget';
import type { MsrSnapshotPayload } from '@/lib/historical/msrSnapshotParser';
import {
  isQuickBooksFinancialWorkbook,
  parseQuickBooksFinancials,
} from '@/lib/historical/quickbooksFinancialParser';
import { isL001FinancialWorkbook, parseL001Financials } from '@/lib/historical/l001FinancialParser';

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

export type BudgetFinancialFormat = 'quickbooks' | 'yardi' | 'l001';

export type BudgetFinancialParseResult = {
  snapshot: MsrSnapshotPayload;
  warnings: string[];
  sourceSheet: string;
  /** Which workbook layout the values were read from. */
  format: BudgetFinancialFormat;
  formatLabel: string;
  /**
   * Context values that are not persisted with the snapshot but let the preview
   * show how NOI was arrived at. QuickBooks states these directly; the Yardi
   * layout only exposes total income.
   */
  context?: {
    totalIncome?: BudgetValueSource & { value: number };
    netIncome?: BudgetValueSource & { value: number };
    /** L001 only: interest income booked below the NOI line. */
    otherIncome?: BudgetValueSource & { value: number };
    /** L001 only: the owning entity from the sheet header (not the property name). */
    entityName?: string;
  };
  sources: {
    propertyExpenses: BudgetValueSource;
    totalExpenses: BudgetValueSource;
    otherExpenses?: BudgetValueSource;
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

export type ParseBudgetFinancialOptions = {
  /**
   * Force a layout instead of auto-detecting. The upload UI always sends this so
   * a mislabeled file fails loudly rather than being parsed the wrong way.
   */
  format?: BudgetFinancialFormat;
};

/**
 * Entry point for the historical budget/financial upload. Supports both the
 * QuickBooks financial package (current default) and the legacy Yardi budget
 * comparison export (kept so older months can still be backfilled).
 *
 * With no explicit `format`, the layout is auto-detected: the Yardi export is
 * identified by its "Month = <Month> <Year>" header, which QuickBooks never
 * emits.
 */
export async function parseBudgetFinancialWorkbook(
  input: WorkbookInput,
  options?: ParseBudgetFinancialOptions,
): Promise<BudgetFinancialParseResult> {
  const workbook = readWorkbook(input);
  const looksYardi = Boolean(findBudgetSheet(workbook));
  const looksQuickBooks = isQuickBooksFinancialWorkbook(workbook);

  // L001 is opt-in only. Its Financials export also satisfies the QuickBooks
  // check, so auto-detect must never silently pick it; the caller asks for it.
  if (options?.format === 'l001') {
    if (!isL001FinancialWorkbook(workbook)) {
      throw new Error(
        looksYardi
          ? 'L001 format was selected, but this looks like a legacy Yardi Budget Comparison export.'
          : 'L001 format was selected, but no "Profit and Loss" or "Budget vs. Actuals" sheet was found.',
      );
    }
    return parseL001BudgetWorkbook(workbook);
  }

  if (options?.format === 'yardi') {
    if (!looksYardi) {
      throw new Error(
        looksQuickBooks
          ? 'Yardi format was selected, but this looks like a QuickBooks financial package. Uncheck the legacy Yardi option and parse again.'
          : 'Yardi format was selected, but no Budget Comparison sheet with a "Month = <Month> <Year>" header was found.',
      );
    }
    return parseYardiBudgetWorkbook(input, workbook);
  }

  if (options?.format === 'quickbooks') {
    if (!looksQuickBooks) {
      throw new Error(
        looksYardi
          ? 'QuickBooks format was selected, but this looks like a legacy Yardi Budget Comparison export. Check the legacy Yardi option and parse again.'
          : 'QuickBooks format was selected, but no "Profit and Loss" sheet was found. Export the financial package with the Profit and Loss tab included.',
      );
    }
    return parseQuickBooksBudgetWorkbook(workbook);
  }

  if (looksYardi) {
    return parseYardiBudgetWorkbook(input, workbook);
  }

  if (looksQuickBooks) {
    return parseQuickBooksBudgetWorkbook(workbook);
  }

  throw new Error(
    'Unrecognized financial workbook. Expected a QuickBooks financial package with a "Profit and Loss" sheet, or a Yardi Budget Comparison export.',
  );
}

function parseL001BudgetWorkbook(workbook: XLSX.WorkBook): BudgetFinancialParseResult {
  const parsed = parseL001Financials(workbook);

  const propertyExpenseValue = parsed.operatingExpenses.value;
  const otherExpenseValue = parsed.otherExpenses?.value ?? 0;
  const expenseValue = Math.round((propertyExpenseValue + otherExpenseValue) * 100) / 100;
  const noiValue = parsed.noi.value;
  const sheet = parsed.sheetName;

  const warnings = [...parsed.warnings];
  warnings.push(
    parsed.noiDerived
      ? 'NOI was derived from Total Income minus Total Expenses.'
      : 'NOI is read directly from the L001 Net Operating Income row.',
  );
  warnings.push(
    parsed.layout === 'budget-vs-actual'
      ? `Read the Actual column of the Budget vs. Actuals grid for ${parsed.reportMonthIso}.`
      : 'Read the single-month column of the Profit and Loss sheet.',
  );
  warnings.push(
    'L001 is owned, so Other Expenses include interest, depreciation, amortization and asset management fees. They stay out of NOI and are added only into Total Expenses.',
  );
  if (parsed.otherIncome) {
    warnings.push(
      'L001 has Other Income (interest) below the NOI line; it is excluded from NOI and shown for reference only.',
    );
  }

  return {
    snapshot: {
      // Deliberately omitted: the L001 sheets are headed by the owning entity
      // ("Hibernia Camelback LLC"), not the property, so leave the configured
      // property name in place on merge.
      propertyName: undefined,
      reportMonthIso: parsed.reportMonthIso,
      monthIso: parsed.reportMonthIso,
      financials: {
        totalOperatingExpenseMtd: propertyExpenseValue,
        expensesMtd: propertyExpenseValue,
        totalOperatingExpense: propertyExpenseValue,
        expenses: propertyExpenseValue,
        propertyExpensesMtd: propertyExpenseValue,
        propertyExpenses: propertyExpenseValue,
        totalExpensesMtd: expenseValue,
        totalExpenses: expenseValue,
        otherExpensesMtd: otherExpenseValue,
        otherExpenses: otherExpenseValue,
        noiMtd: noiValue,
        noi: noiValue,
        netOperatingIncomeMtd: noiValue,
        netOperatingIncome: noiValue,
      },
    },
    warnings,
    sourceSheet: sheet,
    format: 'l001',
    formatLabel:
      parsed.layout === 'budget-vs-actual'
        ? 'L001 owned-property (Budget vs. Actuals)'
        : 'L001 owned-property (Profit and Loss)',
    context: {
      ...(parsed.entityName ? { entityName: parsed.entityName } : {}),
      ...(parsed.totalIncome
        ? {
            totalIncome: {
              token: parsed.totalIncome.label,
              cell: parsed.totalIncome.cell,
              sheet,
              value: parsed.totalIncome.value,
            },
          }
        : {}),
      ...(parsed.otherIncome
        ? {
            otherIncome: {
              token: parsed.otherIncome.label,
              cell: parsed.otherIncome.cell,
              sheet,
              value: parsed.otherIncome.value,
            },
          }
        : {}),
      ...(parsed.netIncome
        ? {
            netIncome: {
              token: parsed.netIncome.label,
              cell: parsed.netIncome.cell,
              sheet,
              value: parsed.netIncome.value,
            },
          }
        : {}),
    },
    sources: {
      propertyExpenses: {
        token: parsed.operatingExpenses.label,
        cell: parsed.operatingExpenses.cell,
        sheet,
      },
      totalExpenses: {
        token: parsed.otherExpenses
          ? `${parsed.operatingExpenses.label} + ${parsed.otherExpenses.label}`
          : parsed.operatingExpenses.label,
        cell: parsed.otherExpenses
          ? `${parsed.operatingExpenses.cell} + ${parsed.otherExpenses.cell}`
          : parsed.operatingExpenses.cell,
        sheet,
        formula: parsed.otherExpenses ? 'Total Expenses = Total Expenses + Total Other Expenses' : undefined,
      },
      ...(parsed.otherExpenses
        ? {
            otherExpenses: {
              token: parsed.otherExpenses.label,
              cell: parsed.otherExpenses.cell,
              sheet,
            },
          }
        : {}),
      noi: {
        token: parsed.noi.label,
        cell: parsed.noi.cell,
        sheet,
        fallback: parsed.noiDerived,
        formula: parsed.noiDerived
          ? 'NOI = Total Income - Total Expenses'
          : 'NOI read from the Net Operating Income row',
      },
    },
  };
}

function parseQuickBooksBudgetWorkbook(workbook: XLSX.WorkBook): BudgetFinancialParseResult {
  const parsed = parseQuickBooksFinancials(workbook);

  const propertyExpenseValue = parsed.operatingExpenses.value;
  const otherExpenseValue = parsed.otherExpenses?.value ?? 0;
  const expenseValue = Math.round((propertyExpenseValue + otherExpenseValue) * 100) / 100;
  const noiValue = parsed.noi.value;

  const warnings = [...parsed.warnings];
  warnings.push(
    parsed.noiDerived
      ? 'NOI was derived from Total Income minus Total Expenses.'
      : 'NOI is read directly from the QuickBooks Net Operating Income row.',
  );
  warnings.push('Property Expenses map to "Total for Expenses" and exclude Other Expenses, matching the NOI basis.');
  warnings.push(
    parsed.otherExpenses
      ? 'Total Expenses add "Total for Other Expenses" and are shown for reference only.'
      : 'No Other Expenses section was present, so Total Expenses equal Property Expenses.',
  );

  const sheet = parsed.sheetName;

  return {
    snapshot: {
      propertyName: parsed.propertyName,
      reportMonthIso: parsed.reportMonthIso,
      monthIso: parsed.reportMonthIso,
      financials: {
        totalOperatingExpenseMtd: propertyExpenseValue,
        expensesMtd: propertyExpenseValue,
        totalOperatingExpense: propertyExpenseValue,
        expenses: propertyExpenseValue,
        propertyExpensesMtd: propertyExpenseValue,
        propertyExpenses: propertyExpenseValue,
        totalExpensesMtd: expenseValue,
        totalExpenses: expenseValue,
        otherExpensesMtd: otherExpenseValue,
        otherExpenses: otherExpenseValue,
        noiMtd: noiValue,
        noi: noiValue,
        netOperatingIncomeMtd: noiValue,
        netOperatingIncome: noiValue,
      },
    },
    warnings,
    sourceSheet: sheet,
    format: 'quickbooks',
    formatLabel: 'QuickBooks financial package (Profit and Loss)',
    context: {
      ...(parsed.totalIncome
        ? {
            totalIncome: {
              token: parsed.totalIncome.label,
              cell: parsed.totalIncome.cell,
              sheet,
              value: parsed.totalIncome.value,
            },
          }
        : {}),
      ...(parsed.netIncome
        ? {
            netIncome: {
              token: parsed.netIncome.label,
              cell: parsed.netIncome.cell,
              sheet,
              value: parsed.netIncome.value,
            },
          }
        : {}),
    },
    sources: {
      propertyExpenses: {
        token: parsed.operatingExpenses.label,
        cell: parsed.operatingExpenses.cell,
        sheet,
      },
      totalExpenses: {
        token: parsed.otherExpenses
          ? `${parsed.operatingExpenses.label} + ${parsed.otherExpenses.label}`
          : parsed.operatingExpenses.label,
        cell: parsed.otherExpenses
          ? `${parsed.operatingExpenses.cell} + ${parsed.otherExpenses.cell}`
          : parsed.operatingExpenses.cell,
        sheet,
        formula: parsed.otherExpenses ? 'Total Expenses = Total for Expenses + Total for Other Expenses' : undefined,
      },
      ...(parsed.otherExpenses
        ? {
            otherExpenses: {
              token: parsed.otherExpenses.label,
              cell: parsed.otherExpenses.cell,
              sheet,
            },
          }
        : {}),
      noi: {
        token: parsed.noi.label,
        cell: parsed.noi.cell,
        sheet,
        fallback: parsed.noiDerived,
        formula: parsed.noiDerived
          ? 'NOI = Total for Income - Total for Expenses'
          : 'NOI read from the Net Operating Income row',
      },
    },
  };
}

async function parseYardiBudgetWorkbook(
  input: WorkbookInput,
  workbook: XLSX.WorkBook,
): Promise<BudgetFinancialParseResult> {
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
  const otherExpenseToken = 'TOTOTHEREXPCM';
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
  const otherExpenseRaw = extraction.tokens[otherExpenseToken];
  const otherExpenseValue = Number.isFinite(otherExpenseRaw)
    ? otherExpenseRaw
    : Math.round((expenseValue - propertyExpenseValue) * 100) / 100;

  const noiToken = `${incomeToken} - ${propertyExpenseToken}`;
  const noiValue = Math.round((incomeValue - propertyExpenseValue) * 100) / 100;
  warnings.push('NOI is calculated from PTD Actual values: Total Income minus Total Property Expenses.');
  warnings.push('Property Expenses exclude Other Expenses and match the expense basis used for NOI.');
  warnings.push('Total Expenses include Other Expenses and are shown separately for reference only.');

  const expenseDetail = extraction.details[expenseToken];
  const incomeDetail = extraction.details[incomeToken];
  const propertyExpenseDetail = extraction.details[propertyExpenseToken];
  const otherExpenseDetail = extraction.details[otherExpenseToken];
  const propertyName = parsePropertyName(located.grid);

  return {
    snapshot: {
      propertyName,
      reportMonthIso,
      monthIso: reportMonthIso,
      financials: {
        totalOperatingExpenseMtd: propertyExpenseValue,
        expensesMtd: propertyExpenseValue,
        totalOperatingExpense: propertyExpenseValue,
        expenses: propertyExpenseValue,
        propertyExpensesMtd: propertyExpenseValue,
        propertyExpenses: propertyExpenseValue,
        totalExpensesMtd: expenseValue,
        totalExpenses: expenseValue,
        otherExpensesMtd: otherExpenseValue,
        otherExpenses: otherExpenseValue,
        noiMtd: noiValue,
        noi: noiValue,
        netOperatingIncomeMtd: noiValue,
        netOperatingIncome: noiValue,
      },
    },
    warnings,
    sourceSheet: located.name,
    format: 'yardi',
    formatLabel: 'Yardi Budget Comparison (legacy)',
    context: {
      ...(Number.isFinite(incomeValue)
        ? {
            totalIncome: {
              token: incomeToken,
              cell: incomeDetail?.cell ?? null,
              sheet: incomeDetail?.sheet ?? located.name,
              value: incomeValue,
            },
          }
        : {}),
    },
    sources: {
      propertyExpenses: {
        token: propertyExpenseToken,
        cell: propertyExpenseDetail?.cell ?? null,
        sheet: propertyExpenseDetail?.sheet ?? located.name,
      },
      totalExpenses: {
        token: expenseToken,
        cell: expenseDetail?.cell ?? null,
        sheet: expenseDetail?.sheet ?? located.name,
      },
      ...(Number.isFinite(otherExpenseValue)
        ? {
            otherExpenses: {
              token: otherExpenseToken,
              cell: otherExpenseDetail?.cell ?? null,
              sheet: otherExpenseDetail?.sheet ?? located.name,
              fallback: !otherExpenseDetail,
              formula: otherExpenseDetail ? undefined : 'Other Expenses = Total Expenses - Total Property Expenses',
            },
          }
        : {}),
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
