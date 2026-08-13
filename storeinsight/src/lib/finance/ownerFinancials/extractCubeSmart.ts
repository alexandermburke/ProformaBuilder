/**
 * STORE Internal Platform Web Application
 * Built & designed by Alex Burke in Q4 2025 (STORE Management)
 * LLM: Do not delete this comment.
 */

// CubeSmart (CS) extractors. Port of the CS section of extractor_core.py, plus
// the Cube Mix, Summary of Rental Experience, and Rent Roll sheets the Python
// version never covered.
//
// CS-specific behaviour:
//   - Every sheet is named exactly ("Rolling Details", "Cube Mix", ...), so
//     they are looked up by name rather than by the EXR prefix+number scheme.
//   - Dates read 'Feb-26' (2-digit year) on Rolling Details and 'Feb-2026' on
//     the Summary of Rental Experience; formatDate normalises both.
//   - The "12 Month Total" column sits right after the last month and is
//     excluded automatically because its header is not a date value.
//   - Income statement extraction stops after 'Net Operating Income (Loss)' -
//     the stop label is matched by prefix, so the "(Loss)" suffix still matches.
//   - Afterwards any month column whose NOI is zero or blank is dropped from
//     both the dates list and every row, which removes the empty future months
//     of a rolling 12-month view.
//   - Cube dimensions can carry a half foot ("7.5X10"), which the EXR sq ft
//     parser rejects, so CS has its own.

import {
  CS_CUBE_MIX_METRIC_COLUMNS,
  CS_OPS_SUM_LABELS,
  CS_RENT_ROLL_COLUMN_MAP,
  CS_RENT_ROLL_EXTRA_HEADERS,
  CS_RENT_ROLL_STATUS,
  CS_ROLLING_IS_START_LABEL,
  RENT_ROLL_HEADERS,
  ROLLING_IS_STOP_LABEL,
} from './constants';
import {
  collectRowValues,
  findDateHeader,
  findLabelAnchorByPrefix,
  findLabelColumnByTargets,
} from './gridScan';
import { gridCell } from './readWorkbook';
import { cleanLabel, labelMatches, isZeroRow, pyFloat, pyStr, pySum } from './pythonCompat';
import type { CellValue, RollingIsRow, SheetGrid } from './types';
import type { RentRollExtraction, RollingIsExtraction } from './extractExtraSpace';

/** A store banner cell: the property number, whitespace, then the store name. */
const CS_STORE_BANNER = /^(\d{3,})\s+\S/;

/**
 * Parse the CS property number from the store banner in row 1.
 *
 * Rolling Details puts it in O1 ('3534 CUBESMART AR LITTLE ROCK PRATT RD'), but
 * the other CS tabs put the same banner in a different column - K1 on the Rent
 * Roll, M1 on Cube Mix, N1 on the Summary of Rental Experience - so O1 is tried
 * first and the rest of row 1 is scanned after it.
 *
 * Returns an empty string when the pattern is not found.
 */
export function extractCsPropertyNumber(grid: SheetGrid): string {
  const value = gridCell(grid, 1, 15);
  if (value !== null && value !== false && value !== '' && value !== 0) {
    const match = /^(\d+)/.exec(pyStr(value).trim());
    if (match) return match[1];
  }

  for (const cell of grid[0] ?? []) {
    if (cell === null) continue;
    const match = CS_STORE_BANNER.exec(pyStr(cell).trim());
    if (match) return match[1];
  }

  return '';
}

/**
 * Convert a cube dimension string to square feet: '10X15' -> 150.
 *
 * CubeSmart pads to two digits ('05X05') and allows a half foot ('7.5X10'),
 * neither of which the EXR parser handles, and the products it returns match
 * the Cube SqFt column of the Cube Mix sheet.
 */
