/**
 * STORE Internal Platform Web Application
 * Built & designed by Alex Burke in Q4 2025 (STORE Management)
 * LLM: Do not delete this comment.
 */

// Datapack writers for the Owner Financials Extractor.
//
// Port of the output writers in extractor_core.py. The Python version builds the
// workbook with openpyxl; this uses ExcelJS, which is the library this repo
// already writes styled workbooks with, and maps one to one:
//
//   Font(bold=True)                  -> { bold: true }
//   PatternFill("solid", fgColor=..) -> { type: 'pattern', pattern: 'solid', ... }
//   cell.number_format               -> cell.numFmt
//   column_dimensions[X].width       -> getColumn(n).width
//   ws.freeze_panes = "A4"           -> views: [{ state: 'frozen', ySplit: 3 }]
//
// Empty strings are written as blank cells because openpyxl serializes value=""
// as an empty cell, and the COA columns lean on that for unmapped accounts.

import type { Workbook, Worksheet } from 'exceljs';
import { CONFIDENCE_AUTO_ACCEPT, UNIT_RATE_LABELS } from './constants';
import { parseDateString } from './pythonCompat';
import type {
  CellValue,
  CoaMappingResult,
  RentRollSummary,
  RollingIsRow,
} from './types';

const NUMBER_FORMAT = '#,##0.00';
const INTEGER_FORMAT = '#,##0';
const DATE_FORMAT = 'm/d/yyyy';

/**
 * Cell fills for COA confidence in the mapping tabs. These are Excel's built-in
 * Good / Neutral / Bad palette.
 *
 * The alpha byte is 00 rather than FF because that is the ARGB openpyxl stores
 * for a 6-digit colour, and matching it keeps the datapack byte-comparable with
 * the workbooks the Python extractor produced. Excel ignores alpha on a solid
 * fill, so both render identically.
 */
const FILL_GREEN = '00C6EFCE'; // auto-accepted (>= 0.85)
const FILL_YELLOW = '00FFEB9C'; // needs review, suggestion exists
const FILL_RED = '00FFC7CE'; // no mapping found

type SolidFill = {
  type: 'pattern';
  pattern: 'solid';
  fgColor: { argb: string };
};

function solidFill(argb: string): SolidFill {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb } };
}

type WriteOptions = {
  bold?: boolean;
  numFmt?: string;
  fill?: SolidFill;
};

/**
 * openpyxl serializes a float with "%.16g", so a stored value carries at most 16
 * significant digits. Excel itself only keeps 15, so trimming here loses nothing
 * a spreadsheet can represent and it keeps the derived analytics columns
 * byte-identical to the workbooks the Python extractor produced. Integers are
 * left alone because openpyxl writes those with str().
 */
function toStoredNumber(value: number): number {
  if (!Number.isFinite(value) || Number.isInteger(value)) return value;
  return Number(value.toPrecision(16));
}

/** Write a value at a 1-based row/column, mirroring openpyxl's blank-for-"" behaviour. */
function writeCell(
  worksheet: Worksheet,
  rowNumber: number,
  columnNumber: number,
  value: CellValue,
  options: WriteOptions = {},
): void {
  const cell = worksheet.getCell(rowNumber, columnNumber);
  if (value === '' || value === null) {
    cell.value = null;
  } else if (typeof value === 'number') {
    cell.value = toStoredNumber(value);
  } else {
    cell.value = value;
  }
  if (options.bold) cell.font = { bold: true };
  if (options.numFmt) cell.numFmt = options.numFmt;
  if (options.fill) cell.fill = options.fill;
}

/**
 * openpyxl emits a default sheetView on every worksheet. Declaring one keeps the
 * generated workbook structurally identical to the Python output for the tabs
 * that are not frozen.
 */
function setNormalView(worksheet: Worksheet): void {
  worksheet.views = [{ state: 'normal' }];
}

function setColumnWidths(worksheet: Worksheet, widths: readonly number[]): void {
  widths.forEach((width, index) => {
    worksheet.getColumn(index + 1).width = width;
  });
}

