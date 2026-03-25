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

const PACKAGE_TEMPLATE_PATH = path.join(process.cwd(), 'public', 'PackageTemplate.pptx');
const WENTWORTH_REQUIRED_SHEETS = ['Property Data', '5 Year Summary', '5 Year Model', 'Stabilized Results'] as const;
const PUBLIC_REQUIRED_SHEETS = ['Inputs & Drivers', '5 Year Proforma', 'Model2.0', 'Valuation Sheet'] as const;
const MONTH_TOKEN_COUNT = 12;
const XML_TAG_PATTERN = /<[^>]+>/g;
const TOKEN_SPAN_PATTERN = /\{\{[\s\S]*?\}\}/g;
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
    section: 'manualInputs',
    aliases: [],
  },
};

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

function formatThousandsToken(value: number): string {
  return String(Math.round(value / 1000));
}

function formatMillionsToken(value: number): string {
  return `${(value / 1_000_000).toFixed(1)}M`;
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
  section: PropertyAnalysisTokenSection,
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
          value: formatWholePercentToken(expenseReductionPercent),
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
    firstNonEmpty(summaryRows.find((row) => rowEntries(row).some((entry) => normalizeLabel(entry).includes('year proforma'))) ?? []) ||
    firstNonEmpty(workbook.SheetNames.map((sheetName) => [sheetName]));
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
    const normalizedXml = normalizeTemplateXml(file.asText());
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
