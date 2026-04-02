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

export type PropertyAnalysisParseResponse = {
  metadata: PropertyAnalysisWorkbookMetadata;
  warnings: string[];
  templateTokens: string[];
  unresolvedTokens: string[];
  tokenFields: PropertyAnalysisTokenField[];
};

type PackageTemplateOptions = {
  templatePath?: string;
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

const PACKAGE_TEMPLATE_PATH = path.join(process.cwd(), 'public', 'PackageTemplate.pptx');
const WENTWORTH_REQUIRED_SHEETS = ['Property Data', '5 Year Summary', '5 Year Model', 'Stabilized Results'] as const;
const PUBLIC_REQUIRED_SHEETS = ['Inputs & Drivers', '5 Year Proforma', 'Model2.0', 'Valuation Sheet'] as const;
const MONTH_TOKEN_COUNT = 12;
const XML_TAG_PATTERN = /<[^>]+>/g;
const TOKEN_SPAN_PATTERN = /\{\{[\s\S]*?\}\}/g;
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

const PROFORMA_LABEL_COLUMN_INDEX = 3;
const VALUATION_LABEL_COLUMN_INDEX = 0;
const VALUATION_KEY_METRIC_LABEL_COLUMN_INDEX = 5;
const VALUATION_KEY_METRIC_VALUE_COLUMN_INDEX = 6;

const PROFORMA_VISIBLE_COLUMNS = {
  t12Avg: { index: 4, label: 'T-12 Avg' },
  t12: { index: 5, label: 'T-12' },
  apr2026: { index: 6, label: 'Apr 2026' },
  may2026: { index: 7, label: 'May 2026' },
  jun2026: { index: 8, label: 'Jun 2026' },
  jul2026: { index: 9, label: 'Jul 2026' },
  aug2026: { index: 10, label: 'Aug 2026' },
  sep2026: { index: 11, label: 'Sep 2026' },
  oct2026: { index: 12, label: 'Oct 2026' },
  nov2026: { index: 13, label: 'Nov 2026' },
  dec2026: { index: 14, label: 'Dec 2026' },
  jan2027: { index: 15, label: 'Jan 2027' },
  feb2027: { index: 16, label: 'Feb 2027' },
  mar2027: { index: 17, label: 'Mar 2027' },
  store: { index: 18, label: 'STORE' },
  currentMgmt: { index: 19, label: 'Current Mgmt' },
  impact: { index: 20, label: 'Impact to N.O.I.' },
} as const satisfies Record<string, MatrixColumnSpec>;

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
  const asPercent = value.includes('%') ? numeric : numeric * 100;
  return String(Math.round(asPercent * 100));
}

function splitCombinedValue(value: string, separator: string): [string, string] {
  const parts = value.split(separator).map((part) => part.trim());
  return [parts[0] ?? '', parts[1] ?? ''];
}

const PROFORMA_ALL_COLUMNS: MatrixColumnSpec[] = [
  PROFORMA_VISIBLE_COLUMNS.t12Avg,
  PROFORMA_VISIBLE_COLUMNS.t12,
  PROFORMA_VISIBLE_COLUMNS.apr2026,
  PROFORMA_VISIBLE_COLUMNS.may2026,
  PROFORMA_VISIBLE_COLUMNS.jun2026,
  PROFORMA_VISIBLE_COLUMNS.jul2026,
  PROFORMA_VISIBLE_COLUMNS.aug2026,
  PROFORMA_VISIBLE_COLUMNS.sep2026,
  PROFORMA_VISIBLE_COLUMNS.oct2026,
  PROFORMA_VISIBLE_COLUMNS.nov2026,
  PROFORMA_VISIBLE_COLUMNS.dec2026,
  PROFORMA_VISIBLE_COLUMNS.jan2027,
  PROFORMA_VISIBLE_COLUMNS.feb2027,
  PROFORMA_VISIBLE_COLUMNS.mar2027,
  PROFORMA_VISIBLE_COLUMNS.store,
  PROFORMA_VISIBLE_COLUMNS.currentMgmt,
  PROFORMA_VISIBLE_COLUMNS.impact,
];

