import fs from 'node:fs/promises';
import path from 'node:path';
import PizZip from 'pizzip';
import * as XLSX from 'xlsx';
import { normalizeTokenKey, scanPptTokens, stripHiddenTokenCharacters } from '@/lib/pptTokens';

export type PropertyAnalysisTokenSource = 'extracted' | 'derived' | 'manual';
export type PropertyAnalysisTokenSection =
  | 'reportHeader'
  | 'returnProfile'
  | 'marketSnapshot'
  | 'incomeProforma'
  | 'expenseProforma'
  | 'dealEconomics'
  | 'exitSensitivity'
  | 'manualInputs';

export type PropertyAnalysisWorkbookMetadata = {
  fileName: string;
  workbookType: 'wentworth-results' | 'public-proforma-template';
  propertyName: string;
  propertyAddress: string;
  dealNumber: string;
  templatePath: string;
  sheetsFound: string[];
};

export type PropertyAnalysisTokenField = {
  token: string;
  label: string;
  value: string;
  defaultValue: string;
  section: PropertyAnalysisTokenSection;
  source: PropertyAnalysisTokenSource;
  matchedKey: string | null;
};

export type PropertyAnalysisImageSlot = {
  id: string;
  label: string;
  description: string;
  slideNumber: number;
  mediaPath: string;
  fileName: string;
  contentType: string;
};

export type PropertyAnalysisParseResponse = {
  metadata: PropertyAnalysisWorkbookMetadata;
  warnings: string[];
  templateTokens: string[];
  unresolvedTokens: string[];
  tokenFields: PropertyAnalysisTokenField[];
  imageSlots: PropertyAnalysisImageSlot[];
};

type PackageTemplateOptions = {
  templatePath?: string;
  imageOverrides?: Record<
    string,
    {
      buffer: Buffer;
      fileName?: string;
      contentType?: string;
    }
  >;
};

type InternalTokenSection =
  | 'propertyProfile'
  | 'operatingMetrics'
  | 'stabilizedSummary'
  | 'incomeProforma'
  | 'expenseProforma'
  | 'dealEconomics'
  | 'exitSensitivity'
  | 'manualNarrative';

type ExtractedTokenRecord = {
  label: string;
  value: string;
  section: InternalTokenSection;
  source: Exclude<PropertyAnalysisTokenSource, 'manual'>;
  matchedKey: string;
};

type SheetValueRow = {
  label: string;
  values: string[];
  rawSection: string;
};

type ParsedWorkbookBundle = {
  metadata: PropertyAnalysisWorkbookMetadata;
  warnings: string[];
  defaults: Map<string, ExtractedTokenRecord>;
};

type PackageTokenDefinition = {
  label: string;
  section: PropertyAnalysisTokenSection;
  aliases: string[];
};

type MatrixColumnSpec = {
  index: number;
  label: string;
  fallbackIndices?: number[];
  formatter?: (value: string) => string;
};

type MatrixRowTokenSpec = {
  sourceRow: string;
  label: string;
  section: InternalTokenSection;
  tokenNumbers: number[];
  columns: MatrixColumnSpec[];
  sheetName: string;
  labelColumnIndex: number;
};

type DynamicMatrixRowTokenSpec = Omit<MatrixRowTokenSpec, 'columns' | 'sheetName' | 'labelColumnIndex'> & {
  columns: (layout: PublicProformaLayout) => MatrixColumnSpec[];
};

type PublicProformaLayout = {
  headerRowIndex: number;
  labelColumnIndex: number;
  t12Avg: MatrixColumnSpec;
  t12: MatrixColumnSpec;
  monthColumns: MatrixColumnSpec[];
  store: MatrixColumnSpec;
  currentMgmt: MatrixColumnSpec;
  impact: MatrixColumnSpec;
};

type PublicSensitivityTable = {
  titleRowIndex: number;
  headerRowIndex: number;
  rowIndices: number[];
};

type DirectRowSeriesSpec = {
  rowLabel: string;
  tokenStart: number;
  label: string;
  formatter?: (value: string) => string;
};

type HoldPeriodRowSpec = {
  tokenNumbers: number[];
  label: string;
  sourceLabel: string;
  formatter?: (value: string) => string;
};

type DirectCellSpec = {
  token: string;
  label: string;
  rowLabel: string;
  labelColumn: number;
  valueColumn: number;
};

type CapRateColumnSpec = {
  columnIndex: number;
  suffix: string;
  formatter?: (value: string) => string;
};

type KeyMetricSpec = {
  token: string;
  label: string;
  sourceLabel: string;
};

type PublicProformaSummaryMetricKey =
  | 'totalOperatingIncome'
  | 'totalOperatingExpense'
  | 'netOperatingIncome';

type PublicProformaSummaryMetricValue = {
  displayValue: string;
  numericValue: number;
  matchedKey: string;
};

type PublicProformaSummaryMetric = {
  label: string;
  t12: PublicProformaSummaryMetricValue;
  year1: PublicProformaSummaryMetricValue;
};

type PublicProformaSummaryValues = Record<PublicProformaSummaryMetricKey, PublicProformaSummaryMetric>;

const PACKAGE_TEMPLATE_PATH = path.join(process.cwd(), 'public', 'PackageTemplate.pptx');
const WENTWORTH_REQUIRED_SHEETS = ['Property Data', '5 Year Summary', '5 Year Model', 'Stabilized Results'] as const;
const PUBLIC_REQUIRED_SHEETS = ['Inputs & Drivers', '5 Year Proforma', 'Model2.0', 'Valuation Sheet'] as const;
const MONTH_TOKEN_COUNT = 12;
const XML_TAG_PATTERN = /<[^>]+>/g;
const TOKEN_SPAN_PATTERN = /\{\{[\s\S]*?\}\}/g;
const SHORT_MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'] as const;
const TEMPLATE_RASTER_IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg']);
const MALFORMED_OPEN_PAREN_TOKENS = new Set(
  [...buildCellTokenRange(551, 560), ...buildCellTokenRange(591, 593)].map((tokenNumber) =>
    normalizeTokenKey(buildCellToken(tokenNumber)) ?? buildCellToken(tokenNumber),
  ),
);
const PACKAGE_TOKEN_DEFINITIONS: Record<string, PackageTokenDefinition> = {
  PUBLISHMONTHYEAR: {
    label: 'Publish Month / Year',
    section: 'reportHeader',
    aliases: ['REPORT_MONTH_YEAR', 'PACKAGE_MONTH_YEAR', 'CONFIDENTIAL_DATE'],
  },
  '3YIRR': {
    label: '3-Year Hold IRR',
    section: 'returnProfile',
    aliases: ['LEVERED_IRR_3_YEAR'],
  },
  '3YMUL': {
    label: '3-Year Hold Equity Multiple',
    section: 'returnProfile',
    aliases: ['LEVERED_EQUITY_MULTIPLE_3_YEAR'],
  },
  '5YIRR': {
    label: '5-Year Hold IRR',
    section: 'returnProfile',
    aliases: ['LEVERED_IRR_5_YEAR'],
  },
  '5YMUL': {
    label: '5-Year Hold Equity Multiple',
    section: 'returnProfile',
    aliases: ['LEVERED_EQUITY_MULTIPLE_5_YEAR'],
  },
  '7YIRR': {
    label: '7-Year Hold IRR',
    section: 'returnProfile',
    aliases: ['LEVERED_IRR_7_YEAR'],
  },
  '7YMUL': {
    label: '7-Year Hold Equity Multiple',
    section: 'returnProfile',
    aliases: ['LEVERED_EQUITY_MULTIPLE_7_YEAR'],
  },
  ASSETVALUE: {
    label: 'Asset Value Added',
    section: 'returnProfile',
    aliases: ['ASSET_VALUE_ADDED'],
  },
  NOIPERCENT: {
    label: 'NOI Increase',
    section: 'returnProfile',
    aliases: ['NOI_INCREASE_PERCENT'],
  },
  EXPREDPERC: {
    label: 'Expense Reduction',
    section: 'returnProfile',
    aliases: ['EXPENSE_REDUCTION_PERCENT'],
  },
  REVENUELIFT: {
    label: 'Revenue Lift',
    section: 'returnProfile',
    aliases: ['REVENUE_LIFT_THOUSANDS'],
  },
  OCCPER: {
    label: 'Occupancy',
    section: 'marketSnapshot',
    aliases: ['PROPERTY_OCCUPANCY', 'CURRENT_OCCUPANCY', 'OCCUPANCY'],
  },
  REGION: {
    label: 'Region',
    section: 'returnProfile',
    aliases: ['REGION_NAME'],
  },
  RENTSQFT: {
    label: 'Rentable SqFt',
    section: 'marketSnapshot',
    aliases: ['RENTABLE_SQFT', 'NET_RENTABLE_SQFT'],
  },
  UNITS: {
    label: 'Total Units',
    section: 'marketSnapshot',
    aliases: ['TOTAL_UNITS', 'NUMBER_OF_UNITS'],
  },
  RATING: {
    label: 'Rating',
    section: 'manualInputs',
    aliases: [],
  },
  REVIEWS: {
    label: 'Reviews',
    section: 'manualInputs',
    aliases: [],
  },
  SNAPSHOTDESCRIPTION: {
    label: 'Snapshot Description',
    section: 'marketSnapshot',
    aliases: ['SNAPSHOT_DESCRIPTION'],
  },
};

const VALUATION_LABEL_COLUMN_INDEX = 0;
const VALUATION_KEY_METRIC_LABEL_COLUMN_INDEX = 5;
const VALUATION_KEY_METRIC_VALUE_COLUMN_INDEX = 6;

function buildCellToken(tokenNumber: number): string {
  return `CELL${String(tokenNumber).padStart(4, '0')}`;
}

