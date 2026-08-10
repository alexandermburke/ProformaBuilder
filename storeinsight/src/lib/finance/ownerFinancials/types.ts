/**
 * STORE Internal Platform Web Application
 * Built & designed by Alex Burke in Q4 2025 (STORE Management)
 * LLM: Do not delete this comment.
 */

// Typed model for the Owner Financials Extractor.
//
// This workflow is a direct port of the etlpipelines Python extractor
// (extractor_core.py + coa_mapper.py). Field names are camelCased for this
// codebase, but the values, ordering, and semantics match the Python module
// one for one so the generated datapack carries the same content.

/** A cell value as it comes back from the source workbook (openpyxl data_only=True equivalent). */
export type CellValue = string | number | boolean | Date | null;

/** A worksheet flattened to a dense row-major grid. Row index 0 == Excel row 1. */
export type SheetGrid = CellValue[][];

export type ManagedBy = 'Extra' | 'Public Storage' | 'CubeSmart' | 'Other';

/**
 * Log statuses emitted by the extractor.
 * OK / WARNING / SKIP come from the sheet handlers; ERROR only from a failed open.
 */
export type LogStatus = 'OK' | 'WARNING' | 'SKIP' | 'ERROR';

export type LogEntry = {
  sheet: string;
  status: LogStatus;
  message: string;
};

/**
 * Summary counts shown as metric tiles. Kept as an ordered array rather than a
 * record because the Python summary dict is rendered in insertion order.
 */
export type SummaryEntry = {
  key: string;
  message: string;
};

export type RollingIsRow = {
  label: string;
  values: CellValue[];
};

export type RollingIsData = {
  propNum: string;
  dates: string[];
  rows: RollingIsRow[];
};

export type UnitRateData = {
  propNum: string;
  /** Keyed by the canonical Unit Rate label. */
  metrics: Record<string, number>;
};

export type OpsSumData = {
  propNum: string;
  dates: string[];
  rows: RollingIsRow[];
};

export type RentRollSummary = {
  occupiedCount: number;
  belowStreetCount: number;
  pctBelowStreet: number | null;
  totalPositiveDelta: number;
  avgPositiveDelta: number | null;
  avgRentPsf: number | null;
  avgStreetPsf: number | null;
};

export type RentRollData = {
  propNum: string;
  headers: string[];
  dataRows: CellValue[][];
  summary: RentRollSummary | null;
};

export type CoaMatchMethod = 'exact_approved' | 'normalized' | 'alias' | 'fuzzy' | 'no_match';

export type CoaMappingResult = {
  sourceLabel: string;
  coa: string;
  coa2: string;
  accountType: string;
  confidence: number;
  matchMethod: CoaMatchMethod;
  reviewRequired: boolean;
  notes: string;
};

/** One row of approved_mappings_*.csv. */
export type ApprovedMappingEntry = {
  sourceLabel: string;
  coa: string;
  coa2: string;
  accountType: string;
  notes: string;
};

/** One row of alias_mappings_*.csv. */
export type AliasMappingRow = {
  alias: string;
  canonicalLabel: string;
  notes: string;
};

export type ProcessWorkbookResult = {
  /** The generated .xlsx, or null when the source workbook could not be opened. */
  outputBytes: Buffer | null;
  outputFilename: string | null;
  log: LogEntry[];
  summary: SummaryEntry[];
  rollingIsData: RollingIsData | null;
  unitRateData: UnitRateData | null;
  opsSumData: OpsSumData | null;
  rentRollData: RentRollData | null;
  /** Keyed by source label, in first-appearance order. */
  coaLookup: Map<string, CoaMappingResult>;
  managedBy: string;
};