const PROFORMA_MONTH_COLUMNS: MatrixColumnSpec[] = [
  PROFORMA_VISIBLE_COLUMNS.apr2026,
  PROFORMA_VISIBLE_COLUMNS.may2026,
  PROFORMA_VISIBLE_COLUMNS.jun2026,
  PROFORMA_VISIBLE_COLUMNS.jul2026,
  PROFORMA_VISIBLE_COLUMNS.aug2026,
  PROFORMA_VISIBLE_COLUMNS.sep2026,
  PROFORMA_VISIBLE_COLUMNS.oct2026,
  PROFORMA_VISIBLE_COLUMNS.nov2026,
  PROFORMA_VISIBLE_COLUMNS.dec2026,
  PROFORMA_VISIBLE_COLUMNS.jan2027,
  PROFORMA_VISIBLE_COLUMNS.feb2027,
  PROFORMA_VISIBLE_COLUMNS.mar2027,
];

const SLIDE4_PROFORMA_SPECS: MatrixRowTokenSpec[] = [
  {
    sourceRow: 'Rental Income',
    label: 'Rental Income',
    section: 'incomeProforma',
    tokenNumbers: buildCellTokenRange(3, 19),
    columns: [
      ...PROFORMA_ALL_COLUMNS.slice(0, 16),
      withFormatter(PROFORMA_VISIBLE_COLUMNS.impact, stripLeadingDollar),
    ],
    sheetName: 'Proforma',
    labelColumnIndex: PROFORMA_LABEL_COLUMN_INDEX,
  },
  {
    sourceRow: 'STORE Rate Mgmt. Rev',
    label: 'STORE Rate Management Revenue',
    section: 'incomeProforma',
    tokenNumbers: buildCellTokenRange(20, 30),
    columns: [
      PROFORMA_VISIBLE_COLUMNS.jul2026,
      PROFORMA_VISIBLE_COLUMNS.aug2026,
      PROFORMA_VISIBLE_COLUMNS.sep2026,
      PROFORMA_VISIBLE_COLUMNS.oct2026,
      PROFORMA_VISIBLE_COLUMNS.nov2026,
      PROFORMA_VISIBLE_COLUMNS.dec2026,
      PROFORMA_VISIBLE_COLUMNS.jan2027,
      PROFORMA_VISIBLE_COLUMNS.feb2027,
      PROFORMA_VISIBLE_COLUMNS.mar2027,
      PROFORMA_VISIBLE_COLUMNS.store,
      PROFORMA_VISIBLE_COLUMNS.impact,
    ],
    sheetName: 'Proforma',
    labelColumnIndex: PROFORMA_LABEL_COLUMN_INDEX,
  },
  {
    sourceRow: 'Discounts',
    label: 'Discounts',
    section: 'incomeProforma',
    tokenNumbers: buildCellTokenRange(31, 44),
    columns: [
      ...PROFORMA_MONTH_COLUMNS.map((column) => withFormatter(column, stripLeadingDollar)),
      withFormatter(PROFORMA_VISIBLE_COLUMNS.store, stripLeadingDollar),
      withFormatter(PROFORMA_VISIBLE_COLUMNS.currentMgmt, stripLeadingDollar),
    ],
    sheetName: 'Proforma',
    labelColumnIndex: PROFORMA_LABEL_COLUMN_INDEX,
  },
  {
    sourceRow: 'Net Rental Income',
    label: 'Net Rental Income',
    section: 'incomeProforma',
    tokenNumbers: buildCellTokenRange(45, 61),
    columns: PROFORMA_ALL_COLUMNS,
    sheetName: 'Proforma',
    labelColumnIndex: PROFORMA_LABEL_COLUMN_INDEX,
  },
  {
    sourceRow: 'Admin Fee Income',
    label: 'Admin Fee Income',
    section: 'incomeProforma',
    tokenNumbers: buildCellTokenRange(80, 95),
    columns: PROFORMA_ALL_COLUMNS.slice(0, 16),
    sheetName: 'Proforma',
    labelColumnIndex: PROFORMA_LABEL_COLUMN_INDEX,
  },
  {
    sourceRow: 'Late Fee Income',
    label: 'Late Fee Income',
    section: 'incomeProforma',
    tokenNumbers: buildCellTokenRange(96, 111),
    columns: PROFORMA_ALL_COLUMNS.slice(0, 16),
    sheetName: 'Proforma',
    labelColumnIndex: PROFORMA_LABEL_COLUMN_INDEX,
  },
  {
    sourceRow: 'Current Tenant Protection Split',
    label: 'Current Tenant Protection Split',
    section: 'incomeProforma',
    tokenNumbers: buildCellTokenRange(112, 126),
    columns: [
      ...PROFORMA_ALL_COLUMNS.slice(0, 14),
      PROFORMA_VISIBLE_COLUMNS.currentMgmt,
    ],
    sheetName: 'Proforma',
    labelColumnIndex: PROFORMA_LABEL_COLUMN_INDEX,
  },
  {
    sourceRow: 'STORE Tenant Protection Split',
    label: 'STORE Tenant Protection Split',
    section: 'incomeProforma',
    tokenNumbers: buildCellTokenRange(127, 140),
    columns: [
      ...PROFORMA_MONTH_COLUMNS,
      PROFORMA_VISIBLE_COLUMNS.store,
      PROFORMA_VISIBLE_COLUMNS.impact,
    ],
    sheetName: 'Proforma',
    labelColumnIndex: PROFORMA_LABEL_COLUMN_INDEX,
  },
  {
    sourceRow: 'Retail Sales Income',
    label: 'Retail Sales Income',
    section: 'incomeProforma',
    tokenNumbers: buildCellTokenRange(141, 156),
    columns: PROFORMA_ALL_COLUMNS.slice(0, 16),
    sheetName: 'Proforma',
    labelColumnIndex: PROFORMA_LABEL_COLUMN_INDEX,
  },
  {
    sourceRow: 'Total Operating Income',
    label: 'Total Operating Income',
    section: 'incomeProforma',
    tokenNumbers: buildCellTokenRange(157, 173),
    columns: PROFORMA_ALL_COLUMNS,
    sheetName: 'Proforma',
    labelColumnIndex: PROFORMA_LABEL_COLUMN_INDEX,
  },
  {
    sourceRow: 'Projected Rate',
    label: 'Rent ($/SF)',
    section: 'incomeProforma',
    tokenNumbers: buildCellTokenRange(175, 186),
    columns: PROFORMA_MONTH_COLUMNS,
    sheetName: 'Proforma',
    labelColumnIndex: PROFORMA_LABEL_COLUMN_INDEX,
  },
  {
    sourceRow: 'General Vacancy',
    label: 'Vacancy',
    section: 'incomeProforma',
    tokenNumbers: buildCellTokenRange(187, 198),
    columns: PROFORMA_MONTH_COLUMNS,
    sheetName: 'Proforma',
    labelColumnIndex: PROFORMA_LABEL_COLUMN_INDEX,
  },
];

