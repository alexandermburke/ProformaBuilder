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
 * Parser for the L001 (STORE at The Grove / Hibernia Camelback LLC) financial
 * exports. L001 is owned rather than third-party managed, so its books differ
 * from the managed-property packages in three ways that matter here:
 *
 *  1. Subtotal rows are labelled "Total <account>" instead of
 *     "Total for <account>" (e.g. "Total Expenses", "Total 6900 Utilities").
 *  2. There is an "Other Income" section (9000 Interest Income) below the NOI
 *     line, which managed properties do not have. Net Income therefore reconciles
 *     as NOI + Other Income - Other Expenses.
 *  3. Below-the-line ownership costs appear in Other Expenses: interest expense,
 *     depreciation, amortization, asset management fee, capital expenditure.
 *     Property Taxes and CAM Charges sit above the line inside Total Expenses.
 *
 * Two workbook shapes are accepted:
 *
 *  A. "<code> L001 Financials.xlsx" -> "Profit and Loss" sheet, columns
 *     B = single month, C = YTD.
 *
 *       A1  Hibernia Camelback LLC
 *       A2  Profit and Loss
 *       A3  June 2026
 *       A21 Total Income             B21 $164,839.44
 *       A45 Total Expenses           B45 $45,344.70
 *       A46 Net Operating Income     B46 $119,494.74
 *       A49 Total Other Income       B49 $809.43
 *       A56 Total Other Expenses     B56 $110,894.64
 *       A58 Net Income               B58 $9,409.53
 *
 *  B. "<code> L001 Revised Budget v Actual.xlsx" -> single "Budget vs. Actuals"
 *     sheet, four columns per month (Actual / Budget / over Budget / % of
 *     Budget). The month label sits above its Actual column, so the Actual
 *     column is read for the closing month of the report period.
 *
 * The persisted snapshot shape is identical to the other formats so historical
 * months stay comparable: NOI is Total Income - Total Expenses (operating only),
 * Other Expenses stay out of NOI and are added only into Total Expenses.
 */

export type L001Financials = {
  /** Owning entity from A1 (e.g. "Hibernia Camelback LLC"), not the property name. */
  entityName?: string;
  reportMonthIso: string;
  sheetName: string;
  layout: 'profit-and-loss' | 'budget-vs-actual';
  totalIncome?: LabeledValue;
  operatingExpenses: LabeledValue;
  otherIncome?: LabeledValue;
  otherExpenses?: LabeledValue;
  noi: LabeledValue;
  netIncome?: LabeledValue;
  noiDerived: boolean;
  warnings: string[];
};

const PROFIT_AND_LOSS_PATTERN = /profit\s*(and|&)\s*loss/i;
const BUDGET_VS_ACTUAL_PATTERN = /budget\s*vs\.?\s*actual/i;

// L001 omits the "for" that managed-property exports include; accept both so a
// relabelled export does not silently fall through to zero.
const INCOME_LABELS = ['total income', 'total for income'];
const EXPENSE_LABELS = ['total expenses', 'total for expenses'];
const OTHER_INCOME_LABELS = ['total other income', 'total for other income'];
const OTHER_EXPENSE_LABELS = ['total other expenses', 'total for other expenses'];
const NOI_LABELS = ['net operating income', 'total net operating income'];
const NET_INCOME_LABELS = ['net income'];

const hasFinancialTotals = (grid: Grid): boolean =>
  grid.some((row) => {
    const label = normalizeLabel(row?.[0]);
    return NOI_LABELS.includes(label) || INCOME_LABELS.includes(label);
  });

export const isL001FinancialWorkbook = (workbook: XLSX.WorkBook): boolean =>
  workbook.SheetNames.some((name) => {
    if (PROFIT_AND_LOSS_PATTERN.test(name) || BUDGET_VS_ACTUAL_PATTERN.test(name)) return true;
    const sheet = workbook.Sheets[name];
    if (!sheet) return false;
    const a2 = asText(sheet.A2?.v as never);
    return PROFIT_AND_LOSS_PATTERN.test(a2) || BUDGET_VS_ACTUAL_PATTERN.test(a2);
  });

type LocatedSheet = { name: string; grid: Grid; layout: L001Financials['layout'] };

/**
 * Prefer the Profit and Loss sheet (single month, cleanest). Fall back to the
 * Budget vs Actual grid, which is the only sheet in the "Revised Budget v
 * Actual" export.
 */
