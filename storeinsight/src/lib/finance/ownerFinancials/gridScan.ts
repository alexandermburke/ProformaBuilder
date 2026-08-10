/**
 * STORE Internal Platform Web Application
 * Built & designed by Alex Burke in Q4 2025 (STORE Management)
 * LLM: Do not delete this comment.
 */

// Shared grid-scanning helpers for the Owner Financials Extractor.
//
// The Python extractor repeats the same date-header and label-column scans in
// each manager branch. They are behaviourally identical, so they live here once
// rather than being copy-pasted per format - the manager differences are the
// start label, the label column search width, and the row budget, all passed in.

import { cleanLabel, formatDate, isDateValue, labelMatches } from './pythonCompat';
import type { CellValue, SheetGrid } from './types';

export type DateHeader = {
  /** 0-based grid row index of the header row. */
  rowIndex: number;
  /** 0-based grid column index of the first date cell. */
  startCol: number;
  /** Formatted 'Feb 2025' month labels, left to right. */
  dates: string[];
};

/**
 * Find the date header row: the first row holding 5 or more date values. The
 * threshold avoids false positives from rows with one or two stray dates.
 *
 * From the first date cell the scan walks right collecting months and stops at
 * the first gap or non-date cell, which is what excludes trailing total columns
 * such as the PS "YTD" column or the CubeSmart "12 Month Total" column.
 */
export function findDateHeader(grid: SheetGrid): DateHeader | null {
  for (let rowIndex = 0; rowIndex < grid.length; rowIndex += 1) {
    const row = grid[rowIndex];
    let dateCount = 0;
    let firstDateCol: number | null = null;
    for (let colIndex = 0; colIndex < row.length; colIndex += 1) {
      if (isDateValue(row[colIndex])) {
        dateCount += 1;
        if (firstDateCol === null) firstDateCol = colIndex;
      }
    }
    if (dateCount >= 5 && firstDateCol !== null) {
      const dates: string[] = [];
      for (let colIndex = firstDateCol; colIndex < row.length; colIndex += 1) {
        const value = row[colIndex];
        if (isDateValue(value)) {
          dates.push(formatDate(value));
        } else {
          // Both an empty cell and a non-date value (e.g. a YTD total) end the walk.
          break;
        }
      }
      return { rowIndex, startCol: firstDateCol, dates };
    }
  }
  return null;
}

export type LabelAnchor = {
  /** 0-based grid column index holding the row labels. */
  labelCol: number;
  /** 0-based grid row index where the start label was found. */
  startRowIndex: number;
};

/**
 * Find the label column and start row by looking for the first cell in the
 * leftmost `maxColumns` columns that starts with `startLabel`, within
 * `maxRows` rows below the date header.
 */
export function findLabelAnchorByPrefix(
  grid: SheetGrid,
  dateRowIndex: number,
  startLabel: string,
  maxColumns = 5,
  maxRows = 30,
): LabelAnchor | null {
  const limit = Math.min(dateRowIndex + maxRows, grid.length);
  for (let rowIndex = dateRowIndex + 1; rowIndex < limit; rowIndex += 1) {
    const row = grid[rowIndex];
    for (let colIndex = 0; colIndex < Math.min(maxColumns, row.length); colIndex += 1) {
      if (labelMatches(row[colIndex], startLabel)) {
        return { labelCol: colIndex, startRowIndex: rowIndex };
      }
    }
  }
  return null;
}

/**
 * Find the label column by looking for the first cell in the leftmost
 * `maxColumns` columns whose cleaned text is one of `targets`.
 */
export function findLabelColumnByTargets(
  grid: SheetGrid,
  dateRowIndex: number,
  targets: ReadonlySet<string>,
  maxColumns = 4,
  maxRows = 40,
): number | null {
  const limit = Math.min(dateRowIndex + maxRows, grid.length);
  for (let rowIndex = dateRowIndex + 1; rowIndex < limit; rowIndex += 1) {
    const row = grid[rowIndex];
    for (let colIndex = 0; colIndex < Math.min(maxColumns, row.length); colIndex += 1) {
      if (targets.has(cleanLabel(row[colIndex]))) {
        return colIndex;
      }
    }
  }
  return null;
}

/** Monthly values aligned to the dates list, padded with null past the row end. */
export function collectRowValues(
  row: readonly CellValue[],
  startCol: number,
  count: number,
): CellValue[] {
  const values: CellValue[] = [];
  for (let offset = 0; offset < count; offset += 1) {
    const col = startCol + offset;
    values.push(col < row.length ? row[col] : null);
  }
  return values;
}