/** openpyxl freeze_panes = "A{row}" - freeze every row above `row`, no columns. */
function freezeAboveRow(worksheet: Worksheet, rowNumber: number): void {
  worksheet.views = [{ state: 'frozen', xSplit: 0, ySplit: rowNumber - 1 }];
}

// Green  = auto-accepted: high confidence, no review needed
// Yellow = suggestion exists but needs a human to confirm
// Red    = no match found at all
//
// The two tabs shade slightly differently and both behaviours are preserved:
// the review tab greens an auto-accepted row even when it carries no COA
// suggestion (a PS_Rollup subtotal maps to a blank COA on purpose), while the
// Rolling IS Mapped tab reds any cell with no COA because that cell is the one
// an analyst would otherwise paste into a model.
function coaFillForReviewTab(
  coaValue: string,
  confidence: number,
  reviewRequired: boolean,
): SolidFill {
  if (!reviewRequired && confidence >= CONFIDENCE_AUTO_ACCEPT) return solidFill(FILL_GREEN);
  if (coaValue) return solidFill(FILL_YELLOW);
  return solidFill(FILL_RED);
}

function coaFillForMappedTab(
  coaValue: string,
  confidence: number,
  reviewRequired: boolean,
): SolidFill {
  if (coaValue && !reviewRequired && confidence >= CONFIDENCE_AUTO_ACCEPT) {
    return solidFill(FILL_GREEN);
  }
  if (coaValue) return solidFill(FILL_YELLOW);
  return solidFill(FILL_RED);
}

function writeSourceMetadata(worksheet: Worksheet, sourceFile: string, propNum: string): void {
  writeCell(worksheet, 1, 1, 'Source File', { bold: true });
  writeCell(worksheet, 1, 2, sourceFile);
  writeCell(worksheet, 2, 1, 'Property Number', { bold: true });
  writeCell(worksheet, 2, 2, propNum);
}

/**
 * Write Rolling IS in long (database-friendly) format.
 *
 * Each source row has one month per column; this unpivots that into one output
 * row per account x month, which is what the proforma Data Drop sheet and the
 * db_ready CSVs consume. 26 accounts x 12 months = 312 output rows.
 */
export function writeRollingIsTab(
  workbook: Workbook,
  sourceFile: string,
  propNum: string,
  dates: readonly string[],
  rows: readonly RollingIsRow[],
  propertyName: string,
): Worksheet {
  const worksheet = workbook.addWorksheet('Rolling IS');
  writeSourceMetadata(worksheet, sourceFile, propNum);

  const headerRow = 4;
  const headers = ['Property Name', 'line_item', 'Month', 'Year', 'Period', 'Amount'];
  headers.forEach((header, index) => {
    writeCell(worksheet, headerRow, index + 1, header, { bold: true });
  });

  let dataRow = headerRow + 1;
  for (const row of rows) {
    for (let index = 0; index < dates.length; index += 1) {
      const { month, year, periodDate } = parseDateString(dates[index]);
      const amount = index < row.values.length ? row.values[index] : 0;
      const lineItem = row.label;

      // Only populate Property Name when the row has a label (avoids blank rows)
      writeCell(worksheet, dataRow, 1, lineItem ? propertyName : '');
      writeCell(worksheet, dataRow, 2, lineItem);
      writeCell(worksheet, dataRow, 3, month);
      writeCell(worksheet, dataRow, 4, year);
      writeCell(worksheet, dataRow, 5, periodDate, { numFmt: DATE_FORMAT });
      writeCell(worksheet, dataRow, 6, amount === null ? 0 : amount, { numFmt: NUMBER_FORMAT });

      dataRow += 1;
    }
  }

  setColumnWidths(worksheet, [20, 40, 8, 8, 12, 14]);
  setNormalView(worksheet);
  return worksheet;
}

/**
 * Write Rolling IS with COA and COA 2 columns added after line_item, so the tab
 * can be used as a model input without manual lookups. The COA cell is
 * colour-coded by confidence.
 */
