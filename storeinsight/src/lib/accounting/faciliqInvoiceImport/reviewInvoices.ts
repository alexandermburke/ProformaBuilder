/**
 * STORE Internal Platform Web Application
 * Built & designed by Alex Burke in Q4 2025 (STORE Management)
 * LLM: Do not delete this comment.
 */

import { isBlankRecord, parseCsv } from './csv';
import {
  COLUMN_LABELS,
  REQUIRED_COLUMN_KEYS,
  resolveColumns,
  type ColumnBinding,
  type FaciliqColumnKey,
} from './columns';
import {
  QUICKBOOKS_PROPERTIES,
  extractSiteShapedCode,
  resolveQuickBooksPropertyCode,
  type QuickBooksPropertyCode,
} from './properties';
import {
  formatIsoDateForDisplay,
  isWellFormedGlCode,
  parseCsvAmount,
  parseCsvDate,
  parseExportWindowFromFilename,
  roundCents,
  type ExportWindow,
} from './values';

/**
 * Reads every invoice row in a weekly FacilIQ QuickBooks export, checks the six fields
 * STORE requires (invoice number, vendor, amount, invoice date, property, GL code) plus
 * the cross-row conditions that only show up when the whole file is in hand, and splits
 * the clean rows by property code.
 *
 * Nothing is auto-corrected. A row carrying any error or warning is held out of the
 * per-property import file and listed for review instead.
 */

export type FlagSeverity = 'error' | 'warning' | 'info';

export type InvoiceFlagCode =
  | 'column-count-mismatch'
  | 'missing-invoice-number'
  | 'missing-vendor'
  | 'missing-amount'
  | 'unreadable-amount'
  | 'zero-amount'
  | 'negative-amount'
  | 'amount-line-mismatch'
  | 'missing-invoice-date'
  | 'unreadable-invoice-date'
  | 'invoice-date-future'
  | 'invoice-date-outside-window'
  | 'unreadable-due-date'
  | 'due-before-invoice-date'
  | 'unreadable-service-date'
  | 'service-date-after-invoice-date'
  | 'missing-property'
  | 'unknown-property'
  | 'missing-gl-code'
  | 'gl-code-format'
  | 'invoice-spans-properties'
  | 'invoice-conflicting-vendor'
  | 'invoice-conflicting-date'
  | 'duplicate-line'
  | 'gl-code-conflict-at-property';

type FlagDefinition = { severity: FlagSeverity; label: string };

/**
 * Severity contract, in one place so the page, the review export, and the CLI all
 * agree on what blocks an import:
 *   error   - a required field is missing/unusable, or the split itself is unsafe
 *   warning - readable but questionable; a person needs to look before it posts
 *   info    - worth knowing, does not hold the row back
 */
export const FLAG_DEFINITIONS: Record<InvoiceFlagCode, FlagDefinition> = {
  'column-count-mismatch': { severity: 'error', label: 'Row column count does not match the header' },
  'missing-invoice-number': { severity: 'error', label: 'Missing invoice number' },
  'missing-vendor': { severity: 'error', label: 'Missing vendor' },
  'missing-amount': { severity: 'error', label: 'Missing amount' },
  'unreadable-amount': { severity: 'error', label: 'Amount is not a readable number' },
  'zero-amount': { severity: 'warning', label: 'Amount is zero' },
  'negative-amount': { severity: 'warning', label: 'Amount is negative (credit)' },
  'amount-line-mismatch': { severity: 'warning', label: 'Quantity x rate does not equal the amount' },
  'missing-invoice-date': { severity: 'error', label: 'Missing invoice date' },
  'unreadable-invoice-date': { severity: 'error', label: 'Invoice date is not a readable date' },
  'invoice-date-future': { severity: 'warning', label: 'Invoice date is in the future' },
  'invoice-date-outside-window': {
    severity: 'warning',
    label: 'Invoice date falls outside the export window',
  },
  'unreadable-due-date': { severity: 'warning', label: 'Due date is not a readable date' },
  'due-before-invoice-date': { severity: 'warning', label: 'Due date is before the invoice date' },
  'unreadable-service-date': { severity: 'warning', label: 'Service date is not a readable date' },
  'service-date-after-invoice-date': {
    severity: 'warning',
    label: 'Service date is after the invoice date',
  },
  'missing-property': { severity: 'error', label: 'Missing property' },
  'unknown-property': { severity: 'error', label: 'Property is not one of the four QuickBooks companies' },
  'missing-gl-code': { severity: 'error', label: 'Missing GL code' },
  'gl-code-format': { severity: 'warning', label: 'GL code is not a recognized format' },
  'invoice-spans-properties': {
    severity: 'error',
    label: 'One invoice number spans more than one property',
  },
  'invoice-conflicting-vendor': {
    severity: 'warning',
    label: 'One invoice number carries more than one vendor',
  },
  'invoice-conflicting-date': {
    severity: 'warning',
    label: 'One invoice number carries more than one invoice date',
  },
  'duplicate-line': { severity: 'warning', label: 'Duplicate of another line in this file' },
  'gl-code-conflict-at-property': {
    severity: 'warning',
    label: 'Same service coded to different GL codes at one property',
  },
};