const locateSheet = (workbook: XLSX.WorkBook): LocatedSheet | null => {
  const pl = workbook.SheetNames.find((name) => PROFIT_AND_LOSS_PATTERN.test(name));
  if (pl && workbook.Sheets[pl]) {
    const grid = sheetToGrid(workbook.Sheets[pl]);
    if (hasFinancialTotals(grid)) return { name: pl, grid, layout: 'profit-and-loss' };
  }

  const bva = workbook.SheetNames.find((name) => BUDGET_VS_ACTUAL_PATTERN.test(name));
  if (bva && workbook.Sheets[bva]) {
    const grid = sheetToGrid(workbook.Sheets[bva]);
    if (hasFinancialTotals(grid)) return { name: bva, grid, layout: 'budget-vs-actual' };
  }

  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    if (!sheet) continue;
    const grid = sheetToGrid(sheet);
    if (!hasFinancialTotals(grid)) continue;
    const a2 = asText(grid[1]?.[0]);
    const layout: L001Financials['layout'] = BUDGET_VS_ACTUAL_PATTERN.test(a2) ? 'budget-vs-actual' : 'profit-and-loss';
    return { name, grid, layout };
  }
  return null;
};

const parseEntityName = (grid: Grid): string | undefined => {
  const first = asText(grid[0]?.[0]);
  if (!first) return undefined;
  if (PROFIT_AND_LOSS_PATTERN.test(first) || BUDGET_VS_ACTUAL_PATTERN.test(first)) return undefined;
  return first;
};

export function parseL001Financials(workbook: XLSX.WorkBook): L001Financials {
  const located = locateSheet(workbook);
  if (!located) {
    throw new Error(
      'Unable to locate a "Profit and Loss" or "Budget vs. Actuals" sheet in the L001 workbook.',
    );
  }

  const { name: sheetName, grid, layout } = located;
  const warnings: string[] = [];

  const periodMonthIso = monthIsoFromPeriod(asText(grid[2]?.[0])) ?? monthIsoFromPeriod(asText(grid[1]?.[0]));
  const monthColumns = findMonthColumns(grid);
  const { column, warnings: columnWarnings } = selectMonthColumn(monthColumns, periodMonthIso);
  warnings.push(...columnWarnings);

  // No month header at all: fall back to the first value column.
  const columnIndex = column?.index ?? 1;
  if (!column) {
    warnings.push('No month column header was found; using the first value column.');
  }
  const reportMonthIso = column?.monthIso ?? periodMonthIso;
  if (!reportMonthIso) {
    throw new Error(`Unable to determine the report month from ${sheetName}.`);
  }

  const totalIncome = readLabeledValue(grid, columnIndex, INCOME_LABELS);
  const operatingExpenses = readLabeledValue(grid, columnIndex, EXPENSE_LABELS);
  const otherIncome = readLabeledValue(grid, columnIndex, OTHER_INCOME_LABELS);
  const otherExpenses = readLabeledValue(grid, columnIndex, OTHER_EXPENSE_LABELS);
  const netIncome = readLabeledValue(grid, columnIndex, NET_INCOME_LABELS);
  const statedNoi = readLabeledValue(grid, columnIndex, NOI_LABELS);

  if (!operatingExpenses) {
    throw new Error(
      `Unable to read "Total Expenses" from ${sheetName} column ${XLSX.utils.encode_col(columnIndex)}.`,
    );
  }

  let noi = statedNoi;
  let noiDerived = false;
  if (!noi) {
    if (!totalIncome) {
      throw new Error(
        `Unable to read "Net Operating Income" or "Total Income" from ${sheetName}; cannot determine NOI.`,
      );
    }
    noi = {
      value: round2(totalIncome.value - operatingExpenses.value),
      label: 'Total Income - Total Expenses',
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

  // L001 reconciles as NOI + Other Income - Other Expenses = Net Income. Managed
  // properties have no Other Income, so this check is L001-specific.
  if (netIncome) {
    const expectedNet = round2(noi.value + (otherIncome?.value ?? 0) - (otherExpenses?.value ?? 0));
    if (Math.abs(expectedNet - netIncome.value) > 0.01) {
      warnings.push(
        `Net Income (${netIncome.value.toFixed(2)}) does not match NOI + Other Income - Other Expenses (${expectedNet.toFixed(2)}).`,
      );
    }
  }

  return {
    entityName: parseEntityName(grid),
    reportMonthIso,
    sheetName,
    layout,
    totalIncome: totalIncome ?? undefined,
    operatingExpenses,
    otherIncome: otherIncome ?? undefined,
    otherExpenses: otherExpenses ?? undefined,
    noi,
    netIncome: netIncome ?? undefined,
    noiDerived,
    warnings,
  };
}