function buildCellTokenRange(start: number, end: number): number[] {
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

function withFormatter(
  column: MatrixColumnSpec,
  formatter?: (value: string) => string,
): MatrixColumnSpec {
  return formatter ? { ...column, formatter } : { ...column };
}

function withFallbackIndices(column: MatrixColumnSpec, fallbackIndices: number[]): MatrixColumnSpec {
  if (!fallbackIndices.length) return column;
  return {
    ...column,
    fallbackIndices,
  };
}

function stripLeadingDollar(value: string): string {
  return value.replace(/^\$\s*/, '').trim();
}

function stripOuterParens(value: string): string {
  return value.replace(/^\((.*)\)$/, '$1').trim();
}

function stripTrailingX(value: string): string {
  return value.replace(/x$/i, '').trim();
}

function percentToBasisPoints(value: string): string {
  const numeric = parseNumberLike(value);
  if (numeric == null) return value.trim();
  if (value.includes('%')) return String(Math.round(numeric * 100));
  if (Math.abs(numeric) > 10) return String(Math.round(numeric));
  if (Math.abs(numeric) > 1) return String(Math.round(numeric * 100));
  return String(Math.round(numeric * 10_000));
}

function splitCombinedValue(value: string, separator: string): [string, string] {
  const parts = value.split(separator).map((part) => part.trim());
  return [parts[0] ?? '', parts[1] ?? ''];
}

function buildPublicProformaAllColumns(layout: PublicProformaLayout): MatrixColumnSpec[] {
  return [layout.t12Avg, layout.t12, ...layout.monthColumns, layout.store, layout.currentMgmt, layout.impact];
}

const SLIDE4_PROFORMA_SPECS: DynamicMatrixRowTokenSpec[] = [
  {
    sourceRow: 'Rental Income',
    label: 'Rental Income',
    section: 'incomeProforma',
    tokenNumbers: buildCellTokenRange(3, 19),
    columns: (layout) => [
      ...buildPublicProformaAllColumns(layout).slice(0, 16),
      withFormatter(layout.impact, stripLeadingDollar),
    ],
  },
  {
    sourceRow: 'STORE Rate Mgmt. Rev',
    label: 'STORE Rate Management Revenue',
    section: 'incomeProforma',
    // The managed PackageTemplate now renders the full STORE revenue row, including
    // leading zero columns and the current-management comparison cell. These tokens
    // must stay aligned to the table grid in slide 4 or the deck silently falls back
    // to manual-input mode for otherwise deterministic proforma values.
    tokenNumbers: [1000, 1001, 1002, 1003, 1004, ...buildCellTokenRange(20, 29), 1005, 30],
    columns: (layout) => buildPublicProformaAllColumns(layout),
  },
  {
    sourceRow: 'Discounts',
    label: 'Discounts',
    section: 'incomeProforma',
    tokenNumbers: [1006, 1007, ...buildCellTokenRange(31, 44), 1008],
    columns: (layout) =>
      buildPublicProformaAllColumns(layout).map((column) => withFormatter(column, stripLeadingDollar)),
  },
  {
    sourceRow: 'Net Rental Income',
    label: 'Net Rental Income',
    section: 'incomeProforma',
    tokenNumbers: buildCellTokenRange(45, 61),
    columns: (layout) => buildPublicProformaAllColumns(layout),
  },
  {
    sourceRow: 'Admin Fee Income',
    label: 'Admin Fee Income',
    section: 'incomeProforma',
    tokenNumbers: [...buildCellTokenRange(80, 95), 1011],
    columns: (layout) => buildPublicProformaAllColumns(layout),
  },
  {
    sourceRow: 'Late Fee Income',
    label: 'Late Fee Income',
    section: 'incomeProforma',
    tokenNumbers: [...buildCellTokenRange(96, 111), 1012],
    columns: (layout) => buildPublicProformaAllColumns(layout),
  },
  {
    sourceRow: 'Current Tenant Protection Split',
    label: 'Current Tenant Protection Split',
    section: 'incomeProforma',
    tokenNumbers: [...buildCellTokenRange(112, 125), 1010, 126, 1013],
    columns: (layout) => buildPublicProformaAllColumns(layout),
  },
  {
    sourceRow: 'STORE Tenant Protection Split',
    label: 'STORE Tenant Protection Split',
    section: 'incomeProforma',
    tokenNumbers: [1008, 1009, ...buildCellTokenRange(127, 139), 1014, 140],
    columns: (layout) => buildPublicProformaAllColumns(layout),
  },
  {
    sourceRow: 'Other Tenant Income',
    label: 'Other Tenant Income',
    section: 'incomeProforma',
    tokenNumbers: [...buildCellTokenRange(1015, 1029), 1010, 1010],
    columns: (layout) => buildPublicProformaAllColumns(layout),
  },
  {
    sourceRow: 'Retail Sales Income',
    label: 'Retail Sales Income',
    section: 'incomeProforma',
    tokenNumbers: [...buildCellTokenRange(141, 156), 1010],
    columns: (layout) => buildPublicProformaAllColumns(layout),
  },
  {
    sourceRow: 'Total Operating Income',
    label: 'Total Operating Income',
    section: 'incomeProforma',
    tokenNumbers: buildCellTokenRange(157, 173),
    columns: (layout) => buildPublicProformaAllColumns(layout),
  },
  {
    sourceRow: 'Projected Rate',
    label: 'Rent ($/SF)',
    section: 'incomeProforma',
    tokenNumbers: buildCellTokenRange(175, 186),
    columns: (layout) => layout.monthColumns,
  },
  {
    sourceRow: 'General Vacancy',
    label: 'Vacancy',
    section: 'incomeProforma',
    tokenNumbers: buildCellTokenRange(187, 198),
    columns: (layout) => layout.monthColumns,
  },
];

const SLIDE5_PROFORMA_SPECS: DynamicMatrixRowTokenSpec[] = [
  {
    sourceRow: 'Advertising & Marketing',
    label: 'Advertising & Marketing',
    section: 'expenseProforma',
    tokenNumbers: [...buildCellTokenRange(201, 216), 1030],
    columns: (layout) => buildPublicProformaAllColumns(layout),
  },
  {
    sourceRow: 'Current Payment Processing Fees',
    label: 'Current Payment Processing Fees',
    section: 'expenseProforma',
    tokenNumbers: [...buildCellTokenRange(217, 230), 1063, 231, 1031],
    columns: (layout) => buildPublicProformaAllColumns(layout),
  },
  {
    sourceRow: 'STORE Payment Processing Fees',
    label: 'STORE Payment Processing Fees',
    section: 'expenseProforma',
    tokenNumbers: [...buildCellTokenRange(1049, 1062), 1064, 1068, 1032],
    columns: (layout) => buildPublicProformaAllColumns(layout),
  },
  {
    sourceRow: 'Fire Prevention',
    label: 'Fire Prevention',
    section: 'expenseProforma',
    tokenNumbers: [1082, 1083, ...buildCellTokenRange(1071, 1079), 1080, 1080, 1081, 1065, 1069, 1033],
    columns: (layout) => buildPublicProformaAllColumns(layout),
  },
  {
    sourceRow: 'Licenses & Permits',
    label: 'Licenses & Permits',
    section: 'expenseProforma',
    tokenNumbers: [...buildCellTokenRange(1084, 1097), 1066, 1070, 1034],
    columns: (layout) => buildPublicProformaAllColumns(layout),
  },
  {
    sourceRow: 'Current Mgmt. Fee',
    label: 'Current Management Fee',
    section: 'expenseProforma',
    tokenNumbers: [...buildCellTokenRange(233, 246), 1067, 247, 1035],
    columns: (layout) => buildPublicProformaAllColumns(layout),
  },
  {
    sourceRow: 'STORE Mgmt. Fee',
    label: 'STORE Management Fee',
    section: 'expenseProforma',
    tokenNumbers: [1098, 1099, ...buildCellTokenRange(248, 260), 1119, 1036],
    columns: (layout) => buildPublicProformaAllColumns(layout),
  },
  {
    sourceRow: 'Payroll',
    label: 'Payroll',
    section: 'expenseProforma',
    tokenNumbers: [...buildCellTokenRange(262, 277), 1037],
    columns: (layout) => buildPublicProformaAllColumns(layout),
  },
  {
    sourceRow: 'Office Supplies',
    label: 'Office Supplies',
    section: 'expenseProforma',
    tokenNumbers: [...buildCellTokenRange(279, 294), 1038],
    columns: (layout) => buildPublicProformaAllColumns(layout),
  },
  {
    sourceRow: 'Repairs & Maintenance',
    label: 'Repairs & Maintenance',
    section: 'expenseProforma',
    tokenNumbers: [...buildCellTokenRange(295, 310), 1039],
    columns: (layout) => buildPublicProformaAllColumns(layout),
  },
  {
    sourceRow: 'Security',
    label: 'Security',
    section: 'expenseProforma',
    tokenNumbers: [1100, 1101, ...buildCellTokenRange(311, 323), 1118, 1040],
    columns: (layout) => buildPublicProformaAllColumns(layout),
  },
  {
    sourceRow: 'Retail Products',
    label: 'Retail Products',
    section: 'expenseProforma',
    tokenNumbers: [...buildCellTokenRange(325, 340), 1041],
    columns: (layout) => buildPublicProformaAllColumns(layout),
  },
  {
    sourceRow: 'Telephone & Internet',
    label: 'Telephone & Internet',
    section: 'expenseProforma',
    tokenNumbers: [...buildCellTokenRange(341, 356), 1042],
    columns: (layout) => buildPublicProformaAllColumns(layout),
  },
  {
    sourceRow: 'Software',
    label: 'Software',
    section: 'expenseProforma',
    tokenNumbers: buildCellTokenRange(357, 373),
    columns: (layout) => [
      ...buildPublicProformaAllColumns(layout).slice(0, 16),
      withFormatter(layout.impact, stripLeadingDollar),
    ],
  },
  {
    sourceRow: 'Bank Charges',
    label: 'Bank Charges',
    section: 'expenseProforma',
    tokenNumbers: [...buildCellTokenRange(1102, 1117), 1043],
    columns: (layout) => buildPublicProformaAllColumns(layout),
  },
  {
    sourceRow: 'Prof Fees - Legal/Acctg',
    label: 'Prof Fees - Legal/Acctg',
    section: 'expenseProforma',
    tokenNumbers: [...buildCellTokenRange(374, 389), 1044],
    columns: (layout) => buildPublicProformaAllColumns(layout),
  },
  {
    sourceRow: 'Utilities',
    label: 'Utilities',
    section: 'expenseProforma',
    tokenNumbers: [...buildCellTokenRange(390, 405), 1045],
    columns: (layout) => buildPublicProformaAllColumns(layout),
  },
  {
    sourceRow: 'Insurance',
    label: 'Insurance',
    section: 'expenseProforma',
    tokenNumbers: [...buildCellTokenRange(406, 421), 1046],
    columns: (layout) => buildPublicProformaAllColumns(layout),
  },
  {
    sourceRow: 'Property Taxes',
    label: 'Property Taxes',
    section: 'expenseProforma',
    tokenNumbers: [...buildCellTokenRange(422, 437), 1047],
    columns: (layout) => buildPublicProformaAllColumns(layout),
  },
  {
    sourceRow: 'Other Expense',
    label: 'Other Expense',
    section: 'expenseProforma',
    tokenNumbers: [1135, 1134, ...buildCellTokenRange(1120, 1133), 1048],
    columns: (layout) => buildPublicProformaAllColumns(layout),
  },
  {
    sourceRow: 'Total Operating Expense',
    label: 'Total Operating Expense',
    section: 'expenseProforma',
    tokenNumbers: buildCellTokenRange(438, 454),
    columns: (layout) => buildPublicProformaAllColumns(layout),
  },
  {
    sourceRow: 'Net Operating Income',
    label: 'Net Operating Income',
    section: 'expenseProforma',
    tokenNumbers: buildCellTokenRange(473, 489),
    columns: (layout) => buildPublicProformaAllColumns(layout),
  },
];

function cleanCell(value: unknown): string {
  return String(value ?? '')
    .replace(/\u00A0/g, ' ')
    .replace(/\r?\n/g, ' ')
    .trim();
}

function firstNonEmpty(row: string[]): string {
  return row.find((value) => value.trim().length > 0)?.trim() ?? '';
}

function lastNonEmpty(row: string[]): string {
  for (let index = row.length - 1; index >= 0; index -= 1) {
    const value = row[index]?.trim();
    if (value) return value;
  }
  return '';
}

function lastNonEmptyBefore(row: string[], beforeIndex: number): string {
  for (let index = Math.min(beforeIndex - 1, row.length - 1); index >= 0; index -= 1) {
    const value = row[index]?.trim();
    if (value) return value;
  }
  return '';
}

function normalizeLabel(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseMonthHeader(value: string): { ordinal: number; label: string } | null {
  const raw = cleanCell(value);
  if (!raw) return null;
  const match = raw.match(/^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s-]?(\d{2,4})$/i);
  if (!match) return null;
  const monthIndex = SHORT_MONTHS.indexOf(match[1].slice(0, 3).toLowerCase() as (typeof SHORT_MONTHS)[number]);
  if (monthIndex < 0) return null;
  const yearPart = match[2] ?? '';
  const year = yearPart.length === 2 ? 2000 + Number(yearPart) : Number(yearPart);
  if (!Number.isFinite(year)) return null;
  return { ordinal: year * 12 + monthIndex, label: raw };
}

function isLikelyTextLabel(value: string): boolean {
  const raw = cleanCell(value);
  if (!raw) return false;
  if (parseMonthHeader(raw)) return false;
  if (parseNumberLike(raw) !== null) return false;
  return /[A-Za-z]/.test(raw);
}

function detectContiguousMonthColumns(row: string[]): MatrixColumnSpec[] | null {
  for (let startIndex = 0; startIndex <= row.length - MONTH_TOKEN_COUNT; startIndex += 1) {
    const monthColumns: MatrixColumnSpec[] = [];
    let previousOrdinal: number | null = null;
    let valid = true;
    for (let offset = 0; offset < MONTH_TOKEN_COUNT; offset += 1) {
      const parsed = parseMonthHeader(row[startIndex + offset] ?? '');
      if (!parsed) {
        valid = false;
        break;
      }
      if (previousOrdinal !== null && parsed.ordinal !== previousOrdinal + 1) {
        valid = false;
        break;
      }
      previousOrdinal = parsed.ordinal;
      monthColumns.push({ index: startIndex + offset, label: parsed.label });
    }
    if (valid) return monthColumns;
  }
  return null;
}

function findHeaderColumnIndex(
  row: string[],
  matcher: (normalized: string) => boolean,
  options?: { beforeIndex?: number },
): number {
  const endIndex = Math.min(options?.beforeIndex ?? row.length - 1, row.length - 1);
  for (let index = 0; index <= endIndex; index += 1) {
    if (matcher(normalizeLabel(row[index] ?? ''))) return index;
  }
  return -1;
}

function detectPublicProformaLabelColumn(
  rows: string[][],
  headerRowIndex: number,
  monthStartIndex: number,
): number {
  const headerRow = rows[headerRowIndex] ?? [];
  for (let columnIndex = monthStartIndex - 1; columnIndex >= 0; columnIndex -= 1) {
    const normalized = normalizeLabel(headerRow[columnIndex] ?? '');
    if (normalized === 'income' || normalized === 'expenses') return columnIndex;
  }

  for (let columnIndex = monthStartIndex - 1; columnIndex >= 0; columnIndex -= 1) {
    let textHits = 0;
    for (let rowIndex = headerRowIndex + 1; rowIndex < rows.length; rowIndex += 1) {
      if (isLikelyTextLabel(rows[rowIndex]?.[columnIndex] ?? '')) {
        textHits += 1;
        if (textHits >= 3) return columnIndex;
      }
    }
  }

  return -1;
}

function detectPublicProformaLayout(rows: string[][]): PublicProformaLayout | null {
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] ?? [];
    const monthColumns = detectContiguousMonthColumns(row);
    if (!monthColumns) continue;

    const monthStartIndex = monthColumns[0]?.index ?? -1;
    const monthEndIndex = monthColumns[monthColumns.length - 1]?.index ?? -1;
    if (monthStartIndex < 0 || monthEndIndex < monthStartIndex) continue;

    const t12AvgIndex = findHeaderColumnIndex(row, (normalized) => normalized === 't 12 avg', {
      beforeIndex: monthStartIndex - 1,
    });
    const t12Index = findHeaderColumnIndex(row, (normalized) => normalized === 't 12', {
      beforeIndex: monthStartIndex - 1,
    });
    const currentMgmtIndex = row.findIndex((value) => {
      const normalized = normalizeLabel(value);
      return normalized === 'current mgmt' || normalized === 'current management';
    });
    const impactIndex = row.findIndex((value) => {
      const normalized = normalizeLabel(value);
      return normalized.includes('impact to n o i') || normalized.includes('impact to noi');
    });
    const labelColumnIndex = detectPublicProformaLabelColumn(rows, rowIndex, monthStartIndex);
    const storeIndex = currentMgmtIndex > monthEndIndex ? currentMgmtIndex - 1 : -1;
    const fallbackStatusColumnIndex = detectPublicProformaStatusColumn(rows, rowIndex, impactIndex);
    const storeFallbackIndex =
      fallbackStatusColumnIndex >= 0 && fallbackStatusColumnIndex - 2 > impactIndex ? fallbackStatusColumnIndex - 2 : -1;
    const impactFallbackIndex =
      fallbackStatusColumnIndex >= 0 && fallbackStatusColumnIndex - 1 > impactIndex ? fallbackStatusColumnIndex - 1 : -1;

    if (
      t12AvgIndex < 0 ||
      t12Index < 0 ||
      currentMgmtIndex < 0 ||
      impactIndex < 0 ||
      labelColumnIndex < 0 ||
      storeIndex <= monthEndIndex
    ) {
      continue;
    }

    return {
      headerRowIndex: rowIndex,
      labelColumnIndex,
      t12Avg: { index: t12AvgIndex, label: cleanCell(row[t12AvgIndex] ?? 'T-12 Avg') || 'T-12 Avg' },
      t12: { index: t12Index, label: cleanCell(row[t12Index] ?? 'T-12') || 'T-12' },
      monthColumns,
      store: withFallbackIndices({ index: storeIndex, label: 'STORE' }, storeFallbackIndex >= 0 ? [storeFallbackIndex] : []),
      currentMgmt: {
        index: currentMgmtIndex,
        label: cleanCell(row[currentMgmtIndex] ?? 'Current Mgmt') || 'Current Mgmt',
      },
      impact: withFallbackIndices(
        {
          index: impactIndex,
          label: cleanCell(row[impactIndex] ?? 'Impact to N.O.I.') || 'Impact to N.O.I.',
        },
        impactFallbackIndex >= 0 ? [impactFallbackIndex] : [],
      ),
    };
  }

  return null;
}

function detectPublicProformaStatusColumn(rows: string[][], headerRowIndex: number, impactIndex: number): number {
  for (let rowIndex = headerRowIndex + 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] ?? [];
    const endColumnIndex = Math.min(row.length - 1, impactIndex + 6);
    for (let columnIndex = impactIndex + 1; columnIndex <= endColumnIndex; columnIndex += 1) {
      const normalized = normalizeLabel(rows[rowIndex]?.[columnIndex] ?? '');
      if (normalized === 'ok' || normalized === 'check') {
        return columnIndex;
      }
    }
  }
  return -1;
}

function buildPublicProformaMatrixRowSpecs(
  layout: PublicProformaLayout,
  specs: DynamicMatrixRowTokenSpec[],
): MatrixRowTokenSpec[] {
  return specs.map((spec) => ({
    ...spec,
    columns: spec.columns(layout),
    sheetName: 'Proforma',
    labelColumnIndex: layout.labelColumnIndex,
  }));
}