export type InvoiceFlag = {
  code: InvoiceFlagCode;
  severity: FlagSeverity;
  label: string;
  /** Which column the flag is about, when it is about one. */
  column: FaciliqColumnKey | null;
  /** Row-specific detail, e.g. the two values that disagree. */
  detail: string;
};

export type InvoiceRowFields = Record<FaciliqColumnKey, string>;

export type ReviewedInvoiceRow = {
  /** 1-based line number in the uploaded file, so a flag points at a findable row. */
  sourceLine: number;
  /** Original cells, untouched, used to rebuild the split files byte-for-byte. */
  cells: string[];
  /** Trimmed source text per mapped column; '' when the column is absent or empty. */
  fields: InvoiceRowFields;
  amount: number | null;
  invoiceDateIso: string | null;
  propertyCode: QuickBooksPropertyCode | null;
  flags: InvoiceFlag[];
  severity: FlagSeverity | null;
  status: 'ready' | 'review';
};

export type PropertyBucket = {
  code: QuickBooksPropertyCode;
  name: string;
  readyRows: ReviewedInvoiceRow[];
  reviewRows: ReviewedInvoiceRow[];
  readyAmount: number;
  reviewAmount: number;
};

export type ReportTotals = {
  dataRows: number;
  blankRowsSkipped: number;
  readyRows: number;
  reviewRows: number;
  unresolvedRows: number;
  flaggedRows: number;
  sourceAmount: number;
  readyAmount: number;
  reviewAmount: number;
  unresolvedAmount: number;
  /** Rows whose amount could not be read, and therefore contribute 0 to the totals. */
  unreadableAmountRows: number;
  /** ready + review + unresolved ties back to the source total. */
  reconciles: boolean;
};

export type FlagSummaryEntry = {
  code: InvoiceFlagCode;
  severity: FlagSeverity;
  label: string;
  rows: number;
};

export type FaciliqInvoiceReport = {
  ok: boolean;
  headerError: string | null;
  sourceFilename: string;
  asOfIso: string;
  header: string[];
  window: ExportWindow | null;
  columns: ColumnBinding[];
  unmappedHeaders: string[];
  missingRequiredColumns: string[];
  properties: PropertyBucket[];
  /** Flagged rows whose property is missing or not one of the four QuickBooks companies. */
  unresolvedRows: ReviewedInvoiceRow[];
  totals: ReportTotals;
  flagSummary: FlagSummaryEntry[];
  notes: string[];
};

export type ReviewOptions = {
  sourceFilename: string;
  /** Today as yyyy-mm-dd. Injected so the report is deterministic and testable. */
  asOfIso: string;
  /** Overrides the window parsed from the filename. */
  window?: ExportWindow | null;
};

type WorkingRow = Omit<ReviewedInvoiceRow, 'severity' | 'status'>;

