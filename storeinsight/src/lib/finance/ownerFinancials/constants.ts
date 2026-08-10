/**
 * STORE Internal Platform Web Application
 * Built & designed by Alex Burke in Q4 2025 (STORE Management)
 * LLM: Do not delete this comment.
 */

// Layout anchors for the Owner Financials Extractor, ported verbatim from
// extractor_core.py. Edit these if a manager changes its label text - the
// extractors search by label, not by cell address.

import type { ManagedBy } from './types';

/**
 * EXR sheet names all start with a known prefix followed by a property number,
 * e.g. "Rolling IS 7214". Sheets are found by prefix so the property number
 * does not need to be hardcoded.
 */
export const SHEET_PREFIXES = {
  rollingIs: 'Rolling IS',
  unitRate: 'Unit Rate',
  opsSum: 'Ops Sum',
  rentRoll: 'Rent Roll',
} as const;

/**
 * The rolling IS extraction scans from the first row containing the start label
 * down to (and including) the row containing the stop label.
 * EXR starts one row earlier at "Average Sq. Ft. Occupancy"; PS starts at "Rental Income".
 */
export const EXR_ROLLING_IS_START_LABEL = 'Average Sq. Ft. Occupancy';
export const ROLLING_IS_START_LABEL = 'Rental Income';
export const ROLLING_IS_STOP_LABEL = 'Net Operating Income';

/**
 * The Unit Rate sheet is scanned for any row whose label matches one of these.
 * Values are looked up in the cells immediately to the right of the label.
 */
export const UNIT_RATE_LABELS = [
  'Units Available',
  'Units Rented',
  'Sq Ft Available',
  'Sq Ft Rented',
] as const;

/**
 * The Ops Sum sheet is scanned for rows matching these labels exactly.
 * Any label not found is logged as a WARNING but does not stop extraction.
 */
export const OPS_SUM_LABELS = [
  'Rentals During Month',
  'Walk In Rentals',
  'NSC rentals',
  'Web Rentals',
  'Vacates During Month',
  'Net Rentals',
] as const;

/**
 * The expected column names in the EXR Rent Roll sheet header row.
 * The header row is the first row where 3 or more of these appear, which keeps
 * detection working when a file version drops a column.
 */
export const RENT_ROLL_HEADERS = [
  'Tenant Account',
  'Unit #',
  'Move-In Date',
  'Rent Rate',
  'Street Rate',
  'Paid-Thru Date',
  'Status',
  'Size',
  'Type',
] as const;

/** Columns appended by the ECRI / mark-to-market pass. */
export const RENT_ROLL_ANALYTICS_HEADERS = [
  'Rent Rate PSF',
  'Street Rate PSF',
  'Delta to Street Rate',
  'Delta PSF',
  'Below Street Rate',
] as const;

/**
 * Section header rows in the PS IS sheet that are labels only - no data values.
 * These appear inside the extraction range and must be skipped entirely.
 */
export const PS_SECTION_HEADERS = new Set([
  'revenue',
  'contractually set fees',
  'other expenses',
  'other items',
]);

/** Sheet name is exact ("Rolling Details"), unlike EXR which uses prefix+number. */
export const CS_ROLLING_IS_SHEET = 'Rolling Details';
export const CS_ROLLING_IS_START_LABEL = 'Rental Income';

export const MANAGED_BY_OPTIONS: readonly ManagedBy[] = [
  'Extra', // Extra Space Storage - EXR format
  'Public Storage', // Public Storage format
  'CubeSmart', // CubeSmart format
  'Other', // Smaller / unknown managers - COA mapping is manual
];

export const DEFAULT_MANAGED_BY: ManagedBy = 'Extra';

/**
 * Mappings at or above this confidence score are auto-accepted (no review needed).
 * Shared by the mapper and the workbook writers so the colour coding stays in sync.
 */
export const CONFIDENCE_AUTO_ACCEPT = 0.85;

/** Fuzzy matches below this raw difflib score are treated as no-match. */
export const CONFIDENCE_FUZZY_MIN = 0.5;

export const XLSX_MIME_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
