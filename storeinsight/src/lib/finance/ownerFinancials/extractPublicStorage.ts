/**
 * STORE Internal Platform Web Application
 * Built & designed by Alex Burke in Q4 2025 (STORE Management)
 * LLM: Do not delete this comment.
 */

// Public Storage (PS) extractors. Port of the PS section of extractor_core.py.
//
// PS-specific behaviour:
//   - The income statement sheet is named exactly "IS" (no prefix, no number).
//   - Dates read 'Feb-2025' and are normalised to 'Feb 2025' by formatDate().
//   - The trailing YTD column is excluded automatically: its header is not a
//     date value, so the date walk stops before it.
//   - Section header rows (Revenue, Contractually set fees, Other Expenses,
//     Other items) carry no numbers and are skipped.
//   - The PS Rent Roll has no rates or move-in dates, so the only reliable
//     metric is an occupied-unit count.

import { PS_SECTION_HEADERS, ROLLING_IS_START_LABEL, ROLLING_IS_STOP_LABEL } from './constants';
import { collectRowValues, findDateHeader, findLabelAnchorByPrefix } from './gridScan';
import { gridCell } from './readWorkbook';
import { isZeroRow, labelMatches, pyStr } from './pythonCompat';
import type { RollingIsRow, SheetGrid } from './types';
import type { RollingIsExtraction } from './extractExtraSpace';

/**
 * Parse the PS property number from cell B3.
 * '77712 - Wentworth (Vacaville, CA)' -> '77712'
 * Returns an empty string when the pattern is not found.
 */
export function extractPsPropertyNumber(grid: SheetGrid): string {
  const value = gridCell(grid, 3, 2);
  if (value !== null && value !== false && value !== '' && value !== 0) {
    const match = /^(\d+)/.exec(pyStr(value).trim());
    if (match) return match[1];
  }
  return '';
}

/** Extract the PS income statement from the IS sheet. */
export function extractPsRollingIs(grid: SheetGrid): RollingIsExtraction {
  if (grid.length === 0) return { dates: null, rows: null };

  const header = findDateHeader(grid);
  if (!header) return { dates: null, rows: null };

  const anchor = findLabelAnchorByPrefix(grid, header.rowIndex, ROLLING_IS_START_LABEL);
  if (!anchor) return { dates: header.dates, rows: null };

  const rows: RollingIsRow[] = [];
  const monthCount = header.dates.length;

  for (let rowIndex = anchor.startRowIndex; rowIndex < grid.length; rowIndex += 1) {
    const row = grid[rowIndex];
    const labelValue = anchor.labelCol < row.length ? row[anchor.labelCol] : null;

    if (labelValue === null || pyStr(labelValue).trim() === '') continue;

    const labelText = pyStr(labelValue).trim();

    // Skip pure section header rows - they carry no numeric data
    if (PS_SECTION_HEADERS.has(labelText.toLowerCase())) continue;

    const values = collectRowValues(row, header.startCol, monthCount);
    if (!isZeroRow(values)) {
      rows.push({ label: labelText, values });
    }

    if (labelMatches(labelText, ROLLING_IS_STOP_LABEL)) break;
  }

  return { dates: header.dates, rows };
}

/**
 * Count occupied units from the PS Rent Roll sheet: column C (Account #) from
 * row 8 down, stopping at the first empty cell.
 *
 * Returns null when the sheet yields no rows, which the caller reports as a
 * warning rather than an occupancy of zero.
 */
export function extractPsRentRollOccupancy(grid: SheetGrid): number | null {
  let count = 0;
  for (let rowNumber = 8; rowNumber <= grid.length; rowNumber += 1) {
    const value = gridCell(grid, rowNumber, 3);
    if (value === null || pyStr(value).trim() === '') break;
    count += 1;
  }
  return count > 0 ? count : null;
}
