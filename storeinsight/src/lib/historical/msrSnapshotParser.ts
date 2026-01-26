import * as XLSX from 'xlsx';

type CellValue = string | number | boolean | Date | null | undefined;
type Grid = CellValue[][];

export type MsrSnapshotPayload = {
  propertyId?: string;
  propertyCode?: string;
  propertyName?: string;
  propertyAddress?: string;
  reportDate?: string;
  reportMonthIso?: string;
  monthIso?: string;
  occupancy?: {
    rsfOccPct?: number;
    spaceOccPct?: number;
    occupiedCount?: number;
    vacantCount?: number;
    offlineCount?: number;
    totalCount?: number;
    occupiedRsf?: number;
    vacantRsf?: number;
    offlineRsf?: number;
    totalRsf?: number;
    avgRentPerSpaceOccupied?: number;
    avgRentPerSqftOccupied?: number;
  };
  revenue?: {
    netRevenueMtd?: number;
    netRevenueSameDayLastMonth?: number;
    netRevenueSameDayLastYear?: number;
    economicOccupancy?: number;
    economicOccPerSqft?: number;
    grossPotentialRevenue?: number;
    grossOccupiedRevenue?: number;
    occupiedRateVariancePct?: number;
  };
  rentals?: {
    moveInsMtd?: number;
    moveOutsMtd?: number;
    netMoveInsMtd?: number;
    netMtd?: number;
  };
  leads?: {
    webMtd?: number;
    walkInMtd?: number;
    phoneMtd?: number;
    otherMtd?: number;
    totalMtd?: number;
    convertedMtd?: number;
    conversionPct?: number;
    conversionRatePctMtd?: number;
    byChannelMtd?: {
      web?: number;
      walkIn?: number;
      phone?: number;
      other?: number;
    };
  };
  ar?: {
    totalPastDue?: number;
    pastDue61Plus?: number;
    delinquentTenantCount?: number;
    agingBuckets?: {
      days0to10?: number;
      days11to30?: number;
      days31to60?: number;
      days61plus?: number;
    };
    aging?: {
      days0to10?: number;
      days11to30?: number;
      days31to60?: number;
      days61plus?: number;
    };
    topDelinquencies?: Array<{
      tenant?: string;
      unit?: string;
      daysLate?: number;
      balance?: number;
      startDate?: string;
    }>;
    overlock?: {
      overlockedUnitCount?: number;
      totalBalance?: number;
      avgDaysLate?: number;
      bucketPct?: {
        d0_10?: number;
        d11_30?: number;
        d31_60?: number;
        d61_plus?: number;
      };
    };
    overlockedUnitCount?: number;
    overlockTotalBalance?: number;
    overlockAvgDaysLate?: number;
    overlockBucketShare?: Array<{ label: string; percent: number }>;
  };
  pricing?: {
    avgSellRateOccupied?: number;
    avgCurrentRentOccupied?: number;
    avgSellRatePerSqftOccupied?: number;
    avgCurrentRentPerSqftOccupied?: number;
    occupiedRateVariancePct?: number;
    spreadPct?: number;
    rentChangeCount?: number;
    avgRentChangePct?: number;
    noRentChange12MoCount?: number;
    noRentChange12MoByType?: Record<string, number>;
  };
  autopay?: {
    enrolledCount?: number;
    enrolledPct?: number;
    autopayCount?: number;
    autopayPct?: number;
  };
  coverage?: {
    enrolledCount?: number;
    enrolledPct?: number;
    premiumSum?: number;
    premiumMtd?: number;
  };
  concessions?: {
    promosDiscountsMtd?: number;
    creditsAdjustmentsMtd?: number;
    refundsMtd?: number;
    writeOffsMtd?: number;
    refundsWriteoffsMtd?: number;
  };
  unitMix?: {
    occupiedRsfByType?: Record<string, number>;
    occupiedPctByType?: Record<string, number>;
    totalOccupiedRsf?: number;
    totalRsf?: number;
    occupiedPct?: number;
  };
  inventory?: {
    vacantUnitsSample?: Array<{ unit?: string; type?: string; size?: string; status?: string }>;
  };
};

export type MsrParseSectionFlags = {
  occupancy: boolean;
  revenue: boolean;
  rentals: boolean;
  leads: boolean;
  ar: boolean;
  pricing: boolean;
  autopay: boolean;
  coverage: boolean;
  concessions: boolean;
  unitMix: boolean;
  inventory: boolean;
};

export type MsrParseResult = {
  snapshot: MsrSnapshotPayload;
  warnings: string[];
  sections: MsrParseSectionFlags;
  occupancyDiagnostics?: OccupancyParseDiagnostics;
  dataSources?: MsrDataSourceDiagnostics;
  msrTableDiagnostics?: MsrTableDiagnostics;
  sheetNames?: string[];
  sheetSources?: MsrSheetSources;
  overlockDiagnostics?: OverlockSheetDiagnostics | null;
  concessionsDiagnostics?: ConcessionsDiagnostics | null;
};

export type OccupancyParseDiagnostics = {
  sheetName?: string;
  headerRowIndex?: number | null;
  columnMapping?: Record<string, string | null>;
  rowCounts?: {
    total: number;
    occupied: number;
    vacant: number;
    offline: number;
    unknown: number;
  };
  headerCandidates?: string[];
  error?: string | null;
};

type OccupancyColumnKey =
  | 'spaceNumber'
  | 'spaceType'
  | 'sqft'
  | 'status'
  | 'sellRate'
  | 'currentRent';

type OccupancyParseResult = {
  snapshot: Partial<MsrSnapshotPayload>;
  diagnostics: OccupancyParseDiagnostics;
  occupancyTypeLookup: Map<string, string>;
  summary?: MsrSnapshotPayload['occupancy'];
};

export type MsrDataSourceDiagnostics = {
  occupancySummarySource?: 'msr' | 'occupancy';
  occupancySummaryRows?: {
    total: number;
    occupied: number;
    vacant: number;
    offline: number;
    unknown: number;
  };
  leadsSource?: 'msr';
  leadsRowCount?: number;
};

export type KpiTableDiagnostics = {
  tableFound: boolean;
  headerRowIndex: number | null;
  headerValues?: string[];
  labelColumnIndex?: number | null;
  columnMap?: {
    daily?: number | null;
    mtd?: number | null;
    ytd?: number | null;
  };
  selectedMtdIndex?: number | null;
  matchedRowLabels?: string[];
  extracted?: Record<string, { daily?: number | null; mtd?: number | null; ytd?: number | null }>;
  candidateTables?: Array<{ headerRowIndex: number; headerValues: string[] }>;
};

export type MsrTableDiagnostics = {
  rentalActivity?: KpiTableDiagnostics;
  leads?: KpiTableDiagnostics;
};

export type MsrSheetSources = {
  overlock: string | null;
  discounts: string | null;
  credits: string | null;
  refunds: string | null;
  writeOffs: string | null;
};

export type OverlockSheetDiagnostics = {
  sheetName?: string;
  headerRowIndex?: number | null;
  columnMapping?: {
    spaceNumber?: string | null;
    daysLate?: string | null;
    balance?: string | null;
  };
  rowCount?: number;
  overlockedUnitCount?: number;
  totalBalance?: number;
  avgDaysLate?: number | null;
  bucketPct?: {
    d0_10?: number;
    d11_30?: number;
    d31_60?: number;
    d61_plus?: number;
  };
  error?: string | null;
};

export type ConcessionSheetDiagnostics = {
  sheetName?: string;
  headerRowIndex?: number | null;
  amountColumn?: string | null;
  rowCount?: number;
  sum?: number | null;
  error?: string | null;
};

export type ConcessionsDiagnostics = {
  discounts?: ConcessionSheetDiagnostics | null;
  credits?: ConcessionSheetDiagnostics | null;
  refunds?: ConcessionSheetDiagnostics | null;
  writeOffs?: ConcessionSheetDiagnostics | null;
};

const normalizeText = (value: unknown): string =>
  String(value ?? '')
    .toLowerCase()
    .replace(/[\s\u00A0]+/g, ' ')
    .replace(/[^a-z0-9%]+/g, ' ')
    .trim();

const normalizeSheetName = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, '');

const normalizeHeaderCell = (value: unknown): string =>
  String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const normalizeHeaderToken = (value: unknown): string =>
  normalizeHeaderCell(value).replace(/\s+/g, '');

const OCCUPANCY_HEADER_ALIASES: Record<OccupancyColumnKey, string[]> = {
  spaceNumber: [
    'space number',
    'space name',
    'unit number',
    'space #',
    'space',
    'unit',
  ].map(normalizeHeaderCell),
  spaceType: ['space type', 'unit type', 'type'].map(normalizeHeaderCell),
  sqft: ['rentable sq ft', 'size sq ft', 'sq ft', 'sqft', 'area'].map(normalizeHeaderCell),
  status: [
    'occupied/vacant/offline',
    'occupancy status',
    'space status',
    'status',
  ].map(normalizeHeaderCell),
  sellRate: [
    'sell rate',
    'street rate',
    'std rate',
    'standard rate',
    'asking rate',
  ].map(normalizeHeaderCell),
  currentRent: [
    'current rent',
    'current rate',
    'in-place rent',
    'in place rent',
    'rent',
  ].map(normalizeHeaderCell),
};

const NO_RENT_CHANGE_SPACE_ALIASES = [
  'space',
  'space name',
  'space number',
  'unit',
  'unit number',
].map(normalizeHeaderCell);

const OCCUPANCY_REQUIRED_KEYS: OccupancyColumnKey[] = [
  'spaceNumber',
  'spaceType',
  'sqft',
  'status',
  'sellRate',
  'currentRent',
];

const OVERLOCK_SHEET_ALIASES = ['Overlocked Spaces', 'Overlocked', 'Overlock'];
const DISCOUNTS_SHEET_ALIASES = [
  'Discounts & Promotions MTD',
  'Discounts and Promotions MTD',
  'Promotions MTD',
  'Discounts MTD',
];
const CREDITS_SHEET_ALIASES = [
  'Credits & Adjustments MTD',
  'Credits and Adjustments MTD',
  'Credits MTD',
];
const REFUNDS_SHEET_ALIASES = ['Refunds MTD', 'Refund MTD'];
const WRITEOFFS_SHEET_ALIASES = [
  'Write-Offs MTD',
  'Write Offs MTD',
  'Writeoffs MTD',
  'Write Off MTD',
];

