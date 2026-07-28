import * as XLSX from 'xlsx';
import {
  asText,
  findMonthColumns,
  monthIsoFromPeriod,
  normalizeLabel,
  readLabeledValue,
  round2,
  selectMonthColumn,
  sheetToGrid,
  type Grid,
  type LabeledValue,
} from '@/lib/historical/financialSheetUtils';

/**
 * Parser for QuickBooks-style monthly financial workbooks for managed
 * properties (the "<code> <name> Financials.xlsx" exports with Balance Sheet /
 * Profit and Loss / Budget vs Actual / Trailing 12 tabs).
 *
 * The monthly snapshot is read from the "Profit and Loss" sheet:
 *
 *   A1  P006 - STORE in Plymouth
 *   A2  Profit and Loss
 *   A3  June 2026
 *   A6  (blank)  B6 "Jun 2026"  C6 "Jan 1 - Jun 30 2026 (YTD)"
 *   ...
 *   A20 Total for Income            B20 $93,017.54
 *   A44 Total for Expenses          B44 $26,440.99
 *   A45 Net Operating Income        B45 $66,576.55
 *   A49 Total for Other Expenses    B49 $24,199.51
 *   A51 Net Income                  B51 $42,377.04
 *
 * Unlike the Yardi budget comparison layout, QuickBooks states Net Operating
 * Income directly, so NOI is read rather than derived (and cross-checked against
 * Total Income - Total Expenses).
 *
 * For the owned L001 property, whose books add an Other Income section and drop
 * the "for" from subtotal labels, see `l001FinancialParser`.
 */

export type QuickBooksValue = LabeledValue;

export type QuickBooksFinancials = {
  propertyName?: string;
  reportMonthIso: string;
  sheetName: string;
  totalIncome?: LabeledValue;
  operatingExpenses: LabeledValue;
  otherExpenses?: LabeledValue;
  noi: LabeledValue;
  netIncome?: LabeledValue;
  noiDerived: boolean;
  warnings: string[];
};

const PROFIT_AND_LOSS_PATTERN = /profit\s*(and|&)\s*loss/i;

const INCOME_LABELS = ['total for income', 'total income'];
const EXPENSE_LABELS = ['total for expenses', 'total expenses'];
const OTHER_EXPENSE_LABELS = ['total for other expenses', 'total other expenses'];
const NOI_LABELS = ['net operating income', 'total net operating income'];
const NET_INCOME_LABELS = ['net income'];

/** Kept as a named export for callers that only need the number coercion. */
export { parseFinancialNumber as parseQuickBooksNumber } from '@/lib/historical/financialSheetUtils';

export const isQuickBooksFinancialWorkbook = (workbook: XLSX.WorkBook): boolean => {
  if (workbook.SheetNames.some((name) => PROFIT_AND_LOSS_PATTERN.test(name))) return true;
  return workbook.SheetNames.some((name) => {
    const sheet = workbook.Sheets[name];
    if (!sheet) return false;
    const a1 = asText(sheet.A1?.v as never);
    const a2 = asText(sheet.A2?.v as never);
    return PROFIT_AND_LOSS_PATTERN.test(a1) || PROFIT_AND_LOSS_PATTERN.test(a2);
  });
};

const findProfitAndLossSheet = (workbook: XLSX.WorkBook): { name: string; grid: Grid } | null => {
  const byName = workbook.SheetNames.find((name) => PROFIT_AND_LOSS_PATTERN.test(name));
  const candidates = byName
    ? [byName, ...workbook.SheetNames.filter((name) => name !== byName)]
    : workbook.SheetNames;

  for (const name of candidates) {
    const sheet = workbook.Sheets[name];
    if (!sheet) continue;
    const grid = sheetToGrid(sheet);
    const header = grid.slice(0, 6).some((row) => PROFIT_AND_LOSS_PATTERN.test(asText(row?.[0])));
    const hasTotals = grid.some((row) => {
      const label = normalizeLabel(row?.[0]);
      return NOI_LABELS.includes(label) || INCOME_LABELS.includes(label);
    });
    if (header || hasTotals) return { name, grid };
  }
  return null;
};

const parsePropertyName = (grid: Grid): string | undefined => {
  for (const row of grid.slice(0, 4)) {
    const text = asText(row?.[0]);
    if (!text) continue;
    if (PROFIT_AND_LOSS_PATTERN.test(text)) continue;
    if (/^balance sheet$|^budget vs\.? actual/i.test(text)) continue;
    if (monthIsoFromPeriod(text)) continue;
    return text;
  }
  return undefined;
};

export function parseQuickBooksFinancials(workbook: XLSX.WorkBook): QuickBooksFinancials {
  const located = findProfitAndLossSheet(workbook);
  if (!located) {
    throw new Error(
      'Unable to locate a "Profit and Loss" sheet in the QuickBooks workbook. Export the financial package with the Profit and Loss tab included.',
    );
  }

  const { name: sheetName, grid } = located;
  const warnings: string[] = [];

  const periodMonthIso = monthIsoFromPeriod(asText(grid[2]?.[0])) ?? monthIsoFromPeriod(asText(grid[1]?.[0]));
  const { column, warnings: columnWarnings } = selectMonthColumn(findMonthColumns(grid), periodMonthIso);
  warnings.push(...columnWarnings);

  const columnIndex = column?.index ?? 1;
  if (!column) {
    warnings.push('No month column header was found; using the first value column.');
  }
  const reportMonthIso = column?.monthIso ?? periodMonthIso;
  if (!reportMonthIso) {
    throw new Error('Unable to determine the report month from the QuickBooks Profit and Loss sheet.');
  }

  const totalIncome = readLabeledValue(grid, columnIndex, INCOME_LABELS);
  const operatingExpenses = readLabeledValue(grid, columnIndex, EXPENSE_LABELS);
  const otherExpenses = readLabeledValue(grid, columnIndex, OTHER_EXPENSE_LABELS);
  const netIncome = readLabeledValue(grid, columnIndex, NET_INCOME_LABELS);
  const statedNoi = readLabeledValue(grid, columnIndex, NOI_LABELS);

  if (!operatingExpenses) {
    throw new Error(
      `Unable to read "Total for Expenses" from ${sheetName} column ${XLSX.utils.encode_col(columnIndex)}.`,
    );
  }

  let noi = statedNoi;
  let noiDerived = false;
  if (!noi) {
    if (!totalIncome) {
      throw new Error(
        `Unable to read "Net Operating Income" or "Total for Income" from ${sheetName}; cannot determine NOI.`,
      );
    }
    noi = {
      value: round2(totalIncome.value - operatingExpenses.value),
      label: 'Total for Income - Total for Expenses',
      cell: `${totalIncome.cell} - ${operatingExpenses.cell}`,
    };
    noiDerived = true;
    warnings.push('Net Operating Income was not stated; derived from Total Income minus Total Expenses.');
  } else if (totalIncome) {
    const expected = round2(totalIncome.value - operatingExpenses.value);
    if (Math.abs(expected - noi.value) > 0.01) {
      warnings.push(
        `Stated Net Operating Income (${noi.value.toFixed(2)}) does not match Total Income minus Total Expenses (${expected.toFixed(2)}).`,
      );
    }
  }

  return {
    propertyName: parsePropertyName(grid),
    reportMonthIso,
    sheetName,
    totalIncome: totalIncome ?? undefined,
    operatingExpenses,
    otherExpenses: otherExpenses ?? undefined,
    noi,
    netIncome: netIncome ?? undefined,
    noiDerived,
    warnings,
  };
}