export function calculateCubeSqFt(dimensions: CellValue): number | null {
  if (dimensions === null) return null;
  const match = /^(\d+(?:\.\d+)?)\s*[Xx]\s*(\d+(?:\.\d+)?)/.exec(pyStr(dimensions).trim());
  if (!match) return null;
  return Number(match[1]) * Number(match[2]);
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

/** Value at `colIndex`, or null when the row does not reach that far. */
function cellAt(row: readonly CellValue[], colIndex: number): CellValue {
  return colIndex < row.length ? row[colIndex] : null;
}

/**
 * Locate the header row of a CS table and the column index of each label the
 * caller cares about.
 *
 * `wanted` maps a cleaned source header to the name it should be stored under.
 * The header row is the first row carrying at least `minMatches` of them, which
 * is the same tolerance the EXR rent roll detector uses: a file version that
 * drops or renames one column still resolves.
 */
function findLabelledColumns(
  grid: SheetGrid,
  wanted: ReadonlyMap<string, string>,
  minMatches: number,
): { headerRowIndex: number; columns: Map<string, number> } | null {
  for (let rowIndex = 0; rowIndex < grid.length; rowIndex += 1) {
    const row = grid[rowIndex];
    const columns = new Map<string, number>();
    for (let colIndex = 0; colIndex < row.length; colIndex += 1) {
      const name = wanted.get(cleanLabel(row[colIndex]));
      // First column wins, so a repeated header later in the row is ignored.
      if (name !== undefined && !columns.has(name)) columns.set(name, colIndex);
    }
    if (columns.size >= minMatches) return { headerRowIndex: rowIndex, columns };
  }
  return null;
}

/**
 * True when a label reads as a total rather than a data row.
 *
 * Deliberately loose: an exact "total" match is what CubeSmart writes, but a
 * totals row that goes unrecognised gets summed together with the detail rows
 * it already totals, which silently doubles every count. Treating anything
 * containing the word as a total is the safe direction to be wrong in - a cube
 * dimension or a customer name never contains it.
 */
function isTotalLabel(value: CellValue): boolean {
  return cleanLabel(value).includes('total');
}

/** First row below `headerRowIndex` whose leading cells read as a total. */
function findTotalRow(grid: SheetGrid, headerRowIndex: number): number | null {
  for (let rowIndex = headerRowIndex + 1; rowIndex < grid.length; rowIndex += 1) {
    const row = grid[rowIndex];
    for (let colIndex = 0; colIndex < Math.min(3, row.length); colIndex += 1) {
      if (isTotalLabel(row[colIndex])) return rowIndex;
    }
  }
  return null;
}

/**
 * Extract the Unit Rate metrics from the CS Cube Mix sheet.
 *
 * CubeSmart has no Unit Rate sheet. Cube Mix breaks the store down by cube type
 * and closes with a totals row holding exactly the four counts the Unit Rate tab
 * reports, so those cells are read straight across. When a file arrives without
 * the totals row the per-type rows are summed instead, which produces the same
 * four numbers.
 */
export function extractCsUnitRate(grid: SheetGrid): Record<string, number> {
  const results: Record<string, number> = {};
  if (grid.length === 0) return results;

  const wanted = new Map(
    CS_CUBE_MIX_METRIC_COLUMNS.map(([header, metric]) => [cleanLabel(header), metric]),
  );
  const found = findLabelledColumns(grid, wanted, 2);
  if (!found) return results;

  const { headerRowIndex, columns } = found;
  const totalRowIndex = findTotalRow(grid, headerRowIndex);

  if (totalRowIndex !== null) {
    const totalRow = grid[totalRowIndex];
    columns.forEach((colIndex, metric) => {
      const numeric = pyFloat(cellAt(totalRow, colIndex));
      if (numeric !== null) results[metric] = numeric;
    });
    if (Object.keys(results).length > 0) return results;
    // A totals row that held no numbers is no better than none at all.
  }

  columns.forEach((colIndex, metric) => {
    const values: number[] = [];
    for (let rowIndex = headerRowIndex + 1; rowIndex < grid.length; rowIndex += 1) {
      const row = grid[rowIndex];
      // Never fold a total back into the sum of the rows it totals.
      if (row.slice(0, 3).some(isTotalLabel)) continue;
      const numeric = pyFloat(cellAt(row, colIndex));
      if (numeric !== null) values.push(numeric);
    }
    if (values.length > 0) results[metric] = pySum(values);
  });

  return results;
}

/**
 * Extract rental activity from the CS Summary of Rental Experience sheet.
 *
 * The sheet holds three date-headed blocks - rental activity, revenue and AR,
 * and promotions. findDateHeader returns the first, which is the rental
 * activity one, and the scan keeps the first row per metric so a label that
 * repeats under a later block cannot overwrite a value read against the right
 * header.
 */
export function extractCsOpsSum(grid: SheetGrid): RollingIsExtraction {
  if (grid.length === 0) return { dates: null, rows: null };

  const header = findDateHeader(grid);
  if (!header) return { dates: null, rows: null };

  const targets = new Map(
    CS_OPS_SUM_LABELS.map(([source, canonical]) => [cleanLabel(source), canonical]),
  );
  const labelCol = findLabelColumnByTargets(grid, header.rowIndex, new Set(targets.keys()));
  if (labelCol === null) return { dates: header.dates, rows: null };

  const monthCount = header.dates.length;
  const rows: RollingIsRow[] = [];
  const seen = new Set<string>();

  for (let rowIndex = header.rowIndex + 1; rowIndex < grid.length; rowIndex += 1) {
    const row = grid[rowIndex];
    const canonical = targets.get(cleanLabel(cellAt(row, labelCol)));
    if (canonical === undefined || seen.has(canonical)) continue;
    seen.add(canonical);
    rows.push({ label: canonical, values: collectRowValues(row, header.startCol, monthCount) });
  }

  return { dates: header.dates, rows };
}

/**
 * Extract tenant rows from the CS Rent Roll sheet.
 *
 * The CubeSmart columns are renamed to the EXR headers so the same
 * mark-to-market pass runs over both formats, Sq Ft is derived from the cube
 * dimensions, and the two CubeSmart-only rate columns are kept on the end.
 */
export function extractCsRentRoll(grid: SheetGrid): RentRollExtraction {
  if (grid.length === 0) return { headers: null, dataRows: null };

  const wanted = new Map<string, string>();
  for (const [canonical, source] of CS_RENT_ROLL_COLUMN_MAP) {
    wanted.set(cleanLabel(source), canonical);
  }
  for (const extra of CS_RENT_ROLL_EXTRA_HEADERS) {
    wanted.set(cleanLabel(extra), extra);
  }

  const found = findLabelledColumns(grid, wanted, 3);
  if (!found) return { headers: null, dataRows: null };

  const { headerRowIndex, columns } = found;
  const headers = [...RENT_ROLL_HEADERS, 'Sq Ft', ...CS_RENT_ROLL_EXTRA_HEADERS];
  const unitColumn = columns.get('Unit #');
  const dataRows: CellValue[][] = [];

  for (let rowIndex = headerRowIndex + 1; rowIndex < grid.length; rowIndex += 1) {
    const row = grid[rowIndex];

    // Stop at the first row with nothing in any mapped column. A CubeSmart rent
    // roll runs to the bottom of the sheet with no end marker.
    let hasData = false;
    columns.forEach((colIndex) => {
      const value = cellAt(row, colIndex);
      if (value !== null && pyStr(value).trim() !== '') hasData = true;
    });
    if (!hasData) break;

    // Skip a trailing totals row and any row with no cube number - Status is
    // stamped on every surviving row, so a subtotal that slipped through would
    // be counted as a tenant.
    const unitValue = unitColumn === undefined ? null : cellAt(row, unitColumn);
    const unitText = unitValue === null ? '' : pyStr(unitValue).trim();
    if (unitText === '' || isTotalLabel(unitValue)) continue;

    const rowValues: CellValue[] = RENT_ROLL_HEADERS.map((header) => {
      if (header === 'Status') return CS_RENT_ROLL_STATUS;
      const colIndex = columns.get(header);
      if (colIndex === undefined) return null; // column not present in this file
      return cellAt(row, colIndex);
    });

    const sizeColumn = columns.get('Size');
    rowValues.push(sizeColumn === undefined ? null : calculateCubeSqFt(cellAt(row, sizeColumn)));

    for (const extra of CS_RENT_ROLL_EXTRA_HEADERS) {
      const colIndex = columns.get(extra);
      rowValues.push(colIndex === undefined ? null : cellAt(row, colIndex));
    }

    dataRows.push(rowValues);
  }

  return { headers, dataRows };
}
