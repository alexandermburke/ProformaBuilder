/**
 * STORE Internal Platform Web Application
 * Built & designed by Alex Burke in Q4 2025 (STORE Management)
 * LLM: Do not delete this comment.
 */

// Extra Space (EXR) extractors. Port of the EXR section of extractor_core.py.
//
// EXR is the primary production format: Rolling IS, Unit Rate, Ops Sum, and
// Rent Roll sheets, each named with the prefix plus the property number.

import {
  EXR_ROLLING_IS_START_LABEL,
  OPS_SUM_LABELS,
  RENT_ROLL_ANALYTICS_HEADERS,
  RENT_ROLL_HEADERS,
  ROLLING_IS_STOP_LABEL,
  UNIT_RATE_LABELS,
} from './constants';
import {
  collectRowValues,
  findDateHeader,
  findLabelAnchorByPrefix,
  findLabelColumnByTargets,
} from './gridScan';
import {
  calculateSqFt,
  cleanLabel,
  isZeroRow,
  labelMatches,
  pyFloat,
  pyStr,
  pySum,
} from './pythonCompat';
import type { CellValue, RentRollSummary, RollingIsRow, SheetGrid } from './types';

/** Pull the property number from a sheet name like 'Rolling IS 7214'. */
export function extractPropertyNumber(sheetName: string, prefix: string): string {
  const remainder = sheetName.split(prefix).join('').trim();
  const digits = remainder.replace(/[^0-9]/g, '');
  return digits ? digits : 'UNKNOWN';
}

export type RollingIsExtraction = {
  dates: string[] | null;
  rows: RollingIsRow[] | null;
};

/**
 * Extract the income statement from the EXR Rolling IS sheet.
 *
 * Collection starts at the "Average Sq. Ft. Occupancy" row - one row earlier
 * than the other formats - and stops after the "Net Operating Income" row.
 * Rows where every month is zero or blank are dropped.
 */
export function extractRollingIs(grid: SheetGrid): RollingIsExtraction {
  if (grid.length === 0) return { dates: null, rows: null };

  const header = findDateHeader(grid);
  if (!header) return { dates: null, rows: null };

  const anchor = findLabelAnchorByPrefix(grid, header.rowIndex, EXR_ROLLING_IS_START_LABEL);
  if (!anchor) return { dates: header.dates, rows: null };

  const rows: RollingIsRow[] = [];
  const monthCount = header.dates.length;

  for (let rowIndex = anchor.startRowIndex; rowIndex < grid.length; rowIndex += 1) {
    const row = grid[rowIndex];
    const labelValue = anchor.labelCol < row.length ? row[anchor.labelCol] : null;

    // Skip blank rows (section gaps, empty lines between groups)
    if (labelValue === null || pyStr(labelValue).trim() === '') continue;

    const labelText = pyStr(labelValue).trim();
    const values = collectRowValues(row, header.startCol, monthCount);

    // Skip rows where every month is zero - they add no information
    if (!isZeroRow(values)) {
      rows.push({ label: labelText, values });
    }

    // Stop once the Net Operating Income row has been captured
    if (labelMatches(labelText, ROLLING_IS_STOP_LABEL)) break;
  }

  return { dates: header.dates, rows };
}

/**
 * Extract summary metrics from the Unit Rate sheet.
 *
 * Every row is scanned for a known metric label; the value is the first numeric
 * cell within the next four columns. A later row matching the same label
 * overwrites an earlier one, which is how the Python helper behaves.
 */
export function extractUnitRate(grid: SheetGrid): Record<string, number> {
  const results: Record<string, number> = {};
  const targets = new Map<string, string>(
    UNIT_RATE_LABELS.map((label) => [cleanLabel(label), label]),
  );

  for (const row of grid) {
    for (let colIndex = 0; colIndex < row.length; colIndex += 1) {
      const originalLabel = targets.get(cleanLabel(row[colIndex]));
      if (!originalLabel) continue;
      const searchEnd = Math.min(colIndex + 5, row.length);
      for (let searchCol = colIndex + 1; searchCol < searchEnd; searchCol += 1) {
        const candidate = row[searchCol];
        if (candidate === null) continue;
        const numeric = pyFloat(candidate);
        if (numeric === null) continue; // cell had text, keep looking right
        results[originalLabel] = numeric;
        break;
      }
    }
  }

  return results;
}