const EMPTY_FIELDS = (): InvoiceRowFields => ({
  invoiceNumber: '',
  vendor: '',
  invoiceDate: '',
  dueDate: '',
  terms: '',
  location: '',
  memo: '',
  item: '',
  description: '',
  quantity: '',
  rate: '',
  amount: '',
  serviceDate: '',
  property: '',
  glCode: '',
});

const makeFlag = (
  code: InvoiceFlagCode,
  column: FaciliqColumnKey | null,
  detail: string,
): InvoiceFlag => ({
  code,
  severity: FLAG_DEFINITIONS[code].severity,
  label: FLAG_DEFINITIONS[code].label,
  column,
  detail,
});

const addFlag = (
  row: WorkingRow,
  code: InvoiceFlagCode,
  column: FaciliqColumnKey | null,
  detail: string,
): void => {
  if (row.flags.some((flag) => flag.code === code)) return;
  row.flags.push(makeFlag(code, column, detail));
};

const SEVERITY_RANK: Record<FlagSeverity, number> = { info: 1, warning: 2, error: 3 };

export const highestSeverity = (flags: readonly InvoiceFlag[]): FlagSeverity | null =>
  flags.reduce<FlagSeverity | null>(
    (worst, flag) =>
      worst === null || SEVERITY_RANK[flag.severity] > SEVERITY_RANK[worst] ? flag.severity : worst,
    null,
  );

/** Errors and warnings both hold a row back; info does not. */
const holdsRowBack = (flags: readonly InvoiceFlag[]): boolean =>
  flags.some((flag) => flag.severity === 'error' || flag.severity === 'warning');

const groupKey = (value: string): string => value.trim().toUpperCase().replace(/\s+/g, ' ');

const listLines = (lines: readonly number[]): string => lines.join(', ');