const OVERLOCK_HEADER_ALIASES = {
  spaceNumber: ['space', 'space number', 'unit', 'space name'],
  daysLate: ['days late', 'days past due', 'days delinquent'],
  balance: ['balance', 'total balance', 'past due', 'amount'],
};

const CONCESSION_AMOUNT_ALIASES = [
  'amount',
  'total',
  'value',
  'promo amount',
  'credit amount',
  'refund amount',
  'write-off amount',
];


const isBlankCell = (value: CellValue): boolean =>
  value == null || (typeof value === 'string' && !value.trim());

const isBlankRow = (row: CellValue[]): boolean => row.every((cell) => isBlankCell(cell));

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const findHeaderIndexByAliases = (headers: string[], aliases: string[]): number | null => {
  let bestIndex: number | null = null;
  let bestScore = 0;
  for (let idx = 0; idx < headers.length; idx += 1) {
    const header = headers[idx];
    if (!header) continue;
    for (const alias of aliases) {
      if (!alias) continue;
      if (header === alias) {
        const score = alias.length + 100;
        if (score > bestScore) {
          bestScore = score;
          bestIndex = idx;
        }
        continue;
      }
      if (header.includes(alias)) {
        const score = alias.length;
        if (score > bestScore) {
          bestScore = score;
          bestIndex = idx;
        }
      }
    }
  }
  return bestIndex;
};

const collectHeaderCandidates = (grid: Grid, maxRows: number, maxCandidates: number): string[] => {
  const candidates: string[] = [];
  const limit = Math.min(grid.length, maxRows);
  for (let r = 0; r < limit; r += 1) {
    const row = grid[r] ?? [];
    const values = row
      .map((cell) => String(cell ?? '').trim())
      .filter((value) => value);
    if (!values.length) continue;
    candidates.push(`Row ${r + 1}: ${values.slice(0, 8).join(' | ')}`);
    if (candidates.length >= maxCandidates) break;
  }
  return candidates;
};

const normalizeSpaceKey = (value: unknown): string => String(value ?? '').trim().toUpperCase();

const buildSpaceKeyVariants = (value: unknown): string[] => {
  const raw = normalizeSpaceKey(value);
  if (!raw) return [];
  if (/^\d+$/.test(raw)) {
    const stripped = raw.replace(/^0+/, '') || '0';
    return stripped === raw ? [raw] : [raw, stripped];
  }
  return [raw];
};

const normalizeSpaceType = (value: unknown): string =>
  String(value ?? '').trim().replace(/\s+/g, ' ');

const normalizeOccupancyStatus = (value: unknown): 'occupied' | 'vacant' | 'offline' | 'unknown' => {
  const normalized = normalizeText(value);
  if (!normalized) return 'unknown';
  if (/\b(occupied|occ)\b/.test(normalized)) return 'occupied';
  if (/\b(vacant|vac)\b/.test(normalized)) return 'vacant';
  if (/\b(offline|unrentable|down)\b/.test(normalized)) return 'offline';
  return 'unknown';
};


const coerceNumber = (value: CellValue): number | null => {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const isNegative = /^\(.*\)$/.test(trimmed);
    const cleaned = trimmed.replace(/[(),$%\s]/g, '');
    const parsed = Number(cleaned);
    if (!Number.isFinite(parsed)) return null;
    return isNegative ? -parsed : parsed;
  }
  return null;
};

const coercePercent = (value: CellValue): number | null => {
  if (value == null) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const hasPercent = trimmed.includes('%');
    const numeric = coerceNumber(trimmed);
    if (numeric == null) return null;
    if (hasPercent) return numeric / 100;
    if (Math.abs(numeric) > 1) return numeric / 100;
    return numeric;
  }
  const numeric = coerceNumber(value);
  if (numeric == null) return null;
  if (Math.abs(numeric) > 1) return numeric / 100;
  return numeric;
};

const coerceDate = (value: CellValue): Date | null => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === 'number' && Number.isFinite(value)) {
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    const ms = Math.round(value * 86400 * 1000);
    const date = new Date(excelEpoch.getTime() + ms);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const formatIsoDate = (date: Date | null): string | undefined => {
  if (!date) return undefined;
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

const formatMonthIso = (date: Date | null): string | undefined => {
  if (!date) return undefined;
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  return `${yyyy}-${mm}`;
};

const sheetToGrid = (sheet: XLSX.WorkSheet): Grid =>
  XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null }) as Grid;

const readCellValue = (sheet: XLSX.WorkSheet | undefined, address: string): CellValue => {
  if (!sheet) return null;
  const cell = sheet[address];
  return (cell ? cell.v : null) as CellValue;
};

const findSheetWithName = (
  workbook: XLSX.WorkBook,
  names: string[],
): { sheet: XLSX.WorkSheet; name: string } | null => {
  const targetNames = names.map(normalizeSheetName);
  for (const name of workbook.SheetNames) {
    const normalized = normalizeSheetName(name);
    if (targetNames.includes(normalized)) {
      return { sheet: workbook.Sheets[name], name };
    }
  }
  return null;
};

const findSheet = (workbook: XLSX.WorkBook, names: string[]): XLSX.WorkSheet | undefined =>
  findSheetWithName(workbook, names)?.sheet;

const findCellByAnchor = (
  grid: Grid,
  anchors: string[],
): { row: number; col: number } | null => {
  const normalizedAnchors = anchors.map((anchor) => normalizeText(anchor));
  for (let r = 0; r < grid.length; r += 1) {
    const row = grid[r] ?? [];
    for (let c = 0; c < row.length; c += 1) {
      const value = normalizeText(row[c]);
      if (!value) continue;
      if (normalizedAnchors.some((anchor) => value.includes(anchor))) {
        return { row: r, col: c };
      }
    }
  }
  return null;
};

const findHeaderRow = (
  grid: Grid,
  startRow: number,
  endRow: number,
  requiredHeaders: string[][],
): number | null => {
  const upper = Math.min(grid.length - 1, endRow);
  for (let r = startRow; r <= upper; r += 1) {
    const row = grid[r] ?? [];
    const normalized = row.map((cell) => normalizeText(cell));
    let hits = 0;
    for (const group of requiredHeaders) {
      if (group.some((token) => normalized.some((header) => header.includes(token)))) {
        hits += 1;
      }
    }
    if (hits >= Math.min(requiredHeaders.length, 3)) {
      return r;
    }
  }
  return null;
};

const findHeaderIndex = (headers: string[], keywords: string[]): number | null => {
  for (let idx = 0; idx < headers.length; idx += 1) {
    const header = headers[idx] ?? '';
    if (!header) continue;
    if (keywords.some((keyword) => header.includes(keyword))) return idx;
  }
  return null;
};

const findRowByLabel = (
  grid: Grid,
  startRow: number,
  endRow: number,
  label: string,
): { row: number; col: number } | null => {
  const target = normalizeText(label);
  const upper = Math.min(grid.length - 1, endRow);
  for (let r = startRow; r <= upper; r += 1) {
    const row = grid[r] ?? [];
    for (let c = 0; c < row.length; c += 1) {
      const text = normalizeText(row[c]);
      if (text && text.includes(target)) {
        return { row: r, col: c };
      }
    }
  }
  return null;
};

const collectNumbersBelow = (
  grid: Grid,
  row: number,
  col: number,
  maxRows: number,
): number[] => {
  const values: number[] = [];
  const upper = Math.min(grid.length - 1, row + maxRows);
  for (let r = row + 1; r <= upper; r += 1) {
    const cell = grid[r]?.[col];
    const numeric = coerceNumber(cell);
    if (numeric == null) continue;
    values.push(numeric);
  }
  return values;
};

const collectRowNumbers = (row: CellValue[], startCol: number): number[] => {
  const values: number[] = [];
  for (let c = startCol; c < row.length; c += 1) {
    const numeric = coerceNumber(row[c]);
    if (numeric == null) continue;
    values.push(numeric);
  }
  return values;
};

const formatHeaderValue = (value: CellValue): string => {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'number') {
    const date = coerceDate(value);
    if (date) return date.toISOString().slice(0, 10);
  }
  return String(value ?? '').trim();
};

const isDateHeaderValue = (value: CellValue): boolean => coerceDate(value) != null;

type KpiTableCandidate = {
  headerRowIndex: number;
  labelColumnIndex: number;
  headerValues: string[];
  columnMap: { daily: number | null; mtd: number | null; ytd: number | null };
  rows: Record<string, { label: string; cells: CellValue[] }>;
};

type KpiTableMatch = {
  table: KpiTableCandidate | null;
  matchedRows: Record<string, { label: string; cells: CellValue[] }>;
  matchedLabels: string[];
};

const normalizeLabelKey = (value: unknown): string =>
  normalizeText(value).replace(/\s+/g, '');

const findKpiTableCandidates = (grid: Grid): KpiTableCandidate[] => {
  const candidates: KpiTableCandidate[] = [];
  for (let r = 0; r < grid.length; r += 1) {
    const row = grid[r] ?? [];
    if (!row.length) continue;
    const headerTokens = row.map((cell) => normalizeHeaderToken(cell));
    const kpiIndexes = headerTokens
      .map((header, idx) => (header === 'kpi' ? idx : -1))
      .filter((idx) => idx >= 0);
    if (!kpiIndexes.length) continue;

    const headerValues = row.map((cell) => formatHeaderValue(cell));

    kpiIndexes.forEach((kpiIndex) => {
      const mtdIndex = headerTokens.findIndex((header, idx) => header === 'mtd' && idx > kpiIndex);
      const ytdIndex = headerTokens.findIndex((header, idx) => header === 'ytd' && idx > kpiIndex);
      if (mtdIndex < 0 || ytdIndex < 0) return;
      if (ytdIndex <= mtdIndex) return;

      let dateIndex: number | null = null;
      for (let idx = kpiIndex + 1; idx < mtdIndex; idx += 1) {
        if (isDateHeaderValue(row[idx])) {
          dateIndex = idx;
          break;
        }
      }
      if (dateIndex == null) return;

      const rows: Record<string, { label: string; cells: CellValue[] }> = {};
      for (let rr = r + 1; rr < grid.length; rr += 1) {
        const rowCells = grid[rr] ?? [];
        const labelCell = rowCells[kpiIndex] ?? null;
        const label = String(labelCell ?? '').trim();
        if (!label) break;
        const normalizedLabel = normalizeText(label);
        if (!normalizedLabel) continue;
        rows[normalizedLabel] = { label, cells: rowCells };
      }

      candidates.push({
        headerRowIndex: r,
        labelColumnIndex: kpiIndex,
        headerValues,
        columnMap: { daily: dateIndex, mtd: mtdIndex, ytd: ytdIndex },
        rows,
      });
    });
  }
  return candidates;
};

