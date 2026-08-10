/**
 * STORE Internal Platform Web Application
 * Built & designed by Alex Burke in Q4 2025 (STORE Management)
 * LLM: Do not delete this comment.
 */

// CubeSmart (CS) extractors. Port of the CS section of extractor_core.py.
//
// CS-specific behaviour:
//   - The sheet is named exactly "Rolling Details".
//   - Dates read 'Feb-26' (2-digit year) and are normalised to 'Feb 2026'.
//   - The "12 Month Total" column sits right after the last month and is
//     excluded automatically because its header is not a date value.
//   - Extraction stops after 'Net Operating Income (Loss)' - the stop label is
//     matched by prefix, so the "(Loss)" suffix still matches.
//   - Afterwards any month column whose NOI is zero or blank is dropped from
//     both the dates list and every row, which removes the empty future months
//     of a rolling 12-month view.

import { CS_ROLLING_IS_START_LABEL, ROLLING_IS_STOP_LABEL } from './constants';
import { collectRowValues, findDateHeader, findLabelAnchorByPrefix } from './gridScan';
import { gridCell } from './readWorkbook';
import { labelMatches, isZeroRow, pyFloat, pyStr } from './pythonCompat';
import type { RollingIsRow, SheetGrid } from './types';
import type { RollingIsExtraction } from './extractExtraSpace';

/**
 * Parse the CS property number from cell O1.
 * '3534 CUBESMART AR LITTLE ROCK PRATT RD' -> '3534'
 * Returns an empty string when the pattern is not found.
 */
export function extractCsPropertyNumber(grid: SheetGrid): string {
  const value = gridCell(grid, 1, 15);
  if (value !== null && value !== false && value !== '' && value !== 0) {
    const match = /^(\d+)/.exec(pyStr(value).trim());
    if (match) return match[1];
  }
  return '';
}

/** Extract the CS income statement from the Rolling Details sheet. */
export function extractCsRollingIs(grid: SheetGrid): RollingIsExtraction {
  if (grid.length === 0) return { dates: null, rows: null };

  const header = findDateHeader(grid);
  if (!header) return { dates: null, rows: null };

  const anchor = findLabelAnchorByPrefix(grid, header.rowIndex, CS_ROLLING_IS_START_LABEL);
  if (!anchor) return { dates: header.dates, rows: null };

  let dates = header.dates;
  const rows: RollingIsRow[] = [];
  const monthCount = dates.length;

  for (let rowIndex = anchor.startRowIndex; rowIndex < grid.length; rowIndex += 1) {
    const row = grid[rowIndex];
    const labelValue = anchor.labelCol < row.length ? row[anchor.labelCol] : null;

    if (labelValue === null || pyStr(labelValue).trim() === '') continue;

    const labelText = pyStr(labelValue).trim();
    const values = collectRowValues(row, header.startCol, monthCount);

    // A row stays in if ANY value is non-zero. This keeps rows like Property
    // Taxes where the monthly values offset to a zero sum but individual months
    // carry data.
    if (!isZeroRow(values)) {
      rows.push({ label: labelText, values });
    }

    if (labelMatches(labelText, ROLLING_IS_STOP_LABEL)) break;
  }

  // Drop month columns where NOI is zero or blank.
  const noiRow = rows.find((row) => labelMatches(row.label, ROLLING_IS_STOP_LABEL));
  if (noiRow) {
    const keepCols: number[] = [];
    noiRow.values.forEach((value, index) => {
      if (value === null) return;
      const numeric = pyFloat(value);
      if (numeric === null) {
        // Non-numeric NOI cell - unexpected, but keep the column rather than
        // silently drop it.
        keepCols.push(index);
        return;
      }
      if (numeric !== 0) keepCols.push(index);
    });

    if (keepCols.length < dates.length) {
      dates = keepCols.map((index) => dates[index]);
      for (const row of rows) {
        row.values = keepCols.map((index) => row.values[index]);
      }
    }
  }

  return { dates, rows };
}