export function reviewInvoiceCsv(text: string, options: ReviewOptions): FaciliqInvoiceReport {
  const window =
    options.window !== undefined
      ? options.window
      : parseExportWindowFromFilename(options.sourceFilename);

  const records = parseCsv(text);
  const notes: string[] = [];

  const emptyReport = (headerError: string, header: string[]): FaciliqInvoiceReport => ({
    ok: false,
    headerError,
    sourceFilename: options.sourceFilename,
    asOfIso: options.asOfIso,
    header,
    window,
    columns: [],
    unmappedHeaders: [],
    missingRequiredColumns: [],
    properties: QUICKBOOKS_PROPERTIES.map((property) => ({
      code: property.code,
      name: property.name,
      readyRows: [],
      reviewRows: [],
      readyAmount: 0,
      reviewAmount: 0,
    })),
    unresolvedRows: [],
    totals: {
      dataRows: 0,
      blankRowsSkipped: 0,
      readyRows: 0,
      reviewRows: 0,
      unresolvedRows: 0,
      flaggedRows: 0,
      sourceAmount: 0,
      readyAmount: 0,
      reviewAmount: 0,
      unresolvedAmount: 0,
      unreadableAmountRows: 0,
      reconciles: true,
    },
    flagSummary: [],
    notes,
  });

  const headerRecord = records[0];
  if (!headerRecord) {
    return emptyReport('The file is empty, so there is no header row to read.', []);
  }

  const header = headerRecord.cells.map((cell) => cell.trim());
  const columns = resolveColumns(header);

  if (columns.missingRequired.length > 0) {
    const missingLabels = columns.missingRequired.map((key) => COLUMN_LABELS[key]);
    return {
      ...emptyReport(
        `The export is missing a column for: ${missingLabels.join(
          ', ',
        )}. FacilIQ's format changed, so no rows were read.`,
        header,
      ),
      columns: columns.bindings,
      unmappedHeaders: columns.unmappedHeaders,
      missingRequiredColumns: missingLabels,
    };
  }

  const read = (cells: readonly string[], key: FaciliqColumnKey): string => {
    const index = columns.indexByKey[key];
    if (index === undefined) return '';
    return (cells[index] ?? '').trim();
  };

  const rows: WorkingRow[] = [];
  let blankRowsSkipped = 0;

  for (const record of records.slice(1)) {
    if (isBlankRecord(record.cells)) {
      blankRowsSkipped += 1;
      continue;
    }

    const fields = EMPTY_FIELDS();
    for (const key of Object.keys(fields) as FaciliqColumnKey[]) {
      fields[key] = read(record.cells, key);
    }

    const row: WorkingRow = {
      sourceLine: record.line,
      cells: [...record.cells],
      fields,
      amount: null,
      invoiceDateIso: null,
      propertyCode: null,
      flags: [],
    };

    if (record.cells.length !== header.length) {
      addFlag(
        row,
        'column-count-mismatch',
        null,
        `Row has ${record.cells.length} column(s), header has ${header.length}.`,
      );
    }

    // --- Invoice number -----------------------------------------------------
    if (!fields.invoiceNumber) {
      addFlag(row, 'missing-invoice-number', 'invoiceNumber', 'The invoice number cell is blank.');
    }

    // --- Vendor -------------------------------------------------------------
    if (!fields.vendor) {
      addFlag(row, 'missing-vendor', 'vendor', 'The vendor cell is blank.');
    }

    // --- Amount -------------------------------------------------------------
    const amount = parseCsvAmount(fields.amount);
    if (!fields.amount) {
      addFlag(row, 'missing-amount', 'amount', 'The amount cell is blank.');
    } else if (!amount) {
      addFlag(row, 'unreadable-amount', 'amount', `Could not read "${fields.amount}" as a number.`);
    } else {
      row.amount = amount.value;
      if (amount.value === 0) {
        addFlag(row, 'zero-amount', 'amount', 'The line amount is 0.00.');
      } else if (amount.value < 0) {
        addFlag(
          row,
          'negative-amount',
          'amount',
          `Reads as ${amount.value.toFixed(2)}; confirm this is a credit before it posts.`,
        );
      }

      const quantity = parseCsvAmount(fields.quantity);
      const rate = parseCsvAmount(fields.rate);
      if (quantity && rate) {
        const expected = roundCents(quantity.value * rate.value);
        if (Math.abs(expected - roundCents(amount.value)) > 0.01) {
          addFlag(
            row,
            'amount-line-mismatch',
            'amount',
            `${fields.quantity} x ${fields.rate} = ${expected.toFixed(2)}, but the amount reads ${amount.value.toFixed(2)}.`,
          );
        }
      }
    }

    // --- Invoice date -------------------------------------------------------
    const invoiceDate = parseCsvDate(fields.invoiceDate);
    if (!fields.invoiceDate) {
      addFlag(row, 'missing-invoice-date', 'invoiceDate', 'The invoice date cell is blank.');
    } else if (!invoiceDate) {
      addFlag(
        row,
        'unreadable-invoice-date',
        'invoiceDate',
        `Could not read "${fields.invoiceDate}" as a calendar date.`,
      );
    } else {
      row.invoiceDateIso = invoiceDate.iso;
      if (invoiceDate.iso > options.asOfIso) {
        addFlag(
          row,
          'invoice-date-future',
          'invoiceDate',
          `Dated ${fields.invoiceDate}, later than ${formatIsoDateForDisplay(options.asOfIso)}.`,
        );
      }
      if (window && (invoiceDate.iso < window.startIso || invoiceDate.iso > window.endIso)) {
        addFlag(
          row,
          'invoice-date-outside-window',
          'invoiceDate',
          `Dated ${fields.invoiceDate}, outside ${formatIsoDateForDisplay(window.startIso)} - ${formatIsoDateForDisplay(window.endIso)}.`,
        );
      }
    }

    // --- Due date and service date (read only when the columns exist) -------
    if (fields.dueDate) {
      const dueDate = parseCsvDate(fields.dueDate);
      if (!dueDate) {
        addFlag(
          row,
          'unreadable-due-date',
          'dueDate',
          `Could not read "${fields.dueDate}" as a calendar date.`,
        );
      } else if (invoiceDate && dueDate.iso < invoiceDate.iso) {
        addFlag(
          row,
          'due-before-invoice-date',
          'dueDate',
          `Due ${fields.dueDate} but invoiced ${fields.invoiceDate}.`,
        );
      }
    }

    if (fields.serviceDate) {
      const serviceDate = parseCsvDate(fields.serviceDate);
      if (!serviceDate) {
        addFlag(
          row,
          'unreadable-service-date',
          'serviceDate',
          `Could not read "${fields.serviceDate}" as a calendar date.`,
        );
      } else if (invoiceDate && serviceDate.iso > invoiceDate.iso) {
        addFlag(
          row,
          'service-date-after-invoice-date',
          'serviceDate',
          `Serviced ${fields.serviceDate} but invoiced ${fields.invoiceDate}.`,
        );
      }
    }

    // --- Property -----------------------------------------------------------
    if (!fields.property) {
      addFlag(row, 'missing-property', 'property', 'The property cell is blank.');
    } else {
      const code = resolveQuickBooksPropertyCode(fields.property);
      if (code) {
        row.propertyCode = code;
      } else {
        const siteShaped = extractSiteShapedCode(fields.property);
        addFlag(
          row,
          'unknown-property',
          'property',
          siteShaped
            ? `"${fields.property}" reads as site ${siteShaped}, which is not L001, P006, W002, or W003.`
            : `"${fields.property}" does not match L001, P006, W002, or W003.`,
        );
      }
    }

    // --- GL code ------------------------------------------------------------
    if (!fields.glCode) {
      addFlag(row, 'missing-gl-code', 'glCode', 'The GL code cell is blank.');
    } else if (!isWellFormedGlCode(fields.glCode)) {
      addFlag(
        row,
        'gl-code-format',
        'glCode',
        `"${fields.glCode}" is not the 4-4 or 4-3 digit shape STORE's GL codes use.`,
      );
    }

    rows.push(row);
  }

  applyInvoiceLevelFlags(rows);
  applyDuplicateLineFlags(rows);
  notes.push(...applyGlConsistencyFlags(rows));

  // --- Bucket the rows ------------------------------------------------------
  const finalRows: ReviewedInvoiceRow[] = rows.map((row) => ({
    ...row,
    severity: highestSeverity(row.flags),
    status: holdsRowBack(row.flags) ? 'review' : 'ready',
  }));

  const properties: PropertyBucket[] = QUICKBOOKS_PROPERTIES.map((property) => ({
    code: property.code,
    name: property.name,
    readyRows: [],
    reviewRows: [],
    readyAmount: 0,
    reviewAmount: 0,
  }));
  const bucketByCode = new Map(properties.map((bucket) => [bucket.code, bucket]));
  const unresolvedRows: ReviewedInvoiceRow[] = [];

  let sourceAmount = 0;
  let unreadableAmountRows = 0;

  for (const row of finalRows) {
    sourceAmount += row.amount ?? 0;
    if (row.amount === null) unreadableAmountRows += 1;

    const bucket = row.propertyCode ? bucketByCode.get(row.propertyCode) : undefined;
    if (!bucket) {
      unresolvedRows.push(row);
      continue;
    }
    if (row.status === 'ready') {
      bucket.readyRows.push(row);
      bucket.readyAmount += row.amount ?? 0;
    } else {
      bucket.reviewRows.push(row);
      bucket.reviewAmount += row.amount ?? 0;
    }
  }

  for (const bucket of properties) {
    bucket.readyAmount = roundCents(bucket.readyAmount);
    bucket.reviewAmount = roundCents(bucket.reviewAmount);
  }

  const readyRows = properties.reduce((sum, bucket) => sum + bucket.readyRows.length, 0);
  const reviewRows = properties.reduce((sum, bucket) => sum + bucket.reviewRows.length, 0);
  const readyAmount = roundCents(properties.reduce((sum, bucket) => sum + bucket.readyAmount, 0));
  const reviewAmount = roundCents(properties.reduce((sum, bucket) => sum + bucket.reviewAmount, 0));
  const unresolvedAmount = roundCents(
    unresolvedRows.reduce((sum, row) => sum + (row.amount ?? 0), 0),
  );
  const roundedSource = roundCents(sourceAmount);

  const totals: ReportTotals = {
    dataRows: finalRows.length,
    blankRowsSkipped,
    readyRows,
    reviewRows,
    unresolvedRows: unresolvedRows.length,
    flaggedRows: reviewRows + unresolvedRows.length,
    sourceAmount: roundedSource,
    readyAmount,
    reviewAmount,
    unresolvedAmount,
    unreadableAmountRows,
    reconciles: Math.abs(readyAmount + reviewAmount + unresolvedAmount - roundedSource) < 0.005,
  };

  if (blankRowsSkipped > 0) {
    notes.push(`Skipped ${blankRowsSkipped} blank row(s) in the file.`);
  }
  if (unreadableAmountRows > 0) {
    notes.push(
      `${unreadableAmountRows} row(s) have an amount that could not be read, so they count as 0.00 in the dollar totals.`,
    );
  }
  if (!window) {
    notes.push(
      'No date window was found in the filename, so invoice dates were not range-checked against the export period.',
    );
  }
  if (columns.unmappedHeaders.length > 0) {
    notes.push(
      `Columns carried through but not checked: ${columns.unmappedHeaders.join(', ')}.`,
    );
  }

  return {
    ok: true,
    headerError: null,
    sourceFilename: options.sourceFilename,
    asOfIso: options.asOfIso,
    header,
    window,
    columns: columns.bindings,
    unmappedHeaders: columns.unmappedHeaders,
    missingRequiredColumns: [],
    properties,
    unresolvedRows,
    totals,
    flagSummary: buildFlagSummary(finalRows),
    notes,
  };
}