const findRowByVariants = (
  rows: Record<string, { label: string; cells: CellValue[] }>,
  variants: string[],
): { label: string; cells: CellValue[] } | null => {
  if (!variants.length) return null;
  for (const variant of variants) {
    const normalized = normalizeText(variant);
    const direct = rows[normalized];
    if (direct) return direct;
  }
  const rowEntries = Object.entries(rows).map(([key, row]) => ({
    key,
    compact: normalizeLabelKey(key),
    row,
  }));
  for (const variant of variants) {
    const compact = normalizeLabelKey(variant);
    if (!compact) continue;
    const exact = rowEntries.find((entry) => entry.compact === compact);
    if (exact) return exact.row;
  }
  for (const variant of variants) {
    const compact = normalizeLabelKey(variant);
    if (!compact) continue;
    const match = rowEntries.find(
      (entry) => entry.compact.includes(compact) || compact.includes(entry.compact),
    );
    if (match) return match.row;
  }
  return null;
};

const selectKpiTable = (
  candidates: KpiTableCandidate[],
  labelMap: Record<string, string[]>,
): KpiTableMatch => {
  let best: {
    table: KpiTableCandidate;
    matchedRows: Record<string, { label: string; cells: CellValue[] }>;
    matchedLabels: string[];
    hits: number;
  } | null = null;

  candidates.forEach((candidate) => {
    const matchedRows: Record<string, { label: string; cells: CellValue[] }> = {};
    const matchedLabels: string[] = [];
    Object.entries(labelMap).forEach(([key, variants]) => {
      const row = findRowByVariants(candidate.rows, variants);
      if (!row) return;
      matchedRows[key] = row;
      matchedLabels.push(row.label);
    });
    const hits = Object.keys(matchedRows).length;
    if (!best || hits > best.hits) {
      best = { table: candidate, matchedRows, matchedLabels, hits };
    }
  });

  if (!best) {
    return { table: null, matchedRows: {}, matchedLabels: [] };
  }
  return {
    table: best.table,
    matchedRows: best.matchedRows,
    matchedLabels: best.matchedLabels,
  };
};

const buildSectionFlags = (snapshot: MsrSnapshotPayload): MsrParseSectionFlags => ({
  occupancy: Boolean(snapshot.occupancy && Object.values(snapshot.occupancy).some((value) => value != null)),
  revenue: Boolean(snapshot.revenue && Object.values(snapshot.revenue).some((value) => value != null)),
  rentals: Boolean(snapshot.rentals && Object.values(snapshot.rentals).some((value) => value != null)),
  leads: Boolean(snapshot.leads && Object.values(snapshot.leads).some((value) => value != null)),
  ar: Boolean(snapshot.ar && Object.values(snapshot.ar).some((value) => value != null)),
  pricing: Boolean(snapshot.pricing && Object.values(snapshot.pricing).some((value) => value != null)),
  autopay: Boolean(snapshot.autopay && Object.values(snapshot.autopay).some((value) => value != null)),
  coverage: Boolean(snapshot.coverage && Object.values(snapshot.coverage).some((value) => value != null)),
  concessions: Boolean(snapshot.concessions && Object.values(snapshot.concessions).some((value) => value != null)),
  unitMix: Boolean(snapshot.unitMix && Object.values(snapshot.unitMix).some((value) => value != null)),
  inventory: Boolean(snapshot.inventory && Object.values(snapshot.inventory).some((value) => value != null)),
});

const splitPropertyHeader = (
  value: CellValue,
): { propertyCode?: string; propertyName?: string } => {
  const raw = String(value ?? '').trim();
  if (!raw) return {};
  const match = raw.match(/^([A-Za-z0-9]+)\s*-\s*(.+)$/);
  if (!match) return { propertyName: raw };
  return { propertyCode: match[1].trim(), propertyName: match[2].trim() };
};
const extractMsrSheet = (
  grid: Grid,
  sheet: XLSX.WorkSheet,
  warnings: string[],
): Partial<MsrSnapshotPayload> => {
  const snapshot: Partial<MsrSnapshotPayload> = {};
  const propertyHeader = readCellValue(sheet, 'K1');
  const propertyAddress = readCellValue(sheet, 'K2');
  const reportDateValue = readCellValue(sheet, 'A3');
  const reportDate = coerceDate(reportDateValue);

  Object.assign(snapshot, splitPropertyHeader(propertyHeader));
  if (propertyAddress) snapshot.propertyAddress = String(propertyAddress ?? '').trim();
  snapshot.reportDate = formatIsoDate(reportDate);
  snapshot.reportMonthIso = formatMonthIso(reportDate);
  if (snapshot.reportMonthIso) snapshot.monthIso = snapshot.reportMonthIso;

  if (!snapshot.propertyName) warnings.push('MSR sheet: property header not found at K1.');
  if (!snapshot.propertyAddress) warnings.push('MSR sheet: property address not found at K2.');
  if (!snapshot.reportDate) warnings.push('MSR sheet: report date not found at A3.');

  const netRevenueAnchor = findCellByAnchor(grid, ['net revenue']);
  if (!netRevenueAnchor) {
    warnings.push('MSR sheet: Net Revenue anchor not found.');
  } else {
    const values = collectNumbersBelow(grid, netRevenueAnchor.row, netRevenueAnchor.col, 6);
    if (!values.length) {
      warnings.push('MSR sheet: Net Revenue values missing.');
    } else {
      snapshot.revenue = {
        netRevenueMtd: values[0],
        netRevenueSameDayLastMonth: values[1],
        netRevenueSameDayLastYear: values[2],
      };
    }
  }

  const revenueAnchor = findCellByAnchor(grid, ['revenue statistics']);
  if (!revenueAnchor) {
    warnings.push('MSR sheet: Revenue Statistics anchor not found.');
  } else {
    const revenue = snapshot.revenue ?? {};
    const econRow = findRowByLabel(grid, revenueAnchor.row + 1, revenueAnchor.row + 12, 'economic occupancy');
    if (econRow) {
      const row = grid[econRow.row] ?? [];
      const values = collectRowNumbers(row, econRow.col + 1);
      if (values[0] != null) revenue.economicOccupancy = values[0];
      if (values[1] != null) revenue.economicOccPerSqft = values[1];
    } else {
      warnings.push('MSR sheet: Economic Occupancy row not found.');
    }
    const varianceRow = findRowByLabel(grid, revenueAnchor.row + 1, revenueAnchor.row + 12, 'occupied rate variance');
    if (varianceRow) {
      const row = grid[varianceRow.row] ?? [];
      const values = collectRowNumbers(row, varianceRow.col + 1);
      if (values[0] != null) {
        const variancePct = coercePercent(values[0]);
        if (variancePct != null) {
          revenue.occupiedRateVariancePct = variancePct;
          const pricing = snapshot.pricing ?? {};
          pricing.occupiedRateVariancePct = variancePct;
          snapshot.pricing = pricing;
        }
      }
    } else {
      warnings.push('MSR sheet: Occupied Rate Variance row not found.');
    }
    snapshot.revenue = revenue;
  }

  const perfAnchor = findCellByAnchor(grid, ['performance indicators']);
  if (!perfAnchor) {
    warnings.push('MSR sheet: Performance Indicators anchor not found.');
  } else {
    const autopayRow = findRowByLabel(grid, perfAnchor.row + 1, perfAnchor.row + 16, 'autopay enrollment');
    const coverageRow = findRowByLabel(grid, perfAnchor.row + 1, perfAnchor.row + 16, 'coverage enrollment');
    const overlockRow = findRowByLabel(grid, perfAnchor.row + 1, perfAnchor.row + 16, 'overlocked spaces');
    const noChangeRow = findRowByLabel(
      grid,
      perfAnchor.row + 1,
      perfAnchor.row + 18,
      'no rent change',
    );

    if (autopayRow) {
      const row = grid[autopayRow.row] ?? [];
      const values = collectRowNumbers(row, autopayRow.col + 1);
      snapshot.autopay = {
        enrolledCount: values[0],
        enrolledPct: values[1] != null ? coercePercent(values[1]) : undefined,
        autopayCount: values[0],
        autopayPct: values[1] != null ? coercePercent(values[1]) : undefined,
      };
    } else {
      warnings.push('MSR sheet: Autopay Enrollment row not found.');
    }

    if (coverageRow) {
      const row = grid[coverageRow.row] ?? [];
      const values = collectRowNumbers(row, coverageRow.col + 1);
      snapshot.coverage = {
        enrolledCount: values[0],
        enrolledPct: values[1] != null ? coercePercent(values[1]) : undefined,
      };
    } else {
      warnings.push('MSR sheet: Coverage Enrollment row not found.');
    }

    if (overlockRow) {
      const row = grid[overlockRow.row] ?? [];
      const values = collectRowNumbers(row, overlockRow.col + 1);
      if (!snapshot.ar) snapshot.ar = {};
      if (values[0] != null) {
        snapshot.ar.overlockedUnitCount = values[0];
      }
    }

    if (noChangeRow) {
      const row = grid[noChangeRow.row] ?? [];
      const values = collectRowNumbers(row, noChangeRow.col + 1);
      if (!snapshot.pricing) snapshot.pricing = {};
      if (values[0] != null) snapshot.pricing.noRentChange12MoCount = values[0];
    }
  }

  const statsAnchor = findCellByAnchor(grid, ['space statistics']);
  if (statsAnchor) {
    const headerRow = findHeaderRow(grid, statsAnchor.row + 1, statsAnchor.row + 6, [['occupied']]);
    let occupiedCol: number | null = null;
    if (headerRow != null) {
      const headers = (grid[headerRow] ?? []).map((cell) => normalizeText(cell));
      occupiedCol = findHeaderIndex(headers, ['occupied']);
    }
    const occupancy = snapshot.occupancy ?? {};
    const rentSpaceRow = findRowByLabel(grid, statsAnchor.row + 1, statsAnchor.row + 12, 'average rent/space');
    const rentSqftRow = findRowByLabel(grid, statsAnchor.row + 1, statsAnchor.row + 12, 'average rent sq');
    if (rentSpaceRow) {
      const row = grid[rentSpaceRow.row] ?? [];
      let value: number | null = null;
      if (occupiedCol != null) value = coerceNumber(row[occupiedCol]);
      if (value == null) {
        const values = collectRowNumbers(row, rentSpaceRow.col + 1);
        value = values[0] ?? null;
      }
      if (value != null) occupancy.avgRentPerSpaceOccupied = value;
    }
    if (rentSqftRow) {
      const row = grid[rentSqftRow.row] ?? [];
      let value: number | null = null;
      if (occupiedCol != null) value = coerceNumber(row[occupiedCol]);
      if (value == null) {
        const values = collectRowNumbers(row, rentSqftRow.col + 1);
        value = values[0] ?? null;
      }
      if (value != null) occupancy.avgRentPerSqftOccupied = value;
    }
    snapshot.occupancy = occupancy;
  }

  return snapshot;
};