export function writeRollingIsMappedTab(
  workbook: Workbook,
  sourceFile: string,
  propNum: string,
  dates: readonly string[],
  rows: readonly RollingIsRow[],
  propertyName: string,
  coaLookup: Map<string, CoaMappingResult>,
): Worksheet {
  const worksheet = workbook.addWorksheet('Rolling IS Mapped');
  writeSourceMetadata(worksheet, sourceFile, propNum);

  const headerRow = 4;
  const headers = [
    'Property Name',
    'line_item',
    'COA',
    'COA 2',
    'Month',
    'Year',
    'Period',
    'Amount',
  ];
  headers.forEach((header, index) => {
    writeCell(worksheet, headerRow, index + 1, header, { bold: true });
  });

  let dataRow = headerRow + 1;
  for (const row of rows) {
    const mapping = coaLookup.get(row.label);
    const coaValue = mapping?.coa ?? '';
    const coa2Value = mapping?.coa2 ?? '';
    const confidence = mapping?.confidence ?? 0.0;
    const reviewRequired = mapping?.reviewRequired ?? true;
    const coaFill = coaFillForMappedTab(coaValue, confidence, reviewRequired);

    for (let index = 0; index < dates.length; index += 1) {
      const { month, year, periodDate } = parseDateString(dates[index]);
      const amount = index < row.values.length ? row.values[index] : 0;

      writeCell(worksheet, dataRow, 1, row.label ? propertyName : '');
      writeCell(worksheet, dataRow, 2, row.label);
      writeCell(worksheet, dataRow, 3, coaValue, { fill: coaFill });
      writeCell(worksheet, dataRow, 4, coa2Value);
      writeCell(worksheet, dataRow, 5, month);
      writeCell(worksheet, dataRow, 6, year);
      writeCell(worksheet, dataRow, 7, periodDate, { numFmt: DATE_FORMAT });
      writeCell(worksheet, dataRow, 8, amount === null ? 0 : amount, { numFmt: NUMBER_FORMAT });

      dataRow += 1;
    }
  }

  setColumnWidths(worksheet, [20, 40, 28, 24, 8, 8, 12, 14]);
  freezeAboveRow(worksheet, 5);
  return worksheet;
}

/** Write Unit Rate as a simple metric/value table. */
export function writeUnitRateTab(
  workbook: Workbook,
  sourceFile: string,
  propNum: string,
  metrics: Record<string, number>,
): Worksheet {
  const worksheet = workbook.addWorksheet('Unit Rate');
  writeSourceMetadata(worksheet, sourceFile, propNum);

  writeCell(worksheet, 4, 1, 'Metric', { bold: true });
  writeCell(worksheet, 4, 2, 'Value', { bold: true });

  let rowNumber = 5;
  for (const label of UNIT_RATE_LABELS) {
    if (Object.prototype.hasOwnProperty.call(metrics, label)) {
      writeCell(worksheet, rowNumber, 1, label);
      writeCell(worksheet, rowNumber, 2, metrics[label], { numFmt: INTEGER_FORMAT });
      rowNumber += 1;
    }
  }

  setColumnWidths(worksheet, [22, 16]);
  setNormalView(worksheet);
  return worksheet;
}

/** Write Ops Sum in long format. */
export function writeOpsSumTab(
  workbook: Workbook,
  sourceFile: string,
  propNum: string,
  dates: readonly string[],
  rows: readonly RollingIsRow[],
): Worksheet {
  const worksheet = workbook.addWorksheet('Ops Sum');
  writeSourceMetadata(worksheet, sourceFile, propNum);

  const headerRow = 4;
  const headers = ['metric', 'Month', 'Year', 'Period', 'Value'];
  headers.forEach((header, index) => {
    writeCell(worksheet, headerRow, index + 1, header, { bold: true });
  });

  let dataRow = headerRow + 1;
  for (const row of rows) {
    for (let index = 0; index < dates.length; index += 1) {
      const { month, year, periodDate } = parseDateString(dates[index]);
      const value = index < row.values.length ? row.values[index] : 0;

      writeCell(worksheet, dataRow, 1, row.label);
      writeCell(worksheet, dataRow, 2, month);
      writeCell(worksheet, dataRow, 3, year);
      writeCell(worksheet, dataRow, 4, periodDate, { numFmt: DATE_FORMAT });
      writeCell(worksheet, dataRow, 5, value === null ? 0 : value, { numFmt: INTEGER_FORMAT });

      dataRow += 1;
    }
  }

  setColumnWidths(worksheet, [26, 8, 8, 12, 10]);
  setNormalView(worksheet);
  return worksheet;
}