/**
 * Checks that only exist across rows sharing one invoice number. Splitting a single
 * invoice across two QuickBooks companies is the one that matters most: each half
 * would post as its own document in a different company file.
 */
function applyInvoiceLevelFlags(rows: WorkingRow[]): void {
  const groups = new Map<string, WorkingRow[]>();
  for (const row of rows) {
    const key = groupKey(row.fields.invoiceNumber);
    if (!key) continue;
    const existing = groups.get(key);
    if (existing) existing.push(row);
    else groups.set(key, [row]);
  }

  for (const [invoiceNumber, group] of groups) {
    if (group.length < 2) continue;

    const codes = [...new Set(group.map((row) => row.propertyCode).filter((code) => code !== null))];
    if (codes.length > 1) {
      const lines = listLines(group.map((row) => row.sourceLine));
      for (const row of group) {
        addFlag(
          row,
          'invoice-spans-properties',
          'property',
          `Invoice ${invoiceNumber} appears under ${codes.join(' and ')} (rows ${lines}); splitting it would post it into more than one QuickBooks company.`,
        );
      }
    }

    const vendors = [
      ...new Set(group.map((row) => groupKey(row.fields.vendor)).filter((value) => value !== '')),
    ];
    if (vendors.length > 1) {
      for (const row of group) {
        addFlag(
          row,
          'invoice-conflicting-vendor',
          'vendor',
          `Invoice ${invoiceNumber} lists ${vendors.length} different vendors across its rows.`,
        );
      }
    }

    const dates = [
      ...new Set(group.map((row) => row.invoiceDateIso).filter((value) => value !== null)),
    ];
    if (dates.length > 1) {
      for (const row of group) {
        addFlag(
          row,
          'invoice-conflicting-date',
          'invoiceDate',
          `Invoice ${invoiceNumber} carries ${dates.map(formatIsoDateForDisplay).join(' and ')}.`,
        );
      }
    }
  }
}