const extractSpaceOccupancyFromMsr = (
  grid: Grid,
  warnings: string[],
): {
  occupancy: Partial<MsrSnapshotPayload['occupancy']>;
  anchorFound: boolean;
  headerRowIndex: number | null;
  columnMap: Record<'count' | 'spacePct' | 'sqft' | 'rsfPct', number | null>;
} => {
  const anchor = findCellByAnchor(grid, ['space occupancy']);
  if (!anchor) {
    warnings.push('MSR sheet: Space Occupancy anchor not found.');
    return {
      occupancy: {},
      anchorFound: false,
      headerRowIndex: null,
      columnMap: { count: null, spacePct: null, sqft: null, rsfPct: null },
    };
  }

  const headerRow = findHeaderRow(
    grid,
    anchor.row + 1,
    anchor.row + 10,
    [['count'], ['% space', 'space %'], ['sq ft', 'sqft'], ['% sq ft', '% sqft']],
  );
  if (headerRow == null) {
    warnings.push('MSR sheet: Space Occupancy header row not found.');
    return {
      occupancy: {},
      anchorFound: true,
      headerRowIndex: null,
      columnMap: { count: null, spacePct: null, sqft: null, rsfPct: null },
    };
  }

  const headers = (grid[headerRow] ?? []).map((cell) => normalizeHeaderCell(cell));
  const countCol = findHeaderIndexByAliases(headers, ['count', 'spaces'].map(normalizeHeaderCell));
  const spacePctCol = findHeaderIndexByAliases(
    headers,
    ['% space', 'space %', 'percent space'].map(normalizeHeaderCell),
  );
  const sqftCol = findHeaderIndexByAliases(headers, ['sq ft', 'sqft', 'square feet'].map(normalizeHeaderCell));
  const rsfPctCol = findHeaderIndexByAliases(
    headers,
    ['% sq ft', '% sqft', 'percent sq ft'].map(normalizeHeaderCell),
  );

  const occupancy: Partial<MsrSnapshotPayload['occupancy']> = {};
  const labelRows = [
    { key: 'occupied', label: 'occupied' },
    { key: 'vacant', label: 'vacant' },
    { key: 'offline', label: 'offline' },
    { key: 'total', label: 'total' },
  ] as const;

  labelRows.forEach(({ key, label }) => {
    const rowInfo = findRowByLabel(grid, headerRow + 1, headerRow + 12, label);
    if (!rowInfo) return;
    const row = grid[rowInfo.row] ?? [];
    const countValue = countCol != null ? coerceNumber(row[countCol]) : null;
    const spacePct = spacePctCol != null ? coercePercent(row[spacePctCol]) : null;
    const sqftValue = sqftCol != null ? coerceNumber(row[sqftCol]) : null;
    const rsfPct = rsfPctCol != null ? coercePercent(row[rsfPctCol]) : null;

    if (key === 'occupied') {
      if (countValue != null) occupancy.occupiedCount = countValue;
      if (spacePct != null) occupancy.spaceOccPct = spacePct;
      if (sqftValue != null) occupancy.occupiedRsf = sqftValue;
      if (rsfPct != null) occupancy.rsfOccPct = rsfPct;
    }
    if (key === 'vacant') {
      if (countValue != null) occupancy.vacantCount = countValue;
      if (sqftValue != null) occupancy.vacantRsf = sqftValue;
    }
    if (key === 'offline') {
      if (countValue != null) occupancy.offlineCount = countValue;
      if (sqftValue != null) occupancy.offlineRsf = sqftValue;
    }
    if (key === 'total') {
      if (countValue != null) occupancy.totalCount = countValue;
      if (sqftValue != null) occupancy.totalRsf = sqftValue;
    }
  });

  return {
    occupancy,
    anchorFound: true,
    headerRowIndex: headerRow,
    columnMap: {
      count: countCol,
      spacePct: spacePctCol,
      sqft: sqftCol,
      rsfPct: rsfPctCol,
    },
  };
};

const RENTAL_ACTIVITY_ROW_LABELS: Record<string, string[]> = {
  'move ins': ['move ins', 'move-ins', 'moveins', 'move in', 'move-in'],
  'move outs': ['move outs', 'move-outs', 'moveouts', 'move out', 'move-out'],
  net: ['net', 'net move-ins', 'net moveins'],
};

const LEADS_ROW_LABELS: Record<string, string[]> = {
  total: ['total', 'total leads', 'leads total'],
  converted: ['converted', 'conversions'],
  'conversion rate': ['conversion rate', 'conversion %', 'conversion pct', 'conversion percent'],
};

const extractRentalActivityFromMsr = (
  grid: Grid,
  warnings: string[],
): { rentals: Partial<MsrSnapshotPayload['rentals']>; diagnostics: KpiTableDiagnostics } => {
  const candidates = findKpiTableCandidates(grid);
  const match = selectKpiTable(candidates, RENTAL_ACTIVITY_ROW_LABELS);
  const diagnostics: KpiTableDiagnostics = {
    tableFound: false,
    headerRowIndex: null,
    headerValues: undefined,
    labelColumnIndex: null,
    columnMap: { daily: null, mtd: null, ytd: null },
    selectedMtdIndex: null,
    matchedRowLabels: [],
    extracted: {},
    candidateTables: candidates.map((candidate) => ({
      headerRowIndex: candidate.headerRowIndex,
      headerValues: candidate.headerValues,
    })),
  };

  const requiredCount = Object.keys(RENTAL_ACTIVITY_ROW_LABELS).length;
  if (!match.table || match.matchedLabels.length < requiredCount) {
    warnings.push('MSR sheet: No matching KPI table found for Rental Activity.');
    return { rentals: {}, diagnostics };
  }

  const table = match.table;
  diagnostics.tableFound = true;
  diagnostics.headerRowIndex = table.headerRowIndex;
  diagnostics.headerValues = table.headerValues;
  diagnostics.labelColumnIndex = table.labelColumnIndex;
  diagnostics.columnMap = { ...table.columnMap };
  diagnostics.selectedMtdIndex = table.columnMap.mtd;
  diagnostics.matchedRowLabels = match.matchedLabels;

  const rentals: Partial<MsrSnapshotPayload['rentals']> = {};
  Object.keys(RENTAL_ACTIVITY_ROW_LABELS).forEach((key) => {
    const row = match.matchedRows[key];
    if (!row) return;
    const dailyValue =
      table.columnMap.daily != null ? coerceNumber(row.cells[table.columnMap.daily]) : null;
    const mtdValue =
      table.columnMap.mtd != null ? coerceNumber(row.cells[table.columnMap.mtd]) : null;
    const ytdValue =
      table.columnMap.ytd != null ? coerceNumber(row.cells[table.columnMap.ytd]) : null;
    diagnostics.extracted![key] = {
      daily: dailyValue,
      mtd: mtdValue,
      ytd: ytdValue,
    };
    if (key === 'move ins' && mtdValue != null) rentals.moveInsMtd = mtdValue;
    if (key === 'move outs' && mtdValue != null) rentals.moveOutsMtd = mtdValue;
    if (key === 'net' && mtdValue != null) rentals.netMoveInsMtd = mtdValue;
  });

  return { rentals, diagnostics };
};

const extractLeadsFromMsr = (
  grid: Grid,
  warnings: string[],
  rentals?: MsrSnapshotPayload['rentals'],
): { leads: Partial<MsrSnapshotPayload['leads']>; diagnostics: KpiTableDiagnostics } => {
  const candidates = findKpiTableCandidates(grid);
  const match = selectKpiTable(candidates, LEADS_ROW_LABELS);
  const diagnostics: KpiTableDiagnostics = {
    tableFound: false,
    headerRowIndex: null,
    headerValues: undefined,
    labelColumnIndex: null,
    columnMap: { daily: null, mtd: null, ytd: null },
    selectedMtdIndex: null,
    matchedRowLabels: [],
    extracted: {},
    candidateTables: candidates.map((candidate) => ({
      headerRowIndex: candidate.headerRowIndex,
      headerValues: candidate.headerValues,
    })),
  };

  const requiredCount = Object.keys(LEADS_ROW_LABELS).length;
  if (!match.table || match.matchedLabels.length < requiredCount) {
    warnings.push('MSR sheet: No matching KPI table found for Leads.');
    return { leads: {}, diagnostics };
  }

  const table = match.table;
  diagnostics.tableFound = true;
  diagnostics.headerRowIndex = table.headerRowIndex;
  diagnostics.headerValues = table.headerValues;
  diagnostics.labelColumnIndex = table.labelColumnIndex;
  diagnostics.columnMap = { ...table.columnMap };
  diagnostics.selectedMtdIndex = table.columnMap.mtd;
  diagnostics.matchedRowLabels = match.matchedLabels;

  const leads: Partial<MsrSnapshotPayload['leads']> = {};
  Object.keys(LEADS_ROW_LABELS).forEach((key) => {
    const row = match.matchedRows[key];
    if (!row) return;
    const isRate = key === 'conversion rate';
    const readValue = (index: number | null) => {
      if (index == null) return null;
      return isRate ? coercePercent(row.cells[index]) : coerceNumber(row.cells[index]);
    };
    const dailyValue = readValue(table.columnMap.daily);
    const mtdValue = readValue(table.columnMap.mtd);
    const ytdValue = readValue(table.columnMap.ytd);
    diagnostics.extracted![key] = {
      daily: dailyValue,
      mtd: mtdValue,
      ytd: ytdValue,
    };
    if (key === 'total' && mtdValue != null) leads.totalMtd = mtdValue;
    if (key === 'converted' && mtdValue != null) leads.convertedMtd = mtdValue;
    if (key === 'conversion rate') {
      const rateValue = mtdValue;
      if (rateValue != null) leads.conversionRatePctMtd = rateValue;
    }
  });

  if (!isFiniteNumber(leads.conversionRatePctMtd)) {
    const totalMtd = leads.totalMtd;
    const moveInsMtd = rentals?.moveInsMtd;
    if (isFiniteNumber(totalMtd) && totalMtd > 0 && isFiniteNumber(moveInsMtd)) {
      leads.conversionRatePctMtd = moveInsMtd / totalMtd;
    }
  }

  return { leads, diagnostics };
};