/**
 * Extract rental activity rows from the Ops Sum sheet.
 *
 * There is no clean start/stop here, so rows are filtered by label name and
 * stored under the canonical label rather than the raw cell text.
 */
export function extractOpsSum(grid: SheetGrid): RollingIsExtraction {
  if (grid.length === 0) return { dates: null, rows: null };

  const header = findDateHeader(grid);
  if (!header) return { dates: null, rows: null };

  const targets = new Map<string, string>(
    OPS_SUM_LABELS.map((label) => [cleanLabel(label), label]),
  );
  const targetKeys = new Set(targets.keys());
  const monthCount = header.dates.length;

  const labelCol = findLabelColumnByTargets(grid, header.rowIndex, targetKeys);
  if (labelCol === null) return { dates: header.dates, rows: null };

  const rows: RollingIsRow[] = [];
  for (let rowIndex = header.rowIndex + 1; rowIndex < grid.length; rowIndex += 1) {
    const row = grid[rowIndex];
    const rawLabel = labelCol < row.length ? row[labelCol] : null;
    if (rawLabel === null) continue;
    const canonical = targets.get(cleanLabel(rawLabel));
    if (!canonical) continue;
    rows.push({ label: canonical, values: collectRowValues(row, header.startCol, monthCount) });
  }

  return { dates: header.dates, rows };
}

export type RentRollExtraction = {
  headers: string[] | null;
  dataRows: CellValue[][] | null;
};

/**
 * Extract rent roll data.
 *
 * The header row is the first row where 3 or more expected headers appear, so
 * detection survives a file version that drops a column. Columns are then read
 * by name; a header that is missing contributes a null placeholder so
 * downstream positional indexes stay stable.
 */
export function extractRentRoll(grid: SheetGrid): RentRollExtraction {
  if (grid.length === 0) return { headers: null, dataRows: null };

  let headerRowIndex: number | null = null;
  const colMap = new Map<string, number>();

  for (let rowIndex = 0; rowIndex < grid.length; rowIndex += 1) {
    const row = grid[rowIndex];
    // Later duplicates of the same cleaned label win, matching the Python dict
    // comprehension this replaces.
    const rowLabels = new Map<string, number>();
    for (let colIndex = 0; colIndex < row.length; colIndex += 1) {
      const cell = row[colIndex];
      if (cell === null) continue;
      rowLabels.set(cleanLabel(cell), colIndex);
    }
    const matches = RENT_ROLL_HEADERS.filter((header) => rowLabels.has(cleanLabel(header))).length;
    if (matches >= 3) {
      headerRowIndex = rowIndex;
      for (const expected of RENT_ROLL_HEADERS) {
        const found = rowLabels.get(cleanLabel(expected));
        if (found !== undefined) colMap.set(expected, found);
      }
      break;
    }
  }

  if (headerRowIndex === null) return { headers: null, dataRows: null };

  const statusIndex = RENT_ROLL_HEADERS.indexOf('Status');
  const sizeIndex = RENT_ROLL_HEADERS.indexOf('Size');
  const dataRows: CellValue[][] = [];

  for (let rowIndex = headerRowIndex + 1; rowIndex < grid.length; rowIndex += 1) {
    const row = grid[rowIndex];

    // Stop at the first row that has no data in any known column. Rent rolls do
    // not carry an end marker.
    let hasData = false;
    for (const header of RENT_ROLL_HEADERS) {
      const colIndex = colMap.get(header);
      if (colIndex === undefined) continue;
      const value = colIndex < row.length ? row[colIndex] : null;
      if (value !== null && pyStr(value).trim() !== '') {
        hasData = true;
        break;
      }
    }
    if (!hasData) break;

    const rowValues: CellValue[] = RENT_ROLL_HEADERS.map((header) => {
      const colIndex = colMap.get(header);
      if (colIndex === undefined) return null; // column not present in this file
      return colIndex < row.length ? row[colIndex] : null;
    });

    // Skip vacant and non-tenant units
    if (statusIndex < rowValues.length) {
      const rawStatus = rowValues[statusIndex];
      const statusValue = (rawStatus ? pyStr(rawStatus) : '').trim().toLowerCase();
      if (statusValue === 'available' || statusValue === 'company use') continue;
    }

    const sqFt = sizeIndex < rowValues.length ? calculateSqFt(rowValues[sizeIndex]) : null;
    rowValues.push(sqFt);

    dataRows.push(rowValues);
  }

  return { headers: [...RENT_ROLL_HEADERS, 'Sq Ft'], dataRows };
}