/**
 * Two rows identical on invoice number, service, amount, dates, and property are
 * usually a double-send from FacilIQ, but can legitimately be two units billed the
 * same way -- so this is a warning for a person, not an automatic drop.
 */
function applyDuplicateLineFlags(rows: WorkingRow[]): void {
  const groups = new Map<string, WorkingRow[]>();
  for (const row of rows) {
    const key = [
      groupKey(row.fields.invoiceNumber),
      groupKey(row.fields.item),
      groupKey(row.fields.description),
      groupKey(row.fields.amount),
      groupKey(row.fields.invoiceDate),
      groupKey(row.fields.serviceDate),
      groupKey(row.fields.property),
      groupKey(row.fields.glCode),
    ].join('|');
    const existing = groups.get(key);
    if (existing) existing.push(row);
    else groups.set(key, [row]);
  }

  for (const group of groups.values()) {
    if (group.length < 2) continue;
    for (const row of group) {
      const others = group.filter((other) => other !== row).map((other) => other.sourceLine);
      addFlag(
        row,
        'duplicate-line',
        null,
        `Identical to row ${listLines(others)} on invoice number, service, amount, dates, property, and GL code.`,
      );
    }
  }
}

/**
 * Same service coded two ways at one property is suspect. The same service coded
 * differently between properties is normal, so that only becomes a file note.
 */