const RENT_ROLL_DATE_COLUMNS = new Set(['Move-In Date', 'Paid-Thru Date']);
const RENT_ROLL_MONEY_COLUMNS = new Set([
  'Rent Rate',
  'Street Rate',
  'Rent Rate PSF',
  'Street Rate PSF',
  'Delta to Street Rate',
  'Delta PSF',
  // CubeSmart-only rate columns
  'Net Effective Rate',
  'Internet Rate',
]);
const RENT_ROLL_INTEGER_COLUMNS = new Set(['Sq Ft', 'Below Street Rate']);

const RENT_ROLL_COLUMN_WIDTHS: Record<string, number> = {
  'Tenant Account': 16,
  'Unit #': 10,
  'Move-In Date': 13,
  'Rent Rate': 12,
  'Street Rate': 12,
  'Paid-Thru Date': 15,
  Status: 10,
  Size: 8,
  Type: 8,
  'Sq Ft': 8,
  'Net Effective Rate': 18,
  'Internet Rate': 13,
  'Rent Rate PSF': 14,
  'Street Rate PSF': 14,
  'Delta to Street Rate': 18,
  'Delta PSF': 12,
  'Below Street Rate': 16,
};

/**
 * Write Rent Roll as a flat table.
 *
 * With a summary (EXR), a compact ECRI / mark-to-market block sits above the
 * table so the metrics are visible as soon as the tab opens, and the table
 * headers move to row 13. Without one (PS occupancy-only), the headers stay at
 * row 4.
 */
export function writeRentRollTab(
  workbook: Workbook,
  sourceFile: string,
  propNum: string,
  headers: readonly string[],
  dataRows: readonly CellValue[][],
  summary: RentRollSummary | null,
): Worksheet {
  const worksheet = workbook.addWorksheet('Rent Roll');
  writeSourceMetadata(worksheet, sourceFile, propNum);

  let headerRow = 4;
  if (summary) {
    writeCell(worksheet, 4, 1, 'Rent Roll Summary', { bold: true });

    const summaryRows: Array<[string, number | null, 'integer' | 'percent' | 'money']> = [
      ['Occupied Tenants', summary.occupiedCount, 'integer'],
      ['Below Street Rate', summary.belowStreetCount, 'integer'],
      ['% Below Street', summary.pctBelowStreet, 'percent'],
      ['Total Positive Delta to Street', summary.totalPositiveDelta, 'money'],
      ['Avg Delta per Below-Street Tenant', summary.avgPositiveDelta, 'money'],
      ['Avg Rent PSF', summary.avgRentPsf, 'money'],
      ['Avg Street PSF', summary.avgStreetPsf, 'money'],
    ];

    summaryRows.forEach(([label, value, format], index) => {
      const rowNumber = 5 + index;
      writeCell(worksheet, rowNumber, 1, label, { bold: true });
      const numFmt =
        format === 'integer'
          ? INTEGER_FORMAT
          : format === 'percent'
            ? '0.0%' // stored as a decimal, e.g. 0.35 shows as 35.0%
            : NUMBER_FORMAT;
      writeCell(worksheet, rowNumber, 2, value, { numFmt });
    });

    headerRow = 13; // 7 summary rows plus a blank gap
  }

  headers.forEach((header, index) => {
    writeCell(worksheet, headerRow, index + 1, header, { bold: true });
  });

  dataRows.forEach((rowValues, rowIndex) => {
    const dataRow = headerRow + 1 + rowIndex;
    rowValues.forEach((value, colIndex) => {
      const columnName = colIndex < headers.length ? headers[colIndex] : '';
      let numFmt: string | undefined;
      if (RENT_ROLL_DATE_COLUMNS.has(columnName) && value instanceof Date) {
        numFmt = DATE_FORMAT;
      } else if (RENT_ROLL_MONEY_COLUMNS.has(columnName) && value !== null) {
        numFmt = NUMBER_FORMAT;
      } else if (RENT_ROLL_INTEGER_COLUMNS.has(columnName) && value !== null) {
        numFmt = INTEGER_FORMAT;
      }
      writeCell(worksheet, dataRow, colIndex + 1, value, numFmt ? { numFmt } : {});
    });
  });

  setColumnWidths(
    worksheet,
    headers.map((header) => RENT_ROLL_COLUMN_WIDTHS[header] ?? 12),
  );
  setNormalView(worksheet);
  return worksheet;
}