function findValueCellForLabels(
  rows: string[][],
  labels: string[],
): { rowIndex: number; labelIndex: number; valueIndex: number; value: string } | null {
  const labelSet = new Set(labels.map(normalizeLabel));
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] ?? [];
    for (let labelIndex = 0; labelIndex < row.length; labelIndex += 1) {
      if (!labelSet.has(normalizeLabel(row[labelIndex] ?? ''))) continue;
      for (let valueIndex = row.length - 1; valueIndex > labelIndex; valueIndex -= 1) {
        const value = cleanCell(row[valueIndex] ?? '');
        if (!value) continue;
        return { rowIndex, labelIndex, valueIndex, value };
      }
    }
  }
  return null;
}

function findNearestNumericValueCellForLabels(
  rows: string[][],
  labels: string[],
): { rowIndex: number; labelIndex: number; valueIndex: number; value: string } | null {
  const labelSet = new Set(labels.map(normalizeLabel));
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] ?? [];
    for (let labelIndex = 0; labelIndex < row.length; labelIndex += 1) {
      if (!labelSet.has(normalizeLabel(row[labelIndex] ?? ''))) continue;
      for (let valueIndex = labelIndex + 1; valueIndex < row.length; valueIndex += 1) {
        const value = cleanCell(row[valueIndex] ?? '');
        if (!value) continue;
        if (parseNumberLike(value) === null && !value.includes('%')) continue;
        return { rowIndex, labelIndex, valueIndex, value };
      }
    }
  }
  return null;
}

function findCellMatchingPattern(
  rows: string[][] | null,
  pattern: RegExp,
): { rowIndex: number; columnIndex: number; value: string } | null {
  if (!rows) return null;
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] ?? [];
    for (let columnIndex = 0; columnIndex < row.length; columnIndex += 1) {
      const value = cleanCell(row[columnIndex] ?? '');
      if (!value || !pattern.test(value)) continue;
      return { rowIndex, columnIndex, value };
    }
  }
  return null;
}

function extractBasisPointsFromText(value: string): string | null {
  const match = value.match(/([0-9]+(?:\.[0-9]+)?)\s*bps/i);
  if (!match) return null;
  const numeric = Number(match[1]);
  if (!Number.isFinite(numeric)) return null;
  return String(Math.round(numeric));
}

function formatCurrencyTokenValue(value: string): string {
  const numeric = parseNumberLike(value);
  if (numeric == null) return value.trim();
  return formatCurrency(numeric);
}

function hasValuesInColumns(rows: string[][], rowIndex: number, columnIndices: number[]): boolean {
  return columnIndices.some((columnIndex) => readMatrixCell(rows, rowIndex, columnIndex).length > 0);
}

function findRowLabelInColumns(
  rows: string[][] | null,
  labels: string[],
  columnIndices: number[],
  options?: { startRow?: number; endRow?: number },
): { rowIndex: number; labelColumnIndex: number } | null {
  if (!rows) return null;
  const labelSet = new Set(labels.map(normalizeLabel));
  const start = options?.startRow ?? 0;
  const end = Math.min(options?.endRow ?? rows.length - 1, rows.length - 1);

  for (let rowIndex = start; rowIndex <= end; rowIndex += 1) {
    for (const columnIndex of columnIndices) {
      const candidate = normalizeLabel(rows[rowIndex]?.[columnIndex] ?? '');
      if (!candidate || !labelSet.has(candidate)) continue;
      return { rowIndex, labelColumnIndex: columnIndex };
    }
  }

  return null;
}

function collectValueCellsToRight(
  row: string[],
  labelColumnIndex: number,
  count: number,
): Array<{ valueIndex: number; value: string }> {
  const matches: Array<{ valueIndex: number; value: string }> = [];
  for (let valueIndex = labelColumnIndex + 1; valueIndex < row.length; valueIndex += 1) {
    const value = cleanCell(row[valueIndex] ?? '');
    if (!value) continue;
    matches.push({ valueIndex, value });
    if (matches.length >= count) break;
  }
  return matches;
}

function resolveSpreadBasisPoints(
  inputsRows: string[][],
  exitSensitivityRows: string[][] | null,
): { value: string; matchedKey: string } | null {
  const spreadCell = findNearestNumericValueCellForLabels(inputsRows, ['Spread (bps)', 'Spread']);
  if (spreadCell) {
    return {
      value: percentToBasisPoints(spreadCell.value),
      matchedKey: `Inputs & Drivers!R${spreadCell.rowIndex + 1}C${spreadCell.valueIndex + 1}`,
    };
  }

  const exitSensitivityCell = findCellMatchingPattern(
    exitSensitivityRows,
    /all-in interest rate\s*\(sofr\+\s*[0-9.]+\s*bps\)/i,
  );
  if (!exitSensitivityCell) return null;

  const bpsValue = extractBasisPointsFromText(exitSensitivityCell.value);
  if (!bpsValue) return null;

  return {
    value: bpsValue,
    matchedKey: `Print - Exit & Sensitivity!R${exitSensitivityCell.rowIndex + 1}C${exitSensitivityCell.columnIndex + 1}`,
  };
}

function collectPercentLabeledRows(rows: string[][], startRowIndex: number): number[] {
  const rowIndices: number[] = [];
  for (let rowIndex = startRowIndex; rowIndex < rows.length; rowIndex += 1) {
    const label = cleanCell(rows[rowIndex]?.[VALUATION_LABEL_COLUMN_INDEX] ?? '');
    if (!label) {
      if (rowIndices.length > 0) break;
      continue;
    }
    if (!label.includes('%') || parseNumberLike(label) === null) {
      if (rowIndices.length > 0) break;
      continue;
    }
    rowIndices.push(rowIndex);
  }
  return rowIndices;
}

function detectSensitivityTable(
  rows: string[][],
  titleMatcher: (label: string) => boolean,
  headerMatcher: (label: string, row: string[]) => boolean,
): PublicSensitivityTable | null {
  const titleRowIndex = rows.findIndex((row) => titleMatcher(normalizeLabel(firstNonEmpty(row))));
  if (titleRowIndex < 0) return null;

  let headerRowIndex = -1;
  for (let rowIndex = titleRowIndex + 1; rowIndex < Math.min(rows.length, titleRowIndex + 6); rowIndex += 1) {
    if (headerMatcher(normalizeLabel(firstNonEmpty(rows[rowIndex] ?? [])), rows[rowIndex] ?? [])) {
      headerRowIndex = rowIndex;
      break;
    }
  }
  if (headerRowIndex < 0) return null;

  const rowIndices = collectPercentLabeledRows(rows, headerRowIndex + 1);

  if (!rowIndices.length) return null;
  return { titleRowIndex, headerRowIndex, rowIndices };
}