function applyGlConsistencyFlags(rows: WorkingRow[]): string[] {
  const byPropertyAndItem = new Map<string, WorkingRow[]>();
  const glCodesByItem = new Map<string, Set<string>>();
  const itemLabels = new Map<string, string>();

  for (const row of rows) {
    const item = groupKey(row.fields.item);
    const gl = groupKey(row.fields.glCode);
    if (!item || !gl) continue;

    if (!itemLabels.has(item)) itemLabels.set(item, row.fields.item);

    const codes = glCodesByItem.get(item) ?? new Set<string>();
    codes.add(gl);
    glCodesByItem.set(item, codes);

    if (!row.propertyCode) continue;
    const key = `${row.propertyCode}|${item}`;
    const existing = byPropertyAndItem.get(key);
    if (existing) existing.push(row);
    else byPropertyAndItem.set(key, [row]);
  }

  const conflictedItems = new Set<string>();
  for (const [key, group] of byPropertyAndItem) {
    const codes = [...new Set(group.map((row) => groupKey(row.fields.glCode)))];
    if (codes.length < 2) continue;
    const item = key.split('|').slice(1).join('|');
    conflictedItems.add(item);
    for (const row of group) {
      addFlag(
        row,
        'gl-code-conflict-at-property',
        'glCode',
        `"${row.fields.item}" is coded to ${codes.join(' and ')} at ${row.propertyCode} in this file.`,
      );
    }
  }

  const notes: string[] = [];
  for (const [item, codes] of glCodesByItem) {
    if (codes.size < 2 || conflictedItems.has(item)) continue;
    notes.push(
      `"${itemLabels.get(item) ?? item}" uses different GL codes at different properties (${[...codes].join(', ')}). Consistent within each property, so nothing was held back.`,
    );
  }
  return notes;
}

function buildFlagSummary(rows: readonly ReviewedInvoiceRow[]): FlagSummaryEntry[] {
  const counts = new Map<InvoiceFlagCode, number>();
  for (const row of rows) {
    for (const flag of row.flags) {
      counts.set(flag.code, (counts.get(flag.code) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([code, rowCount]) => ({
      code,
      severity: FLAG_DEFINITIONS[code].severity,
      label: FLAG_DEFINITIONS[code].label,
      rows: rowCount,
    }))
    .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || b.rows - a.rows);
}

/** Every flagged row in the file, in file order. */
export const collectFlaggedRows = (report: FaciliqInvoiceReport): ReviewedInvoiceRow[] =>
  [...report.properties.flatMap((bucket) => bucket.reviewRows), ...report.unresolvedRows].sort(
    (a, b) => a.sourceLine - b.sourceLine,
  );

export { REQUIRED_COLUMN_KEYS, COLUMN_LABELS };