const extractOccupancySheet = (
  grid: Grid,
  warnings: string[],
  sheetName?: string,
): OccupancyParseResult => {
  const headerCandidates = collectHeaderCandidates(grid, 50, 5);
  const maxRows = Math.min(grid.length, 50);
  let bestMatch: {
    rowIndex: number;
    mapping: Record<OccupancyColumnKey, number | null>;
    hits: number;
  } | null = null;

  for (let r = 0; r < maxRows; r += 1) {
    const row = grid[r] ?? [];
    const headers = row.map((cell) => normalizeHeaderCell(cell));
    if (!headers.some(Boolean)) continue;
    const mapping: Record<OccupancyColumnKey, number | null> = {
      spaceNumber: findHeaderIndexByAliases(headers, OCCUPANCY_HEADER_ALIASES.spaceNumber),
      spaceType: findHeaderIndexByAliases(headers, OCCUPANCY_HEADER_ALIASES.spaceType),
      sqft: findHeaderIndexByAliases(headers, OCCUPANCY_HEADER_ALIASES.sqft),
      status: findHeaderIndexByAliases(headers, OCCUPANCY_HEADER_ALIASES.status),
      sellRate: findHeaderIndexByAliases(headers, OCCUPANCY_HEADER_ALIASES.sellRate),
      currentRent: findHeaderIndexByAliases(headers, OCCUPANCY_HEADER_ALIASES.currentRent),
    };
    const hits = OCCUPANCY_REQUIRED_KEYS.filter((key) => mapping[key] != null).length;
    if (!bestMatch || hits > bestMatch.hits) {
      bestMatch = { rowIndex: r, mapping, hits };
    }
    if (hits === OCCUPANCY_REQUIRED_KEYS.length) {
      bestMatch = { rowIndex: r, mapping, hits };
      break;
    }
  }

  const diagnostics: OccupancyParseDiagnostics = {
    sheetName,
    headerRowIndex: bestMatch?.rowIndex ?? null,
    headerCandidates,
    error: null,
  };

  if (!bestMatch) {
    warnings.push('Occupancy sheet: header row not found.');
    diagnostics.error = 'Occupancy tab parsed 0 rows. Header detection failed.';
    return { snapshot: {}, diagnostics, occupancyTypeLookup: new Map() };
  }

  const headerRow = grid[bestMatch.rowIndex] ?? [];
  diagnostics.columnMapping = {
    spaceNumber:
      bestMatch.mapping.spaceNumber != null
        ? String(headerRow[bestMatch.mapping.spaceNumber] ?? '').trim() || null
        : null,
    spaceType:
      bestMatch.mapping.spaceType != null
        ? String(headerRow[bestMatch.mapping.spaceType] ?? '').trim() || null
        : null,
    sqft:
      bestMatch.mapping.sqft != null
        ? String(headerRow[bestMatch.mapping.sqft] ?? '').trim() || null
        : null,
    status:
      bestMatch.mapping.status != null
        ? String(headerRow[bestMatch.mapping.status] ?? '').trim() || null
        : null,
    sellRate:
      bestMatch.mapping.sellRate != null
        ? String(headerRow[bestMatch.mapping.sellRate] ?? '').trim() || null
        : null,
    currentRent:
      bestMatch.mapping.currentRent != null
        ? String(headerRow[bestMatch.mapping.currentRent] ?? '').trim() || null
        : null,
  };

  if (OCCUPANCY_REQUIRED_KEYS.some((key) => bestMatch.mapping[key] == null)) {
    warnings.push('Occupancy sheet: required columns missing.');
    diagnostics.error = 'Occupancy tab parsed 0 rows. Header detection failed.';
    return { snapshot: {}, diagnostics, occupancyTypeLookup: new Map() };
  }

  const colSpaceNumber = bestMatch.mapping.spaceNumber!;
  const colSpaceType = bestMatch.mapping.spaceType!;
  const colSqft = bestMatch.mapping.sqft!;
  const colStatus = bestMatch.mapping.status!;
  const colSellRate = bestMatch.mapping.sellRate!;
  const colCurrentRent = bestMatch.mapping.currentRent!;
  const headerNormalized = headerRow.map((cell) => normalizeHeaderCell(cell));
  const colSpaceSize = findHeaderIndexByAliases(
    headerNormalized,
    ['space size', 'size'].map(normalizeHeaderCell),
  );

  const occupiedRsfByType: Record<string, number> = {};
  const vacantUnitsSample: Array<{ unit?: string; type?: string; size?: string; status?: string }> = [];
  const occupancyTypeLookup = new Map<string, string>();

  let blankSpaceStreak = 0;
  let totalRows = 0;
  let occupiedRows = 0;
  let vacantRows = 0;
  let offlineRows = 0;
  let unknownRows = 0;

  let totalRsf = 0;
  let totalOccupiedRsf = 0;
  let totalVacantRsf = 0;
  let totalOfflineRsf = 0;

  let sellRateSum = 0;
  let sellRateCount = 0;
  let sellRateSqftSum = 0;
  let currentRentSum = 0;
  let currentRentCount = 0;
  let currentRentSqftSum = 0;

  for (let r = bestMatch.rowIndex + 1; r < grid.length; r += 1) {
    const row = grid[r] ?? [];
    if (isBlankRow(row)) break;
    const spaceNumberRaw = String(row[colSpaceNumber] ?? '').trim();
    if (!spaceNumberRaw) {
      blankSpaceStreak += 1;
      if (blankSpaceStreak > 5) break;
      continue;
    }
    blankSpaceStreak = 0;

    const sqft = coerceNumber(row[colSqft]);
    if (sqft == null) continue;

    totalRows += 1;
    totalRsf += sqft;

    const statusRaw = String(row[colStatus] ?? '').trim();
    const status = normalizeOccupancyStatus(statusRaw);
    const typeRaw = normalizeSpaceType(row[colSpaceType]);
    const typeLabel = typeRaw || 'Unknown';
    const sizeRaw =
      colSpaceSize != null ? String(row[colSpaceSize] ?? '').trim() : sqft != null ? String(sqft) : '';
    const sellRate = coerceNumber(row[colSellRate]);
    const currentRent = coerceNumber(row[colCurrentRent]);

    buildSpaceKeyVariants(spaceNumberRaw).forEach((key) => {
      if (typeRaw) occupancyTypeLookup.set(key, typeRaw);
    });

    if (status === 'occupied') {
      occupiedRows += 1;
      totalOccupiedRsf += sqft;
      occupiedRsfByType[typeLabel] = (occupiedRsfByType[typeLabel] ?? 0) + sqft;
      if (sellRate != null) {
        sellRateSum += sellRate;
        sellRateCount += 1;
        sellRateSqftSum += sqft;
      }
      if (currentRent != null) {
        currentRentSum += currentRent;
        currentRentCount += 1;
        currentRentSqftSum += sqft;
      }
    } else {
      if (status === 'vacant') vacantRows += 1;
      else if (status === 'offline') offlineRows += 1;
      else unknownRows += 1;
      if (status === 'vacant') totalVacantRsf += sqft;
      if (status === 'offline') totalOfflineRsf += sqft;
      if (vacantUnitsSample.length < 25) {
        vacantUnitsSample.push({
          unit: spaceNumberRaw,
          type: typeRaw || undefined,
          size: sizeRaw || undefined,
          status: statusRaw || undefined,
        });
      }
    }
  }

  diagnostics.rowCounts = {
    total: totalRows,
    occupied: occupiedRows,
    vacant: vacantRows,
    offline: offlineRows,
    unknown: unknownRows,
  };

  if (totalRows === 0) {
    warnings.push('Occupancy sheet: parsed 0 rows.');
    diagnostics.error = 'Occupancy tab parsed 0 rows. Header detection failed.';
    return { snapshot: {}, diagnostics, occupancyTypeLookup };
  }

  const pricing: MsrSnapshotPayload['pricing'] = {};
  const avgSellRate = sellRateCount ? sellRateSum / sellRateCount : undefined;
  const avgCurrentRent = currentRentCount ? currentRentSum / currentRentCount : undefined;
  if (avgSellRate != null) pricing.avgSellRateOccupied = avgSellRate;
  if (avgCurrentRent != null) pricing.avgCurrentRentOccupied = avgCurrentRent;
  if (sellRateSqftSum > 0) pricing.avgSellRatePerSqftOccupied = sellRateSum / sellRateSqftSum;
  if (currentRentSqftSum > 0) pricing.avgCurrentRentPerSqftOccupied = currentRentSum / currentRentSqftSum;
  if (avgSellRate != null && avgCurrentRent != null && avgSellRate !== 0) {
    pricing.spreadPct = (avgCurrentRent - avgSellRate) / avgSellRate;
  }

  const unitMix: MsrSnapshotPayload['unitMix'] = {};
  if (Object.keys(occupiedRsfByType).length) unitMix.occupiedRsfByType = occupiedRsfByType;
  if (totalRows > 0) unitMix.totalRsf = totalRsf;
  if (totalRows > 0) unitMix.totalOccupiedRsf = totalOccupiedRsf;
  if (totalRsf > 0) unitMix.occupiedPct = totalOccupiedRsf / totalRsf;
  if (totalOccupiedRsf > 0 && Object.keys(occupiedRsfByType).length) {
    const pctByType: Record<string, number> = {};
    Object.entries(occupiedRsfByType).forEach(([key, value]) => {
      pctByType[key] = value / totalOccupiedRsf;
    });
    unitMix.occupiedPctByType = pctByType;
  }

  const occupancySummary: MsrSnapshotPayload['occupancy'] = {};
  const totalCount = occupiedRows + vacantRows + offlineRows;
  if (totalCount > 0) {
    occupancySummary.totalCount = totalCount;
    occupancySummary.occupiedCount = occupiedRows;
    occupancySummary.vacantCount = vacantRows;
    occupancySummary.offlineCount = offlineRows;
    occupancySummary.totalRsf = totalRsf;
    occupancySummary.occupiedRsf = totalOccupiedRsf;
    occupancySummary.vacantRsf = totalVacantRsf;
    occupancySummary.offlineRsf = totalOfflineRsf;
    if (totalCount > 0) {
      occupancySummary.spaceOccPct = occupiedRows / totalCount;
    }
    if (totalRsf > 0) {
      occupancySummary.rsfOccPct = totalOccupiedRsf / totalRsf;
    }
  }

  const snapshot: Partial<MsrSnapshotPayload> = {};
  if (Object.values(pricing).some((value) => value != null)) snapshot.pricing = pricing;
  if (Object.values(unitMix).some((value) => value != null)) snapshot.unitMix = unitMix;
  if (vacantUnitsSample.length) snapshot.inventory = { vacantUnitsSample };

  const summary = Object.values(occupancySummary).some((value) => value != null) ? occupancySummary : undefined;
  return { snapshot, diagnostics, occupancyTypeLookup, summary };
};

