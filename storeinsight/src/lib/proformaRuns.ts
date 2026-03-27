import { type SupabaseClient } from '@supabase/supabase-js';
import * as XLSX from 'xlsx';
import {
  profileWorkbook,
  sanitizeStoragePathPart,
  type WorkbookSectionKey,
  type WorkbookSheetProfile,
} from '@/lib/lakehouse/proformaLakehouse';
import {
  buildPublicProformaWorkbookExport,
  loadPublicTemplateCoaCatalog,
  PROFORMA_EXCEL_CONNECTION_GUIDE_URL,
  type ProformaCoaCatalogEntry,
} from '@/lib/proformaWorkbook';

export type SupportedProformaWorkbookFamily = 'extra-space' | 'cubesmart' | 'public';
export type ProformaRunStatus = 'draft' | 'reviewed' | 'ready_for_excel';
export type ProformaInputValueType = 'text' | 'number' | 'currency' | 'percent' | 'date';
export type ProformaInputSource = 'extracted' | 'manual';

const PROFORMA_INPUT_DEFINITIONS = {
  PROPERTY_NAME: { label: 'Property Name', valueType: 'text', cellRef: 'Inputs & Drivers!E5', required: true },
  PROPERTY_TYPE: { label: 'Property Type', valueType: 'text', cellRef: 'Inputs & Drivers!E6', required: true },
  PROPERTY_ADDRESS: { label: 'Property Address', valueType: 'text', cellRef: 'Inputs & Drivers!E7', required: true },
  UNITS_AVAILABLE: { label: 'Units Available', valueType: 'number', cellRef: 'Inputs & Drivers!E8', required: true },
  UNITS_OCCUPIED: { label: 'Units Occupied', valueType: 'number', cellRef: 'Inputs & Drivers!E9', required: true },
  NRSF: { label: 'NRSF', valueType: 'number', cellRef: 'Inputs & Drivers!E10', required: true },
  ACQUISITION_DATE: { label: 'Acquisition Date', valueType: 'date', cellRef: 'Inputs & Drivers!E12', required: false },
  HOLD_PERIOD_YEARS: { label: 'Hold Period', valueType: 'number', cellRef: 'Inputs & Drivers!E13', required: true },
  PURCHASE_PRICE: { label: 'Purchase Price', valueType: 'currency', cellRef: 'Inputs & Drivers!E14', required: true },
  ACQUISITION_CLOSING_COST_PCT: {
    label: 'Acquisition Closing Costs',
    valueType: 'percent',
    cellRef: 'Inputs & Drivers!E15',
    required: false,
  },
  LOAN_TO_COST: { label: 'Loan-to-Cost (LTC)', valueType: 'percent', cellRef: 'Inputs & Drivers!I13', required: true },
  SOFR_RATE: { label: 'SOFR Rate', valueType: 'percent', cellRef: 'Inputs & Drivers!I14', required: false },
  SPREAD_RATE: { label: 'Spread Rate', valueType: 'percent', cellRef: 'Inputs & Drivers!I15', required: false },
  ALL_IN_RATE: { label: 'All-In Rate', valueType: 'percent', cellRef: 'Inputs & Drivers!I16', required: true },
  AMORTIZATION_YEARS: {
    label: 'Amortization (Years)',
    valueType: 'number',
    cellRef: 'Inputs & Drivers!I17',
    required: false,
  },
  LOAN_TERM_YEARS: {
    label: 'Loan Term (Years)',
    valueType: 'number',
    cellRef: 'Inputs & Drivers!I18',
    required: false,
  },
  LOAN_AMOUNT: { label: 'Loan Amount', valueType: 'currency', cellRef: 'Inputs & Drivers!I19', required: false },
  INTEREST_ONLY_PERIOD_MONTHS: {
    label: 'Interest-Only Period',
    valueType: 'number',
    cellRef: 'Inputs & Drivers!I20',
    required: false,
  },
  UPFRONT_CAPEX: { label: 'Upfront CapEx', valueType: 'currency', cellRef: 'Inputs & Drivers!I22', required: false },
  YEAR_ONE_CAPEX: { label: 'Year 1 CapEx', valueType: 'currency', cellRef: 'Inputs & Drivers!I23', required: false },
  TOTAL_CAPEX: { label: 'Total CapEx', valueType: 'currency', cellRef: 'Inputs & Drivers!I24', required: false },
  ANNUAL_CAPEX_RESERVE: {
    label: 'Annual CapEx Reserve',
    valueType: 'currency',
    cellRef: 'Inputs & Drivers!I25',
    required: false,
  },
  EXIT_CAP_RATE: { label: 'Exit Cap Rate', valueType: 'percent', cellRef: 'Inputs & Drivers!I28', required: true },
  DISPOSITION_COST_PCT: {
    label: 'Disposition Costs',
    valueType: 'percent',
    cellRef: 'Inputs & Drivers!I29',
    required: false,
  },
  GOING_IN_CAP_RATE: {
    label: 'Going-In Cap Rate',
    valueType: 'percent',
    cellRef: 'Inputs & Drivers!I30',
    required: false,
  },
  ASSET_MANAGEMENT_FEE: {
    label: 'Asset Management Fee',
    valueType: 'currency',
    cellRef: 'Inputs & Drivers!I31',
    required: false,
  },
  OCCUPANCY_RATE: { label: 'Occupancy', valueType: 'percent', cellRef: 'Inputs & Drivers!D36', required: false },
  ENTITY: { label: 'Entity', valueType: 'text', cellRef: 'Data Drop!B:B', required: true },
} as const;

export type ProformaInputKey = keyof typeof PROFORMA_INPUT_DEFINITIONS;

export type ProformaPropertyInputRecord = {
  key: ProformaInputKey;
  label: string;
  valueType: ProformaInputValueType;
  cellRef: string;
  required: boolean;
  source: ProformaInputSource;
  textValue: string | null;
  numericValue: number | null;
  dateValue: string | null;
  displayValue: string;
};

export type ProformaFactRow = {
  actualBudget: 'Actual';
  entity: string;
  operatorAccount: string;
  standardizedCoaName: string | null;
  topTier: string | null;
  header: string | null;
  accountType: string | null;
  month: number;
  year: number;
  periodDate: string;
  amount: number;
  sourceSheet: string;
};

export type ProformaRunWarning = {
  code: string;
  message: string;
  severity: 'warning' | 'error';
};

export type ProformaRunResponse = {
  runId: string;
  uploadId: string | null;
  createdAt: string;
  status: ProformaRunStatus;
  operatorType: SupportedProformaWorkbookFamily;
  originalFileName: string;
  workbookTitle: string | null;
  propertyName: string | null;
  propertyAddress: string | null;
  reportMonth: string | null;
  totalFactRows: number;
  previewFactRows: ProformaFactRow[];
  unresolvedAccounts: string[];
  missingRequiredInputs: ProformaInputKey[];
  propertyInputs: ProformaPropertyInputRecord[];
  warnings: ProformaRunWarning[];
  coaOptions: string[];
  guideUrl: string;
  sheetNames: string[];
  detectedSections: WorkbookSectionKey[];
  sheetProfiles: WorkbookSheetProfile[];
};

type ParsedWorkbookResult = {
  operatorType: SupportedProformaWorkbookFamily;
  workbookTitle: string | null;
  entity: string;
  propertyName: string | null;
  propertyAddress: string | null;
  reportMonth: string | null;
  propertyInputs: Map<ProformaInputKey, ProformaPropertyInputRecord>;
  factRows: ProformaFactRow[];
  warnings: ProformaRunWarning[];
};