const SLIDE5_PROFORMA_SPECS: MatrixRowTokenSpec[] = [
  {
    sourceRow: 'Advertising & Marketing',
    label: 'Advertising & Marketing',
    section: 'expenseProforma',
    tokenNumbers: buildCellTokenRange(201, 216),
    columns: PROFORMA_ALL_COLUMNS.slice(0, 16),
    sheetName: 'Proforma',
    labelColumnIndex: PROFORMA_LABEL_COLUMN_INDEX,
  },
  {
    sourceRow: 'Current Payment Processing Fees',
    label: 'Current Payment Processing Fees',
    section: 'expenseProforma',
    tokenNumbers: buildCellTokenRange(217, 231),
    columns: [
      ...PROFORMA_ALL_COLUMNS.slice(0, 14),
      PROFORMA_VISIBLE_COLUMNS.currentMgmt,
    ],
    sheetName: 'Proforma',
    labelColumnIndex: PROFORMA_LABEL_COLUMN_INDEX,
  },
  {
    sourceRow: 'STORE Payment Processing Fees',
    label: 'STORE Payment Processing Fees / Impact to N.O.I.',
    section: 'expenseProforma',
    tokenNumbers: [232],
    columns: [PROFORMA_VISIBLE_COLUMNS.impact],
    sheetName: 'Proforma',
    labelColumnIndex: PROFORMA_LABEL_COLUMN_INDEX,
  },
  {
    sourceRow: 'Current Mgmt. Fee',
    label: 'Current Management Fee',
    section: 'expenseProforma',
    tokenNumbers: buildCellTokenRange(233, 247),
    columns: [
      ...PROFORMA_ALL_COLUMNS.slice(0, 14),
      PROFORMA_VISIBLE_COLUMNS.currentMgmt,
    ],
    sheetName: 'Proforma',
    labelColumnIndex: PROFORMA_LABEL_COLUMN_INDEX,
  },
  {
    sourceRow: 'STORE Mgmt. Fee',
    label: 'STORE Management Fee',
    section: 'expenseProforma',
    tokenNumbers: buildCellTokenRange(248, 261),
    columns: [
      ...PROFORMA_MONTH_COLUMNS,
      PROFORMA_VISIBLE_COLUMNS.store,
      PROFORMA_VISIBLE_COLUMNS.impact,
    ],
    sheetName: 'Proforma',
    labelColumnIndex: PROFORMA_LABEL_COLUMN_INDEX,
  },
  {
    sourceRow: 'Payroll',
    label: 'Payroll',
    section: 'expenseProforma',
    tokenNumbers: buildCellTokenRange(262, 278),
    columns: [
      ...PROFORMA_ALL_COLUMNS.slice(0, 16),
      withFormatter(PROFORMA_VISIBLE_COLUMNS.impact, stripLeadingDollar),
    ],
    sheetName: 'Proforma',
    labelColumnIndex: PROFORMA_LABEL_COLUMN_INDEX,
  },
  {
    sourceRow: 'Office Supplies',
    label: 'Office Supplies',
    section: 'expenseProforma',
    tokenNumbers: buildCellTokenRange(279, 294),
    columns: PROFORMA_ALL_COLUMNS.slice(0, 16),
    sheetName: 'Proforma',
    labelColumnIndex: PROFORMA_LABEL_COLUMN_INDEX,
  },
  {
    sourceRow: 'Repairs & Maintenance',
    label: 'Repairs & Maintenance',
    section: 'expenseProforma',
    tokenNumbers: buildCellTokenRange(295, 310),
    columns: PROFORMA_ALL_COLUMNS.slice(0, 16),
    sheetName: 'Proforma',
    labelColumnIndex: PROFORMA_LABEL_COLUMN_INDEX,
  },
  {
    sourceRow: 'Security',
    label: 'Security',
    section: 'expenseProforma',
    tokenNumbers: buildCellTokenRange(311, 324),
    columns: [
      ...PROFORMA_MONTH_COLUMNS,
      PROFORMA_VISIBLE_COLUMNS.store,
      withFormatter(PROFORMA_VISIBLE_COLUMNS.impact, stripLeadingDollar),
    ],
    sheetName: 'Proforma',
    labelColumnIndex: PROFORMA_LABEL_COLUMN_INDEX,
  },
  {
    sourceRow: 'Retail Products',
    label: 'Retail Products',
    section: 'expenseProforma',
    tokenNumbers: buildCellTokenRange(325, 340),
    columns: PROFORMA_ALL_COLUMNS.slice(0, 16),
    sheetName: 'Proforma',
    labelColumnIndex: PROFORMA_LABEL_COLUMN_INDEX,
  },
  {
    sourceRow: 'Telephone & Internet',
    label: 'Telephone & Internet',
    section: 'expenseProforma',
    tokenNumbers: buildCellTokenRange(341, 356),
    columns: PROFORMA_ALL_COLUMNS.slice(0, 16),
    sheetName: 'Proforma',
    labelColumnIndex: PROFORMA_LABEL_COLUMN_INDEX,
  },
  {
    sourceRow: 'Software',
    label: 'Software',
    section: 'expenseProforma',
    tokenNumbers: buildCellTokenRange(357, 373),
    columns: [
      ...PROFORMA_ALL_COLUMNS.slice(0, 16),
      withFormatter(PROFORMA_VISIBLE_COLUMNS.impact, stripLeadingDollar),
    ],
    sheetName: 'Proforma',
    labelColumnIndex: PROFORMA_LABEL_COLUMN_INDEX,
  },
  {
    sourceRow: 'Prof Fees - Legal/Acctg',
    label: 'Prof Fees - Legal/Acctg',
    section: 'expenseProforma',
    tokenNumbers: buildCellTokenRange(374, 389),
    columns: PROFORMA_ALL_COLUMNS.slice(0, 16),
    sheetName: 'Proforma',
    labelColumnIndex: PROFORMA_LABEL_COLUMN_INDEX,
  },
  {
    sourceRow: 'Utilities',
    label: 'Utilities',
    section: 'expenseProforma',
    tokenNumbers: buildCellTokenRange(390, 405),
    columns: PROFORMA_ALL_COLUMNS.slice(0, 16),
    sheetName: 'Proforma',
    labelColumnIndex: PROFORMA_LABEL_COLUMN_INDEX,
  },
  {
    sourceRow: 'Insurance',
    label: 'Insurance',
    section: 'expenseProforma',
    tokenNumbers: buildCellTokenRange(406, 421),
    columns: PROFORMA_ALL_COLUMNS.slice(0, 16),
    sheetName: 'Proforma',
    labelColumnIndex: PROFORMA_LABEL_COLUMN_INDEX,
  },
  {
    sourceRow: 'Property Taxes',
    label: 'Property Taxes',
    section: 'expenseProforma',
    tokenNumbers: buildCellTokenRange(422, 437),
    columns: PROFORMA_ALL_COLUMNS.slice(0, 16),
    sheetName: 'Proforma',
    labelColumnIndex: PROFORMA_LABEL_COLUMN_INDEX,
  },
  {
    sourceRow: 'Total Operating Expense',
    label: 'Total Operating Expense',
    section: 'expenseProforma',
    tokenNumbers: buildCellTokenRange(438, 454),
    columns: PROFORMA_ALL_COLUMNS,
    sheetName: 'Proforma',
    labelColumnIndex: PROFORMA_LABEL_COLUMN_INDEX,
  },
  {
    sourceRow: 'Net Operating Income',
    label: 'Net Operating Income',
    section: 'expenseProforma',
    tokenNumbers: buildCellTokenRange(473, 489),
    columns: PROFORMA_ALL_COLUMNS,
    sheetName: 'Proforma',
    labelColumnIndex: PROFORMA_LABEL_COLUMN_INDEX,
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
  const negative = /^\((.+)\)$/.test(raw);
  const cleaned = raw
    .replace(/[,$]/g, '')
    .replace(/%/g, '')
    .replace(/[()]/g, '')
    .trim();
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
  return 'N/A ERROR';
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
  const apiKey = process.env.OPENAI_KEY;
  if (!apiKey) return null;

  const model = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
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

function findValueForLabel(rows: string[][], labels: string[]): string {
  const labelSet = new Set(labels.map(normalizeLabel));
  for (const row of rows) {
    const entries = rowEntries(row);
    if (entries.length < 2) continue;
    for (let index = 0; index < entries.length - 1; index += 1) {
      if (!labelSet.has(normalizeLabel(entries[index] ?? ''))) continue;
      const value = entries.slice(index + 1).findLast((entry) => entry.trim().length > 0);
      if (value) return value;
    }
  }
  return '';
}

function collectKnownLabelValues(rows: string[][], labels: string[]): Array<{ label: string; value: string }> {
  const values: Array<{ label: string; value: string }> = [];
  for (const label of labels) {
    const value = findValueForLabel(rows, [label]);
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

function readMatrixCell(rows: string[][], rowIndex: number, columnIndex: number): string {
  return cleanCell(rows[rowIndex]?.[columnIndex] ?? '');
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
    const rawValue = readMatrixCell(rows, rowIndex, column.index);
    const value = column.formatter ? column.formatter(rawValue) : rawValue;
    setResolvedValue(map, buildCellToken(tokenNumber), {
      label: `${spec.label} / ${column.label}`,
      value,
      section: spec.section,
      source: 'extracted',
      matchedKey: `${spec.sheetName}!R${rowIndex + 1}C${column.index + 1}`,
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
  if (occupancy) {
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
  workbook: XLSX.WorkBook,
  inputsRows: string[][],
): string[] {
  const warnings: string[] = [];
  const proformaRows = sheetToOptionalMatrix(workbook, 'Proforma');
  if (!proformaRows) {
    warnings.push('Proforma sheet is missing comparison rows for revenue, expense, and NOI callouts.');
    return warnings;
  }

  const headerRow = proformaRows.find((row) => {
    const labels = row.map(normalizeLabel);
    return labels.includes('current mgmt') && labels.includes('impact to n o i');
  });

  if (!headerRow) {
    warnings.push('Proforma sheet is missing the Current Mgmt / Impact to N.O.I comparison header.');
    return warnings;
  }

  const impactValueIndex = headerRow.findIndex((value) => normalizeLabel(value) === 'impact to n o i');
  const impactPercentIndex = impactValueIndex >= 0 ? impactValueIndex + 1 : -1;
  if (impactValueIndex < 0 || impactPercentIndex < 0) {
    warnings.push('Proforma sheet comparison columns could not be located.');
    return warnings;
  }

  const findComparisonRow = (label: string): string[] | undefined =>
    proformaRows.find((row) => normalizeLabel(firstNonEmpty(row)) === normalizeLabel(label));

  const revenueRow = findComparisonRow('Total Operating Income');
  const expenseRow = findComparisonRow('Total Operating Expense');
  const noiRow = findComparisonRow('Net Operating Income');

  const exitCapRaw = findValueForLabel(inputsRows, ['Exit Cap Rate']);
  const exitCapValue = parseNumberLike(exitCapRaw);
  const exitCapRate = exitCapValue === null ? null : exitCapValue > 1 ? exitCapValue / 100 : exitCapValue;
  if (exitCapRate === null || exitCapRate === 0) {
    warnings.push('Inputs & Drivers is missing a usable Exit Cap Rate for Asset Value Added.');
  }

  if (!revenueRow) {
    warnings.push('Proforma sheet is missing the Total Operating Income comparison row.');
  } else {
    const revenueLift = parseNumberLike(revenueRow[impactValueIndex] ?? '');
    if (revenueLift === null) {
      warnings.push('Proforma sheet is missing the Total Operating Income impact value.');
    } else {
      registerValue(
        map,
        ['REVENUE_LIFT_THOUSANDS'],
        {
          label: 'Revenue Lift',
          value: formatThousandsToken(revenueLift),
          section: 'stabilizedSummary',
          source: 'extracted',
        },
      );
    }
  }

  if (!expenseRow) {
    warnings.push('Proforma sheet is missing the Total Operating Expense comparison row.');
  } else {
    const expenseReductionPercent = parseNumberLike(expenseRow[impactPercentIndex] ?? '');
    if (expenseReductionPercent === null) {
      warnings.push('Proforma sheet is missing the Total Operating Expense impact percent.');
    } else {
      registerValue(
        map,
        ['EXPENSE_REDUCTION_PERCENT'],
        {
          label: 'Expense Reduction',
          value: formatWholePercentWithSymbol(expenseReductionPercent),
          section: 'stabilizedSummary',
          source: 'extracted',
        },
      );
    }
  }

  if (!noiRow) {
    warnings.push('Proforma sheet is missing the Net Operating Income comparison row.');
    return warnings;
  }

  const noiDelta = parseNumberLike(noiRow[impactValueIndex] ?? '');
  const noiIncreasePercent = parseNumberLike(noiRow[impactPercentIndex] ?? '');

  if (noiIncreasePercent === null) {
    warnings.push('Proforma sheet is missing the Net Operating Income impact percent.');
  } else {
    registerValue(
      map,
      ['NOI_INCREASE_PERCENT'],
      {
        label: 'NOI Increase',
        value: formatWholePercentToken(noiIncreasePercent),
        section: 'stabilizedSummary',
        source: 'extracted',
      },
    );
  }

  if (noiDelta === null) {
    warnings.push('Proforma sheet is missing the Net Operating Income impact value.');
  } else if (exitCapRate !== null && exitCapRate !== 0) {
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
): string[] {
  const warnings: string[] = [];
  for (const spec of [...SLIDE4_PROFORMA_SPECS, ...SLIDE5_PROFORMA_SPECS]) {
    addMatrixRowTokenSpec(map, warnings, proformaRows, spec);
  }
  return warnings;
}

function addPublicSlide6Mappings(
  map: Map<string, ExtractedTokenRecord>,
  valuationRows: string[][],
  inputsRows: string[][],
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

  const spreadRowIndex = findRowIndexByColumnValue(inputsRows, 5, 'Spread (bps)', { startRow: 0, endRow: 30 });
  if (spreadRowIndex < 0) {
    warnings.push('Inputs & Drivers: unable to locate "Spread (bps)" for slide 6.');
  } else {
    addDirectCellToken(
      map,
      'CELL0492',
      'Spread (bps)',
      'dealEconomics',
      'Inputs & Drivers',
      spreadRowIndex,
      7,
      inputsRows,
      percentToBasisPoints,
    );
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
    const rowIndex = findRowIndexByColumnValue(valuationRows, VALUATION_LABEL_COLUMN_INDEX, series.rowLabel, {
      startRow: 22,
      endRow: 35,
    });
    if (rowIndex < 0) {
      warnings.push(`Valuation Sheet: unable to locate cash flow row "${series.rowLabel}".`);
      continue;
    }
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

  const interestSensitivityRowLabels = ['5.50%', '6.00%', '6.50%', '7.00%', '7.50%'];
  const interestSensitivityTokenRows = [
    buildCellTokenRange(621, 625),
    buildCellTokenRange(627, 631),
    buildCellTokenRange(633, 637),
    buildCellTokenRange(639, 643),
    buildCellTokenRange(645, 649),
  ];
  const interestHeaderRowIndex = findRowIndexByColumnValue(
    valuationRows,
    VALUATION_LABEL_COLUMN_INDEX,
    'Exit Cap \\ All-In Rate',
    { startRow: 84, endRow: 95 },
  );
  for (let rowOffset = 0; rowOffset < interestSensitivityRowLabels.length; rowOffset += 1) {
    const rowIndex = findRowIndexByColumnValue(valuationRows, VALUATION_LABEL_COLUMN_INDEX, interestSensitivityRowLabels[rowOffset], {
      startRow: 84,
      endRow: 95,
    });
    if (rowIndex < 0) {
      warnings.push(`Valuation Sheet: unable to locate interest sensitivity row "${interestSensitivityRowLabels[rowOffset]}".`);
      continue;
    }
    interestSensitivityTokenRows[rowOffset]?.forEach((tokenNumber, columnOffset) => {
      addDirectCellToken(
        map,
        buildCellToken(tokenNumber),
        `Interest Rate Sensitivity / Exit Cap ${interestSensitivityRowLabels[rowOffset]} / All-In Rate ${
          interestHeaderRowIndex >= 0 ? readMatrixCell(valuationRows, interestHeaderRowIndex, columnOffset + 1) : `Column ${columnOffset + 1}`
        }`,
        'exitSensitivity',
        'Valuation Sheet',
        rowIndex,
        columnOffset + 1,
        valuationRows,
      );
    });
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
  ['CELL0650', 'CELL_0651', 'CELL_0652', 'CELL_0653', 'CELL_0654'].forEach((token) => {
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

  const capRateRowLabels = ['5.50%', '5.75%', '6.00%', '6.50%', '7.00%', '7.50%', '8.00%', '8.50%'];
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
  for (let rowOffset = 0; rowOffset < capRateRowLabels.length; rowOffset += 1) {
    const rowIndex = findRowIndexByColumnValue(valuationRows, VALUATION_LABEL_COLUMN_INDEX, capRateRowLabels[rowOffset], {
      startRow: 74,
      endRow: 85,
    });
    if (rowIndex < 0) {
      warnings.push(`Valuation Sheet: unable to locate cap rate sensitivity row "${capRateRowLabels[rowOffset]}".`);
      continue;
    }
    capRateColumnSpecs.forEach((columnSpec, columnOffset) => {
      addDirectCellToken(
        map,
        capRateTokenRows[rowOffset]?.[columnOffset] ?? '',
        `Cap Rate Sensitivity / Exit Rate ${capRateRowLabels[rowOffset]} / ${columnSpec.suffix}`,
        'exitSensitivity',
        'Valuation Sheet',
        rowIndex,
        columnSpec.columnIndex,
        valuationRows,
        columnSpec.formatter,
      );
    });
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
  const inputsRows = sheetToMatrix(workbook, 'Inputs & Drivers');
  const summaryRows = sheetToMatrix(workbook, '5 Year Proforma');
  const modelRows = sheetToMatrix(workbook, 'Model2.0');
  const valuationRows = sheetToMatrix(workbook, 'Valuation Sheet');

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
    ...collectKnownLabelValues(inputsRows, propertyLabels),
    ...collectKnownLabelValues(valuationRows, valuationLabels),
  ];

  const propertyName =
    findValueForLabel(inputsRows, ['Name']) ||
    firstNonEmpty(
      summaryRows.find((row) => rowEntries(row).some((entry) => normalizeLabel(entry).includes('year proforma'))) ?? [],
    ) ||
    workbook.SheetNames[0] ||
    '';
  const propertyAddress = findValueForLabel(inputsRows, ['Location']);
  const propertyType = findValueForLabel(inputsRows, ['Type']);

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
  warnings.push(...addPublicComparisonCalloutAliases(defaults, workbook, inputsRows));
  if (proformaRows) {
    warnings.push(...addPublicProformaSlideMappings(defaults, proformaRows));
  } else {
    warnings.push('Proforma sheet is missing direct table rows for slides 4 and 5.');
  }
  warnings.push(...addPublicSlide6Mappings(defaults, valuationRows, inputsRows));
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
  return output;
}

export function buildPackageFileName(propertyName: string, now = new Date()): string {
  const safeProperty = propertyName.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
  return `Property-Analysis-Package_${safeProperty || 'Property'}_${formatIsoDate(now)}.pptx`;
}