const extractDelinquenciesSheet = (grid: Grid, warnings: string[]): Partial<MsrSnapshotPayload> => {
  const headerRow = findHeaderRow(
    grid,
    0,
    25,
    [
      ['tenant', 'name'],
      ['space', 'unit'],
      ['days late', 'days'],
      ['past due', 'amount', 'balance'],
    ],
  );
  if (headerRow == null) {
    warnings.push('Delinquencies sheet: header row not found.');
    return {};
  }
  const headers = (grid[headerRow] ?? []).map((cell) => normalizeText(cell));
  const colTenant = findHeaderIndex(headers, ['tenant name', 'tenant']);
  const colUnit = findHeaderIndex(headers, ['space number', 'space', 'unit']);
  const colDays = findHeaderIndex(headers, ['days late', 'days']);
  const colPastDue = findHeaderIndex(headers, ['past due', 'amount', 'balance']);
  const colMoveIn = findHeaderIndex(headers, ['move in', 'start date', 'lease start']);

  const rows: Array<{
    tenant?: string;
    unit?: string;
    daysLate?: number;
    balance?: number;
    startDate?: string;
  }> = [];

  let totalPastDue = 0;
  let pastDue61 = 0;
  const aging = {
    days0to10: 0,
    days11to30: 0,
    days31to60: 0,
    days61plus: 0,
  };

  for (let r = headerRow + 1; r < grid.length; r += 1) {
    const row = grid[r] ?? [];
    if (isBlankRow(row)) break;
    const tenant = colTenant != null ? String(row[colTenant] ?? '').trim() : '';
    const unit = colUnit != null ? String(row[colUnit] ?? '').trim() : '';
    const tenantNormalized = normalizeText(tenant);
    const unitNormalized = normalizeText(unit);
    const numericOnly = (value: string): boolean => /^\d+$/.test(value);
    const isNumericTenant = tenant ? numericOnly(tenant) : false;
    const isNumericUnit = unit ? numericOnly(unit) : false;
    const isTotalRow =
      ['total', 'totals', 'grand total'].includes(tenantNormalized) ||
      ['total', 'totals', 'grand total'].includes(unitNormalized) ||
      (tenantNormalized.includes('total') && !unitNormalized);
    if (isTotalRow || (isNumericTenant && isNumericUnit)) continue;
    const daysLate = colDays != null ? coerceNumber(row[colDays]) : null;
    const balance = colPastDue != null ? coerceNumber(row[colPastDue]) : null;
    const moveInRaw = colMoveIn != null ? row[colMoveIn] : null;
    const moveInDate = coerceDate(moveInRaw);
    if (!tenant && !unit) continue;

    const numericBalance = balance ?? 0;
    totalPastDue += numericBalance;
    if (daysLate != null) {
      if (daysLate <= 10) aging.days0to10 += numericBalance;
      else if (daysLate <= 30) aging.days11to30 += numericBalance;
      else if (daysLate <= 60) aging.days31to60 += numericBalance;
      else aging.days61plus += numericBalance;
      if (daysLate >= 61) pastDue61 += numericBalance;
    }

    rows.push({
      tenant: tenant || undefined,
      unit: unit || undefined,
      daysLate: daysLate ?? undefined,
      balance: balance ?? undefined,
      startDate: formatIsoDate(moveInDate),
    });
  }

  rows.sort((a, b) => (b.balance ?? 0) - (a.balance ?? 0));

  return {
    ar: {
      totalPastDue,
      pastDue61Plus: pastDue61,
      delinquentTenantCount: rows.length,
      agingBuckets: { ...aging },
      aging: { ...aging },
      topDelinquencies: rows.slice(0, 10),
    },
  };
};

const extractOverlockFromSheet = (
  grid: Grid,
  warnings: string[],
  sheetName?: string,
): { snapshot: Partial<MsrSnapshotPayload>; diagnostics: OverlockSheetDiagnostics } => {
  const diagnostics: OverlockSheetDiagnostics = {
    sheetName,
    headerRowIndex: null,
    columnMapping: undefined,
    rowCount: undefined,
    overlockedUnitCount: undefined,
    totalBalance: undefined,
    avgDaysLate: null,
    bucketPct: undefined,
    error: null,
  };

  const maxRows = Math.min(grid.length, 50);
  let headerRow: number | null = null;
  let colSpace: number | null = null;
  let colDays: number | null = null;
  let colBalance: number | null = null;
  const spaceAliases = OVERLOCK_HEADER_ALIASES.spaceNumber.map(normalizeHeaderCell);
  const daysAliases = OVERLOCK_HEADER_ALIASES.daysLate.map(normalizeHeaderCell);
  const balanceAliases = OVERLOCK_HEADER_ALIASES.balance.map(normalizeHeaderCell);

  for (let r = 0; r < maxRows; r += 1) {
    const row = grid[r] ?? [];
    const headers = row.map((cell) => normalizeHeaderCell(cell));
    const spaceIndex = findHeaderIndexByAliases(headers, spaceAliases);
    const daysIndex = findHeaderIndexByAliases(headers, daysAliases);
    const balanceIndex = findHeaderIndexByAliases(headers, balanceAliases);
    if (spaceIndex != null && daysIndex != null && balanceIndex != null) {
      headerRow = r;
      colSpace = spaceIndex;
      colDays = daysIndex;
      colBalance = balanceIndex;
      break;
    }
  }

  if (headerRow == null || colSpace == null || colDays == null || colBalance == null) {
    warnings.push('Overlocked Spaces sheet: header row not found.');
    diagnostics.error = 'Header row not found.';
    return { snapshot: {}, diagnostics };
  }

  const headerRowValues = grid[headerRow] ?? [];
  diagnostics.headerRowIndex = headerRow;
  diagnostics.columnMapping = {
    spaceNumber: String(headerRowValues[colSpace] ?? '').trim() || null,
    daysLate: String(headerRowValues[colDays] ?? '').trim() || null,
    balance: String(headerRowValues[colBalance] ?? '').trim() || null,
  };

  let rowCount = 0;
  let totalBalance = 0;
  let totalDays = 0;
  let daysCount = 0;
  let blankSpaceStreak = 0;
  const buckets = {
    d0_10: 0,
    d11_30: 0,
    d31_60: 0,
    d61_plus: 0,
  };

  for (let r = headerRow + 1; r < grid.length; r += 1) {
    const row = grid[r] ?? [];
    const spaceRaw = String(row[colSpace] ?? '').trim();
    if (!spaceRaw) {
      blankSpaceStreak += 1;
      if (blankSpaceStreak > 5) break;
      continue;
    }
    blankSpaceStreak = 0;
    if (normalizeText(spaceRaw).includes('total')) continue;
    const daysLate = coerceNumber(row[colDays]);
    const balance = coerceNumber(row[colBalance]);
    if (daysLate == null && balance == null) continue;

    rowCount += 1;
    if (balance != null) totalBalance += balance;
    if (daysLate != null) {
      totalDays += daysLate;
      daysCount += 1;
      if (daysLate <= 10) buckets.d0_10 += 1;
      else if (daysLate <= 30) buckets.d11_30 += 1;
      else if (daysLate <= 60) buckets.d31_60 += 1;
      else buckets.d61_plus += 1;
    }
  }

  const avgDaysLate = daysCount ? totalDays / daysCount : null;
  const bucketPct =
    rowCount > 0
      ? {
          d0_10: (buckets.d0_10 / rowCount) * 100,
          d11_30: (buckets.d11_30 / rowCount) * 100,
          d31_60: (buckets.d31_60 / rowCount) * 100,
          d61_plus: (buckets.d61_plus / rowCount) * 100,
        }
      : undefined;
  const bucketShare = bucketPct
    ? [
        { label: '0-10', percent: bucketPct.d0_10 },
        { label: '11-30', percent: bucketPct.d11_30 },
        { label: '31-60', percent: bucketPct.d31_60 },
        { label: '61+', percent: bucketPct.d61_plus },
      ]
    : undefined;

  diagnostics.rowCount = rowCount;
  diagnostics.overlockedUnitCount = rowCount;
  diagnostics.totalBalance = totalBalance;
  diagnostics.avgDaysLate = avgDaysLate;
  diagnostics.bucketPct = bucketPct;

  return {
    snapshot: {
      ar: {
        overlock: {
          overlockedUnitCount: rowCount,
          totalBalance,
          avgDaysLate: avgDaysLate ?? undefined,
          bucketPct,
        },
        overlockedUnitCount: rowCount,
        overlockTotalBalance: totalBalance,
        overlockAvgDaysLate: avgDaysLate ?? undefined,
        overlockBucketShare: bucketShare,
      },
    },
    diagnostics,
  };
};

const extractRentChangeSheet = (grid: Grid, warnings: string[]): Partial<MsrSnapshotPayload> => {
  const headerRow = findHeaderRow(grid, 0, 25, [['rent change', 'variance', '%']]);
  if (headerRow == null) {
    warnings.push('Rent Change sheet: header row not found.');
    return {};
  }
  const headers = (grid[headerRow] ?? []).map((cell) => normalizeText(cell));
  const colVariance = findHeaderIndex(headers, ['rent change % variance', 'rent change', 'variance']);

  let count = 0;
  let totalPct = 0;
  for (let r = headerRow + 1; r < grid.length; r += 1) {
    const row = grid[r] ?? [];
    if (isBlankRow(row)) break;
    if (colVariance == null) continue;
    const pct = coercePercent(row[colVariance]);
    if (pct == null) continue;
    count += 1;
    totalPct += pct;
  }
  return {
    pricing: {
      rentChangeCount: count,
      avgRentChangePct: count ? totalPct / count : undefined,
    },
  };
};