type MonthMeta = {
  month: number;
  year: number;
  label: string;
  columnIndex: number;
};

type MappingUpdate = {
  operatorAccountName: string;
  standardizedCoaName: string;
};

type ParsedInputValue = {
  textValue: string | null;
  numericValue: number | null;
  dateValue: string | null;
};

type ParsedDataDropRow = {
  actualBudget: 'Actual';
  entity: string;
  operatorAccount: string;
  month: number;
  year: number;
  periodDate: string;
  amount: number;
  standardizedCoaName: string | null;
};

type StoredInputRow = {
  input_key: ProformaInputKey;
  input_label: string;
  value_type: ProformaInputValueType;
  text_value: string | null;
  numeric_value: number | null;
  date_value: string | null;
  source: ProformaInputSource;
  is_required: boolean;
};

type StoredWarningRow = {
  warning_code: string;
  warning_message: string;
  severity: 'warning' | 'error';
};

const PUBLIC_REQUIRED_SHEETS = ['Inputs & Drivers', 'Data Drop', 'COA Translation'] as const;
const EXTRA_REQUIRED_PATTERNS = [/^Rolling IS/i, /^Ops Sum/i, /^Unit Rate/i];
const CUBESMART_REQUIRED_PATTERNS = [/^Rolling Details$/i, /^Summary of Rental Experience$/i, /^Cube Mix$/i];
const PREVIEW_FACT_ROW_LIMIT = 200;
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const REVIEW_REQUIRED_INPUT_KEYS: ProformaInputKey[] = [
  'PROPERTY_NAME',
  'PROPERTY_TYPE',
  'PROPERTY_ADDRESS',
  'UNITS_AVAILABLE',
  'UNITS_OCCUPIED',
  'NRSF',
  'HOLD_PERIOD_YEARS',
  'PURCHASE_PRICE',
  'LOAN_TO_COST',
  'ALL_IN_RATE',
  'EXIT_CAP_RATE',
  'ENTITY',
];

const STANDARDIZED_COA_ALIASES: Record<string, string[]> = {
  'Rental Income': ['rental income', 'rent income'],
  Discounts: ['discount', 'discounts charged'],
  'Bad Debt/Rental Refunds': ['bad debt', 'written off', 'write off', 'refund'],
  'Admin Fee Income': ['admin fee', 'late fee', 'other fee', 'nsf fee', 'convenience fee', 'fees waived'],
  'Current Tenant Protection Split': ['tenant insurance', 'tenant protection', 'insurance fee'],
  'Retail Sales Income': ['merchandise sales', 'lock and pack', 'lock & pack'],
  Software: ['software', 'customer care center', 'network charges', 'bank charges', 'help desk', 'cms license'],
  Payroll: ['payroll', 'overtime', 'vacation', 'temporary labor', 'bonus', '401k', 'payroll tax', 'workers comp'],
  Utilities: ['utilities', 'electric', 'gas', 'water', 'sewer', 'trash'],
  'Telephone & Internet': ['telephone', 'telecom', 'internet'],
  'Repairs & Maintenance': ['repair', 'maintenance', 'r & m'],
  'Advertising & Marketing': ['advertising', 'marketing', 'website'],
  'Current Mgmt. Fee': ['management fee', 'third party management'],
  'Office Supplies': ['office supplies', 'office expense', 'printing expense', 'equipment', 'postage'],
  'Licenses & Permits': ['licenses', 'permits'],
  'Prof Fees - Legal/Acctg': ['legal', 'auction', 'accounting'],
  'Retail Products': ['cost of goods sold', 'retail products'],
};

function cleanCell(value: unknown): string {
  return String(value ?? '')
    .replace(/\u00A0/g, ' ')
    .replace(/\r?\n/g, ' ')
    .trim();
}

function normalizeKey(value: string): string {
  return cleanCell(value).toLowerCase().replace(/\s+/g, ' ');
}

function parseNumericValue(raw: unknown, valueType?: ProformaInputValueType): number | null {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? raw : null;
  }
  const text = cleanCell(raw);
  if (!text) return null;
  const negative = /^\((.+)\)$/.test(text);
  const cleaned = text.replace(/[,$]/g, '').replace(/[()]/g, '').replace(/months?$/i, '').trim();
  const percent = cleaned.endsWith('%');
  const numeric = Number(cleaned.replace(/%/g, '').replace(/[^\d.+-]/g, ''));
  if (!Number.isFinite(numeric)) return null;
  let value = negative ? -Math.abs(numeric) : numeric;
  if (percent || valueType === 'percent') value /= 100;
  return value;
}

function parseDateValue(raw: unknown): string | null {
  if (raw instanceof Date && Number.isFinite(raw.getTime())) {
    return raw.toISOString().slice(0, 10);
  }
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 20000 && raw < 90000) {
    const parsedDate = XLSX.SSF.parse_date_code(raw);
    if (parsedDate && parsedDate.y && parsedDate.m && parsedDate.d) {
      return `${String(parsedDate.y).padStart(4, '0')}-${String(parsedDate.m).padStart(2, '0')}-${String(parsedDate.d).padStart(2, '0')}`;
    }
  }
  const text = cleanCell(raw);
  if (!text) return null;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function parseMonthMeta(raw: unknown): MonthMeta | null {
  if (raw instanceof Date && Number.isFinite(raw.getTime())) {
    return {
      month: raw.getMonth() + 1,
      year: raw.getFullYear(),
      label: `${MONTH_NAMES[raw.getMonth()]}-${raw.getFullYear()}`,
      columnIndex: -1,
    };
  }
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 20000 && raw < 90000) {
    const parsedDate = XLSX.SSF.parse_date_code(raw);
    if (parsedDate && parsedDate.y && parsedDate.m) {
      const month = parsedDate.m;
      const year = parsedDate.y;
      return {
        month,
        year,
        label: `${MONTH_NAMES[month - 1]}-${year}`,
        columnIndex: -1,
      };
    }
  }
  const text = cleanCell(raw);
  if (!text) return null;
  if (text.toLowerCase().includes('reporting period')) return null;
  const parsed = new Date(text.replace(/\./g, ' '));
  if (!Number.isNaN(parsed.getTime())) {
    return {
      month: parsed.getMonth() + 1,
      year: parsed.getFullYear(),
      label: `${MONTH_NAMES[parsed.getMonth()]}-${parsed.getFullYear()}`,
      columnIndex: -1,
    };
  }
  const lowered = text.toLowerCase();
  const monthMatch = lowered.match(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/,
  );
  const yearMatch = lowered.match(/\b(20\d{2}|19\d{2}|\d{2})\b/);
  if (!monthMatch) return null;
  const monthToken = monthMatch[1]?.slice(0, 3).toLowerCase();
  const month = MONTH_NAMES.findIndex((entry) => entry.toLowerCase() === monthToken) + 1;
  if (!month) return null;
  let year = new Date().getFullYear();
  if (yearMatch) {
    const rawYear = Number(yearMatch[1]);
    year = rawYear < 100 ? 2000 + rawYear : rawYear;
  }
  return {
    month,
    year,
    label: `${MONTH_NAMES[month - 1]}-${year}`,
    columnIndex: -1,
  };
}

function formatDisplayValue(value: ParsedInputValue, valueType: ProformaInputValueType): string {
  if (valueType === 'date') return value.dateValue ?? '';
  if (valueType === 'percent' && value.numericValue !== null) return `${(value.numericValue * 100).toFixed(2)}%`;
  if (valueType === 'currency' && value.numericValue !== null) {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    }).format(value.numericValue);
  }
  if (value.numericValue !== null) return String(Number(value.numericValue.toFixed(6)));
  return value.textValue ?? '';
}