export type RentRollAnalytics = {
  headers: string[];
  dataRows: CellValue[][];
  summary: RentRollSummary;
};

/**
 * Add ECRI / mark-to-market columns to the extracted rent roll.
 *
 * Per tenant: Rent Rate PSF, Street Rate PSF, Delta to Street Rate, Delta PSF,
 * and a Below Street Rate flag. Also returns portfolio-level metrics.
 *
 * "Occupied Tenants" counts rows whose Status is exactly Current, while
 * "% Below Street" divides the below-street count by that occupied count - so
 * the two sides of the ratio come from different filters. That is the
 * definition the Python extractor uses and the datapack has always reported.
 */
export function calculateRentRollAnalytics(
  headers: readonly string[],
  dataRows: readonly CellValue[][],
): RentRollAnalytics {
  const columnIndex = (name: string): number | null => {
    const index = headers.indexOf(name);
    return index >= 0 ? index : null;
  };

  const iRent = columnIndex('Rent Rate');
  const iStreet = columnIndex('Street Rate');
  const iSqFt = columnIndex('Sq Ft');
  const iStatus = columnIndex('Status');

  const enhancedHeaders = [...headers, ...RENT_ROLL_ANALYTICS_HEADERS];
  const enhancedRows: CellValue[][] = [];

  let currentCount = 0; // tenants whose Status = "Current"
  const rentPsfValues: number[] = [];
  const streetPsfValues: number[] = [];
  const positiveDeltas: number[] = [];

  for (const row of dataRows) {
    const safeNum = (index: number | null): number | null => {
      if (index === null || index >= row.length) return null;
      return pyFloat(row[index]);
    };

    const rent = safeNum(iRent);
    const street = safeNum(iStreet);
    const sqft = safeNum(iSqFt);

    if (iStatus !== null && iStatus < row.length) {
      const rawStatus = row[iStatus];
      if ((rawStatus ? pyStr(rawStatus) : '').trim().toLowerCase() === 'current') {
        currentCount += 1;
      }
    }

    // PSF - only valid when sq ft is a positive number
    const rentPsf = rent !== null && sqft !== null && sqft > 0 ? rent / sqft : null;
    const streetPsf = street !== null && sqft !== null && sqft > 0 ? street / sqft : null;

    // Delta - dollar gap between asking rent and in-place rent
    const delta = rent !== null && street !== null ? street - rent : null;
    const deltaPsf = rentPsf !== null && streetPsf !== null ? streetPsf - rentPsf : null;

    const belowFlag = rent !== null && street !== null && rent < street ? 1 : 0;

    if (rentPsf !== null) rentPsfValues.push(rentPsf);
    if (streetPsf !== null) streetPsfValues.push(streetPsf);
    if (delta !== null && delta > 0) positiveDeltas.push(delta);

    enhancedRows.push([...row, rentPsf, streetPsf, delta, deltaPsf, belowFlag]);
  }

  const occupiedCount = currentCount;
  const belowStreetCount = positiveDeltas.length;
  const totalPositiveDelta = positiveDeltas.length > 0 ? pySum(positiveDeltas) : 0;

  const summary: RentRollSummary = {
    occupiedCount,
    belowStreetCount,
    pctBelowStreet: occupiedCount > 0 ? belowStreetCount / occupiedCount : null,
    totalPositiveDelta,
    avgPositiveDelta: belowStreetCount > 0 ? totalPositiveDelta / belowStreetCount : null,
    avgRentPsf: rentPsfValues.length > 0 ? pySum(rentPsfValues) / rentPsfValues.length : null,
    avgStreetPsf:
      streetPsfValues.length > 0 ? pySum(streetPsfValues) / streetPsfValues.length : null,
  };

  return { headers: enhancedHeaders, dataRows: enhancedRows, summary };
}