function humanizeToken(token: string): string {
  const normalized = normalizeTokenKey(token);
  if (!normalized) return token;
  return normalized
    .split('_')
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1)}${part.slice(1).toLowerCase()}`)
    .join(' ');
}

function tokenBaseFromLabel(label: string): string {
  return normalizeTokenKey(label) ?? '';
}

function formatMonthYear(date: Date): string {
  return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(date);
}

function formatIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function parseNumberLike(value: string): number | null {
  const raw = value.trim();
  if (!raw) return null;
  const compact = raw.replace(/\s+/g, '').replace(/,/g, '');
  if (compact === '-' || compact === '$-' || compact === '($-)' || compact === '(-)') {
    return 0;
  }
  const normalized = raw.replace(/[$,%\s]/g, '');
  const negative = /^\(.+\)$/.test(normalized);
  const cleaned = normalized.replace(/[()]/g, '').trim();
  if (!/^[-+]?\d*\.?\d+$/.test(cleaned)) return null;
  const numeric = Number(cleaned);
  if (!Number.isFinite(numeric)) return null;
  return negative ? -numeric : numeric;
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value);
}

function formatPercent(value: number): string {
  return `${value.toFixed(2)}%`;
}

function formatWholePercentToken(value: number): string {
  return String(Math.round(value));
}

function formatWholePercentWithSymbol(value: number): string {
  return `${Math.round(value)}%`;
}

function formatThousandsToken(value: number): string {
  return String(Math.round(value / 1000));
}

function formatMillionsToken(value: number): string {
  return `${(value / 1_000_000).toFixed(1)}M`;
}

function formatPublicMetricLogValue(value: PublicProformaSummaryMetricValue): string {
  return `${value.displayValue} (${value.matchedKey})`;
}

function parseAddressLocation(address: string): { city: string; state: string } {
  const parts = address
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length >= 4) {
    return {
      city: parts[parts.length - 3] ?? '',
      state: parts[parts.length - 2]?.split(/\s+/)[0] ?? '',
    };
  }
  if (parts.length >= 3) {
    const city = parts[parts.length - 2] ?? '';
    const statePart = parts[parts.length - 1] ?? '';
    const state = statePart.split(/\s+/)[0] ?? '';
    return { city, state };
  }
  if (parts.length >= 2) {
    const cityPart = parts[parts.length - 1] ?? '';
    const tokens = cityPart.split(/\s+/).filter(Boolean);
    if (tokens.length >= 2) {
      return {
        city: tokens.slice(0, -2).join(' '),
        state: tokens[tokens.length - 2] ?? '',
      };
    }
  }
  return { city: '', state: '' };
}

function mapStateToRegion(state: string): string {
  const normalized = state.trim().toUpperCase();
  if (!normalized) return '';
  if (['NC', 'SC'].includes(normalized)) return 'Carolinas';
  if (['AZ', 'NM', 'NV'].includes(normalized)) return 'Southwest';
  if (['CA', 'OR', 'WA'].includes(normalized)) return 'West Coast';
  if (['TX'].includes(normalized)) return 'Texas';
  if (['FL'].includes(normalized)) return 'Florida';
  if (['CO', 'ID', 'MT', 'UT', 'WY'].includes(normalized)) return 'Mountain';
  if (['IL', 'IN', 'IA', 'KS', 'MI', 'MN', 'MO', 'ND', 'NE', 'OH', 'SD', 'WI'].includes(normalized)) return 'Midwest';
  if (['CT', 'MA', 'ME', 'NH', 'NJ', 'NY', 'PA', 'RI', 'VT'].includes(normalized)) return 'Northeast';
  if (['AL', 'AR', 'GA', 'KY', 'LA', 'MS', 'OK', 'TN', 'VA', 'WV'].includes(normalized)) return 'Southeast';
  if (['DC', 'DE', 'MD'].includes(normalized)) return 'Mid-Atlantic';
  return normalized;
}

function buildSnapshotDescription(
  propertyName: string,
  propertyAddress: string,
  propertyType: string,
): string {
  void propertyName;
  void propertyAddress;
  void propertyType;
  return '';
}

function buildSnapshotDescriptionPrompt(
  propertyName: string,
  propertyAddress: string,
  propertyType: string,
  region: string,
): string {
  return [
    'Write a two-sentence investment-style market snapshot for a property analysis presentation.',
    'Do not include any actual numbers, percentages, counts, square footage, ratings, review counts, or address street numbers.',
    'Keep it general, polished, and confident.',
    "Emphasize location fundamentals, demand, and STORE Management's execution-driven value creation.",
    'Do not use bullet points.',
    `Property name: ${propertyName || 'Unknown property'}`,
    `City/state: ${propertyAddress || 'Unknown location'}`,
    `Property type: ${propertyType || 'Storage asset'}`,
    `Region: ${region || 'Unknown region'}`,
    'Example tone: "The Carolina Property is a well-positioned asset in a high-growth submarket, supported by strong location fundamentals and consistent demand. STORE Management’s disciplined execution enhances these advantages, driving tangible value creation and strengthening the property’s ability to capture and retain market share."',
    'Return only the final description text.',
  ].join(' ');
}

function normalizeAiDescription(value: string): string {
  return value.replace(/^["']|["']$/g, '').replace(/\s+/g, ' ').trim();
}

async function maybeGenerateSnapshotDescriptionWithAi(
  propertyName: string,
  propertyAddress: string,
  propertyType: string,
  region: string,
): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const model = process.env.OPENAI_MODEL ?? 'gpt-5.5';
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'system',
          content:
            'You write concise real-estate presentation copy. Follow the prompt exactly and never include raw numbers unless explicitly requested.',
        },
        {
          role: 'user',
          content: buildSnapshotDescriptionPrompt(propertyName, propertyAddress, propertyType, region),
        },
      ],
    }),
  });

  if (!response.ok) {
  const text = await response.text();
  console.error('Snapshot AI request failed', response.status, text);
  return null;
}

  const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content !== 'string') return null;
  const normalized = normalizeAiDescription(content);
  return normalized || null;
}

function sheetToMatrix(workbook: XLSX.WorkBook, sheetName: string): string[][] {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    throw new Error(`Unsupported workbook format: missing "${sheetName}" sheet.`);
  }
  return (XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' }) as unknown[][]).map((row) =>
    Array.isArray(row) ? row.map(cleanCell) : [],
  );
}

function sheetToOptionalMatrix(workbook: XLSX.WorkBook, sheetName: string): string[][] | null {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return null;
  return (XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' }) as unknown[][]).map((row) =>
    Array.isArray(row) ? row.map(cleanCell) : [],
  );
}

function findRowIndex(rows: string[][], matcher: (label: string, row: string[]) => boolean): number {
  return rows.findIndex((row) => matcher(firstNonEmpty(row), row));
}

function pairFromRow(row: string[], labelIndex: number, valueIndex: number): { label: string; value: string } | null {
  const label = row[labelIndex]?.trim() ?? '';
  const value = row[valueIndex]?.trim() ?? '';
  if (!label || !value) return null;
  return { label, value };
}

function parsePropertyDataSheet(rows: string[][]): {
  propertyName: string;
  propertyAddress: string;
  dealNumber: string;
  propertyType: string;
  values: Array<{ label: string; value: string }>;
} {
  const nonEmptyLines = rows.map(firstNonEmpty).filter(Boolean);
  const propertyName = nonEmptyLines[0] ?? '';
  const propertyAddress = nonEmptyLines[1] ?? '';

  let dealNumber = '';
  let propertyType = '';
  const values: Array<{ label: string; value: string }> = [];

  const storageIndex = findRowIndex(rows, (label) => normalizeLabel(label) === 'storage mini');
  const lockerIndex = findRowIndex(rows, (label) => normalizeLabel(label) === 'locker');
  const parkingIndex = findRowIndex(rows, (label) => normalizeLabel(label) === 'parking');
  const revenuesIndex = findRowIndex(rows, (label) => normalizeLabel(label) === 'revenues fees');

  for (const row of rows) {
    const leftPair = pairFromRow(row, 1, 3);
    const rightPair = pairFromRow(row, 6, 8);
    if (leftPair && normalizeLabel(leftPair.label) === 'deal no') {
      dealNumber = leftPair.value;
      continue;
    }
    if (leftPair && normalizeLabel(leftPair.label) === 'property type') {
      propertyType = leftPair.value;
      continue;
    }
    if (rightPair && normalizeLabel(rightPair.label) === 'property type') {
      propertyType = rightPair.value;
    }
  }

  if (storageIndex >= 0) {
    const endIndex =
      [lockerIndex, parkingIndex, revenuesIndex]
        .filter((index) => index > storageIndex)
        .sort((a, b) => a - b)[0] ?? rows.length;
    for (let rowIndex = storageIndex + 1; rowIndex < endIndex; rowIndex += 1) {
      const row = rows[rowIndex] ?? [];
      const leftPair = pairFromRow(row, 1, 3);
      const rightPair = pairFromRow(row, 6, 8);
      if (leftPair) values.push(leftPair);
      if (rightPair) values.push(rightPair);
    }
  }

  if (revenuesIndex >= 0) {
    for (let rowIndex = revenuesIndex + 1; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex] ?? [];
      const label = row[1]?.trim() ?? '';
      const value = lastNonEmpty(row);
      if (!label || !value || normalizeLabel(label) === normalizeLabel(value)) continue;
      values.push({ label, value });
    }
  }

  if (propertyType) {
    values.push({ label: 'Property Type', value: propertyType });
  }

  return {
    propertyName,
    propertyAddress,
    dealNumber,
    propertyType,
    values,
  };
}

function parseMultiColumnSheet(
  rows: string[][],
  headerRegex: RegExp,
  minHeaderMatches = 2,
): {
  columns: Array<{ index: number; label: string }>;
  values: SheetValueRow[];
} {
  const headerRowIndex = rows.findIndex((row) => row.filter((value) => headerRegex.test(value)).length >= minHeaderMatches);
  if (headerRowIndex < 0) {
    throw new Error('Unsupported workbook format: unable to locate summary/model headers.');
  }

  const headerRow = rows[headerRowIndex] ?? [];
  const columns = headerRow
    .map((value, index) => ({ index, label: value }))
    .filter((entry) => headerRegex.test(entry.label))
    .slice(0, MONTH_TOKEN_COUNT);

  const values: SheetValueRow[] = [];
  let currentSection = '';
  for (let rowIndex = headerRowIndex + 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] ?? [];
    const label = lastNonEmptyBefore(row, columns[0]?.index ?? row.length);
    const rowValues = columns.map((column) => row[column.index]?.trim() ?? '');
    const hasValues = rowValues.some((value) => value.length > 0);
    if (!label) continue;
    if (!hasValues) {
      currentSection = label;
      continue;
    }
    values.push({ label, values: rowValues, rawSection: currentSection });
  }

  return { columns, values };
}

function rowEntries(row: string[]): string[] {
  return row.map((value) => value.trim()).filter(Boolean);
}

function findValueForLabel(rows: string[][], labels: string[], strategy: 'first' | 'last' = 'last'): string {
  const labelSet = new Set(labels.map(normalizeLabel));
  for (const row of rows) {
    const entries = rowEntries(row);
    if (entries.length < 2) continue;
    for (let index = 0; index < entries.length - 1; index += 1) {
      if (!labelSet.has(normalizeLabel(entries[index] ?? ''))) continue;
      const candidates = entries.slice(index + 1).filter((entry) => entry.trim().length > 0);
      const value = strategy === 'first' ? candidates[0] : candidates[candidates.length - 1];
      if (value) return value;
    }
  }
  return '';
}

function collectKnownLabelValues(
  rows: string[][],
  labels: string[],
  strategy: 'first' | 'last' = 'last',
): Array<{ label: string; value: string }> {
  const values: Array<{ label: string; value: string }> = [];
  for (const label of labels) {
    const value = findValueForLabel(rows, [label], strategy);
    if (value) values.push({ label, value });
  }
  return values;
}

function parseSingleValueSectionSheet(rows: string[][]): Array<{ label: string; value: string; rawSection: string }> {
  const values: Array<{ label: string; value: string; rawSection: string }> = [];
  let currentSection = '';
  for (const row of rows) {
    const entries = row.map((value) => value.trim()).filter(Boolean);
    if (entries.length === 1) {
      currentSection = entries[0];
      continue;
    }
    if (entries.length < 2) continue;
    const value = entries[entries.length - 1] ?? '';
    const label = entries.slice(0, -1).join(' ').trim();
    if (!label || !value) continue;
    values.push({ label, value, rawSection: currentSection });
  }
  return values;
}

function normalizeSection(value: string): InternalTokenSection {
  const normalized = normalizeLabel(value);
  if (!normalized) return 'manualNarrative';
  if (normalized.includes('stabilized')) return 'stabilizedSummary';
  if (normalized.includes('revenue') || normalized.includes('expense') || normalized.includes('fees')) {
    return 'operatingMetrics';
  }
  return 'stabilizedSummary';
}

function mapInternalSection(section: InternalTokenSection): PropertyAnalysisTokenSection {
  switch (section) {
    case 'propertyProfile':
      return 'marketSnapshot';
    case 'incomeProforma':
      return 'incomeProforma';
    case 'expenseProforma':
      return 'expenseProforma';
    case 'dealEconomics':
      return 'dealEconomics';
    case 'exitSensitivity':
      return 'exitSensitivity';
    case 'operatingMetrics':
    case 'stabilizedSummary':
      return 'returnProfile';
    default:
      return 'manualInputs';
  }
}

function findTemplateResolvedValue(
  defaults: Map<string, ExtractedTokenRecord>,
  token: string,
): { definition: PackageTokenDefinition | null; resolved: ExtractedTokenRecord | null } {
  const normalized = normalizeTokenKey(token);
  if (!normalized) {
    return { definition: null, resolved: null };
  }

  const definition = PACKAGE_TOKEN_DEFINITIONS[normalized] ?? null;
  if (definition) {
    for (const alias of definition.aliases) {
      const aliasKey = normalizeTokenKey(alias);
      if (!aliasKey) continue;
      const resolved = defaults.get(aliasKey);
      if (resolved) {
        return { definition, resolved };
      }
    }
    return { definition, resolved: null };
  }

  return { definition: null, resolved: defaults.get(normalized) ?? null };
}

function buildTokenField(token: string, defaults: Map<string, ExtractedTokenRecord>): PropertyAnalysisTokenField {
  const { definition, resolved } = findTemplateResolvedValue(defaults, token);
  return {
    token,
    label: definition?.label ?? resolved?.label ?? humanizeToken(token),
    value: resolved?.value ?? '',
    defaultValue: resolved?.value ?? '',
    section: definition?.section ?? (resolved ? mapInternalSection(resolved.section) : 'manualInputs'),
    source: resolved?.source ?? 'manual',
    matchedKey: resolved?.matchedKey ?? null,
  };
}

function registerValue(
  map: Map<string, ExtractedTokenRecord>,
  aliases: string[],
  record: Omit<ExtractedTokenRecord, 'matchedKey'>,
): void {
  for (const alias of aliases) {
    const normalized = normalizeTokenKey(alias);
    if (!normalized || map.has(normalized)) continue;
    map.set(normalized, {
      ...record,
      matchedKey: normalized,
    });
  }
}

function setRegisteredValue(
  map: Map<string, ExtractedTokenRecord>,
  alias: string,
  record: Omit<ExtractedTokenRecord, 'matchedKey'>,
): void {
  setResolvedValue(map, alias, { ...record });
}

function setResolvedValue(
  map: Map<string, ExtractedTokenRecord>,
  alias: string,
  record: Omit<ExtractedTokenRecord, 'matchedKey'> & { matchedKey?: string },
): void {
  const normalized = normalizeTokenKey(alias);
  if (!normalized) return;
  map.set(normalized, {
    ...record,
    matchedKey: record.matchedKey ?? normalized,
  });
}

function findRowIndexByColumnValue(
  rows: string[][],
  columnIndex: number,
  label: string,
  options?: { startRow?: number; endRow?: number },
): number {
  const target = normalizeLabel(label);
  const start = options?.startRow ?? 0;
  const end = Math.min(options?.endRow ?? rows.length - 1, rows.length - 1);

  for (let rowIndex = start; rowIndex <= end; rowIndex += 1) {
    const candidate = normalizeLabel(rows[rowIndex]?.[columnIndex] ?? '');
    if (candidate && candidate === target) return rowIndex;
  }

  return -1;
}

function findBestRowIndexByColumnValue(
  rows: string[][],
  columnIndex: number,
  label: string,
  options?: { startRow?: number; endRow?: number; preferredValueColumns?: number[] },
): number {
  const target = normalizeLabel(label);
  const start = options?.startRow ?? 0;
  const end = Math.min(options?.endRow ?? rows.length - 1, rows.length - 1);
  const matches: number[] = [];

  for (let rowIndex = start; rowIndex <= end; rowIndex += 1) {
    const candidate = normalizeLabel(rows[rowIndex]?.[columnIndex] ?? '');
    if (!candidate || candidate !== target) continue;
    matches.push(rowIndex);
  }

  if (!matches.length) return -1;
  const preferredValueColumns = options?.preferredValueColumns ?? [];
  if (!preferredValueColumns.length) {
    return matches[matches.length - 1] ?? -1;
  }

  for (const rowIndex of matches) {
    if (hasValuesInColumns(rows, rowIndex, preferredValueColumns)) {
      return rowIndex;
    }
  }

  return matches[matches.length - 1] ?? -1;
}

function readMatrixCell(rows: string[][], rowIndex: number, columnIndex: number): string {
  return cleanCell(rows[rowIndex]?.[columnIndex] ?? '');
}

function resolveMatrixColumnValue(
  rows: string[][],
  rowIndex: number,
  column: MatrixColumnSpec,
): { value: string; matchedColumnIndex: number } {
  const primaryValue = readMatrixCell(rows, rowIndex, column.index);
  if (primaryValue) {
    return { value: primaryValue, matchedColumnIndex: column.index };
  }

  for (const fallbackIndex of column.fallbackIndices ?? []) {
    const fallbackValue = readMatrixCell(rows, rowIndex, fallbackIndex);
    if (!fallbackValue) continue;
    return { value: fallbackValue, matchedColumnIndex: fallbackIndex };
  }

  return { value: '', matchedColumnIndex: column.index };
}

function addMatrixRowTokenSpec(
  map: Map<string, ExtractedTokenRecord>,
  warnings: string[],
  rows: string[][],
  spec: MatrixRowTokenSpec,
): void {
  if (spec.tokenNumbers.length !== spec.columns.length) {
    warnings.push(
      `${spec.sheetName}: token/column count mismatch for ${spec.label} (${spec.tokenNumbers.length} tokens, ${spec.columns.length} columns).`,
    );
    return;
  }

  const rowIndex = findRowIndexByColumnValue(rows, spec.labelColumnIndex, spec.sourceRow);
  if (rowIndex < 0) {
    warnings.push(`${spec.sheetName}: unable to locate row "${spec.sourceRow}" for slide mapping.`);
    return;
  }

  spec.tokenNumbers.forEach((tokenNumber, index) => {
    const column = spec.columns[index];
    const { value: resolvedValue, matchedColumnIndex } = resolveMatrixColumnValue(rows, rowIndex, column);
    const rawValue = resolvedValue;
    const value = column.formatter ? column.formatter(rawValue) : rawValue;
    setResolvedValue(map, buildCellToken(tokenNumber), {
      label: `${spec.label} / ${column.label}`,
      value,
      section: spec.section,
      source: 'extracted',
      matchedKey: `${spec.sheetName}!R${rowIndex + 1}C${matchedColumnIndex + 1}`,
    });
  });
}

function addPropertyAliases(map: Map<string, ExtractedTokenRecord>, label: string, value: string): void {
  const tokenBase = tokenBaseFromLabel(label);
  if (!tokenBase || !value) return;
  registerValue(
    map,
    [tokenBase, `PROPERTY_${tokenBase}`],
    {
      label,
      value,
      section: 'propertyProfile',
      source: 'extracted',
    },
  );
}

function addArrayAliases(
  map: Map<string, ExtractedTokenRecord>,
  prefix: 'YEAR' | 'MONTH',
  values: SheetValueRow[],
  section: InternalTokenSection,
): void {
  for (const entry of values) {
    const tokenBase = tokenBaseFromLabel(entry.label);
    if (!tokenBase) continue;
    entry.values.forEach((value, index) => {
      if (!value) return;
      const ordinal = index + 1;
      const aliases =
        prefix === 'YEAR'
          ? [`YEAR_${ordinal}_${tokenBase}`, `SUMMARY_YEAR_${ordinal}_${tokenBase}`]
          : [`MONTH_${ordinal}_${tokenBase}`, `MODEL_MONTH_${ordinal}_${tokenBase}`];
      registerValue(
        map,
        aliases,
        {
          label: `${entry.label} ${prefix === 'YEAR' ? `Year ${ordinal}` : `Month ${ordinal}`}`,
          value,
          section,
          source: 'extracted',
        },
      );
    });
  }
}

function addSingleValueAliases(
  map: Map<string, ExtractedTokenRecord>,
  prefix: string,
  values: Array<{ label: string; value: string; rawSection: string }>,
): void {
  for (const entry of values) {
    const tokenBase = tokenBaseFromLabel(entry.label);
    if (!tokenBase || !entry.value) continue;
    registerValue(
      map,
      [`${prefix}_${tokenBase}`],
      {
        label: entry.label,
        value: entry.value,
        section: normalizeSection(entry.rawSection),
        source: 'extracted',
      },
    );
  }
}

function addDerivedValues(
  map: Map<string, ExtractedTokenRecord>,
  propertyName: string,
  propertyAddress: string,
  dealNumber: string,
  propertyValues: Array<{ label: string; value: string }>,
  summaryValues: SheetValueRow[],
  stabilizedValues: Array<{ label: string; value: string; rawSection: string }>,
): void {
  const now = new Date();
  registerValue(
    map,
    ['PROPERTY_NAME', 'PROPERTY_TITLE', 'FACILITY_NAME', 'PROPERTYDISPLAYNAME'],
    {
      label: 'Property Name',
      value: propertyName,
      section: 'propertyProfile',
      source: 'extracted',
    },
  );
  registerValue(
    map,
    ['PROPERTY_ADDRESS', 'ADDRESS'],
    {
      label: 'Property Address',
      value: propertyAddress,
      section: 'propertyProfile',
      source: 'extracted',
    },
  );
  registerValue(
    map,
    ['DEAL_NUMBER', 'DEAL_NO'],
    {
      label: 'Deal Number',
      value: dealNumber,
      section: 'propertyProfile',
      source: 'extracted',
    },
  );
  registerValue(
    map,
    ['REPORT_MONTH_YEAR', 'CONFIDENTIAL_DATE', 'PACKAGE_MONTH_YEAR'],
    {
      label: 'Report Month',
      value: formatMonthYear(now),
      section: 'manualNarrative',
      source: 'derived',
    },
  );
  registerValue(
    map,
    ['REPORT_DATE', 'AS_OF_DATE'],
    {
      label: 'Report Date',
      value: formatIsoDate(now),
      section: 'manualNarrative',
      source: 'derived',
    },
  );

  const propertyLookup = new Map(propertyValues.map((entry) => [normalizeLabel(entry.label), entry.value]));
  const summaryLookup = new Map(summaryValues.map((entry) => [normalizeLabel(entry.label), entry.values]));
  const stabilizedLookup = new Map(stabilizedValues.map((entry) => [normalizeLabel(entry.label), entry.value]));

  const squareFeet = propertyLookup.get('net rentable square feet') ?? propertyLookup.get('nrsf');
  if (squareFeet) {
    registerValue(
      map,
      ['RENTABLE_SQFT', 'NET_RENTABLE_SQFT'],
      {
        label: 'Rentable SqFt',
        value: squareFeet,
        section: 'propertyProfile',
        source: 'extracted',
      },
    );
  }

  const units = propertyLookup.get('number of units') ?? propertyLookup.get('units available');
  if (units) {
    registerValue(
      map,
      ['TOTAL_UNITS', 'NUMBER_OF_UNITS'],
      {
        label: 'Total Units',
        value: units,
        section: 'propertyProfile',
        source: 'extracted',
      },
    );
  }

  const occupancy =
    propertyLookup.get('current sq ft occupancy') ??
    propertyLookup.get('occupancy') ??
    (() => {
      const occupied = parseNumberLike(propertyLookup.get('units occupied') ?? '');
      const available = parseNumberLike(propertyLookup.get('units available') ?? '');
      if (occupied === null || available === null || available === 0) return null;
      return formatPercent((occupied / available) * 100);
    })();
  if (occupancy !== null && occupancy !== '') {
    const hasExplicitOccupancy =
      propertyLookup.has('current sq ft occupancy') || propertyLookup.has('occupancy');
    registerValue(
      map,
      ['PROPERTY_OCCUPANCY', 'CURRENT_OCCUPANCY', 'OCCUPANCY'],
      {
        label: 'Current Occupancy',
        value: occupancy,
        section: 'propertyProfile',
        source: hasExplicitOccupancy ? 'extracted' : 'derived',
      },
    );
  }

  const marketRate =
    propertyLookup.get('monthly market rate per sq ft') ??
    propertyLookup.get('projected rate sqft') ??
    propertyLookup.get('projected rate');
  if (marketRate) {
    registerValue(
      map,
      ['MARKET_RATE_PSF', 'MONTHLY_MARKET_RATE_PSF'],
      {
        label: 'Market Rate / SqFt',
        value: marketRate,
        section: 'propertyProfile',
        source: 'extracted',
      },
    );
  }

  const projectedRate =
    propertyLookup.get('monthly projected rate per sq ft') ??
    propertyLookup.get('projected rate sqft') ??
    propertyLookup.get('projected rate');
  if (projectedRate) {
    registerValue(
      map,
      ['PROJECTED_RATE_PSF', 'MONTHLY_PROJECTED_RATE_PSF'],
      {
        label: 'Projected Rate / SqFt',
        value: projectedRate,
        section: 'propertyProfile',
        source: 'extracted',
      },
    );
  }

  const stabilizedRevenue = stabilizedLookup.get('total revenue');
  if (stabilizedRevenue) {
    registerValue(
      map,
      ['STABILIZED_TOTAL_REVENUE'],
      {
        label: 'Stabilized Total Revenue',
        value: stabilizedRevenue,
        section: 'stabilizedSummary',
        source: 'extracted',
      },
    );
  }

  const stabilizedFees = stabilizedLookup.get('total contractually set fees');
  const stabilizedOtherExpenses = stabilizedLookup.get('total other expenses');
  const revenueNumeric = stabilizedRevenue ? parseNumberLike(stabilizedRevenue) : null;
  const feesNumeric = stabilizedFees ? parseNumberLike(stabilizedFees) : null;
  const otherExpensesNumeric = stabilizedOtherExpenses ? parseNumberLike(stabilizedOtherExpenses) : null;
  if (revenueNumeric !== null && feesNumeric !== null && otherExpensesNumeric !== null) {
    registerValue(
      map,
      ['STABILIZED_NOI', 'STABILIZED_NET_OPERATING_INCOME'],
      {
        label: 'Stabilized NOI',
        value: formatCurrency(revenueNumeric - feesNumeric - otherExpensesNumeric),
        section: 'stabilizedSummary',
        source: 'derived',
      },
    );
  }

  const summaryRevenue = summaryLookup.get('total revenue') ?? summaryLookup.get('total operating income');
  const summaryFees = summaryLookup.get('total contractually set fees');
  if (summaryRevenue && summaryFees) {
    for (let index = 0; index < Math.min(summaryRevenue.length, summaryFees.length); index += 1) {
      const revenue = parseNumberLike(summaryRevenue[index] ?? '');
      const fees = parseNumberLike(summaryFees[index] ?? '');
      if (revenue === null || fees === null) continue;
      registerValue(
        map,
        [`YEAR_${index + 1}_TOTAL_REVENUE_LESS_FEES`],
        {
          label: `Year ${index + 1} Revenue Less Fees`,
          value: formatCurrency(revenue - fees),
          section: 'stabilizedSummary',
          source: 'derived',
        },
      );
    }
  }

  const yearlyOccupancy = summaryLookup.get('year end projected sq ft occupancy');
  if (yearlyOccupancy?.[0]) {
    registerValue(
      map,
      ['THREE_YEAR_HOLD_OCCUPANCY'],
      {
        label: '3-Year Hold Occupancy',
        value: yearlyOccupancy[Math.min(2, yearlyOccupancy.length - 1)],
        section: 'stabilizedSummary',
        source: 'derived',
      },
    );
  }

  const marketGrowth = propertyLookup.get('projected market rent growth annually');
  if (marketGrowth) {
    const growth = parseNumberLike(marketGrowth);
    if (growth !== null) {
      registerValue(
        map,
        ['PROJECTED_MARKET_RENT_GROWTH', 'MARKET_RENT_GROWTH'],
        {
          label: 'Projected Market Rent Growth',
          value: marketGrowth.includes('%') ? marketGrowth : formatPercent(growth),
          section: 'propertyProfile',
          source: 'extracted',
        },
      );
    }
  }

  const snapshotDescription = buildSnapshotDescription(
    propertyName,
    propertyAddress,
    propertyLookup.get('property type') ?? '',
  );
  if (snapshotDescription) {
    registerValue(
      map,
      ['SNAPSHOT_DESCRIPTION'],
      {
        label: 'Snapshot Description',
        value: snapshotDescription,
        section: 'propertyProfile',
        source: 'derived',
      },
    );
  }

  const region = mapStateToRegion(parseAddressLocation(propertyAddress).state);
  if (region) {
    registerValue(
      map,
      ['REGION_NAME'],
      {
        label: 'Region',
        value: region,
        section: 'stabilizedSummary',
        source: 'derived',
      },
    );
  }
}

function addPublicHoldPeriodReturnAliases(
  map: Map<string, ExtractedTokenRecord>,
  valuationRows: string[][],
): string[] {
  const warnings: string[] = [];
  const headerRowIndex = valuationRows.findIndex((row) => {
    const labels = row.map(normalizeLabel);
    return labels.includes('3 year hold') && labels.includes('5 year hold') && labels.includes('7 year hold');
  });

  if (headerRowIndex < 0) {
    warnings.push('Valuation Sheet is missing the 3/5/7-Year Hold comparison header.');
    return warnings;
  }

  const headerRow = valuationRows[headerRowIndex] ?? [];
  const holdColumns = [
    { years: 3, index: headerRow.findIndex((value) => normalizeLabel(value) === '3 year hold') },
    { years: 5, index: headerRow.findIndex((value) => normalizeLabel(value) === '5 year hold') },
    { years: 7, index: headerRow.findIndex((value) => normalizeLabel(value) === '7 year hold') },
  ];

  if (holdColumns.some((column) => column.index < 0)) {
    warnings.push('Valuation Sheet is missing one or more hold-period comparison columns.');
    return warnings;
  }

  const leveredIrrRow = valuationRows.find((row) => normalizeLabel(firstNonEmpty(row)) === 'levered irr');
  const equityMultipleRow = valuationRows.find((row) => normalizeLabel(firstNonEmpty(row)) === 'equity multiple');

  if (!leveredIrrRow) {
    warnings.push('Valuation Sheet is missing the Levered IRR row for hold-period returns.');
  }
  if (!equityMultipleRow) {
    warnings.push('Valuation Sheet is missing the Equity Multiple row for hold-period returns.');
  }

  for (const { years, index } of holdColumns) {
    const irrValue = leveredIrrRow?.[index]?.trim() ?? '';
    const multipleValue = equityMultipleRow?.[index]?.trim() ?? '';

    if (irrValue) {
      registerValue(
        map,
        [`LEVERED_IRR_${years}_YEAR`],
        {
          label: `${years}-Year Hold IRR`,
          value: irrValue,
          section: 'stabilizedSummary',
          source: 'extracted',
        },
      );
    } else {
      warnings.push(`Valuation Sheet is missing the ${years}-year Levered IRR value.`);
    }

    if (multipleValue) {
      registerValue(
        map,
        [`LEVERED_EQUITY_MULTIPLE_${years}_YEAR`],
        {
          label: `${years}-Year Hold Equity Multiple`,
          value: multipleValue,
          section: 'stabilizedSummary',
          source: 'extracted',
        },
      );
    } else {
      warnings.push(`Valuation Sheet is missing the ${years}-year Equity Multiple value.`);
    }
  }

  return warnings;
}

function addPublicComparisonCalloutAliases(
  map: Map<string, ExtractedTokenRecord>,
  proformaRows: string[][] | null,
  proformaLayout: PublicProformaLayout | null,
  inputsRows: string[][],
): string[] {
  const warnings: string[] = [];
  if (!proformaRows || !proformaLayout) {
    warnings.push('Proforma sheet is missing comparison rows for revenue, expense, and NOI callouts.');
    return warnings;
  }

  const exitCapRaw = findValueForLabel(inputsRows, ['Exit Cap Rate']);
  const exitCapValue = parseNumberLike(exitCapRaw);
  const exitCapRate = exitCapValue === null ? null : exitCapValue > 1 ? exitCapValue / 100 : exitCapValue;
  if (exitCapRate === null || exitCapRate === 0) {
    warnings.push('Inputs & Drivers is missing a usable Exit Cap Rate for Asset Value Added.');
  }

  const summaryValues = extractPublicProformaSummaryValues(proformaRows, proformaLayout, warnings);
  if (!summaryValues) {
    return warnings;
  }

  console.info('[property-analysis-package] extracted proforma summary values', {
    totalOperatingIncomeT12: formatPublicMetricLogValue(summaryValues.totalOperatingIncome.t12),
    totalOperatingIncomeYear1: formatPublicMetricLogValue(summaryValues.totalOperatingIncome.year1),
    totalOperatingExpenseT12: formatPublicMetricLogValue(summaryValues.totalOperatingExpense.t12),
    totalOperatingExpenseYear1: formatPublicMetricLogValue(summaryValues.totalOperatingExpense.year1),
    netOperatingIncomeT12: formatPublicMetricLogValue(summaryValues.netOperatingIncome.t12),
    netOperatingIncomeYear1: formatPublicMetricLogValue(summaryValues.netOperatingIncome.year1),
  });

  setResolvedValue(map, 'PROFORMA_T12_TOTAL_OPERATING_INCOME', {
    label: 'Proforma T-12 Total Operating Income',
    value: summaryValues.totalOperatingIncome.t12.displayValue,
    section: 'stabilizedSummary',
    source: 'extracted',
    matchedKey: summaryValues.totalOperatingIncome.t12.matchedKey,
  });
  setResolvedValue(map, 'PROFORMA_YEAR1_TOTAL_OPERATING_INCOME', {
    label: 'Proforma Year 1 Total Operating Income',
    value: summaryValues.totalOperatingIncome.year1.displayValue,
    section: 'stabilizedSummary',
    source: 'extracted',
    matchedKey: summaryValues.totalOperatingIncome.year1.matchedKey,
  });
  setResolvedValue(map, 'PROFORMA_T12_TOTAL_OPERATING_EXPENSE', {
    label: 'Proforma T-12 Total Operating Expense',
    value: summaryValues.totalOperatingExpense.t12.displayValue,
    section: 'stabilizedSummary',
    source: 'extracted',
    matchedKey: summaryValues.totalOperatingExpense.t12.matchedKey,
  });
  setResolvedValue(map, 'PROFORMA_YEAR1_TOTAL_OPERATING_EXPENSE', {
    label: 'Proforma Year 1 Total Operating Expense',
    value: summaryValues.totalOperatingExpense.year1.displayValue,
    section: 'stabilizedSummary',
    source: 'extracted',
    matchedKey: summaryValues.totalOperatingExpense.year1.matchedKey,
  });
  setResolvedValue(map, 'PROFORMA_T12_NET_OPERATING_INCOME', {
    label: 'Proforma T-12 Net Operating Income',
    value: summaryValues.netOperatingIncome.t12.displayValue,
    section: 'stabilizedSummary',
    source: 'extracted',
    matchedKey: summaryValues.netOperatingIncome.t12.matchedKey,
  });
  setResolvedValue(map, 'PROFORMA_YEAR1_NET_OPERATING_INCOME', {
    label: 'Proforma Year 1 Net Operating Income',
    value: summaryValues.netOperatingIncome.year1.displayValue,
    section: 'stabilizedSummary',
    source: 'extracted',
    matchedKey: summaryValues.netOperatingIncome.year1.matchedKey,
  });

  const revenueLift =
    summaryValues.totalOperatingIncome.year1.numericValue - summaryValues.totalOperatingIncome.t12.numericValue;
  const expenseChangePercent =
    ((summaryValues.totalOperatingExpense.year1.numericValue - summaryValues.totalOperatingExpense.t12.numericValue) /
      summaryValues.totalOperatingExpense.t12.numericValue) *
    100;
  const noiDelta = summaryValues.netOperatingIncome.year1.numericValue - summaryValues.netOperatingIncome.t12.numericValue;
  const noiIncreasePercent =
    (noiDelta / summaryValues.netOperatingIncome.t12.numericValue) * 100;

  console.info('[property-analysis-package] computed summary metrics', {
    revenueLift,
    expenseChangePercent,
    noiIncreasePercent,
    assetValueAdded: exitCapRate ? noiDelta / exitCapRate : null,
  });

  registerValue(
    map,
    ['REVENUE_LIFT_THOUSANDS'],
    {
      label: 'Revenue Lift',
      value: formatThousandsToken(revenueLift),
      section: 'stabilizedSummary',
      source: 'derived',
    },
  );

  registerValue(
    map,
    ['EXPENSE_REDUCTION_PERCENT'],
    {
      label: 'Expense Change',
      value: formatWholePercentWithSymbol(expenseChangePercent),
      section: 'stabilizedSummary',
      source: 'derived',
    },
  );

  registerValue(
    map,
    ['NOI_INCREASE_PERCENT'],
    {
      label: 'NOI Increase',
      value: formatWholePercentToken(noiIncreasePercent),
      section: 'stabilizedSummary',
      source: 'derived',
    },
  );

  if (exitCapRate !== null && exitCapRate !== 0) {
    registerValue(
      map,
      ['ASSET_VALUE_ADDED'],
      {
        label: 'Asset Value Added',
        value: formatMillionsToken(noiDelta / exitCapRate),
        section: 'stabilizedSummary',
        source: 'derived',
      },
    );
  }

  return warnings;
}

function extractPublicProformaSummaryValues(
  proformaRows: string[][],
  proformaLayout: PublicProformaLayout,
  warnings: string[],
): PublicProformaSummaryValues | null {
  const summarySpecs: Array<{
    key: PublicProformaSummaryMetricKey;
    rowLabel: string;
    label: string;
  }> = [
    {
      key: 'totalOperatingIncome',
      rowLabel: 'Total Operating Income',
      label: 'Total Operating Income',
    },
    {
      key: 'totalOperatingExpense',
      rowLabel: 'Total Operating Expense',
      label: 'Total Operating Expense',
    },
    {
      key: 'netOperatingIncome',
      rowLabel: 'Net Operating Income',
      label: 'Net Operating Income',
    },
  ];

  const extracted = {} as PublicProformaSummaryValues;

  for (const spec of summarySpecs) {
    const rowIndex = findRowIndexByColumnValue(proformaRows, proformaLayout.labelColumnIndex, spec.rowLabel);
    if (rowIndex < 0) {
      warnings.push(`Proforma sheet is missing the ${spec.label} summary row.`);
      return null;
    }

    const t12DisplayValue = readMatrixCell(proformaRows, rowIndex, proformaLayout.t12.index);
    const year1DisplayValue = readMatrixCell(proformaRows, rowIndex, proformaLayout.store.index);
    const t12NumericValue = parseNumberLike(t12DisplayValue);
    const year1NumericValue = parseNumberLike(year1DisplayValue);

    if (t12NumericValue === null) {
      warnings.push(`Proforma sheet is missing a usable T-12 value for ${spec.label}.`);
      return null;
    }

    if (year1NumericValue === null) {
      warnings.push(`Proforma sheet is missing a usable Year 1 / STORE value for ${spec.label}.`);
      return null;
    }

    extracted[spec.key] = {
      label: spec.label,
      t12: {
        displayValue: t12DisplayValue,
        numericValue: t12NumericValue,
        matchedKey: `Proforma!R${rowIndex + 1}C${proformaLayout.t12.index + 1}`,
      },
      year1: {
        displayValue: year1DisplayValue,
        numericValue: year1NumericValue,
        matchedKey: `Proforma!R${rowIndex + 1}C${proformaLayout.store.index + 1}`,
      },
    };
  }

  return extracted;
}

function addDirectCellToken(
  map: Map<string, ExtractedTokenRecord>,
  token: string,
  label: string,
  section: InternalTokenSection,
  sheetName: string,
  rowIndex: number,
  columnIndex: number,
  rows: string[][],
  formatter?: (value: string) => string,
): void {
  const rawValue = readMatrixCell(rows, rowIndex, columnIndex);
  const value = formatter ? formatter(rawValue) : rawValue;
  setResolvedValue(map, token, {
    label,
    value,
    section,
    source: 'extracted',
    matchedKey: `${sheetName}!R${rowIndex + 1}C${columnIndex + 1}`,
  });
}

function addPublicProformaSlideMappings(
  map: Map<string, ExtractedTokenRecord>,
  proformaRows: string[][],
  proformaLayout: PublicProformaLayout | null,
): string[] {
  const warnings: string[] = [];
  if (!proformaLayout) {
    warnings.push('Proforma sheet is missing recognizable direct table rows for slides 4 and 5.');
    return warnings;
  }
  for (const spec of buildPublicProformaMatrixRowSpecs(proformaLayout, [...SLIDE4_PROFORMA_SPECS, ...SLIDE5_PROFORMA_SPECS])) {
    addMatrixRowTokenSpec(map, warnings, proformaRows, spec);
  }
  return warnings;
}

function addPublicSlide6Mappings(
  map: Map<string, ExtractedTokenRecord>,
  valuationRows: string[][],
  inputsRows: string[][],
  acquisitionReturnsRows: string[][] | null,
  exitSensitivityRows: string[][] | null,
): string[] {
  const warnings: string[] = [];

  const keyMetricSpecs: KeyMetricSpec[] = [
    { token: 'CELL0490', label: 'Purchase Price', sourceLabel: 'Purchase Price' },
    { token: 'CELL0491', label: 'Going-In Cap Rate', sourceLabel: 'Going-In Cap Rate' },
    { token: 'CELL0493', label: 'All-In Interest Rate', sourceLabel: 'All-In Interest Rate (SOFR+220bps)' },
    { token: 'CELL0494', label: 'LTC', sourceLabel: 'LTC' },
    { token: 'CELL0495', label: 'Loan Amount', sourceLabel: 'Loan Amount' },
    { token: 'CELL0496', label: 'Equity Required', sourceLabel: 'Equity Required' },
    { token: 'CELL0497', label: 'Total CapEx', sourceLabel: 'Total CapEx' },
    { token: 'CELL0498', label: 'NRSF', sourceLabel: 'NRSF' },
    { token: 'CELL0499', label: 'Price / SqFt', sourceLabel: 'Price / SqFt' },
    { token: 'CELL0500', label: 'Asset Mgmt Fee', sourceLabel: 'Asset Mgmt Fee' },
  ];

  for (const spec of keyMetricSpecs) {
    const rowIndex = findRowIndexByColumnValue(
      valuationRows,
      VALUATION_KEY_METRIC_LABEL_COLUMN_INDEX,
      spec.sourceLabel,
      { startRow: 0, endRow: 25 },
    );
    if (rowIndex < 0) {
      warnings.push(`Valuation Sheet: unable to locate key metric "${spec.sourceLabel}".`);
      continue;
    }
    addDirectCellToken(
      map,
      spec.token,
      spec.label,
      'dealEconomics',
      'Valuation Sheet',
      rowIndex,
      VALUATION_KEY_METRIC_VALUE_COLUMN_INDEX,
      valuationRows,
    );
  }

  const spreadBps = resolveSpreadBasisPoints(inputsRows, exitSensitivityRows);
  if (!spreadBps) {
    warnings.push('Inputs & Drivers: unable to locate "Spread" for slide 6.');
  } else {
    setResolvedValue(map, 'CELL0492', {
      label: 'Spread (bps)',
      value: spreadBps.value,
      section: 'dealEconomics',
      source: 'extracted',
      matchedKey: spreadBps.matchedKey,
    });
  }

  const debtServiceSeries: DirectRowSeriesSpec[] = [
    { rowLabel: 'Beginning Balance', tokenStart: 506, label: 'Beginning Balance' },
    { rowLabel: 'Annual Debt Service', tokenStart: 511, label: 'Annual Debt Service' },
    { rowLabel: 'Interest Portion', tokenStart: 516, label: 'Interest Portion' },
    { rowLabel: 'Principal Portion', tokenStart: 521, label: 'Principal Portion' },
    { rowLabel: 'DSCR', tokenStart: 526, label: 'DSCR', formatter: stripTrailingX },
    { rowLabel: 'Ending Balance', tokenStart: 531, label: 'Ending Balance' },
  ];

  for (const series of debtServiceSeries) {
    const rowIndex = findRowIndexByColumnValue(valuationRows, VALUATION_LABEL_COLUMN_INDEX, series.rowLabel, {
      startRow: 12,
      endRow: 24,
    });
    if (rowIndex < 0) {
      warnings.push(`Valuation Sheet: unable to locate debt service row "${series.rowLabel}".`);
      continue;
    }
    for (let yearOffset = 0; yearOffset < 5; yearOffset += 1) {
      addDirectCellToken(
        map,
        buildCellToken(series.tokenStart + yearOffset),
        `Debt Service / ${series.label} / Year ${yearOffset + 1}`,
        'dealEconomics',
        'Valuation Sheet',
        rowIndex,
        yearOffset + 1,
        valuationRows,
        series.formatter,
      );
    }
  }

  const cashFlowSeries: DirectRowSeriesSpec[] = [
    { rowLabel: 'Net Operating Income', tokenStart: 541, label: 'Net Operating Income' },
    { rowLabel: 'Less: CapEx', tokenStart: 546, label: 'Less: CapEx' },
    { rowLabel: 'Less: Debt Service', tokenStart: 551, label: 'Less: Debt Service', formatter: stripOuterParens },
    { rowLabel: 'Less: Asset Mgmt Fee', tokenStart: 556, label: 'Less: Asset Mgmt Fee', formatter: stripOuterParens },
    { rowLabel: 'Levered Cash Flow', tokenStart: 561, label: 'Levered Cash Flow' },
  ];

  for (const series of cashFlowSeries) {
    const valuationColumnIndices = Array.from({ length: 5 }, (_, index) => index + 1);
    const rowIndex = findBestRowIndexByColumnValue(valuationRows, VALUATION_LABEL_COLUMN_INDEX, series.rowLabel, {
      startRow: 22,
      endRow: 35,
      preferredValueColumns: valuationColumnIndices,
    });
    const useValuationSheet = rowIndex >= 0 && hasValuesInColumns(valuationRows, rowIndex, valuationColumnIndices);
    if (useValuationSheet) {
      for (let yearOffset = 0; yearOffset < 5; yearOffset += 1) {
        addDirectCellToken(
          map,
          buildCellToken(series.tokenStart + yearOffset),
          `Cash Flow / ${series.label} / Year ${yearOffset + 1}`,
          'dealEconomics',
          'Valuation Sheet',
          rowIndex,
          yearOffset + 1,
          valuationRows,
          series.formatter,
        );
      }
      continue;
    }

    if (series.rowLabel === 'Levered Cash Flow') {
      const acquisitionRow = findRowLabelInColumns(acquisitionReturnsRows, [series.rowLabel], [0, 1, 2], {
        startRow: 0,
        endRow: 60,
      });
      const fallbackValues =
        acquisitionRow && acquisitionReturnsRows
          ? collectValueCellsToRight(acquisitionReturnsRows[acquisitionRow.rowIndex] ?? [], acquisitionRow.labelColumnIndex, 5)
          : [];

      if (acquisitionRow && fallbackValues.length >= 5) {
        fallbackValues.slice(0, 5).forEach((cell, yearOffset) => {
          setResolvedValue(map, buildCellToken(series.tokenStart + yearOffset), {
            label: `Cash Flow / ${series.label} / Year ${yearOffset + 1}`,
            value: formatCurrencyTokenValue(cell.value),
            section: 'dealEconomics',
            source: 'extracted',
            matchedKey: `Print - Acquisition & Returns!R${acquisitionRow.rowIndex + 1}C${cell.valueIndex + 1}`,
          });
        });
        continue;
      }
    }

    if (rowIndex < 0) {
      warnings.push(`Valuation Sheet: unable to locate cash flow row "${series.rowLabel}".`);
    } else {
      warnings.push(`Valuation Sheet: cash flow row "${series.rowLabel}" did not expose usable Year 1-Year 5 values.`);
    }
  }

  const cashOnCashRowIndex = findRowIndexByColumnValue(valuationRows, VALUATION_LABEL_COLUMN_INDEX, 'Cash-on-Cash Return', {
    startRow: 28,
    endRow: 34,
  });
  if (cashOnCashRowIndex >= 0) {
    addDirectCellToken(
      map,
      'CELL0566',
      'Cash-on-Cash Return / Year 1',
      'dealEconomics',
      'Valuation Sheet',
      cashOnCashRowIndex,
      1,
      valuationRows,
    );
  } else {
    warnings.push('Valuation Sheet: unable to locate "Cash-on-Cash Return" for slide 6.');
  }

  const yieldOnCostRowIndex = findRowIndexByColumnValue(valuationRows, VALUATION_LABEL_COLUMN_INDEX, 'Yield on Cost', {
    startRow: 28,
    endRow: 34,
  });
  if (yieldOnCostRowIndex >= 0) {
    addDirectCellToken(
      map,
      'CELL0567',
      'Yield on Cost / Year 1',
      'dealEconomics',
      'Valuation Sheet',
      yieldOnCostRowIndex,
      1,
      valuationRows,
    );
  } else {
    warnings.push('Valuation Sheet: unable to locate "Yield on Cost" for slide 6.');
  }

  const sourceUseSpecs: DirectCellSpec[] = [
    { token: 'CELL0568', label: 'Sources of Capital / Senior Debt', rowLabel: 'Senior Debt', labelColumn: 0, valueColumn: 1 },
    { token: 'CELL0569', label: 'Sources of Capital / Equity', rowLabel: 'Equity', labelColumn: 0, valueColumn: 1 },
    { token: 'CELL0570', label: 'Sources of Capital / Total Sources', rowLabel: 'Total Sources', labelColumn: 0, valueColumn: 1 },
    { token: 'CELL0571', label: 'Uses of Capital / Purchase Price', rowLabel: 'Purchase Price', labelColumn: 2, valueColumn: 3 },
    { token: 'CELL0572', label: 'Uses of Capital / Closing Costs', rowLabel: 'Closing Costs', labelColumn: 2, valueColumn: 3 },
    { token: 'CELL0573', label: 'Uses of Capital / Upfront CapEx', rowLabel: 'Upfront CapEx', labelColumn: 2, valueColumn: 3 },
    { token: 'CELL0574', label: 'Uses of Capital / Total Uses', rowLabel: 'Total Uses', labelColumn: 2, valueColumn: 3 },
  ];

  for (const spec of sourceUseSpecs) {
    const rowIndex = findRowIndexByColumnValue(valuationRows, spec.labelColumn, spec.rowLabel, { startRow: 0, endRow: 15 });
    if (rowIndex < 0) {
      warnings.push(`Valuation Sheet: unable to locate sources/uses row "${spec.rowLabel}".`);
      continue;
    }
    addDirectCellToken(
      map,
      spec.token,
      spec.label,
      'dealEconomics',
      'Valuation Sheet',
      rowIndex,
      spec.valueColumn,
      valuationRows,
    );
  }

  return warnings;
}

function addPublicSlide7Mappings(
  map: Map<string, ExtractedTokenRecord>,
  valuationRows: string[][],
): string[] {
  const warnings: string[] = [];

  const holdPeriodRows: HoldPeriodRowSpec[] = [
    { tokenNumbers: [578, 579, 580], label: 'Exit Year NOI', sourceLabel: 'Exit Year NOI' },
    { tokenNumbers: [582, 583, 584], label: 'Forward NOI', sourceLabel: 'Forward NOI (exit + 1 yr)' },
    { tokenNumbers: [591, 592, 593], label: 'Disposition Costs', sourceLabel: 'Disposition Costs', formatter: stripOuterParens },
    { tokenNumbers: [594, 595, 596], label: 'Net Sale Price', sourceLabel: 'Net Sale Price' },
    { tokenNumbers: [597, 598, 599], label: 'Loan Balance at Exit', sourceLabel: 'Loan Balance at Exit' },
    { tokenNumbers: [600, 601, 602], label: 'Net Equity Proceeds', sourceLabel: 'Net Equity Proceeds' },
  ];

  for (const rowSpec of holdPeriodRows) {
    const rowIndex = findRowIndexByColumnValue(valuationRows, VALUATION_LABEL_COLUMN_INDEX, rowSpec.sourceLabel, {
      startRow: 35,
      endRow: 45,
    });
    if (rowIndex < 0) {
      warnings.push(`Valuation Sheet: unable to locate hold-period row "${rowSpec.sourceLabel}".`);
      continue;
    }
    rowSpec.tokenNumbers.forEach((tokenNumber, index) => {
      addDirectCellToken(
        map,
        buildCellToken(tokenNumber),
        `${rowSpec.label} / ${[3, 5, 7][index]}-Year Hold`,
        'exitSensitivity',
        'Valuation Sheet',
        rowIndex,
        index + 1,
        valuationRows,
        rowSpec.formatter,
      );
    });
  }

  const grossSaleRowIndex = findRowIndexByColumnValue(
    valuationRows,
    VALUATION_LABEL_COLUMN_INDEX,
    'Gross Sale Price / Price Per Square Foot',
    { startRow: 35, endRow: 45 },
  );
  if (grossSaleRowIndex < 0) {
    warnings.push('Valuation Sheet: unable to locate "Gross Sale Price / Price Per Square Foot".');
  } else {
    const grossSaleTokens: Array<[string, string]> = [
      ['CELL0585', '3-Year Hold / Gross Sale Price'],
      ['CELL0586', '3-Year Hold / Price Per Square Foot'],
      ['CELL0587', '5-Year Hold / Gross Sale Price'],
      ['CELL0588', '5-Year Hold / Price Per Square Foot'],
      ['CELL0589', '7-Year Hold / Gross Sale Price'],
      ['CELL0590', '7-Year Hold / Price Per Square Foot'],
    ];
    [1, 2, 3].forEach((columnIndex, holdIndex) => {
      const [grossSale, pricePerSquareFoot] = splitCombinedValue(readMatrixCell(valuationRows, grossSaleRowIndex, columnIndex), '/');
      const pair = grossSaleTokens.slice(holdIndex * 2, holdIndex * 2 + 2);
      setResolvedValue(map, pair[0][0], {
        label: pair[0][1],
        value: grossSale,
        section: 'exitSensitivity',
        source: 'extracted',
        matchedKey: `Valuation Sheet!R${grossSaleRowIndex + 1}C${columnIndex + 1}`,
      });
      setResolvedValue(map, pair[1][0], {
        label: pair[1][1],
        value: pricePerSquareFoot,
        section: 'exitSensitivity',
        source: 'extracted',
        matchedKey: `Valuation Sheet!R${grossSaleRowIndex + 1}C${columnIndex + 1}`,
      });
    });
  }

  const irrRowIndex = findRowIndexByColumnValue(valuationRows, VALUATION_LABEL_COLUMN_INDEX, 'Levered IRR', {
    startRow: 35,
    endRow: 50,
  });
  if (irrRowIndex >= 0) {
    addDirectCellToken(map, 'CELL0604', '3-Year IRR', 'exitSensitivity', 'Valuation Sheet', irrRowIndex, 1, valuationRows);
    addDirectCellToken(map, 'CELL0606', '5-Year IRR', 'exitSensitivity', 'Valuation Sheet', irrRowIndex, 2, valuationRows);
    addDirectCellToken(map, 'CELL0608', '7-Year IRR', 'exitSensitivity', 'Valuation Sheet', irrRowIndex, 3, valuationRows);
  } else {
    warnings.push('Valuation Sheet: unable to locate hold-period "Levered IRR".');
  }

  const equityMultipleRowIndex = findRowIndexByColumnValue(valuationRows, VALUATION_LABEL_COLUMN_INDEX, 'Equity Multiple', {
    startRow: 35,
    endRow: 50,
  });
  if (equityMultipleRowIndex >= 0) {
    addDirectCellToken(
      map,
      'CELL0610',
      '3-Year Equity Multiple',
      'exitSensitivity',
      'Valuation Sheet',
      equityMultipleRowIndex,
      1,
      valuationRows,
      stripTrailingX,
    );
    addDirectCellToken(
      map,
      'CELL0612',
      '5-Year Equity Multiple',
      'exitSensitivity',
      'Valuation Sheet',
      equityMultipleRowIndex,
      2,
      valuationRows,
      stripTrailingX,
    );
    addDirectCellToken(
      map,
      'CELL0614',
      '7-Year Equity Multiple',
      'exitSensitivity',
      'Valuation Sheet',
      equityMultipleRowIndex,
      3,
      valuationRows,
      stripTrailingX,
    );
  } else {
    warnings.push('Valuation Sheet: unable to locate hold-period "Equity Multiple".');
  }

  const interestSensitivityTokenRows = [
    buildCellTokenRange(621, 625),
    buildCellTokenRange(627, 631),
    buildCellTokenRange(633, 637),
    buildCellTokenRange(639, 643),
    buildCellTokenRange(645, 649),
  ];
  const interestSensitivityTable = detectSensitivityTable(
    valuationRows,
    (label) => label.includes('interest rate sensitivity') && label.includes('levered irr'),
    (label) => label === 'exit cap all in rate',
  );
  if (!interestSensitivityTable) {
    warnings.push('Valuation Sheet: unable to locate the interest-rate sensitivity table.');
  } else {
    const visibleInterestRowCount = Math.min(interestSensitivityTokenRows.length, interestSensitivityTable.rowIndices.length);
    for (let rowOffset = 0; rowOffset < visibleInterestRowCount; rowOffset += 1) {
      const rowIndex = interestSensitivityTable.rowIndices[rowOffset] ?? -1;
      if (rowIndex < 0) continue;
      const rowLabel = readMatrixCell(valuationRows, rowIndex, VALUATION_LABEL_COLUMN_INDEX) || `Row ${rowOffset + 1}`;
      interestSensitivityTokenRows[rowOffset]?.forEach((tokenNumber, columnOffset) => {
        addDirectCellToken(
          map,
          buildCellToken(tokenNumber),
          `Interest Rate Sensitivity / Exit Cap ${rowLabel} / All-In Rate ${
            readMatrixCell(valuationRows, interestSensitivityTable.headerRowIndex, columnOffset + 1) || `Column ${columnOffset + 1}`
          }`,
          'exitSensitivity',
          'Valuation Sheet',
          rowIndex,
          columnOffset + 1,
          valuationRows,
        );
      });
    }
  }

  const capRateSensitivityTitleRowIndex = findRowIndexByColumnValue(
    valuationRows,
    VALUATION_LABEL_COLUMN_INDEX,
    'Cap Rate Sensitivity — Implied Value at Exit (Year 5 NOI)',
    { startRow: 70, endRow: 80 },
  );
  const capRateYearMatch =
    capRateSensitivityTitleRowIndex >= 0
      ? readMatrixCell(valuationRows, capRateSensitivityTitleRowIndex, 0).match(/Year\s+(\d+)/i)
      : null;
  const capRateYearValue = capRateYearMatch?.[1] ?? '';
  ['CELL0650', 'CELL0651', 'CELL0652', 'CELL0653', 'CELL0654'].forEach((token) => {
    setResolvedValue(map, token, {
      label: 'Cap Rate Sensitivity / Exit NOI Year',
      value: capRateYearValue,
      section: 'exitSensitivity',
      source: 'extracted',
      matchedKey:
        capRateSensitivityTitleRowIndex >= 0
          ? `Valuation Sheet!R${capRateSensitivityTitleRowIndex + 1}C1`
          : 'Valuation Sheet / Cap Rate Sensitivity title',
    });
  });
  if (!capRateYearValue) {
    warnings.push('Valuation Sheet: unable to determine the cap rate sensitivity exit-year label.');
  }

  const capRateSensitivityTable = detectSensitivityTable(
    valuationRows,
    (label) => label.includes('cap rate sensitivity') && label.includes('implied value at exit'),
    (label, row) => label === 'exit cap rate' && rowEntries(row).some((entry) => normalizeLabel(entry) === 'net proceeds'),
  );
  const capRateTokenRows: string[][] = [
    ['CELL0656', 'CELL0657', 'CELL0658', 'CELL0659'],
    ['CELL0661', 'CELL0662', 'CELL0663', 'CELL0664'],
    ['CELL0666', 'CELL0667', 'CELL0668', 'CELL0669'],
    ['CELL0671', 'CELL0672', 'CELL0673', 'CELL0674'],
    ['CELL0676', 'CELL0677', 'CELL0678', 'CELL0679'],
    ['CELL0681', 'CELL0682', 'CELL0683', 'CELL0684'],
    ['CELL0686', 'CELL0687', 'CELL0688', 'CELL0689'],
    ['CELL0691', 'CELL0692', 'CELL0693', 'CELL0694'],
  ];
  const capRateColumnSpecs: CapRateColumnSpec[] = [
    { columnIndex: 2, suffix: 'Net Proceeds' },
    { columnIndex: 3, suffix: 'Equity Proceeds' },
    { columnIndex: 4, suffix: 'Equity Multiple', formatter: stripTrailingX },
    { columnIndex: 5, suffix: 'Levered IRR' },
  ];
  const capRateRowIndices =
    capRateSensitivityTable?.rowIndices ??
    (capRateSensitivityTitleRowIndex >= 0 ? collectPercentLabeledRows(valuationRows, capRateSensitivityTitleRowIndex + 1) : []);
  if (!capRateRowIndices.length) {
    warnings.push('Valuation Sheet: unable to locate the cap-rate sensitivity table.');
  } else {
    const visibleCapRateRowCount = Math.min(capRateTokenRows.length, capRateRowIndices.length);
    for (let rowOffset = 0; rowOffset < visibleCapRateRowCount; rowOffset += 1) {
      const rowIndex = capRateRowIndices[rowOffset] ?? -1;
      if (rowIndex < 0) continue;
      const rowLabel = readMatrixCell(valuationRows, rowIndex, VALUATION_LABEL_COLUMN_INDEX) || `Row ${rowOffset + 1}`;
      capRateColumnSpecs.forEach((columnSpec, columnOffset) => {
        addDirectCellToken(
          map,
          capRateTokenRows[rowOffset]?.[columnOffset] ?? '',
          `Cap Rate Sensitivity / Exit Rate ${rowLabel} / ${columnSpec.suffix}`,
          'exitSensitivity',
          'Valuation Sheet',
          rowIndex,
          columnSpec.columnIndex,
          valuationRows,
          columnSpec.formatter,
        );
      });
    }
  }

  return warnings;
}

function buildWentworthDefaults(workbook: XLSX.WorkBook, fileName: string): ParsedWorkbookBundle {
  const propertyRows = sheetToMatrix(workbook, 'Property Data');
  const summaryRows = sheetToMatrix(workbook, '5 Year Summary');
  const modelRows = sheetToMatrix(workbook, '5 Year Model');
  const stabilizedRows = sheetToMatrix(workbook, 'Stabilized Results');

  const propertyData = parsePropertyDataSheet(propertyRows);
  const summaryData = parseMultiColumnSheet(summaryRows, /^Year\s+\d+$/i, 5);
  const modelData = parseMultiColumnSheet(modelRows, /^Month\s+\d+$/i, 6);
  const stabilizedData = parseSingleValueSectionSheet(stabilizedRows);

  const defaults = new Map<string, ExtractedTokenRecord>();

  propertyData.values.forEach((entry) => addPropertyAliases(defaults, entry.label, entry.value));
  addArrayAliases(defaults, 'YEAR', summaryData.values, 'stabilizedSummary');
  addArrayAliases(defaults, 'MONTH', modelData.values, 'operatingMetrics');
  addSingleValueAliases(defaults, 'STABILIZED', stabilizedData);
  addDerivedValues(
    defaults,
    propertyData.propertyName,
    propertyData.propertyAddress,
    propertyData.dealNumber,
    propertyData.values,
    summaryData.values,
    stabilizedData,
  );

  const warnings: string[] = [];
  if (summaryData.columns.length < 5) {
    warnings.push('5 Year Summary sheet exposed fewer than five summary columns.');
  }
  if (modelData.columns.length < 12) {
    warnings.push('5 Year Model sheet exposed fewer than twelve monthly columns.');
  }

  return {
    metadata: {
      fileName,
      workbookType: 'wentworth-results',
      propertyName: propertyData.propertyName,
      propertyAddress: propertyData.propertyAddress,
      dealNumber: propertyData.dealNumber,
      templatePath: 'public/PackageTemplate.pptx',
      sheetsFound: workbook.SheetNames,
    },
    warnings,
    defaults,
  };
}

function buildPublicTemplateDefaults(workbook: XLSX.WorkBook, fileName: string): ParsedWorkbookBundle {
  const proformaRows = sheetToOptionalMatrix(workbook, 'Proforma');
  const proformaLayout = proformaRows ? detectPublicProformaLayout(proformaRows) : null;
  const inputsRows = sheetToMatrix(workbook, 'Inputs & Drivers');
  const summaryRows = sheetToMatrix(workbook, '5 Year Proforma');
  const modelRows = sheetToMatrix(workbook, 'Model2.0');
  const valuationRows = sheetToMatrix(workbook, 'Valuation Sheet');
  const acquisitionReturnsRows = sheetToOptionalMatrix(workbook, 'Print - Acquisition & Returns');
  const exitSensitivityRows = sheetToOptionalMatrix(workbook, 'Print - Exit & Sensitivity');

  const propertyLabels = [
    'Name',
    'Type',
    'Location',
    'Units Available',
    'Units Occupied',
    'NRSF',
    'Acquisition Date',
    'Hold Period',
    'Purchase Price',
    'Acquisition Closing Costs',
    'Loan-to-Cost (LTC)',
    'Loan Amount',
    'All-In Rate',
    'Total CapEx',
  ];
  const valuationLabels = [
    'Purchase Price',
    'Going-In Cap Rate',
    'All-In Interest Rate (SOFR+220bps)',
    'LTC',
    'Loan Amount',
    'Equity Required',
    'Total CapEx',
    'NRSF',
    'Price / SqFt',
    'Asset Mgmt Fee',
  ];

  const propertyValues = [
    ...collectKnownLabelValues(inputsRows, propertyLabels, 'first'),
    ...collectKnownLabelValues(valuationRows, valuationLabels, 'first'),
  ];

  const propertyName =
    findValueForLabel(inputsRows, ['Name'], 'first') ||
    firstNonEmpty(
      summaryRows.find((row) => rowEntries(row).some((entry) => normalizeLabel(entry).includes('year proforma'))) ?? [],
    ) ||
    workbook.SheetNames[0] ||
    '';
  const propertyAddress = findValueForLabel(inputsRows, ['Location'], 'first');
  const propertyType = findValueForLabel(inputsRows, ['Type'], 'first');

  if (propertyType) {
    propertyValues.push({ label: 'Property Type', value: propertyType });
  }

  const summaryData = parseMultiColumnSheet(summaryRows, /^Year\s+\d+$/i, 2);
  const modelData = parseMultiColumnSheet(modelRows, /^Month\s+\d+$/i, 4);
  const valuationData = parseSingleValueSectionSheet(valuationRows);

  const defaults = new Map<string, ExtractedTokenRecord>();
  propertyValues.forEach((entry) => addPropertyAliases(defaults, entry.label, entry.value));
  addArrayAliases(defaults, 'YEAR', summaryData.values, 'stabilizedSummary');
  addArrayAliases(defaults, 'MONTH', modelData.values, 'operatingMetrics');
  addSingleValueAliases(defaults, 'VALUATION', valuationData);
  addDerivedValues(defaults, propertyName, propertyAddress, '', propertyValues, summaryData.values, valuationData);

  const warnings = addPublicHoldPeriodReturnAliases(defaults, valuationRows);
  warnings.push(...addPublicComparisonCalloutAliases(defaults, proformaRows, proformaLayout, inputsRows));
  if (proformaRows) {
    warnings.push(...addPublicProformaSlideMappings(defaults, proformaRows, proformaLayout));
  } else {
    warnings.push('Proforma sheet is missing direct table rows for slides 4 and 5.');
  }
  warnings.push(...addPublicSlide6Mappings(defaults, valuationRows, inputsRows, acquisitionReturnsRows, exitSensitivityRows));
  warnings.push(...addPublicSlide7Mappings(defaults, valuationRows));
  if (summaryData.columns.length < 5) {
    warnings.push('5 Year Proforma sheet exposed fewer than five yearly summary columns.');
  }
  if (modelData.columns.length < 12) {
    warnings.push('Model2.0 sheet exposed fewer than twelve monthly columns.');
  }

  return {
    metadata: {
      fileName,
      workbookType: 'public-proforma-template',
      propertyName,
      propertyAddress,
      dealNumber: '',
      templatePath: 'public/PackageTemplate.pptx',
      sheetsFound: workbook.SheetNames,
    },
    warnings,
    defaults,
  };
}

function buildDefaultsFromWorkbook(buffer: Buffer, fileName: string): ParsedWorkbookBundle {
  const workbook = XLSX.read(buffer, { type: 'buffer' });

  const hasWentworthSheets = WENTWORTH_REQUIRED_SHEETS.every((sheetName) => workbook.SheetNames.includes(sheetName));
  if (hasWentworthSheets) {
    return buildWentworthDefaults(workbook, fileName);
  }

  const hasPublicSheets = PUBLIC_REQUIRED_SHEETS.every((sheetName) => workbook.SheetNames.includes(sheetName));
  if (hasPublicSheets) {
    return buildPublicTemplateDefaults(workbook, fileName);
  }

  throw new Error(
    `Unsupported workbook format: expected either ${WENTWORTH_REQUIRED_SHEETS.join(', ')} or ${PUBLIC_REQUIRED_SHEETS.join(', ')}.`,
  );
}

export async function scanPackageTemplateTokens(options?: PackageTemplateOptions): Promise<string[]> {
  const templatePath = options?.templatePath ?? PACKAGE_TEMPLATE_PATH;
  const scan = await scanPptTokens({ templatePath });
  return scan.tokens;
}

export async function parsePropertyAnalysisWorkbook(
  buffer: Buffer,
  fileName: string,
  options?: PackageTemplateOptions,
): Promise<PropertyAnalysisParseResponse> {
  const templatePath = options?.templatePath ?? PACKAGE_TEMPLATE_PATH;
  const parsed = buildDefaultsFromWorkbook(buffer, fileName);
  const region = parsed.defaults.get('REGION_NAME')?.value ?? '';
  const propertyType = parsed.defaults.get('PROPERTY_TYPE')?.value ?? '';
  const aiSnapshotDescription = await maybeGenerateSnapshotDescriptionWithAi(
    parsed.metadata.propertyName,
    parsed.metadata.propertyAddress,
    propertyType,
    region,
  );
  if (aiSnapshotDescription) {
    setRegisteredValue(parsed.defaults, 'SNAPSHOT_DESCRIPTION', {
      label: 'Snapshot Description',
      value: aiSnapshotDescription,
      section: 'propertyProfile',
      source: 'derived',
    });
  }
  try {
    await fs.access(templatePath);
  } catch {
    throw new Error('Missing public/PackageTemplate.pptx. Add the managed package template before generating.');
  }

  const templateTokens = await scanPackageTemplateTokens({ templatePath });
  const tokenFields = templateTokens.map((token) => buildTokenField(token, parsed.defaults));
  const imageSlots = await scanPackageTemplateImageSlots({ templatePath });
  const warnings = [...parsed.warnings];
  if (templateTokens.length === 0) {
    warnings.push('PackageTemplate.pptx does not contain any {{TOKEN}} placeholders yet.');
  }

  return {
  metadata: parsed.metadata,
  warnings,
  templateTokens,
  unresolvedTokens: tokenFields.filter((field) => field.source === 'manual').map((field) => field.token),
  tokenFields,
  imageSlots,
};
}

function normalizeTemplateXml(xml: string): string {
  const withoutHidden = stripHiddenTokenCharacters(xml);
  return withoutHidden.replace(TOKEN_SPAN_PATTERN, (segment) => {
    const withoutTags = segment.replace(XML_TAG_PATTERN, '');
    const normalized = withoutTags.replace(/[{}]/g, '').replace(/\s+/g, '');
    if (!normalized) return segment;
    return `{{${normalized}}}`;
  });
}

function replaceTokensInContent(content: string, normalizedTokens: Record<string, string>): string {
  return content.replace(/{{\s*([^{}]+?)\s*}}/g, (_match, rawKey) => {
    const key = normalizeTokenKey(String(rawKey));
    if (!key) return '';
    return normalizedTokens[key] ?? '';
  });
}

function repairMalformedTokenWrappers(content: string): string {
  return content.replace(/\(\{\{\s*([^{}]+?)\s*\}\}(?!\))/g, (segment, rawKey) => {
    const normalized = normalizeTokenKey(String(rawKey));
    if (!normalized || !MALFORMED_OPEN_PAREN_TOKENS.has(normalized)) {
      return segment;
    }
    return `${segment})`;
  });
}

function processEmbeddedWorkbooks(zip: PizZip, normalizedTokens: Record<string, string>): void {
  const embeddedPaths = Object.keys(zip.files).filter(
    (filePath) => filePath.startsWith('ppt/embeddings/') && filePath.endsWith('.xlsx'),
  );

  for (const embeddedPath of embeddedPaths) {
    const file = zip.file(embeddedPath);
    if (!file) continue;
    const workbookZip = new PizZip(file.asUint8Array());
    let mutated = false;
    const workbookXmlPaths = Object.keys(workbookZip.files).filter(
      (filePath) => filePath.startsWith('xl/') && filePath.endsWith('.xml'),
    );
    for (const workbookPath of workbookXmlPaths) {
      const workbookFile = workbookZip.file(workbookPath);
      if (!workbookFile) continue;
      const original = workbookFile.asText();
      const replaced = replaceTokensInContent(original, normalizedTokens);
      if (replaced !== original) {
        workbookZip.file(workbookPath, replaced);
        mutated = true;
      }
    }
    if (mutated) {
      zip.file(embeddedPath, workbookZip.generate({ type: 'uint8array' }));
    }
  }
}

function buildImageSlotId(mediaPath: string): string {
  return mediaPath.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase();
}

function mediaPathContentType(mediaPath: string): string {
  const lowerPath = mediaPath.toLowerCase();
  if (lowerPath.endsWith('.png')) return 'image/png';
  if (lowerPath.endsWith('.jpg') || lowerPath.endsWith('.jpeg')) return 'image/jpeg';
  return 'application/octet-stream';
}

function collectTemplateImageSlots(zip: PizZip): PropertyAnalysisImageSlot[] {
  const slots: PropertyAnalysisImageSlot[] = [];
  const seenMediaPaths = new Set<string>();
  const slideRelPaths = Object.keys(zip.files)
    .filter((filePath) => /^ppt\/slides\/_rels\/slide\d+\.xml\.rels$/i.test(filePath))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));

  for (const relPath of slideRelPaths) {
    const slideNumberMatch = relPath.match(/slide(\d+)\.xml\.rels$/i);
    if (!slideNumberMatch) continue;
    const slideNumber = Number(slideNumberMatch[1]);
    const slidePath = relPath.replace('/_rels/', '/').replace(/\.rels$/i, '');
    const relFile = zip.file(relPath);
    const slideFile = zip.file(slidePath);
    if (!relFile || !slideFile) continue;

    const slideXml = slideFile.asText();
    const usedRelIds = new Set(Array.from(slideXml.matchAll(/r:embed="([^"]+)"/g), (match) => match[1]));
    if (usedRelIds.size === 0) continue;

    let slideImageIndex = 0;
    for (const match of relFile.asText().matchAll(/Id="([^"]+)"[\s\S]*?Target="\.\.\/media\/([^"]+)"/g)) {
      const relId = match[1];
      const fileName = path.posix.basename(match[2]);
      const mediaPath = `ppt/media/${fileName}`;
      if (!usedRelIds.has(relId) || seenMediaPaths.has(mediaPath)) continue;
      if (!TEMPLATE_RASTER_IMAGE_EXTENSIONS.has(path.posix.extname(fileName).toLowerCase())) continue;
      slideImageIndex += 1;
      seenMediaPaths.add(mediaPath);
      slots.push({
        id: buildImageSlotId(mediaPath),
        label: `Slide ${slideNumber} image ${slideImageIndex}`,
        description: `Replaces ${fileName} in the managed template.`,
        slideNumber,
        mediaPath,
        fileName,
        contentType: mediaPathContentType(mediaPath),
      });
    }
  }

  return slots;
}

async function transcodeImageBuffer(
  buffer: Buffer,
  targetContentType: 'image/png' | 'image/jpeg',
): Promise<Buffer> {
  const { createCanvas, loadImage } = await import('canvas');
  const image = await loadImage(buffer);
  const width = Math.max(1, Math.round(image.width || 1));
  const height = Math.max(1, Math.round(image.height || 1));
  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');

  context.drawImage(image, 0, 0, width, height);

  if (targetContentType === 'image/png') {
    return canvas.toBuffer('image/png');
  }

  return canvas.toBuffer('image/jpeg');
}

async function normalizeImageOverrideBuffer(
  override: {
    buffer: Buffer;
    fileName?: string;
    contentType?: string;
  },
  slot: PropertyAnalysisImageSlot,
): Promise<Buffer> {
  const lowerFileName = override.fileName?.toLowerCase() ?? '';
  const lowerContentType = override.contentType?.toLowerCase() ?? '';
  const targetContentType = slot.contentType === 'image/png' ? 'image/png' : 'image/jpeg';
  const alreadyCompatible =
    (targetContentType === 'image/png' &&
      (lowerContentType === 'image/png' || lowerFileName.endsWith('.png'))) ||
    (targetContentType === 'image/jpeg' &&
      (lowerContentType === 'image/jpeg' ||
        lowerContentType === 'image/jpg' ||
        lowerFileName.endsWith('.jpg') ||
        lowerFileName.endsWith('.jpeg')));

  if (alreadyCompatible) {
    return override.buffer;
  }

  try {
    return await transcodeImageBuffer(override.buffer, targetContentType);
  } catch (error) {
    throw new Error(
      `Unable to convert uploaded image "${override.fileName || slot.fileName}" into ${targetContentType} for ${slot.label}.`,
      { cause: error },
    );
  }
}

async function applyImageOverridesToZip(
  zip: PizZip,
  imageOverrides: PackageTemplateOptions['imageOverrides'],
): Promise<void> {
  if (!imageOverrides || Object.keys(imageOverrides).length === 0) return;

  const slots = collectTemplateImageSlots(zip);
  const slotsById = new Map(slots.map((slot) => [slot.id, slot]));

  for (const [slotId, override] of Object.entries(imageOverrides)) {
    if (!override) continue;
    const slot = slotsById.get(slotId);
    if (!slot) {
      throw new Error(`Unknown template image slot "${slotId}". Re-parse the workbook and try again.`);
    }
    const normalizedBuffer = await normalizeImageOverrideBuffer(override, slot);
    zip.file(slot.mediaPath, normalizedBuffer);
  }
}

export async function scanPackageTemplateImageSlots(options?: PackageTemplateOptions): Promise<PropertyAnalysisImageSlot[]> {
  const templatePath = options?.templatePath ?? PACKAGE_TEMPLATE_PATH;
  const templateBuffer = await fs.readFile(templatePath);
  return collectTemplateImageSlots(new PizZip(templateBuffer));
}

export async function renderPropertyAnalysisPackage(
  overrides: Record<string, string>,
  options?: PackageTemplateOptions,
): Promise<Buffer> {
  const templatePath = options?.templatePath ?? PACKAGE_TEMPLATE_PATH;
  const templateBuffer = await fs.readFile(templatePath);
  const zip = new PizZip(templateBuffer);
  const normalizedTokens: Record<string, string> = {};

  for (const [key, value] of Object.entries(overrides)) {
    const normalized = normalizeTokenKey(key);
    if (!normalized) continue;
    normalizedTokens[normalized] = value ?? '';
  }

  await applyImageOverridesToZip(zip, options?.imageOverrides);

  const pptXmlPaths = Object.keys(zip.files).filter(
    (filePath) => filePath.startsWith('ppt/') && filePath.endsWith('.xml') && !filePath.startsWith('ppt/embeddings/'),
  );

  for (const filePath of pptXmlPaths) {
    const file = zip.file(filePath);
    if (!file) continue;
    const normalizedXml = repairMalformedTokenWrappers(normalizeTemplateXml(file.asText()));
    const replaced = replaceTokensInContent(normalizedXml, normalizedTokens);
    zip.file(filePath, replaced);
  }

  processEmbeddedWorkbooks(zip, normalizedTokens);
  return Buffer.from(zip.generate({ type: 'uint8array' }));
}

export function buildFinalTokenMap(
  parsed: PropertyAnalysisParseResponse,
  overrides: Record<string, string>,
): Record<string, string> {
  const output: Record<string, string> = {};
  for (const field of parsed.tokenFields) {
    const override = overrides[field.token];
    output[field.token] = typeof override === 'string' ? override : field.defaultValue;
  }
  console.info('[property-analysis-package] final resolved template tokens', {
    NOIPERCENT: output.NOIPERCENT ?? '',
    EXPREDPERC: output.EXPREDPERC ?? '',
    REVENUELIFT: output.REVENUELIFT ?? '',
    ASSETVALUE: output.ASSETVALUE ?? '',
    CELL0171: output.CELL0171 ?? '',
    CELL0452: output.CELL0452 ?? '',
    CELL0487: output.CELL0487 ?? '',
  });
  return output;
}

export function buildPackageFileName(propertyName: string, now = new Date()): string {
  const safeProperty = propertyName.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
  return `Property Analysis Package - ${safeProperty || 'Property'}_${formatIsoDate(now)}.pptx`;
}