function parseInputByDefinition(key: ProformaInputKey, raw: unknown): ParsedInputValue {
  const definition = PROFORMA_INPUT_DEFINITIONS[key];
  return {
    textValue: cleanCell(raw) || null,
    numericValue:
      definition.valueType === 'text' || definition.valueType === 'date'
        ? null
        : parseNumericValue(raw, definition.valueType),
    dateValue: definition.valueType === 'date' ? parseDateValue(raw) : null,
  };
}

function createInputRecord(key: ProformaInputKey, raw: unknown, source: ProformaInputSource): ProformaPropertyInputRecord | null {
  const definition = PROFORMA_INPUT_DEFINITIONS[key];
  const parsed = parseInputByDefinition(key, raw);
  if (!(parsed.textValue || parsed.numericValue !== null || parsed.dateValue)) return null;
  return {
    key,
    label: definition.label,
    valueType: definition.valueType,
    cellRef: definition.cellRef,
    required: definition.required,
    source,
    textValue: parsed.textValue,
    numericValue: parsed.numericValue,
    dateValue: parsed.dateValue,
    displayValue: formatDisplayValue(parsed, definition.valueType),
  };
}

function firstNonEmpty(values: unknown[]): string {
  return values.map(cleanCell).find(Boolean) ?? '';
}

function sheetToMatrix(workbook: XLSX.WorkBook, sheetName: string): unknown[][] {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new Error(`Workbook is missing required sheet: ${sheetName}`);
  return XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    defval: null,
    blankrows: false,
  }) as unknown[][];
}

function findSheetByPattern(workbook: XLSX.WorkBook, pattern: RegExp): string | null {
  return workbook.SheetNames.find((sheetName) => pattern.test(sheetName)) ?? null;
}

function hasPatternSet(workbook: XLSX.WorkBook, patterns: readonly RegExp[]): boolean {
  return patterns.every((pattern) => workbook.SheetNames.some((sheetName) => pattern.test(sheetName)));
}

export function detectProformaWorkbookFamily(
  workbook: XLSX.WorkBook,
  hint?: SupportedProformaWorkbookFamily | 'auto' | null,
): SupportedProformaWorkbookFamily {
  const hasPublic = PUBLIC_REQUIRED_SHEETS.every((sheetName) => workbook.SheetNames.includes(sheetName));
  const hasExtra = hasPatternSet(workbook, EXTRA_REQUIRED_PATTERNS);
  const hasCube = hasPatternSet(workbook, CUBESMART_REQUIRED_PATTERNS);

  if (hint && hint !== 'auto') {
    if (hint === 'public' && hasPublic) return 'public';
    if (hint === 'extra-space' && hasExtra) return 'extra-space';
    if (hint === 'cubesmart' && hasCube) return 'cubesmart';
  }
  if (hasPublic) return 'public';
  if (hasExtra) return 'extra-space';
  if (hasCube) return 'cubesmart';
  throw new Error('Unsupported workbook family. Expected a Public, Extra Space, or CubeSmart workbook.');
}

function findLatestMonthColumns(row: unknown[]): MonthMeta[] {
  const columns: MonthMeta[] = [];
  row.forEach((value, columnIndex) => {
    const parsed = parseMonthMeta(value);
    if (parsed) columns.push({ ...parsed, columnIndex });
  });
  return columns.sort((left, right) => left.year - right.year || left.month - right.month).slice(-12);
}

function detectMonthHeaderRow(rows: unknown[][]): { rowIndex: number; columns: MonthMeta[] } | null {
  let best: { rowIndex: number; columns: MonthMeta[] } | null = null;
  const maxScan = Math.min(rows.length, 40);
  for (let index = 0; index < maxScan; index += 1) {
    const columns = findLatestMonthColumns(rows[index] ?? []);
    if (columns.length < 2) continue;
    if (!best || columns.length > best.columns.length) {
      best = { rowIndex: index, columns };
    }
  }
  return best;
}

function findFirstCellMatching(rows: unknown[][], pattern: RegExp): string {
  for (const row of rows) {
    for (const value of row) {
      const cleaned = cleanCell(value);
      if (cleaned && pattern.test(cleaned)) return cleaned;
    }
  }
  return '';
}

