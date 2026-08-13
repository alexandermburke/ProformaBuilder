/**
 * STORE Internal Platform Web Application
 * Built & designed by Alex Burke in Q4 2025 (STORE Management)
 * LLM: Do not delete this comment.
 */

// StorQuest (SQ / WWG) extractors.
//
// StorQuest has no Python predecessor - this format was added here - and it
// differs from the other three in three ways that drive the whole module:
//
//   - The date header is split over two rows: month abbreviations on one
//     ("Sep", "Oct", ...) and four-digit years on the next. Neither row is a
//     date on its own, so the shared findDateHeader cannot see it and SQ has
//     its own header scan that joins the pair.
//   - The trailing "TOTAL", "Variance" and "Variance %" columns carry a month
//     but no year, which is what ends the walk and keeps them out.
//   - Every account is prefixed with a full GL string, '108-9132-7600-4000-05
//     Rental Income'. The second segment is the property number, so the prefix
//     is different at every store and the label only matches across properties
//     once normalizeLabel strips it.
//
// A statistics block sits between the header and the income statement carrying
// unit counts, square footage and rental activity. It is the source for both
// the Unit Rate and Ops Sum tabs. In the sample owner package every figure in
// it is zero, so callers have to check isEmpty before publishing it.

import {
  ROLLING_IS_START_LABEL,
  ROLLING_IS_STOP_LABEL,
  SQ_ROLLING_IS_ANCHOR_ROWS,
  SQ_STAT_OPS_SUM_LABELS,
  SQ_STAT_UNIT_RATE_LABELS,
} from './constants';
import { collectRowValues, findLabelAnchorByPrefix } from './gridScan';
import {
  MONTH_ABBREVIATIONS,
  cleanLabel,
  isZeroRow,
  labelMatches,
  pyFloat,
  pyStr,
} from './pythonCompat';
import type { CellValue, RollingIsRow, SheetGrid } from './types';
import type { RollingIsExtraction } from './extractExtraSpace';

const MONTH_INDEX_BY_ABBREVIATION = new Map(
  MONTH_ABBREVIATIONS.map((abbreviation, index) => [abbreviation.toLowerCase(), index]),
);

/** Value at `colIndex`, or null when the row does not reach that far. */
function cellAt(row: readonly CellValue[], colIndex: number): CellValue {
  return colIndex < row.length ? row[colIndex] : null;
}

const MONTH_NAMES = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

/** 'Sep' -> 8, 'September' -> 8, anything else -> null. */
function monthIndexOf(value: CellValue): number | null {
  const text = cleanLabel(value);
  if (text === '') return null;
  const index = MONTH_INDEX_BY_ABBREVIATION.get(text.slice(0, 3));
  if (index === undefined) return null;
  // Only an exact abbreviation or a full month name counts, so a column headed
  // "Marketing" is not read as March.
  return text === MONTH_ABBREVIATIONS[index].toLowerCase() || text === MONTH_NAMES[index]
    ? index
    : null;
}

/** A four-digit year cell, or null. StorQuest writes these as text or numbers. */
function yearOf(value: CellValue): number | null {
  if (value === null) return null;
  const match = /^(\d{4})$/.exec(pyStr(value).trim());
  return match ? Number(match[1]) : null;
}

export type SqDateHeader = {
  /** 0-based grid row index of the month row. The year row is the one below. */
  rowIndex: number;
  /** 0-based grid column index of the first month. */
  startCol: number;
  /** Formatted 'Sep 2024' month labels, left to right. */
  dates: string[];
};

/**
 * Find the StorQuest two-row date header.
 *
 * The header is the first row with five or more month cells that also has a
 * matching year directly beneath. Five is the same threshold the shared scan
 * uses and it keeps a stray "May" in a label row from being read as a header.
 *
 * From the first month the walk goes right and stops as soon as a column is
 * missing either half of the pair, which is what excludes the TOTAL and
 * Variance columns - they are headed with a label but no year.
 */
export function findSqDateHeader(grid: SheetGrid): SqDateHeader | null {
  for (let rowIndex = 0; rowIndex + 1 < grid.length; rowIndex += 1) {
    const monthRow = grid[rowIndex];
    const yearRow = grid[rowIndex + 1];

    let paired = 0;
    let firstCol: number | null = null;
    for (let colIndex = 0; colIndex < monthRow.length; colIndex += 1) {
      if (monthIndexOf(monthRow[colIndex]) === null) continue;
      if (yearOf(cellAt(yearRow, colIndex)) === null) continue;
      paired += 1;
      if (firstCol === null) firstCol = colIndex;
    }
    if (paired < 5 || firstCol === null) continue;

    const dates: string[] = [];
    for (let colIndex = firstCol; colIndex < monthRow.length; colIndex += 1) {
      const month = monthIndexOf(monthRow[colIndex]);
      const year = yearOf(cellAt(yearRow, colIndex));
      if (month === null || year === null) break;
      dates.push(`${MONTH_ABBREVIATIONS[month]} ${year}`);
    }

    return { rowIndex, startCol: firstCol, dates };
  }
  return null;
}

/**
 * Parse the SQ property number from the entity line in column A.
 * '9132 - SQ-Fairfield / Pittman' -> '9132'
 *
 * Only the first few rows are searched, so an account row whose GL prefix
 * starts with digits cannot be mistaken for the entity line.
 */