const extractNoRentChangeSheet = (
  grid: Grid,
  warnings: string[],
  occupancyTypeBySpace: Map<string, string>,
): Partial<MsrSnapshotPayload> => {
  const maxRows = Math.min(grid.length, 50);
  let headerRow: number | null = null;
  for (let r = 0; r < maxRows; r += 1) {
    const row = grid[r] ?? [];
    const headers = row.map((cell) => normalizeHeaderCell(cell));
    if (headers.some((header) => NO_RENT_CHANGE_SPACE_ALIASES.some((alias) => header.includes(alias)))) {
      headerRow = r;
      break;
    }
  }
  if (headerRow == null) {
    warnings.push('No Rent Change Last 12 Months sheet: header row not found.');
    return {};
  }
  const headers = (grid[headerRow] ?? []).map((cell) => normalizeHeaderCell(cell));
  const colSpace = findHeaderIndexByAliases(headers, NO_RENT_CHANGE_SPACE_ALIASES);
  if (colSpace == null) {
    warnings.push('No Rent Change Last 12 Months sheet: space column not found.');
    return {};
  }

  let count = 0;
  const byType: Record<string, number> = {};
  for (let r = headerRow + 1; r < grid.length; r += 1) {
    const row = grid[r] ?? [];
    if (isBlankRow(row)) break;
    const spaceName = String(row[colSpace] ?? '').trim();
    if (!spaceName) continue;
    count += 1;
    const keyVariants = buildSpaceKeyVariants(spaceName);
    const type = keyVariants
      .map((key) => occupancyTypeBySpace.get(key))
      .find((value) => value) ?? 'Unknown';
    byType[type] = (byType[type] ?? 0) + 1;
  }

  return {
    pricing: {
      noRentChange12MoCount: count,
      noRentChange12MoByType: Object.keys(byType).length ? byType : undefined,
    },
  };
};

const extractCoverageEnrollmentSheet = (grid: Grid, warnings: string[]): Partial<MsrSnapshotPayload> => {
  const headerRow = findHeaderRow(grid, 0, 25, [['premium']]);
  if (headerRow == null) {
    warnings.push('Coverage Enrollment sheet: header row not found.');
    return {};
  }
  const headers = (grid[headerRow] ?? []).map((cell) => normalizeText(cell));
  const colPremium = findHeaderIndex(headers, ['premium']);

  let sum = 0;
  let rows = 0;
  for (let r = headerRow + 1; r < grid.length; r += 1) {
    const row = grid[r] ?? [];
    if (isBlankRow(row)) break;
    if (colPremium == null) continue;
    const value = coerceNumber(row[colPremium]);
    if (value == null) continue;
    sum += value;
    rows += 1;
  }

  return {
    coverage: {
      premiumSum: rows ? sum : undefined,
      premiumMtd: rows ? sum : undefined,
    },
  };
};

const extractConcessionSheet = (
  grid: Grid,
  warnings: string[],
  sheetLabel: string,
  sheetName?: string,
): { sum: number | null; diagnostics: ConcessionSheetDiagnostics } => {
  const diagnostics: ConcessionSheetDiagnostics = {
    sheetName,
    headerRowIndex: null,
    amountColumn: null,
    rowCount: undefined,
    sum: null,
    error: null,
  };

  const maxRows = Math.min(grid.length, 50);
  let headerRow: number | null = null;
  let amountCol: number | null = null;
  const amountAliases = CONCESSION_AMOUNT_ALIASES.map(normalizeHeaderCell);

  for (let r = 0; r < maxRows; r += 1) {
    const row = grid[r] ?? [];
    const headers = row.map((cell) => normalizeHeaderCell(cell));
    const amountIndex = findHeaderIndexByAliases(headers, amountAliases);
    if (amountIndex != null) {
      headerRow = r;
      amountCol = amountIndex;
      break;
    }
  }

  if (headerRow == null || amountCol == null) {
    warnings.push(`${sheetLabel} sheet: amount column header not found.`);
    diagnostics.error = 'Amount column header not found.';
    return { sum: null, diagnostics };
  }

  const headerRowValues = grid[headerRow] ?? [];
  diagnostics.headerRowIndex = headerRow;
  diagnostics.amountColumn = String(headerRowValues[amountCol] ?? '').trim() || null;

  let sum = 0;
  let rows = 0;
  let blankRowStreak = 0;
  for (let r = headerRow + 1; r < grid.length; r += 1) {
    const row = grid[r] ?? [];
    if (isBlankRow(row)) {
      blankRowStreak += 1;
      if (blankRowStreak > 5) break;
      continue;
    }
    blankRowStreak = 0;
    const value = coerceNumber(row[amountCol]);
    if (value == null) continue;
    sum += value;
    rows += 1;
  }

  diagnostics.rowCount = rows;
  diagnostics.sum = sum;

  return { sum, diagnostics };
};

const extractConcessions = (
  sheets: {
    discounts?: { sheet: XLSX.WorkSheet; name: string } | null;
    credits?: { sheet: XLSX.WorkSheet; name: string } | null;
    refunds?: { sheet: XLSX.WorkSheet; name: string } | null;
    writeOffs?: { sheet: XLSX.WorkSheet; name: string } | null;
  },
  warnings: string[],
): { snapshot: Partial<MsrSnapshotPayload>; diagnostics: ConcessionsDiagnostics } => {
  const diagnostics: ConcessionsDiagnostics = {};

  const discountsResult = sheets.discounts
    ? extractConcessionSheet(
        sheetToGrid(sheets.discounts.sheet),
        warnings,
        'Discounts & Promotions MTD',
        sheets.discounts.name,
      )
    : null;
  if (!sheets.discounts) {
    warnings.push('Workbook is missing "Discounts & Promotions MTD" worksheet.');
  }
  diagnostics.discounts = discountsResult?.diagnostics ?? {
    sheetName: undefined,
    error: 'Missing sheet.',
  };

  const creditsResult = sheets.credits
    ? extractConcessionSheet(
        sheetToGrid(sheets.credits.sheet),
        warnings,
        'Credits & Adjustments MTD',
        sheets.credits.name,
      )
    : null;
  if (!sheets.credits) {
    warnings.push('Workbook is missing "Credits & Adjustments MTD" worksheet.');
  }
  diagnostics.credits = creditsResult?.diagnostics ?? {
    sheetName: undefined,
    error: 'Missing sheet.',
  };

  const refundsResult = sheets.refunds
    ? extractConcessionSheet(
        sheetToGrid(sheets.refunds.sheet),
        warnings,
        'Refunds MTD',
        sheets.refunds.name,
      )
    : null;
  if (!sheets.refunds) {
    warnings.push('Workbook is missing "Refunds MTD" worksheet.');
  }
  diagnostics.refunds = refundsResult?.diagnostics ?? {
    sheetName: undefined,
    error: 'Missing sheet.',
  };

  const writeOffsResult = sheets.writeOffs
    ? extractConcessionSheet(
        sheetToGrid(sheets.writeOffs.sheet),
        warnings,
        'Write-Offs MTD',
        sheets.writeOffs.name,
      )
    : null;
  if (!sheets.writeOffs) {
    warnings.push('Workbook is missing "Write-Offs MTD" worksheet.');
  }
  diagnostics.writeOffs = writeOffsResult?.diagnostics ?? {
    sheetName: undefined,
    error: 'Missing sheet.',
  };

  const promos = discountsResult?.sum ?? null;
  const credits = creditsResult?.sum ?? null;
  const refunds = refundsResult?.sum ?? null;
  const writeOffs = writeOffsResult?.sum ?? null;

  const refundsWriteoffs =
    refunds != null || writeOffs != null ? (refunds ?? 0) + (writeOffs ?? 0) : null;

  return {
    snapshot: {
      concessions: {
        promosDiscountsMtd: promos ?? undefined,
        creditsAdjustmentsMtd: credits ?? undefined,
        refundsMtd: refunds ?? undefined,
        writeOffsMtd: writeOffs ?? undefined,
        refundsWriteoffsMtd: refundsWriteoffs ?? undefined,
      },
    },
    diagnostics,
  };
};

