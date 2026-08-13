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

/**
 * CubeSmart names every tab exactly, unlike EXR which uses prefix+number, so
 * each CS sheet is looked up by its full name.
 */
export const CS_ROLLING_IS_SHEET = 'Rolling Details';
export const CS_ROLLING_IS_START_LABEL = 'Rental Income';
export const CS_CUBE_MIX_SHEET = 'Cube Mix';
export const CS_RENTAL_EXPERIENCE_SHEET = 'Summary of Rental Experience';
export const CS_RENT_ROLL_SHEET = 'Rent Roll';

/**
 * Cube Mix column header -> Unit Rate metric. CubeSmart has no Unit Rate sheet;
 * the same four counts live in the Cube Mix totals row, one column each.
 */
export const CS_CUBE_MIX_METRIC_COLUMNS: readonly (readonly [string, string])[] = [
  ['Total Cubes', 'Units Available'],
  ['Occupied Cubes', 'Units Rented'],
  ['Total SqFt', 'Sq Ft Available'],
  ['Occupied SqFt', 'Sq Ft Rented'],
];

/**
 * Summary of Rental Experience row label -> Ops Sum metric.
 *
 * The first three carry the EXR spelling so a CS datapack reads the same as an
 * EXR one. The last two have no EXR equivalent and keep their CubeSmart names -
 * they are the monthly unit counts behind the occupancy series, which is the
 * most useful thing on the sheet and is nowhere else in the workbook by month.
 */
export const CS_OPS_SUM_LABELS: readonly (readonly [string, string])[] = [
  ['Rented During Month', 'Rentals During Month'],
  ['Vacated During Month', 'Vacates During Month'],
  ['Net Rentals', 'Net Rentals'],
  ['Total Cubes Available', 'Total Cubes Available'],
  ['Cubes Occupied at EOM', 'Cubes Occupied at EOM'],
];

/** EXR Ops Sum metrics CubeSmart does not report - logged, not warned about. */
export const CS_OPS_SUM_UNAVAILABLE: readonly string[] = [
  'Walk In Rentals',
  'NSC rentals',
  'Web Rentals',
];

/**
 * Rent Roll header -> CubeSmart column name.
 *
 * "Street Rate" maps to Full Price rather than Internet Rate: Full Price is the
 * figure the SRE Detail sheet reports as the street rate for that cube type,
 * while Internet Rate is the discounted online move-in price (half of Full
 * Price on every row of the sample file), so comparing in-place rent against it
 * would overstate the mark-to-market gap.
 *
 * Status has no CubeSmart column - see CS_RENT_ROLL_STATUS.
 */
export const CS_RENT_ROLL_COLUMN_MAP: readonly (readonly [string, string])[] = [
  ['Tenant Account', 'Customer'],
  ['Unit #', 'Cube'],
  ['Move-In Date', 'Move In Date'],
  ['Rent Rate', 'Rent Rate'],
  ['Street Rate', 'Full Price'],
  ['Paid-Thru Date', 'Paid Thru Date'],
  ['Size', 'Cube Dimensions'],
  ['Type', 'Cube Attribute'],
];

/**
 * The CubeSmart rent roll lists occupied cubes only - its row count equals the
 * Cube Mix occupied count - so every row is a current tenant. The Status column
 * is filled in with that value so the below-street analytics, which count rows
 * whose Status is "Current", see the whole tenant base.
 */
export const CS_RENT_ROLL_STATUS = 'Current';

/** CubeSmart rent roll columns with no EXR equivalent, kept after Sq Ft. */
export const CS_RENT_ROLL_EXTRA_HEADERS = ['Net Effective Rate', 'Internet Rate'] as const;

/**
 * StorQuest (WWG) sheet names. "Rolling 13 - Detailed" carries the account-level
 * income statement and is the only accepted source.
 *
 * "Rolling 13" is the same statement rolled up to section subtotals and is
 * deliberately not accepted as a substitute: several of its section names are
 * identical to an account inside that section, so its rows would map to a
 * detail COA at full confidence and understate the other lines the section
 * covers. It is named here so the not-found message can say why.
 */
export const SQ_ROLLING_IS_SHEET = 'Rolling 13 - Detailed';
export const SQ_ROLLING_IS_FALLBACK_SHEET = 'Rolling 13';

/**
 * The StorQuest statistics block sits between the date header and the income
 * statement, so the start-label search has to reach further down than the 30
 * rows the other formats need.
 */
export const SQ_ROLLING_IS_ANCHOR_ROWS = 60;

/**
 * Statistics block row label -> Unit Rate metric.
 *
 * StorQuest has no Unit Rate sheet. The same four figures head the Rolling 13
 * statement as a monthly series, so the Unit Rate tab takes the most recent
 * month of each.
 */
export const SQ_STAT_UNIT_RATE_LABELS: readonly (readonly [string, string])[] = [
  ['Total Units', 'Units Available'],
  ['Occupied Units- End', 'Units Rented'],
  ['Net Rentable Square Feet', 'Sq Ft Available'],
  ['Occupied Square Feet- End', 'Sq Ft Rented'],
];

/**
 * Statistics block row label -> Ops Sum metric.
 *
 * The two occupancy percentage rows are deliberately excluded: the label
 * "Occupancy (%)" appears twice, once for units and once for square feet, and
 * the Ops Sum tab formats its values as integers, which would render a ratio
 * as 0 or 1.
 */
export const SQ_STAT_OPS_SUM_LABELS: readonly (readonly [string, string])[] = [
  ['Total Units', 'Total Units'],
  ['Rentals', 'Rentals During Month'],
  ['Vacates', 'Vacates During Month'],
  ['Net', 'Net Rentals'],
  ['Occupied Units- End', 'Occupied Units at EOM'],
];

export const MANAGED_BY_OPTIONS: readonly ManagedBy[] = [
  'Extra', // Extra Space Storage - EXR format
  'Public Storage', // Public Storage format
  'CubeSmart', // CubeSmart format
  'StorQuest', // StorQuest / WWG format
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