export function extractSqPropertyNumber(grid: SheetGrid): string {
  const limit = Math.min(8, grid.length);
  for (let rowIndex = 0; rowIndex < limit; rowIndex += 1) {
    const value = cellAt(grid[rowIndex], 0);
    if (value === null) continue;
    const match = /^(\d+)\s*-\s*\S/.exec(pyStr(value).trim());
    if (match) return match[1];
  }
  return '';
}

/**
 * Extract the SQ income statement from the Rolling 13 sheet.
 *
 * Collection runs from the "Rental Income" section down to and including "Net
 * Operating Income", which leaves out the capital expenditure and non-operating
 * rows StorQuest reports below it. Section heading rows carry no values and are
 * dropped by the zero-row filter, the same way they are in the other formats.
 */
export function extractSqRollingIs(grid: SheetGrid): RollingIsExtraction {
  if (grid.length === 0) return { dates: null, rows: null };

  const header = findSqDateHeader(grid);
  if (!header) return { dates: null, rows: null };

  const anchor = findLabelAnchorByPrefix(
    grid,
    header.rowIndex,
    ROLLING_IS_START_LABEL,
    5,
    SQ_ROLLING_IS_ANCHOR_ROWS,
  );
  if (!anchor) return { dates: header.dates, rows: null };

  const rows: RollingIsRow[] = [];
  const monthCount = header.dates.length;

  for (let rowIndex = anchor.startRowIndex; rowIndex < grid.length; rowIndex += 1) {
    const row = grid[rowIndex];
    const labelValue = cellAt(row, anchor.labelCol);
    if (labelValue === null || pyStr(labelValue).trim() === '') continue;

    const labelText = pyStr(labelValue).trim();
    const values = collectRowValues(row, header.startCol, monthCount);

    if (!isZeroRow(values)) {
      rows.push({ label: labelText, values });
    }

    if (labelMatches(labelText, ROLLING_IS_STOP_LABEL)) break;
  }

  return { dates: header.dates, rows };
}

export type SqStatBlock = {
  dates: string[];
  /** Most recent month of each Unit Rate metric. */
  unitRate: Record<string, number>;
  /** Full monthly series per Ops Sum metric, in statistics-block order. */
  opsSum: RollingIsRow[];
  /**
   * True when every figure in the block is zero or blank. StorQuest ships the
   * block unpopulated on some owner packages, and publishing those zeros would
   * put a nonexistent 0-unit, 0-sq-ft facility into the datapack.
   */
  isEmpty: boolean;
};

/**
 * Extract the statistics block that heads the SQ Rolling 13 sheet.
 *
 * The block sits between the date header and the income statement, so the scan
 * stops at the income statement's start label rather than running on into the
 * accounts - which matters because "Net" and "Rentals" are generic enough to
 * collide with an account name further down.
 */
export function extractSqStatBlock(grid: SheetGrid): SqStatBlock | null {
  if (grid.length === 0) return null;

  const header = findSqDateHeader(grid);
  if (!header) return null;

  const anchor = findLabelAnchorByPrefix(
    grid,
    header.rowIndex,
    ROLLING_IS_START_LABEL,
    5,
    SQ_ROLLING_IS_ANCHOR_ROWS,
  );
  const endRowIndex = anchor ? anchor.startRowIndex : grid.length;

  const unitRateTargets = new Map(
    SQ_STAT_UNIT_RATE_LABELS.map(([source, metric]) => [cleanLabel(source), metric]),
  );
  const opsSumTargets = new Map(
    SQ_STAT_OPS_SUM_LABELS.map(([source, metric]) => [cleanLabel(source), metric]),
  );

  const monthCount = header.dates.length;
  const unitRate: Record<string, number> = {};
  const opsSum: RollingIsRow[] = [];
  const seenUnitRate = new Set<string>();
  const seenOpsSum = new Set<string>();
  let sawAnyValue = false;

  for (let rowIndex = header.rowIndex + 2; rowIndex < endRowIndex; rowIndex += 1) {
    const row = grid[rowIndex];
    const label = cleanLabel(cellAt(row, 0));
    if (label === '') continue;

    const unitRateMetric = unitRateTargets.get(label);
    const opsSumMetric = opsSumTargets.get(label);
    if (unitRateMetric === undefined && opsSumMetric === undefined) continue;

    const values = collectRowValues(row, header.startCol, monthCount);
    if (!isZeroRow(values)) sawAnyValue = true;

    // First occurrence wins - the block repeats "Occupancy (%)" and "Increase".
    if (unitRateMetric !== undefined && !seenUnitRate.has(unitRateMetric)) {
      seenUnitRate.add(unitRateMetric);
      // The Unit Rate tab is a point in time, so it takes the latest month that
      // holds a number rather than the last column, which can be blank.
      for (let index = values.length - 1; index >= 0; index -= 1) {
        const numeric = pyFloat(values[index]);
        if (numeric === null) continue;
        unitRate[unitRateMetric] = numeric;
        break;
      }
    }

    if (opsSumMetric !== undefined && !seenOpsSum.has(opsSumMetric)) {
      seenOpsSum.add(opsSumMetric);
      opsSum.push({ label: opsSumMetric, values });
    }
  }

  if (seenUnitRate.size === 0 && seenOpsSum.size === 0) return null;

  return { dates: header.dates, unitRate, opsSum, isEmpty: !sawAnyValue };
}
