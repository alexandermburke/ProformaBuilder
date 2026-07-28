import * as XLSX from 'xlsx';

/**
 * Shared primitives for reading QuickBooks-style financial exports (the P006/W002
 * "Financials.xlsx" packages and the L001 owned-property variants). Kept in one
 * place so the per-format parsers cannot drift on number/month parsing.
 */

export type GridValue = string | number | boolean | Date | null | undefined;
export type Grid = GridValue[][];

export type LabeledValue = {
  value: number;
  label: string;
  cell: string;
};

export const MONTH_NUMBERS: Record<string, string> = {
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

export const asText = (value: GridValue): string => {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString();
  return String(value).replace(/\s+/g, ' ').trim();
};

export const normalizeLabel = (value: GridValue): string => asText(value).toLowerCase();

/**
 * QuickBooks writes currency as text: "$93,017.54", "(1,699.84)" for negatives,
 * "$(24,199.51)" for negative totals, and blank cells for zero rows.
 */
export const parseFinancialNumber = (raw: GridValue): number | null => {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  const text = asText(raw);
  if (!text) return null;
  if (text === '-' || text === '--') return null;

  const negative = /^\(.*\)$/.test(text) || /^\$\(.*\)$/.test(text) || /^-/.test(text);
  const digits = text.replace(/[^0-9.]/g, '');
  if (!digits || digits === '.') return null;
  const parsed = Number(digits);
  if (!Number.isFinite(parsed)) return null;
  return negative ? -parsed : parsed;
};

/** "Jun 2026" / "June 2026" -> "2026-06". Returns null for anything else. */
export const monthIsoFromLabel = (label: string): string | null => {
  const match = label.match(/^([A-Za-z]{3,9})\.?\s+(\d{4})$/);
  if (!match) return null;
  const month = MONTH_NUMBERS[match[1].toLowerCase()];
  if (!month) return null;
  return `${match[2]}-${month}`;
};

/**
 * Report periods appear as a single month ("June 2026") or a range
 * ("January 1-June 30, 2026", "January - May, 2026"). For a monthly snapshot the
 * closing month is the one that matters.
 */
export const monthIsoFromPeriod = (text: string): string | null => {
  if (!text) return null;
  const direct = monthIsoFromLabel(text);
  if (direct) return direct;

  const year = text.match(/(\d{4})\s*$/)?.[1] ?? text.match(/(\d{4})/)?.[1];
  if (!year) return null;
  const months = [...text.matchAll(/([A-Za-z]{3,9})/g)]
    .map((m) => MONTH_NUMBERS[m[1].toLowerCase()])
    .filter((m): m is string => Boolean(m));
  if (!months.length) return null;
  return `${year}-${months[months.length - 1]}`;
};

export const sheetToGrid = (sheet: XLSX.WorkSheet): Grid =>
  XLSX.utils.sheet_to_json<GridValue[]>(sheet, { header: 1, raw: false, defval: null });

/**
 * Find the first row-label in column A matching any candidate (case-insensitive,
 * exact after whitespace collapse) and read the value at `columnIndex`.
 * Exact matching is deliberate: "total expenses" must not match
 * "total other expenses".
 */
export const readLabeledValue = (
  grid: Grid,
  columnIndex: number,
  candidates: string[],
): LabeledValue | null => {
  const wanted = candidates.map((candidate) => candidate.toLowerCase());
  for (let rowIdx = 0; rowIdx < grid.length; rowIdx += 1) {
    const row = grid[rowIdx] ?? [];
    const label = normalizeLabel(row[0]);
    if (!label || !wanted.includes(label)) continue;
    const value = parseFinancialNumber(row[columnIndex]);
    if (value == null) continue;
    return {
      value,
      label: asText(row[0]),
      cell: XLSX.utils.encode_cell({ r: rowIdx, c: columnIndex }),
    };
  }
  return null;
};

export type MonthColumn = { index: number; label: string; monthIso: string };

/**
 * Collect every single-month value column from the header band. Multi-month
 * layouts (Budget vs Actual) put the month label directly above its "Actual"
 * sub-column, so the returned index is the Actual column. Range headers such as
 * "Jan 1 - Jun 30 2026 (YTD)" and "Total" never match the "Mon YYYY" shape and
 * are therefore skipped.
 */
export const findMonthColumns = (grid: Grid, scanRows = 12): MonthColumn[] => {
  for (let rowIdx = 0; rowIdx < Math.min(grid.length, scanRows); rowIdx += 1) {
    const row = grid[rowIdx] ?? [];
    const found: MonthColumn[] = [];
    for (let colIdx = 1; colIdx < row.length; colIdx += 1) {
      const label = asText(row[colIdx]);
      const monthIso = monthIsoFromLabel(label);
      if (monthIso) found.push({ index: colIdx, label, monthIso });
    }
    if (found.length) return found;
  }
  return [];
};

/**
 * Choose the month column for the snapshot: the one matching the report period
 * when resolvable, otherwise the most recent.
 */
export const selectMonthColumn = (
  columns: MonthColumn[],
  periodMonthIso: string | null,
): { column: MonthColumn | null; warnings: string[] } => {
  const warnings: string[] = [];
  if (!columns.length) return { column: null, warnings };

  if (periodMonthIso) {
    const matched = columns.find((entry) => entry.monthIso === periodMonthIso);
    if (matched) return { column: matched, warnings };
    warnings.push(
      `Report period ${periodMonthIso} has no matching month column (${columns
        .map((c) => c.label)
        .join(', ')}); using ${columns[columns.length - 1].label}.`,
    );
  } else if (columns.length > 1) {
    warnings.push(
      `Found ${columns.length} month columns (${columns.map((c) => c.label).join(', ')}); using ${
        columns[columns.length - 1].label
      }.`,
    );
  }
  return { column: columns[columns.length - 1], warnings };
};

export const round2 = (value: number): number => Math.round(value * 100) / 100;