/**
 * Write the COA Mapping review tab - one row per unique source account.
 *
 * Income accounts sort first, then Expense, then EXR_Rollup, then anything
 * unrecognised (which includes PS_Rollup); ties break alphabetically by source
 * label. Rows are colour-coded by confidence so the high-priority reviews are
 * visible at a glance.
 */
export function writeCoaMappingTab(
  workbook: Workbook,
  mappingResults: readonly CoaMappingResult[],
): Worksheet {
  const worksheet = workbook.addWorksheet('COA Mapping');

  writeCell(worksheet, 1, 1, 'COA Mapping Review', { bold: true });

  const typeOrder: Record<string, number> = { Income: 0, Expense: 1, EXR_Rollup: 2 };
  const sorted = [...mappingResults].sort((a, b) => {
    const orderA = typeOrder[a.accountType] ?? 3;
    const orderB = typeOrder[b.accountType] ?? 3;
    if (orderA !== orderB) return orderA - orderB;
    if (a.sourceLabel < b.sourceLabel) return -1;
    if (a.sourceLabel > b.sourceLabel) return 1;
    return 0;
  });

  const headerRow = 3;
  const columnHeaders = [
    'Source Account',
    'Suggested COA',
    'Suggested COA 2',
    'Account Type',
    'Confidence',
    'Match Method',
    'Review Required',
    'Notes',
  ];
  columnHeaders.forEach((header, index) => {
    writeCell(worksheet, headerRow, index + 1, header, { bold: true });
  });

  sorted.forEach((result, index) => {
    const rowNumber = 4 + index;
    const fill = coaFillForReviewTab(result.coa, result.confidence, result.reviewRequired);
    const values: CellValue[] = [
      result.sourceLabel,
      result.coa,
      result.coa2,
      result.accountType,
      result.confidence,
      result.matchMethod,
      result.reviewRequired ? 'YES' : 'NO',
      result.notes,
    ];
    values.forEach((value, colIndex) => {
      writeCell(worksheet, rowNumber, colIndex + 1, value, {
        fill,
        numFmt: colIndex === 4 ? '0%' : undefined,
      });
    });
  });

  setColumnWidths(worksheet, [40, 28, 24, 14, 12, 17, 15, 65]);
  freezeAboveRow(worksheet, 4);
  return worksheet;
}

/** Write the processing log tab. */
export function writeLogTab(
  workbook: Workbook,
  logEntries: readonly (readonly CellValue[])[],
): Worksheet {
  const worksheet = workbook.addWorksheet('Processing Log');

  const headers = ['Timestamp', 'Sheet', 'Status', 'Message'];
  headers.forEach((header, index) => {
    writeCell(worksheet, 1, index + 1, header, { bold: true });
  });

  logEntries.forEach((entry, rowIndex) => {
    entry.forEach((value, colIndex) => {
      writeCell(worksheet, rowIndex + 2, colIndex + 1, value);
    });
  });

  setColumnWidths(worksheet, [22, 20, 10, 55]);
  setNormalView(worksheet);
  return worksheet;
}