function buildPeriodDate(year: number, month: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-01`;
}

function stripOperatorAccount(label: string): string {
  return cleanCell(label).replace(/\s+\(\d+\)\s*$/g, '');
}

function buildCatalogLookup(entries: ProformaCoaCatalogEntry[]): Map<string, ProformaCoaCatalogEntry> {
  const lookup = new Map<string, ProformaCoaCatalogEntry>();
  entries.forEach((entry) => lookup.set(normalizeKey(entry.standardizedCoaName), entry));
  return lookup;
}

function findCatalogEntryForMapping(
  operatorAccount: string,
  catalogLookup: Map<string, ProformaCoaCatalogEntry>,
): ProformaCoaCatalogEntry | null {
  const normalized = normalizeKey(stripOperatorAccount(operatorAccount));
  const direct = catalogLookup.get(normalized);
  if (direct) return direct;
  for (const [standardizedCoaName, aliases] of Object.entries(STANDARDIZED_COA_ALIASES)) {
    if (aliases.some((alias) => normalized.includes(alias))) {
      return catalogLookup.get(normalizeKey(standardizedCoaName)) ?? null;
    }
  }
  return null;
}

function applyCatalogEntry(row: ProformaFactRow, entry: ProformaCoaCatalogEntry | null): ProformaFactRow {
  if (!entry) return row;
  return {
    ...row,
    standardizedCoaName: entry.standardizedCoaName,
    topTier: entry.topTier,
    header: entry.header,
    accountType: entry.accountType,
  };
}

async function loadGlobalMappings(
  supabase: SupabaseClient,
  operatorType: SupportedProformaWorkbookFamily,
): Promise<Map<string, ProformaCoaCatalogEntry>> {
  const { data, error } = await supabase
    .from('proforma_coa_mappings')
    .select('operator_account_name, standardized_coa_name, top_tier, header, account_type')
    .eq('operator_type', operatorType);
  if (error) throw error;

  const map = new Map<string, ProformaCoaCatalogEntry>();
  (data ?? []).forEach((row) => {
    const operatorAccountName = cleanCell(row.operator_account_name);
    const standardizedCoaName = cleanCell(row.standardized_coa_name);
    if (!operatorAccountName || !standardizedCoaName) return;
    map.set(normalizeKey(stripOperatorAccount(operatorAccountName)), {
      standardizedCoaName,
      topTier: cleanCell(row.top_tier) || null,
      header: cleanCell(row.header) || null,
      accountType: cleanCell(row.account_type) || null,
    });
  });
  return map;
}

function applyMappingsToFactRows(
  factRows: ProformaFactRow[],
  catalogLookup: Map<string, ProformaCoaCatalogEntry>,
  globalMappings: Map<string, ProformaCoaCatalogEntry>,
): ProformaFactRow[] {
  return factRows.map((row) => {
    if (row.standardizedCoaName) {
      return applyCatalogEntry(row, catalogLookup.get(normalizeKey(row.standardizedCoaName)) ?? null);
    }
    const normalized = normalizeKey(stripOperatorAccount(row.operatorAccount));
    const globalEntry = globalMappings.get(normalized);
    if (globalEntry) return applyCatalogEntry(row, globalEntry);
    return applyCatalogEntry(row, findCatalogEntryForMapping(row.operatorAccount, catalogLookup));
  });
}

function findRowByLabel(rows: unknown[][], label: string, labelColumnIndex: number): unknown[] | null {
  const normalizedLabel = normalizeKey(label);
  for (const row of rows) {
    if (normalizeKey(cleanCell(row[labelColumnIndex])) === normalizedLabel) {
      return row;
    }
  }
  return null;
}

function parsePublicWorkbook(workbook: XLSX.WorkBook, fileName: string): ParsedWorkbookResult {
  const inputsSheet = workbook.Sheets['Inputs & Drivers'];
  const dataDropSheet = workbook.Sheets['Data Drop'];
  if (!inputsSheet || !dataDropSheet) {
    throw new Error('Public workbook is missing Inputs & Drivers or Data Drop.');
  }

  const propertyInputs = new Map<ProformaInputKey, ProformaPropertyInputRecord>();
  const directInputCells: Array<[ProformaInputKey, string]> = [
    ['PROPERTY_NAME', 'E5'],
    ['PROPERTY_TYPE', 'E6'],
    ['PROPERTY_ADDRESS', 'E7'],
    ['UNITS_AVAILABLE', 'E8'],
    ['UNITS_OCCUPIED', 'E9'],
    ['NRSF', 'E10'],
    ['ACQUISITION_DATE', 'E12'],
    ['HOLD_PERIOD_YEARS', 'E13'],
    ['PURCHASE_PRICE', 'E14'],
    ['ACQUISITION_CLOSING_COST_PCT', 'E15'],
    ['LOAN_TO_COST', 'I13'],
    ['SOFR_RATE', 'I14'],
    ['SPREAD_RATE', 'I15'],
    ['ALL_IN_RATE', 'I16'],
    ['AMORTIZATION_YEARS', 'I17'],
    ['LOAN_TERM_YEARS', 'I18'],
    ['LOAN_AMOUNT', 'I19'],
    ['INTEREST_ONLY_PERIOD_MONTHS', 'I20'],
    ['UPFRONT_CAPEX', 'I22'],
    ['YEAR_ONE_CAPEX', 'I23'],
    ['TOTAL_CAPEX', 'I24'],
    ['ANNUAL_CAPEX_RESERVE', 'I25'],
    ['EXIT_CAP_RATE', 'I28'],
    ['DISPOSITION_COST_PCT', 'I29'],
    ['GOING_IN_CAP_RATE', 'I30'],
    ['ASSET_MANAGEMENT_FEE', 'I31'],
  ];
  directInputCells.forEach(([key, cellRef]) => {
    const record = createInputRecord(key, inputsSheet[cellRef]?.v ?? inputsSheet[cellRef]?.w ?? null, 'extracted');
    if (record) propertyInputs.set(key, record);
  });

  const rows = XLSX.utils.sheet_to_json<unknown[]>(dataDropSheet, {
    header: 1,
    raw: true,
    defval: null,
    blankrows: false,
  }) as unknown[][];

  const parsedDataDropRows: ParsedDataDropRow[] = [];
  for (let index = 1; index < rows.length; index += 1) {
    const row = Array.isArray(rows[index]) ? rows[index] : [];
    const operatorAccount = cleanCell(row[2]);
    const entity = cleanCell(row[1]);
    const amount = parseNumericValue(row[6]);
    const month = parseNumericValue(row[3]);
    const year = parseNumericValue(row[4]);
    const periodDate = parseDateValue(row[5]);
    if (!operatorAccount || !entity || amount === null || month === null || year === null || !periodDate) continue;
    parsedDataDropRows.push({
      actualBudget: 'Actual',
      entity,
      operatorAccount,
      month: Math.round(month),
      year: Math.round(year),
      periodDate,
      amount,
      standardizedCoaName: cleanCell(row[7]) || null,
    });
  }

  const entity = parsedDataDropRows[0]?.entity ?? cleanCell(inputsSheet.E5?.v ?? fileName);
  const entityInput = createInputRecord('ENTITY', entity, 'extracted');
  if (entityInput) propertyInputs.set('ENTITY', entityInput);

  const unitsAvailable = propertyInputs.get('UNITS_AVAILABLE')?.numericValue;
  const unitsOccupied = propertyInputs.get('UNITS_OCCUPIED')?.numericValue;
  if (unitsAvailable && unitsOccupied !== null && unitsOccupied !== undefined) {
    const occupancyRecord = createInputRecord('OCCUPANCY_RATE', unitsOccupied / unitsAvailable, 'extracted');
    if (occupancyRecord) propertyInputs.set('OCCUPANCY_RATE', occupancyRecord);
  }

  const factRows: ProformaFactRow[] = parsedDataDropRows.map((row) => ({
    actualBudget: row.actualBudget,
    entity: row.entity,
    operatorAccount: row.operatorAccount,
    standardizedCoaName: row.standardizedCoaName,
    topTier: null,
    header: null,
    accountType: null,
    month: row.month,
    year: row.year,
    periodDate: row.periodDate,
    amount: row.amount,
    sourceSheet: 'Data Drop',
  }));

  const reportMonth = parsedDataDropRows.reduce<string | null>((latest, row) => {
    if (!latest || row.periodDate > latest) return row.periodDate;
    return latest;
  }, null);

  return {
    operatorType: 'public',
    workbookTitle: cleanCell(inputsSheet.E5?.w ?? inputsSheet.E5?.v ?? fileName) || fileName,
    entity,
    propertyName: propertyInputs.get('PROPERTY_NAME')?.textValue ?? null,
    propertyAddress: propertyInputs.get('PROPERTY_ADDRESS')?.textValue ?? null,
    reportMonth,
    propertyInputs,
    factRows,
    warnings: [],
  };
}

function parseExtraWorkbook(workbook: XLSX.WorkBook, fileName: string): ParsedWorkbookResult {
  const rollingSheetName = findSheetByPattern(workbook, /^Rolling IS/i);
  const opsSheetName = findSheetByPattern(workbook, /^Ops Sum/i);
  const unitRateSheetName = findSheetByPattern(workbook, /^Unit Rate/i);
  if (!rollingSheetName || !opsSheetName || !unitRateSheetName) {
    throw new Error('Extra Space workbook is missing Rolling IS, Ops Sum, or Unit Rate.');
  }

  const rollingRows = sheetToMatrix(workbook, rollingSheetName);
  const opsRows = sheetToMatrix(workbook, opsSheetName);
  const unitRateRows = sheetToMatrix(workbook, unitRateSheetName);

  const titleText = findFirstCellMatching(rollingRows, /income statement for/i) || fileName;
  const titleMatch = titleText.match(/For\s+(\d+)\s*-\s*(.+)$/i);
  const entity = titleMatch?.[1] ?? sanitizeStoragePathPart(fileName).slice(0, 24);
  const propertyName = titleMatch?.[2] || titleText || fileName;
  const monthHeader = detectMonthHeaderRow(rollingRows);
  const monthColumns = monthHeader?.columns ?? [];
  const opsHeader = detectMonthHeaderRow(opsRows);
  const firstFinancialIndex = Math.max(
    rollingRows.findIndex((row, index) => index > (monthHeader?.rowIndex ?? 0) && normalizeKey(cleanCell(row[1])).startsWith('rental income')),
    10,
  );

  const factRows: ProformaFactRow[] = [];
  for (let rowIndex = firstFinancialIndex; rowIndex < rollingRows.length; rowIndex += 1) {
    const row = rollingRows[rowIndex] ?? [];
    const operatorAccount = cleanCell(row[1]);
    if (!operatorAccount) continue;
    const monthAmounts = monthColumns
      .map((column) => {
        const amount = parseNumericValue(row[column.columnIndex]);
        return amount === null ? null : { month: column.month, year: column.year, amount };
      })
      .filter((value): value is { month: number; year: number; amount: number } => Boolean(value));
    if (monthAmounts.length === 0) continue;
    monthAmounts.forEach((monthAmount) => {
      factRows.push({
        actualBudget: 'Actual',
        entity,
        operatorAccount,
        standardizedCoaName: null,
        topTier: null,
        header: null,
        accountType: null,
        month: monthAmount.month,
        year: monthAmount.year,
        periodDate: buildPeriodDate(monthAmount.year, monthAmount.month),
        amount: monthAmount.amount,
        sourceSheet: rollingSheetName,
      });
    });
  }

  const propertyInputs = new Map<ProformaInputKey, ProformaPropertyInputRecord>();
  [createInputRecord('PROPERTY_NAME', propertyName, 'extracted'), createInputRecord('PROPERTY_TYPE', 'Storage', 'extracted'), createInputRecord('ENTITY', entity, 'extracted')]
    .filter((record): record is ProformaPropertyInputRecord => Boolean(record))
    .forEach((record) => propertyInputs.set(record.key, record));

  [
    ['UNITS_AVAILABLE', 'Units Available'],
    ['UNITS_OCCUPIED', 'Units Rented'],
    ['NRSF', 'Sq Ft Available'],
  ].forEach(([key, label]) => {
    const row = findRowByLabel(unitRateRows, label, 1);
    const record = createInputRecord(key as ProformaInputKey, row?.[3] ?? null, 'extracted');
    if (record) propertyInputs.set(record.key, record);
  });

  const occupancyRow = findRowByLabel(opsRows, 'Total Occupancy %', 0);
  const lastOpsColumn = opsHeader?.columns.at(-1)?.columnIndex ?? (occupancyRow ? occupancyRow.length - 1 : -1);
  const occupancyRecord = createInputRecord(
    'OCCUPANCY_RATE',
    lastOpsColumn >= 0 ? occupancyRow?.[lastOpsColumn] ?? null : null,
    'extracted',
  );
  if (occupancyRecord) propertyInputs.set('OCCUPANCY_RATE', occupancyRecord);

  const reportPeriodText = findFirstCellMatching(opsRows, /reporting period:/i);
  const reportPeriodMatch = reportPeriodText.match(/Reporting Period:\s*(.+)$/i);
  const reportMonth = parseDateValue(reportPeriodMatch?.[1] ? `1 ${reportPeriodMatch[1]}` : monthColumns.at(-1)?.label ?? null);

  return {
    operatorType: 'extra-space',
    workbookTitle: titleText,
    entity,
    propertyName,
    propertyAddress: null,
    reportMonth,
    propertyInputs,
    factRows,
    warnings: [
      {
        code: 'property-address-missing',
        message: 'Extra Space workbook did not expose a full street address. Review Property Address before export.',
        severity: 'warning',
      },
    ],
  };
}

function parseCubeSmartWorkbook(workbook: XLSX.WorkBook, fileName: string): ParsedWorkbookResult {
  const rollingSheetName = findSheetByPattern(workbook, /^Rolling Details$/i);
  const summarySheetName = findSheetByPattern(workbook, /^Summary of Rental Experience$/i);
  const cubeMixSheetName = findSheetByPattern(workbook, /^Cube Mix$/i);
  if (!rollingSheetName || !summarySheetName || !cubeMixSheetName) {
    throw new Error('CubeSmart workbook is missing Rolling Details, Summary of Rental Experience, or Cube Mix.');
  }

  const rollingRows = sheetToMatrix(workbook, rollingSheetName);
  const summaryRows = sheetToMatrix(workbook, summarySheetName);
  const cubeMixRows = sheetToMatrix(workbook, cubeMixSheetName);
  const monthHeader = detectMonthHeaderRow(rollingRows);
  const monthColumns = monthHeader?.columns ?? [];

  const factRows: ProformaFactRow[] = [];
  for (let rowIndex = 8; rowIndex < rollingRows.length; rowIndex += 1) {
    const row = rollingRows[rowIndex] ?? [];
    const operatorAccount = cleanCell(row[0]);
    if (!operatorAccount) continue;
    const monthAmounts = monthColumns
      .map((column) => {
        const amount = parseNumericValue(row[column.columnIndex]);
        return amount === null ? null : { month: column.month, year: column.year, amount };
      })
      .filter((value): value is { month: number; year: number; amount: number } => Boolean(value));
    if (monthAmounts.length === 0) continue;
    monthAmounts.forEach((monthAmount) => {
      factRows.push({
        actualBudget: 'Actual',
        entity: '',
        operatorAccount,
        standardizedCoaName: null,
        topTier: null,
        header: null,
        accountType: null,
        month: monthAmount.month,
        year: monthAmount.year,
        periodDate: buildPeriodDate(monthAmount.year, monthAmount.month),
        amount: monthAmount.amount,
        sourceSheet: rollingSheetName,
      });
    });
  }

  const storeId = cleanCell(cubeMixRows[8]?.[0] ?? '') || sanitizeStoragePathPart(fileName).slice(0, 24);
  const propertyName = storeId ? `CubeSmart ${storeId}` : fileName;
  const entity = storeId || propertyName;
  factRows.forEach((row) => {
    row.entity = entity;
  });

  const propertyInputs = new Map<ProformaInputKey, ProformaPropertyInputRecord>();
  [createInputRecord('PROPERTY_NAME', propertyName, 'extracted'), createInputRecord('PROPERTY_TYPE', 'Storage', 'extracted'), createInputRecord('ENTITY', entity, 'extracted')]
    .filter((record): record is ProformaPropertyInputRecord => Boolean(record))
    .forEach((record) => propertyInputs.set(record.key, record));

  const summaryHeader = detectMonthHeaderRow(summaryRows);
  const summaryHeaderMonths = summaryHeader?.columns ?? [];
  const lastSummaryColumn = summaryHeaderMonths.at(-1)?.columnIndex ?? 5;
  [createInputRecord('UNITS_AVAILABLE', findRowByLabel(summaryRows, 'Total Cubes Available', 0)?.[lastSummaryColumn] ?? null, 'extracted'),
    createInputRecord('UNITS_OCCUPIED', findRowByLabel(summaryRows, 'Cubes Occupied at EOM', 0)?.[lastSummaryColumn] ?? null, 'extracted'),
    createInputRecord('OCCUPANCY_RATE', findRowByLabel(summaryRows, 'SqFt Occupancy', 0)?.[lastSummaryColumn] ?? null, 'extracted')]
    .filter((record): record is ProformaPropertyInputRecord => Boolean(record))
    .forEach((record) => propertyInputs.set(record.key, record));

  let totalSqFt = 0;
  for (let rowIndex = 8; rowIndex < cubeMixRows.length; rowIndex += 1) {
    totalSqFt += parseNumericValue(cubeMixRows[rowIndex]?.[5]) ?? 0;
  }
  const nrsfRecord = createInputRecord('NRSF', totalSqFt || null, 'extracted');
  if (nrsfRecord) propertyInputs.set('NRSF', nrsfRecord);

  const reportMonth = summaryHeaderMonths.at(-1)
    ? buildPeriodDate(summaryHeaderMonths.at(-1)?.year ?? 0, summaryHeaderMonths.at(-1)?.month ?? 1)
    : null;

  return {
    operatorType: 'cubesmart',
    workbookTitle: 'CubeSmart Financials',
    entity,
    propertyName,
    propertyAddress: null,
    reportMonth,
    propertyInputs,
    factRows,
    warnings: [
      {
        code: 'property-address-missing',
        message: 'CubeSmart workbook did not expose a full street address. Review Property Address before export.',
        severity: 'warning',
      },
    ],
  };
}

function setInputRecord(
  propertyInputs: Map<ProformaInputKey, ProformaPropertyInputRecord>,
  key: ProformaInputKey,
  value: unknown,
  source: ProformaInputSource,
): void {
  const record = createInputRecord(key, value, source);
  if (record) propertyInputs.set(key, record);
}

async function parseWorkbookBuffer(
  buffer: Buffer,
  fileName: string,
  operatorTypeHint: SupportedProformaWorkbookFamily | 'auto' | null,
  propertyNameOverride: string | null,
  reportMonthOverride: string | null,
  supabase: SupabaseClient | null,
): Promise<ParsedWorkbookResult> {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const operatorType = detectProformaWorkbookFamily(workbook, operatorTypeHint);

  let parsed: ParsedWorkbookResult;
  switch (operatorType) {
    case 'public':
      parsed = parsePublicWorkbook(workbook, fileName);
      break;
    case 'extra-space':
      parsed = parseExtraWorkbook(workbook, fileName);
      break;
    case 'cubesmart':
      parsed = parseCubeSmartWorkbook(workbook, fileName);
      break;
    default:
      throw new Error(`Unsupported workbook family: ${String(operatorType)}`);
  }

  if (propertyNameOverride) {
    setInputRecord(parsed.propertyInputs, 'PROPERTY_NAME', propertyNameOverride, 'manual');
    parsed.propertyName = propertyNameOverride;
  }
  if (reportMonthOverride) {
    parsed.reportMonth = `${reportMonthOverride}-01`;
  }

  const catalogLookup = buildCatalogLookup(await loadPublicTemplateCoaCatalog());
  const globalMappings = supabase ? await loadGlobalMappings(supabase, operatorType) : new Map<string, ProformaCoaCatalogEntry>();
  parsed.factRows = applyMappingsToFactRows(parsed.factRows, catalogLookup, globalMappings);
  parsed.propertyName = parsed.propertyInputs.get('PROPERTY_NAME')?.textValue ?? parsed.propertyName;
  parsed.propertyAddress = parsed.propertyInputs.get('PROPERTY_ADDRESS')?.textValue ?? parsed.propertyAddress;
  return parsed;
}

export async function parseProformaWorkbookPreview(params: {
  buffer: Buffer;
  fileName: string;
  operatorTypeHint?: SupportedProformaWorkbookFamily | 'auto' | null;
  propertyNameOverride?: string | null;
  reportMonthRaw?: string | null;
}): Promise<{
  operatorType: SupportedProformaWorkbookFamily;
  propertyName: string | null;
  propertyAddress: string | null;
  reportMonth: string | null;
  propertyInputs: ProformaPropertyInputRecord[];
  factRows: ProformaFactRow[];
  warnings: ProformaRunWarning[];
}> {
  const parsed = await parseWorkbookBuffer(
    params.buffer,
    params.fileName,
    params.operatorTypeHint ?? 'auto',
    params.propertyNameOverride ?? null,
    params.reportMonthRaw ?? null,
    null,
  );
  return {
    operatorType: parsed.operatorType,
    propertyName: parsed.propertyName,
    propertyAddress: parsed.propertyAddress,
    reportMonth: parsed.reportMonth,
    propertyInputs: Array.from(parsed.propertyInputs.values()),
    factRows: parsed.factRows,
    warnings: parsed.warnings,
  };
}

function buildStoragePath(operatorType: SupportedProformaWorkbookFamily, reportMonth: string | null, fileName: string): string {
  const monthPart = reportMonth ? sanitizeStoragePathPart(reportMonth) : 'undated';
  const safeName = sanitizeStoragePathPart(fileName || 'upload.xlsx');
  return `proforma-runs/${operatorType}/${monthPart}/${Date.now()}-${safeName}`;
}

function buildStoredInputRows(
  runId: string,
  propertyInputs: Map<ProformaInputKey, ProformaPropertyInputRecord>,
): Array<StoredInputRow & { run_id: string }> {
  return Array.from(propertyInputs.values()).map((input) => ({
    run_id: runId,
    input_key: input.key,
    input_label: input.label,
    value_type: input.valueType,
    text_value: input.textValue,
    numeric_value: input.numericValue,
    date_value: input.dateValue,
    source: input.source,
    is_required: input.required,
  }));
}

function buildStoredFactRows(runId: string, factRows: ProformaFactRow[]): Array<Record<string, unknown>> {
  return factRows.map((row) => ({
    run_id: runId,
    actual_budget: row.actualBudget,
    entity: row.entity,
    operator_account: row.operatorAccount,
    standardized_coa_name: row.standardizedCoaName,
    top_tier: row.topTier,
    header: row.header,
    account_type: row.accountType,
    month: row.month,
    year: row.year,
    period_date: row.periodDate,
    amount: row.amount,
    source_sheet: row.sourceSheet,
  }));
}

function buildStoredWarnings(runId: string, warnings: ProformaRunWarning[]): Array<StoredWarningRow & { run_id: string }> {
  return warnings.map((warning) => ({
    run_id: runId,
    warning_code: warning.code,
    warning_message: warning.message,
    severity: warning.severity,
  }));
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort((left, right) => left.localeCompare(right));
}

function isInputMissing(input: ProformaPropertyInputRecord | undefined): boolean {
  if (!input) return true;
  return !(input.textValue || input.numericValue !== null || input.dateValue);
}

async function computeAndPersistRunStatus(supabase: SupabaseClient, runId: string): Promise<void> {
  const [factRowsResult, inputsResult] = await Promise.all([
    supabase.from('proforma_fact_rows').select('operator_account, standardized_coa_name').eq('run_id', runId),
    supabase.from('proforma_property_inputs').select('input_key, text_value, numeric_value, date_value, source').eq('run_id', runId),
  ]);
  if (factRowsResult.error) throw factRowsResult.error;
  if (inputsResult.error) throw inputsResult.error;

  const unresolvedAccounts = uniqueSorted(
    (factRowsResult.data ?? [])
      .filter((row) => !cleanCell(row.standardized_coa_name))
      .map((row) => cleanCell(row.operator_account)),
  );

  const inputsMap = new Map<ProformaInputKey, ProformaPropertyInputRecord>();
  (inputsResult.data ?? []).forEach((row) => {
    const key = row.input_key as ProformaInputKey;
    const definition = PROFORMA_INPUT_DEFINITIONS[key];
    if (!definition) return;
    const value: ParsedInputValue = {
      textValue: row.text_value,
      numericValue: row.numeric_value === null ? null : Number(row.numeric_value),
      dateValue: row.date_value,
    };
    inputsMap.set(key, {
      key,
      label: definition.label,
      valueType: definition.valueType,
      cellRef: definition.cellRef,
      required: definition.required,
      source: row.source as ProformaInputSource,
      textValue: value.textValue,
      numericValue: value.numericValue,
      dateValue: value.dateValue,
      displayValue: formatDisplayValue(value, definition.valueType),
    });
  });

  const missingRequiredInputs = REVIEW_REQUIRED_INPUT_KEYS.filter((key) => isInputMissing(inputsMap.get(key)));
  const status: ProformaRunStatus =
    unresolvedAccounts.length === 0 && missingRequiredInputs.length === 0 ? 'reviewed' : 'draft';

  const { error } = await supabase.from('proforma_runs').update({ status, updated_at: new Date().toISOString() }).eq('id', runId);
  if (error) throw error;
}

function parseReportMonth(reportMonthRaw: string | null): string | null {
  if (!reportMonthRaw) return null;
  return parseDateValue(`${reportMonthRaw}-01`);
}

async function buildRunResponse(supabase: SupabaseClient, runId: string): Promise<ProformaRunResponse> {
  const [runResult, warningResult, inputResult, factRowResult] = await Promise.all([
    supabase.from('proforma_runs').select('*').eq('id', runId).single(),
    supabase.from('proforma_run_warnings').select('warning_code, warning_message, severity').eq('run_id', runId),
    supabase.from('proforma_property_inputs').select('input_key, text_value, numeric_value, date_value, source').eq('run_id', runId),
    supabase
      .from('proforma_fact_rows')
      .select('actual_budget, entity, operator_account, standardized_coa_name, top_tier, header, account_type, month, year, period_date, amount, source_sheet')
      .eq('run_id', runId)
      .order('period_date', { ascending: true })
      .order('operator_account', { ascending: true }),
  ]);
  if (runResult.error) throw runResult.error;
  if (warningResult.error) throw warningResult.error;
  if (inputResult.error) throw inputResult.error;
  if (factRowResult.error) throw factRowResult.error;

  const run = runResult.data;
  let sheetNames: string[] = [];
  let detectedSections: WorkbookSectionKey[] = [];
  let sheetProfiles: WorkbookSheetProfile[] = [];

  const uploadId = cleanCell(run.upload_id) || null;
  if (uploadId) {
    const [uploadDetailResult, sectionRowsResult] = await Promise.all([
      supabase.from('proforma_uploads').select('sheet_names, detected_sections').eq('id', uploadId).single(),
      supabase
        .from('proforma_workbook_sections')
        .select('sheet_name, section_key, non_empty_row_count, preview_rows, first_meaningful_row')
        .eq('upload_id', uploadId)
        .order('sheet_order', { ascending: true }),
    ]);
    if (uploadDetailResult.error) throw uploadDetailResult.error;
    if (sectionRowsResult.error) throw sectionRowsResult.error;
    sheetNames = Array.isArray(uploadDetailResult.data.sheet_names)
      ? uploadDetailResult.data.sheet_names.map((value) => cleanCell(value))
      : [];
    detectedSections = Array.isArray(uploadDetailResult.data.detected_sections)
      ? uploadDetailResult.data.detected_sections.map((value) => cleanCell(value) as WorkbookSectionKey)
      : [];
    sheetProfiles = (sectionRowsResult.data ?? []).map((row) => ({
      sheetName: cleanCell(row.sheet_name),
      sectionKey: cleanCell(row.section_key) as WorkbookSectionKey,
      nonEmptyRowCount: Number(row.non_empty_row_count ?? 0),
      firstMeaningfulRow:
        row.first_meaningful_row === null || row.first_meaningful_row === undefined ? null : Number(row.first_meaningful_row),
      previewRows: Array.isArray(row.preview_rows)
        ? (row.preview_rows as Array<Record<string, unknown>>).map((previewRow) => ({
            rowNumber: Number(previewRow.rowNumber ?? 0),
            values: Array.isArray(previewRow.values) ? previewRow.values.map((value) => cleanCell(value)) : [],
          }))
        : [],
    }));
  }

  const propertyInputsMap = new Map<ProformaInputKey, ProformaPropertyInputRecord>();
  (inputResult.data ?? []).forEach((row) => {
    const key = row.input_key as ProformaInputKey;
    const definition = PROFORMA_INPUT_DEFINITIONS[key];
    if (!definition) return;
    const value: ParsedInputValue = {
      textValue: row.text_value,
      numericValue: row.numeric_value === null ? null : Number(row.numeric_value),
      dateValue: row.date_value,
    };
    propertyInputsMap.set(key, {
      key,
      label: definition.label,
      valueType: definition.valueType,
      cellRef: definition.cellRef,
      required: definition.required,
      source: row.source as ProformaInputSource,
      textValue: value.textValue,
      numericValue: value.numericValue,
      dateValue: value.dateValue,
      displayValue: formatDisplayValue(value, definition.valueType),
    });
  });

  const propertyInputs: ProformaPropertyInputRecord[] = (Object.keys(PROFORMA_INPUT_DEFINITIONS) as ProformaInputKey[]).map((key) => {
    const existing = propertyInputsMap.get(key);
    if (existing) return existing;
    const definition = PROFORMA_INPUT_DEFINITIONS[key];
    return {
      key,
      label: definition.label,
      valueType: definition.valueType,
      cellRef: definition.cellRef,
      required: definition.required,
      source: 'manual',
      textValue: null,
      numericValue: null,
      dateValue: null,
      displayValue: '',
    };
  });

  const previewFactRows: ProformaFactRow[] = (factRowResult.data ?? []).slice(0, PREVIEW_FACT_ROW_LIMIT).map((row) => ({
    actualBudget: 'Actual',
    entity: cleanCell(row.entity),
    operatorAccount: cleanCell(row.operator_account),
    standardizedCoaName: cleanCell(row.standardized_coa_name) || null,
    topTier: cleanCell(row.top_tier) || null,
    header: cleanCell(row.header) || null,
    accountType: cleanCell(row.account_type) || null,
    month: Number(row.month ?? 0),
    year: Number(row.year ?? 0),
    periodDate: cleanCell(row.period_date),
    amount: Number(row.amount ?? 0),
    sourceSheet: cleanCell(row.source_sheet),
  }));

  const unresolvedAccounts = uniqueSorted(
    (factRowResult.data ?? [])
      .filter((row) => !cleanCell(row.standardized_coa_name))
      .map((row) => cleanCell(row.operator_account)),
  );
  const missingRequiredInputs = REVIEW_REQUIRED_INPUT_KEYS.filter((key) => isInputMissing(propertyInputsMap.get(key)));
  const coaOptions = (await loadPublicTemplateCoaCatalog()).map((entry) => entry.standardizedCoaName);

  return {
    runId: cleanCell(run.id),
    uploadId,
    createdAt: cleanCell(run.created_at),
    status: cleanCell(run.status) as ProformaRunStatus,
    operatorType: cleanCell(run.operator_type) as SupportedProformaWorkbookFamily,
    originalFileName: cleanCell(run.original_file_name),
    workbookTitle: cleanCell(run.workbook_title) || null,
    propertyName: cleanCell(run.property_name) || null,
    propertyAddress: cleanCell(run.property_address) || null,
    reportMonth: cleanCell(run.report_month) || null,
    totalFactRows: factRowResult.data?.length ?? 0,
    previewFactRows,
    unresolvedAccounts,
    missingRequiredInputs,
    propertyInputs,
    warnings: (warningResult.data ?? []).map((warning) => ({
      code: cleanCell(warning.warning_code),
      message: cleanCell(warning.warning_message),
      severity: cleanCell(warning.severity) === 'error' ? 'error' : 'warning',
    })),
    coaOptions,
    guideUrl: PROFORMA_EXCEL_CONNECTION_GUIDE_URL,
    sheetNames,
    detectedSections,
    sheetProfiles,
  };
}

export async function createProformaRun(
  supabase: SupabaseClient,
  params: {
    buffer: Buffer;
    fileName: string;
    operatorTypeHint: SupportedProformaWorkbookFamily | 'auto' | null;
    propertyNameOverride: string | null;
    reportMonthRaw: string | null;
  },
): Promise<ProformaRunResponse> {
  const profile = profileWorkbook(params.buffer);
  const reportMonth = parseReportMonth(params.reportMonthRaw);
  const parsed = await parseWorkbookBuffer(
    params.buffer,
    params.fileName,
    params.operatorTypeHint,
    params.propertyNameOverride,
    params.reportMonthRaw,
    supabase,
  );

  const storagePath = buildStoragePath(parsed.operatorType, reportMonth, params.fileName);
  const { data: insertedUpload, error: uploadError } = await supabase
    .from('proforma_uploads')
    .insert({
      template_type: parsed.operatorType,
      property_name: parsed.propertyName,
      report_month: reportMonth,
      normalized_family: 'proforma_run',
      original_file_name: params.fileName,
      storage_bucket: 'disabled',
      storage_path: storagePath,
      source_format: 'workbook',
      raw_row_count: profile.totalNonEmptyRows,
      normalized_row_count: parsed.factRows.length,
      status: 'parsed',
      sheet_names: profile.sheetNames,
      detected_sections: profile.detectedSections,
      preview_payload: {
        workbookTitle: profile.workbookTitle,
        sheetCount: profile.sheetNames.length,
        sheetProfiles: profile.sheetProfiles,
      },
    })
    .select('id')
    .single();
  if (uploadError) throw uploadError;

  if (profile.sheetProfiles.length > 0) {
    const { error: sectionError } = await supabase.from('proforma_workbook_sections').insert(
      profile.sheetProfiles.map((sheetProfile, index) => ({
        upload_id: insertedUpload.id,
        sheet_name: sheetProfile.sheetName,
        section_key: sheetProfile.sectionKey,
        sheet_order: index,
        non_empty_row_count: sheetProfile.nonEmptyRowCount,
        first_meaningful_row: sheetProfile.firstMeaningfulRow,
        preview_rows: sheetProfile.previewRows,
      })),
    );
    if (sectionError) throw sectionError;
  }

  const { data: insertedRun, error: runError } = await supabase
    .from('proforma_runs')
    .insert({
      upload_id: insertedUpload.id,
      operator_type: parsed.operatorType,
      status: 'draft',
      original_file_name: params.fileName,
      workbook_title: parsed.workbookTitle,
      entity: parsed.entity,
      property_name: parsed.propertyName,
      property_address: parsed.propertyAddress,
      report_month: reportMonth ?? parsed.reportMonth,
      storage_path: storagePath,
      updated_at: new Date().toISOString(),
    })
    .select('id')
    .single();
  if (runError) throw runError;

  const runId = cleanCell(insertedRun.id);

  const { error: inputError } = await supabase.from('proforma_property_inputs').insert(buildStoredInputRows(runId, parsed.propertyInputs));
  if (inputError) throw inputError;

  const { error: factError } = await supabase.from('proforma_fact_rows').insert(buildStoredFactRows(runId, parsed.factRows));
  if (factError) throw factError;

  if (parsed.warnings.length > 0) {
    const { error: warningError } = await supabase.from('proforma_run_warnings').insert(buildStoredWarnings(runId, parsed.warnings));
    if (warningError) throw warningError;
  }

  await computeAndPersistRunStatus(supabase, runId);
  return buildRunResponse(supabase, runId);
}

export async function getProformaRun(supabase: SupabaseClient, runId: string): Promise<ProformaRunResponse> {
  return buildRunResponse(supabase, runId);
}

export async function updateProformaRunMappings(
  supabase: SupabaseClient,
  runId: string,
  mappings: MappingUpdate[],
): Promise<ProformaRunResponse> {
  const run = await getProformaRun(supabase, runId);
  const catalogLookup = buildCatalogLookup(await loadPublicTemplateCoaCatalog());
  const upserts: Array<Record<string, unknown>> = [];

  mappings.forEach((mapping) => {
    const operatorAccountName = cleanCell(mapping.operatorAccountName);
    const standardizedCoaName = cleanCell(mapping.standardizedCoaName);
    if (!operatorAccountName || !standardizedCoaName) return;
    const catalogEntry = catalogLookup.get(normalizeKey(standardizedCoaName));
    upserts.push({
      operator_type: run.operatorType,
      operator_account_name: operatorAccountName,
      standardized_coa_name: standardizedCoaName,
      top_tier: catalogEntry?.topTier ?? null,
      header: catalogEntry?.header ?? null,
      account_type: catalogEntry?.accountType ?? null,
      source: 'analyst',
      updated_at: new Date().toISOString(),
    });
  });

  if (upserts.length > 0) {
    const { error: upsertError } = await supabase.from('proforma_coa_mappings').upsert(upserts, {
      onConflict: 'operator_type,operator_account_name',
    });
    if (upsertError) throw upsertError;
  }

  for (const mapping of mappings) {
    const operatorAccountName = cleanCell(mapping.operatorAccountName);
    const standardizedCoaName = cleanCell(mapping.standardizedCoaName);
    if (!operatorAccountName || !standardizedCoaName) continue;
    const catalogEntry = catalogLookup.get(normalizeKey(standardizedCoaName));
    const { error: factUpdateError } = await supabase
      .from('proforma_fact_rows')
      .update({
        standardized_coa_name: standardizedCoaName,
        top_tier: catalogEntry?.topTier ?? null,
        header: catalogEntry?.header ?? null,
        account_type: catalogEntry?.accountType ?? null,
      })
      .eq('run_id', runId)
      .eq('operator_account', operatorAccountName);
    if (factUpdateError) throw factUpdateError;
  }

  await computeAndPersistRunStatus(supabase, runId);
  return buildRunResponse(supabase, runId);
}

export async function updateProformaRunInputs(
  supabase: SupabaseClient,
  runId: string,
  inputs: Partial<Record<ProformaInputKey, string>>,
): Promise<ProformaRunResponse> {
  const rows = Object.entries(inputs)
    .filter(([key]) => key in PROFORMA_INPUT_DEFINITIONS)
    .map(([key, rawValue]) => {
      const inputKey = key as ProformaInputKey;
      const definition = PROFORMA_INPUT_DEFINITIONS[inputKey];
      const parsed = parseInputByDefinition(inputKey, rawValue ?? '');
      return {
        run_id: runId,
        input_key: inputKey,
        input_label: definition.label,
        value_type: definition.valueType,
        text_value: parsed.textValue,
        numeric_value: parsed.numericValue,
        date_value: parsed.dateValue,
        source: 'manual',
        is_required: definition.required,
        updated_at: new Date().toISOString(),
      };
    });

  if (rows.length > 0) {
    const { error } = await supabase.from('proforma_property_inputs').upsert(rows, {
      onConflict: 'run_id,input_key',
    });
    if (error) throw error;
  }

  const runPatch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (Object.prototype.hasOwnProperty.call(inputs, 'PROPERTY_NAME')) {
    runPatch.property_name = cleanCell(inputs.PROPERTY_NAME) || null;
  }
  if (Object.prototype.hasOwnProperty.call(inputs, 'PROPERTY_ADDRESS')) {
    runPatch.property_address = cleanCell(inputs.PROPERTY_ADDRESS) || null;
  }
  if (Object.keys(runPatch).length > 1) {
    const { error } = await supabase.from('proforma_runs').update(runPatch).eq('id', runId);
    if (error) throw error;
  }

  await computeAndPersistRunStatus(supabase, runId);
  return buildRunResponse(supabase, runId);
}

export async function exportProformaRunWorkbook(
  supabase: SupabaseClient,
  runId: string,
): Promise<{ buffer: Buffer; fileName: string }> {
  const run = await getProformaRun(supabase, runId);
  const workbookExport = await buildPublicProformaWorkbookExport(runId, run.propertyName);
  const { error } = await supabase
    .from('proforma_runs')
    .update({ status: 'ready_for_excel', updated_at: new Date().toISOString() })
    .eq('id', runId);
  if (error) throw error;
  return workbookExport;
}