export function parseMsrWorkbook(buffer: ArrayBuffer | Buffer): MsrParseResult {
  const warnings: string[] = [];
  const dataSources: MsrDataSourceDiagnostics = {};
  const msrTableDiagnostics: MsrTableDiagnostics = {};
  let overlockDiagnostics: OverlockSheetDiagnostics | null = null;
  let concessionsDiagnostics: ConcessionsDiagnostics | null = null;
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  } catch (err) {
    throw new Error(err instanceof Error ? err.message : 'Unable to read workbook.');
  }

  const sheetNames = workbook.SheetNames ?? [];
  const overlockSheetInfo = findSheetWithName(workbook, OVERLOCK_SHEET_ALIASES);
  const discountsSheetInfo = findSheetWithName(workbook, DISCOUNTS_SHEET_ALIASES);
  const creditsSheetInfo = findSheetWithName(workbook, CREDITS_SHEET_ALIASES);
  const refundsSheetInfo = findSheetWithName(workbook, REFUNDS_SHEET_ALIASES);
  const writeOffsSheetInfo = findSheetWithName(workbook, WRITEOFFS_SHEET_ALIASES);
  const sheetSources: MsrSheetSources = {
    overlock: overlockSheetInfo?.name ?? null,
    discounts: discountsSheetInfo?.name ?? null,
    credits: creditsSheetInfo?.name ?? null,
    refunds: refundsSheetInfo?.name ?? null,
    writeOffs: writeOffsSheetInfo?.name ?? null,
  };

  const msrSheet = findSheet(workbook, ['msr']);
  if (!msrSheet) {
    warnings.push('Workbook is missing required "MSR" worksheet.');
  }

  const snapshot: MsrSnapshotPayload = {};
  if (msrSheet) {
    const msrGrid = sheetToGrid(msrSheet);
    Object.assign(snapshot, extractMsrSheet(msrGrid, msrSheet, warnings));

    const occupancyResult = extractSpaceOccupancyFromMsr(msrGrid, warnings);
    if (Object.values(occupancyResult.occupancy).some((value) => value != null)) {
      snapshot.occupancy = { ...snapshot.occupancy, ...occupancyResult.occupancy };
    }

    const rentalResult = extractRentalActivityFromMsr(msrGrid, warnings);
    if (Object.values(rentalResult.rentals).some((value) => value != null)) {
      snapshot.rentals = { ...snapshot.rentals, ...rentalResult.rentals };
    }
    msrTableDiagnostics.rentalActivity = rentalResult.diagnostics;

    const leadsResult = extractLeadsFromMsr(msrGrid, warnings, snapshot.rentals);
    if (Object.values(leadsResult.leads).some((value) => value != null)) {
      snapshot.leads = { ...snapshot.leads, ...leadsResult.leads };
    }
    msrTableDiagnostics.leads = leadsResult.diagnostics;
    if (leadsResult.diagnostics.tableFound && leadsResult.diagnostics.headerRowIndex != null) {
      dataSources.leadsSource = 'msr';
      dataSources.leadsRowCount = Object.keys(leadsResult.diagnostics.extracted ?? {}).length;
    }
  }

  const occupancySheetInfo = findSheetWithName(workbook, ['occupancy']);
  let occupancyDiagnostics: OccupancyParseDiagnostics | undefined;
  let occupancyTypeLookup = new Map<string, string>();
  let occupancySummary: MsrSnapshotPayload['occupancy'] | undefined;
  let occupancyRowCounts: OccupancyParseDiagnostics['rowCounts'] | undefined;
  if (occupancySheetInfo) {
    const occupancyResult = extractOccupancySheet(
      sheetToGrid(occupancySheetInfo.sheet),
      warnings,
      occupancySheetInfo.name,
    );
    occupancyDiagnostics = occupancyResult.diagnostics;
    occupancyTypeLookup = occupancyResult.occupancyTypeLookup;
    occupancySummary = occupancyResult.summary;
    occupancyRowCounts = occupancyResult.diagnostics.rowCounts;
    Object.assign(snapshot, mergeSnapshot(snapshot, occupancyResult.snapshot));
  } else {
    warnings.push('Workbook is missing "Occupancy" worksheet.');
    occupancyDiagnostics = {
      sheetName: undefined,
      headerRowIndex: null,
      error: 'Occupancy tab parsed 0 rows. Header detection failed.',
    };
  }

  const requiredOccupancyKeys: Array<keyof NonNullable<MsrSnapshotPayload['occupancy']>> = [
    'rsfOccPct',
    'spaceOccPct',
    'occupiedCount',
    'totalCount',
    'occupiedRsf',
    'totalRsf',
  ];
  const optionalOccupancyKeys: Array<keyof NonNullable<MsrSnapshotPayload['occupancy']>> = [
    'vacantCount',
    'offlineCount',
    'vacantRsf',
    'offlineRsf',
  ];
  const occupancy = snapshot.occupancy ?? {};
  const hasMsrSummary = requiredOccupancyKeys.every((key) => isFiniteNumber(occupancy[key]));

  if (occupancySummary) {
    if (!hasMsrSummary) {
      requiredOccupancyKeys.forEach((key) => {
        if (!isFiniteNumber(occupancy[key]) && isFiniteNumber(occupancySummary?.[key])) {
          occupancy[key] = occupancySummary?.[key];
        }
      });
      optionalOccupancyKeys.forEach((key) => {
        if (!isFiniteNumber(occupancy[key]) && isFiniteNumber(occupancySummary?.[key])) {
          occupancy[key] = occupancySummary?.[key];
        }
      });
      snapshot.occupancy = occupancy;
      dataSources.occupancySummarySource = 'occupancy';
      if (occupancyRowCounts) dataSources.occupancySummaryRows = occupancyRowCounts;
    } else {
      dataSources.occupancySummarySource = 'msr';
    }
  } else if (hasMsrSummary) {
    dataSources.occupancySummarySource = 'msr';
  }

  const delinquenciesSheet = findSheet(workbook, ['delinquencies', 'delinquency']);
  if (delinquenciesSheet) {
    Object.assign(snapshot, mergeSnapshot(snapshot, extractDelinquenciesSheet(sheetToGrid(delinquenciesSheet), warnings)));
  } else {
    warnings.push('Workbook is missing "Delinquencies" worksheet.');
  }

  if (overlockSheetInfo) {
    const overlockResult = extractOverlockFromSheet(
      sheetToGrid(overlockSheetInfo.sheet),
      warnings,
      overlockSheetInfo.name,
    );
    overlockDiagnostics = overlockResult.diagnostics;
    Object.assign(snapshot, mergeSnapshot(snapshot, overlockResult.snapshot));
  } else {
    warnings.push('Workbook is missing "Overlocked Spaces" worksheet.');
    overlockDiagnostics = {
      sheetName: undefined,
      error: 'Missing sheet.',
    };
  }

  const rentChangeSheet = findSheet(workbook, ['rentchange', 'rent change']);
  if (rentChangeSheet) {
    Object.assign(snapshot, mergeSnapshot(snapshot, extractRentChangeSheet(sheetToGrid(rentChangeSheet), warnings)));
  } else {
    warnings.push('Workbook is missing "Rent Change" worksheet.');
  }

  const noRentChangeSheet = findSheet(workbook, ['norentchangelast12months', 'no rent change last 12 months']);
  if (noRentChangeSheet) {
    const existingNoChange = snapshot.pricing?.noRentChange12MoCount ?? null;
    const noChange = extractNoRentChangeSheet(sheetToGrid(noRentChangeSheet), warnings, occupancyTypeLookup);
    if (existingNoChange != null) {
      noChange.pricing = { ...noChange.pricing, noRentChange12MoCount: existingNoChange };
    }
    Object.assign(
      snapshot,
      mergeSnapshot(
        snapshot,
        noChange,
      ),
    );
  } else {
    warnings.push('Workbook is missing "No Rent Change Last 12 Months" worksheet.');
  }

  const coverageSheet = findSheet(workbook, ['coverageenrollment', 'coverage enrollment']);
  if (coverageSheet) {
    Object.assign(snapshot, mergeSnapshot(snapshot, extractCoverageEnrollmentSheet(sheetToGrid(coverageSheet), warnings)));
  } else {
    warnings.push('Workbook is missing "Coverage Enrollment" worksheet.');
  }

  const concessionsResult = extractConcessions(
    {
      discounts: discountsSheetInfo,
      credits: creditsSheetInfo,
      refunds: refundsSheetInfo,
      writeOffs: writeOffsSheetInfo,
    },
    warnings,
  );
  concessionsDiagnostics = concessionsResult.diagnostics;
  Object.assign(snapshot, mergeSnapshot(snapshot, concessionsResult.snapshot));

  const leads = snapshot.leads ?? {};
  const channelValues = [leads.webMtd, leads.walkInMtd, leads.phoneMtd, leads.otherMtd];
  const hasChannelValues = channelValues.some((value) => isFiniteNumber(value));
  if (hasChannelValues && !isFiniteNumber(leads.totalMtd)) {
    leads.totalMtd = channelValues.reduce((sum, value) => sum + (isFiniteNumber(value) ? value : 0), 0);
  }

  leads.byChannelMtd = {
    web: leads.webMtd,
    walkIn: leads.walkInMtd,
    phone: leads.phoneMtd,
    other: leads.otherMtd,
  };
  snapshot.leads = leads;

  const rentals = snapshot.rentals ?? {};
  if (rentals.netMoveInsMtd == null && rentals.moveInsMtd != null && rentals.moveOutsMtd != null) {
    rentals.netMoveInsMtd = rentals.moveInsMtd - rentals.moveOutsMtd;
  }
  if (rentals.netMtd == null && rentals.netMoveInsMtd != null) {
    rentals.netMtd = rentals.netMoveInsMtd;
  }
  snapshot.rentals = rentals;

  if (
    !isFiniteNumber(leads.conversionRatePctMtd) &&
    isFiniteNumber(rentals.moveInsMtd) &&
    isFiniteNumber(leads.totalMtd) &&
    leads.totalMtd > 0
  ) {
    leads.conversionRatePctMtd = rentals.moveInsMtd / leads.totalMtd;
  }
  leads.conversionPct = isFiniteNumber(leads.conversionRatePctMtd)
    ? leads.conversionRatePctMtd
    : null;
  snapshot.leads = leads;

  const unitMix = snapshot.unitMix;
  if (unitMix?.occupiedRsfByType) {
    const total =
      unitMix.totalOccupiedRsf ??
      Object.values(unitMix.occupiedRsfByType).reduce((sum, value) => sum + value, 0);
    unitMix.totalOccupiedRsf = total;
    const totalRsf = unitMix.totalRsf ?? snapshot.occupancy?.totalRsf;
    if (totalRsf != null) unitMix.totalRsf = totalRsf;
    if (totalRsf && totalRsf > 0) unitMix.occupiedPct = total / totalRsf;
    if (total > 0) {
      const pctByType: Record<string, number> = {};
      Object.entries(unitMix.occupiedRsfByType).forEach(([key, value]) => {
        pctByType[key] = value / total;
      });
      unitMix.occupiedPctByType = pctByType;
    }
    snapshot.unitMix = unitMix;
  }

  const sections = buildSectionFlags(snapshot);
  return {
    snapshot,
    warnings,
    sections,
    occupancyDiagnostics,
    dataSources,
    msrTableDiagnostics,
    sheetNames,
    sheetSources,
    overlockDiagnostics,
    concessionsDiagnostics,
  };
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date);

function deepMergeDefined<T>(target: T, source: Partial<T>): T {
  if (source == null) return target;
  if (!isPlainObject(target) || !isPlainObject(source)) {
    return (source ?? target) as T;
  }

  const result: Record<string, unknown> = { ...(target as Record<string, unknown>) };
  Object.entries(source as Record<string, unknown>).forEach(([key, sourceValue]) => {
    if (sourceValue == null) return;
    const targetValue = (target as Record<string, unknown>)[key];
    if (isPlainObject(targetValue) && isPlainObject(sourceValue)) {
      result[key] = deepMergeDefined(targetValue, sourceValue);
    } else if (isPlainObject(sourceValue) && !isPlainObject(targetValue)) {
      result[key] = deepMergeDefined({}, sourceValue);
    } else {
      result[key] = sourceValue;
    }
  });

  return result as T;
}

function mergeSnapshot(
  base: MsrSnapshotPayload,
  incoming: Partial<MsrSnapshotPayload>,
): MsrSnapshotPayload {
  return deepMergeDefined(base, incoming);
}
