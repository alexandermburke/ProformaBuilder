import * as XLSX from "xlsx";

type WorkbookInput = ArrayBuffer | ArrayBufferView | Buffer;

const DASH = "—";
const LENGTH_OF_STAY_THRESHOLD_DAYS = 180;

const MOVE_SHEETS = [
  {
    key: "moveIns" as const,
    name: "Move In",
    dateColumn: "Date",
    areaColumn: "Area",
    rentColumn: "Rent at Move In",
    promoColumn: "Promotion Amount",
  },
  {
    key: "moveOuts" as const,
    name: "Move Out",
    dateColumn: "Date",
    areaColumn: "Area",
    rentColumn: "Rent at Move In",
    lorColumn: "Days In Space",
  },
] as const;

type MonthStats = {
  moveIns: number;
  moveInsArea: number;
  moveInsRent: number;
  moveInsPromoCount: number;
  moveOuts: number;
  moveOutsArea: number;
  moveOutsRentProxy: number;
  moveOutsLorSum: number;
  moveOutsLorCount: number;
  moveOutsLorGtThreshold: number;
};

type MonthRecord = {
  month: Date;
  moveIns: number;
  moveOuts: number;
  net: number;
};

export type OwnerPerformanceOptions = {
  currentMonthOverride?: string;
  includeCurrentMonthInTrailing?: boolean;
};

type MoveActivityTokens = {
  CURRENTMONTH: string;
  MOVEINS: number;
  MOVEOUTS: number;
  NETMOVE: number;
  MOVEINSTRL3: number;
  MOVEOUTSTRL3: number;
  NETTRL3: number;
  MOVEINSTRL6: number;
  MOVEOUTSTRL6: number;
  NETTRL6: number;
  MOVEINSTRL12: number;
  MOVEOUTSTRL12: number;
  NETTRL12: number;
  MOVIPER: string;
  MOVOPER: string;
  MOVN: string;
};

type OwnerSummaryTokens = Record<
  | "MTDMI"
  | "MTDMILM"
  | "DSFTMI"
  | "DSFTMILM"
  | "MTDMO"
  | "MTDMOLM"
  | "DSFTMO"
  | "DSFTMOLM"
  | "AVGLOR"
  | "AVGLORLM"
  | "PERLOR"
  | "PERLORLM"
  | "PROMO"
  | "PROMOLM",
  string
>;

type RateManagementTokens = Record<
  | "NUMREN"
  | "TOTSFT"
  | "BASREVPR"
  | "BASERENPR"
  | "TOTINCESC"
  | "REVWINC"
  | "NEWRENRT"
  | "AVGPERINC",
  string
>;

export type OwnerPerformanceTokenValues = MoveActivityTokens &
  OwnerSummaryTokens &
  RateManagementTokens;

export type OwnerPerformancePreviewRow = {
  section: "Move Activity" | "Owner Summary" | "Rate Management";
  token: keyof OwnerPerformanceTokenValues;
  label: string;
  value: string;
};

export type OwnerPerformanceErrorCode =
  | "parse_error"
  | "missing_sheet"
  | "no_rows"
  | "month_unavailable"
  | "iprc_missing"
  | "iprc_parse_error"
  | "iprc_missing_columns";

export type OwnerPerformanceResult =
  | {
      ok: true;
      tokens: OwnerPerformanceTokenValues;
      preview: OwnerPerformancePreviewRow[];
      metadata: {
        currentMonthKey: string;
        previousMonthKey: string;
        latestMoveDateISO: string;
        hummingbirdRows: number;
        iprcRows: number;
      };
    }
  | {
      ok: false;
      code: OwnerPerformanceErrorCode;
      message: string;
    };

type IprcRow = {
  monthKey: string | null;
  areaSqft: number;
  currentRent: number;
  newRent: number;
  percentIncrease: number | null;
};

type RateManagementStats = {
  count: number;
  totalSqft: number;
  baseRevenue: number;
  newRevenue: number;
  totalIncrease: number;
  percentIncreases: number[];
};

const monthFormatter = new Intl.DateTimeFormat("en-US", {
  month: "long",
  year: "numeric",
});

const integerFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const percentFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

export function computeOwnerPerformance({
  hummingbirdWorkbook,
  iprcCsvText,
  options,
}: {
  hummingbirdWorkbook: WorkbookInput;
  iprcCsvText: string;
  options?: OwnerPerformanceOptions;
}): OwnerPerformanceResult {
  if (!iprcCsvText || !iprcCsvText.trim()) {
    return {
      ok: false,
      code: "iprc_missing",
      message: "Upload the IPRC Change History export (.csv).",
    };
  }

  let workbook: XLSX.WorkBook;
  try {
    const buffer = toArrayBuffer(hummingbirdWorkbook);
    workbook = XLSX.read(buffer, { type: "array" });
  } catch (err) {
    return {
      ok: false,
      code: "parse_error",
      message:
        err instanceof Error
          ? err.message
          : "Unable to read the Hummingbird workbook. Upload the original export.",
    };
  }

  const monthStats = new Map<string, MonthStats>();
  let latestMoveDate: Date | null = null;
  let hummingbirdRowCount = 0;

  for (const sheetMeta of MOVE_SHEETS) {
    const sheet = workbook.Sheets[sheetMeta.name];
    if (!sheet) {
      return {
        ok: false,
        code: "missing_sheet",
        message: `Sheet "${sheetMeta.name}" not found in workbook.`,
      };
    }
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });
    for (const row of rows) {
      const rawDate = row[sheetMeta.dateColumn];
      const parsedDate = parseWorkbookDate(rawDate);
      if (!parsedDate) continue;
      hummingbirdRowCount += 1;
      const normalized = startOfDay(parsedDate);
      if (!latestMoveDate || normalized > latestMoveDate) {
        latestMoveDate = normalized;
      }
      const key = monthKey(startOfMonth(normalized));
      const stats = ensureMonthStats(monthStats, key);
      if (sheetMeta.key === "moveIns") {
        const area = toNumber(row[sheetMeta.areaColumn]);
        const rent = toNumber(row[sheetMeta.rentColumn]);
        const promo = toNumber(row[sheetMeta.promoColumn]);
        stats.moveIns += 1;
        stats.moveInsArea += area;
        stats.moveInsRent += rent;
        if (promo > 0) {
          stats.moveInsPromoCount += 1;
        }
      } else {
        const area = toNumber(row[sheetMeta.areaColumn]);
        const rent = toNumber(row[sheetMeta.rentColumn]);
        const lorDays = toNumber(row[sheetMeta.lorColumn]);
        stats.moveOuts += 1;
        stats.moveOutsArea += area;
        stats.moveOutsRentProxy += rent;
        if (Number.isFinite(lorDays) && lorDays > 0) {
          stats.moveOutsLorSum += lorDays;
          stats.moveOutsLorCount += 1;
          if (lorDays >= LENGTH_OF_STAY_THRESHOLD_DAYS) {
            stats.moveOutsLorGtThreshold += 1;
          }
        }
      }
    }
  }

  if (!latestMoveDate || monthStats.size === 0) {
    return {
      ok: false,
      code: "no_rows",
      message: "No dated rows were found in the Move In/Move Out sheets.",
    };
  }

  const currentMonthStart =
    parseMonthOverride(options?.currentMonthOverride) ?? startOfMonth(latestMoveDate);
  if (!currentMonthStart || Number.isNaN(currentMonthStart.getTime())) {
    return {
      ok: false,
      code: "month_unavailable",
      message: "Unable to determine the current month from the data provided.",
    };
  }
  const previousMonthStart = addMonths(currentMonthStart, -1);

  const monthKeys = Array.from(monthStats.keys()).sort();
  const firstMonth = monthKeyToDate(monthKeys[0]);
  const lastMonth = monthKeyToDate(monthKeys[monthKeys.length - 1]);
  if (!firstMonth || !lastMonth) {
    return {
      ok: false,
      code: "parse_error",
      message: "Unable to determine the month range from the workbook.",
    };
  }

  const monthRecords: MonthRecord[] = [];
  for (
    let cursor = new Date(firstMonth);
    cursor.getTime() <= lastMonth.getTime();
    cursor = addMonths(cursor, 1)
  ) {
    const key = monthKey(cursor);
    const stats = monthStats.get(key);
    const moveIns = stats?.moveIns ?? 0;
    const moveOuts = stats?.moveOuts ?? 0;
    monthRecords.push({
      month: new Date(cursor),
      moveIns,
      moveOuts,
      net: moveIns - moveOuts,
    });
  }

  const currentKey = monthKey(currentMonthStart);
  const previousKey = monthKey(previousMonthStart);
  const currentStats = monthStats.get(currentKey) ?? createEmptyMonthStats();
  const previousStats = monthStats.get(previousKey) ?? createEmptyMonthStats();

  const includeCurrent = options?.includeCurrentMonthInTrailing ?? true;
  const trailingInclusiveEnd = includeCurrent ? currentMonthStart : previousMonthStart;
  const trailing3Start = addMonths(trailingInclusiveEnd, -2);
  const trailing6Start = addMonths(trailingInclusiveEnd, -5);
  const trailing12Start = addMonths(trailingInclusiveEnd, -11);

  const moveActivityTokens: MoveActivityTokens = {
    CURRENTMONTH: monthFormatter.format(currentMonthStart),
    MOVEINS: currentStats.moveIns,
    MOVEOUTS: currentStats.moveOuts,
    NETMOVE: currentStats.moveIns - currentStats.moveOuts,
    MOVEINSTRL3: sumWindow(monthRecords, trailing3Start, trailingInclusiveEnd, "moveIns"),
    MOVEOUTSTRL3: sumWindow(monthRecords, trailing3Start, trailingInclusiveEnd, "moveOuts"),
    NETTRL3: sumWindow(monthRecords, trailing3Start, trailingInclusiveEnd, "net"),
    MOVEINSTRL6: sumWindow(monthRecords, trailing6Start, trailingInclusiveEnd, "moveIns"),
    MOVEOUTSTRL6: sumWindow(monthRecords, trailing6Start, trailingInclusiveEnd, "moveOuts"),
    NETTRL6: sumWindow(monthRecords, trailing6Start, trailingInclusiveEnd, "net"),
    MOVEINSTRL12: sumWindow(monthRecords, trailing12Start, trailingInclusiveEnd, "moveIns"),
    MOVEOUTSTRL12: sumWindow(monthRecords, trailing12Start, trailingInclusiveEnd, "moveOuts"),
    NETTRL12: sumWindow(monthRecords, trailing12Start, trailingInclusiveEnd, "net"),
    MOVIPER: formatPercent(pctChange(currentStats.moveIns, previousStats.moveIns)),
    MOVOPER: formatPercent(pctChange(currentStats.moveOuts, previousStats.moveOuts)),
    MOVN: formatPercent(
      pctChange(
        currentStats.moveIns - currentStats.moveOuts,
        previousStats.moveIns - previousStats.moveOuts,
      ),
    ),
  };

  const ownerSummaryTokens: OwnerSummaryTokens = {
    MTDMI: formatInteger(currentStats.moveIns),
    MTDMILM: formatInteger(previousStats.moveIns),
    DSFTMI: formatCurrencyPerSqft(currentStats.moveInsRent, currentStats.moveInsArea),
    DSFTMILM: formatCurrencyPerSqft(previousStats.moveInsRent, previousStats.moveInsArea),
    MTDMO: formatInteger(currentStats.moveOuts),
    MTDMOLM: formatInteger(previousStats.moveOuts),
    DSFTMO: formatCurrencyPerSqft(currentStats.moveOutsRentProxy, currentStats.moveOutsArea),
    DSFTMOLM: formatCurrencyPerSqft(previousStats.moveOutsRentProxy, previousStats.moveOutsArea),
    AVGLOR: formatAverageDays(currentStats.moveOutsLorSum, currentStats.moveOutsLorCount),
    AVGLORLM: formatAverageDays(previousStats.moveOutsLorSum, previousStats.moveOutsLorCount),
    PERLOR: formatPercent(
      ratio(currentStats.moveOutsLorGtThreshold, currentStats.moveOutsLorCount),
    ),
    PERLORLM: formatPercent(
      ratio(previousStats.moveOutsLorGtThreshold, previousStats.moveOutsLorCount),
    ),
    PROMO: formatPercent(ratio(currentStats.moveInsPromoCount, currentStats.moveIns)),
    PROMOLM: formatPercent(ratio(previousStats.moveInsPromoCount, previousStats.moveIns)),
  };

  const iprcParse = parseIprcCsv(iprcCsvText);
  if (!iprcParse.ok) {
    return iprcParse;
  }

  const rateStats = aggregateIprc(iprcParse.rows, currentKey);
  const rateTokens: RateManagementTokens = {
    NUMREN: formatInteger(rateStats.count),
    TOTSFT: formatInteger(rateStats.totalSqft),
    BASREVPR: formatCurrencyValue(rateStats.baseRevenue),
    BASERENPR: formatCurrencyPerSqft(rateStats.baseRevenue, rateStats.totalSqft),
    TOTINCESC: formatCurrencyValue(rateStats.totalIncrease),
    REVWINC: formatCurrencyValue(rateStats.newRevenue),
    NEWRENRT: formatCurrencyPerSqft(rateStats.newRevenue, rateStats.totalSqft),
    AVGPERINC: formatPercent(average(rateStats.percentIncreases)),
  };

  const tokens: OwnerPerformanceTokenValues = {
    ...moveActivityTokens,
    ...ownerSummaryTokens,
    ...rateTokens,
  };

  const preview = buildOwnerPerformancePreview(tokens);

  return {
    ok: true,
    tokens,
    preview,
    metadata: {
      currentMonthKey: currentKey,
      previousMonthKey: previousKey,
      latestMoveDateISO: dateKey(latestMoveDate),
      hummingbirdRows: hummingbirdRowCount,
      iprcRows: iprcParse.rows.length,
    },
  };
}

function toArrayBuffer(input: WorkbookInput): ArrayBuffer {
  if (input instanceof ArrayBuffer) return input;
  if (ArrayBuffer.isView(input)) {
    const view = input as ArrayBufferView;
    return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
  }
  if (typeof Buffer !== "undefined" && input instanceof Buffer) {
    return input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength);
  }
  throw new Error("Unsupported workbook input type");
}

function ensureMonthStats(map: Map<string, MonthStats>, key: string): MonthStats {
  let stats = map.get(key);
  if (!stats) {
    stats = createEmptyMonthStats();
    map.set(key, stats);
  }
  return stats;
}

function createEmptyMonthStats(): MonthStats {
  return {
    moveIns: 0,
    moveInsArea: 0,
    moveInsRent: 0,
    moveInsPromoCount: 0,
    moveOuts: 0,
    moveOutsArea: 0,
    moveOutsRentProxy: 0,
    moveOutsLorSum: 0,
    moveOutsLorCount: 0,
    moveOutsLorGtThreshold: 0,
  };
}

function parseWorkbookDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    const ms = Math.round(value * 86400 * 1000);
    const date = new Date(excelEpoch.getTime() + ms);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addMonths(date: Date, months: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

function monthKey(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  return `${yyyy}-${mm}-01`;
}

function monthKeyToDate(key: string): Date | null {
  const match = /^(\d{4})-(\d{2})-01$/.exec(key);
  if (!match) return null;
  const [, y, m] = match;
  return new Date(Number(y), Number(m) - 1, 1);
}

function dateKey(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function parseMonthOverride(input?: string): Date | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  const normalized = trimmed.replace(/[/.]/g, "-");
  const match = normalized.match(/^(\d{4})-(\d{1,2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return null;
  if (month < 1 || month > 12) return null;
  return new Date(year, month - 1, 1);
}

function toNumber(raw: unknown): number {
  if (typeof raw === "number") {
    return Number.isFinite(raw) ? raw : 0;
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return 0;
    const negative = /^\(.*\)$/.test(trimmed);
    const cleaned = trimmed.replace(/[,$()%]/g, "");
    const parsed = Number(cleaned);
    if (!Number.isFinite(parsed)) return 0;
    return negative ? -parsed : parsed;
  }
  return 0;
}

function sumWindow(records: MonthRecord[], start: Date, inclusiveEnd: Date, field: keyof MonthRecord) {
  const startTime = start.getTime();
  const endTime = inclusiveEnd.getTime();
  return records.reduce((total, record) => {
    const time = record.month.getTime();
    if (time >= startTime && time <= endTime) {
      return total + Number(record[field]);
    }
    return total;
  }, 0);
}

function pctChange(curr: number, prev: number): number | null {
  if (!Number.isFinite(prev) || prev === 0) return null;
  if (!Number.isFinite(curr)) return null;
  return (curr - prev) / prev;
}

function formatPercent(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return DASH;
  return `${percentFormatter.format(value * 100)}%`;
}

function formatInteger(value: number): string {
  if (!Number.isFinite(value)) return DASH;
  return integerFormatter.format(value);
}

function formatCurrencyValue(value: number): string {
  if (!Number.isFinite(value)) return DASH;
  return currencyFormatter.format(value);
}

function formatCurrencyPerSqft(numerator: number, denominator: number): string {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || Math.abs(denominator) < 1e-6) {
    return DASH;
  }
  return currencyFormatter.format(numerator / denominator);
}

function formatAverageDays(sum: number, count: number): string {
  if (!Number.isFinite(sum) || !Number.isFinite(count) || count <= 0) return DASH;
  const avg = sum / count;
  if (!Number.isFinite(avg)) return DASH;
  return integerFormatter.format(Math.round(avg));
}

function ratio(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    return null;
  }
  return numerator / denominator;
}

function average(values: number[]): number | null {
  if (!values || values.length === 0) return null;
  const valid = values.filter((value) => Number.isFinite(value));
  if (valid.length === 0) return null;
  const total = valid.reduce((sum, value) => sum + value, 0);
  return total / valid.length;
}

function normalizeHeaderCell(cell: string): string {
  return cell.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function parseIprcCsv(text: string):
  | { ok: true; rows: IprcRow[] }
  | { ok: false; code: OwnerPerformanceErrorCode; message: string } {
  const sanitized = text.replace(/^\uFEFF/, "");
  const trimmed = sanitized.trim();
  if (!trimmed) {
    return {
      ok: false,
      code: "iprc_parse_error",
      message: "The IPRC CSV is empty.",
    };
  }

  let rows: string[][];
  try {
    rows = parseDelimitedRows(trimmed);
  } catch (err) {
    return {
      ok: false,
      code: "iprc_parse_error",
      message:
        err instanceof Error ? err.message : "Unable to parse the IPRC CSV. Confirm the file is valid.",
    };
  }

  if (rows.length < 2) {
    return {
      ok: false,
      code: "iprc_parse_error",
      message: "No data rows were detected in the IPRC CSV.",
    };
  }

  const header = rows[0].map((cell) => normalizeHeaderCell(cell));
  const findIndex = (candidates: string[]) => header.findIndex((value) => candidates.includes(value));
  const dtDateIdx = findIndex(["dtdate", "processeddate"]);
  const queueIdx = findIndex(["queue"]);
  const lenIdx = findIndex(["fltlength", "length"]);
  const widthIdx = findIndex(["fltwidth", "width"]);
  const curRentIdx = findIndex(["mnycurrentrent", "currentrent", "currentrate"]);
  const newRentIdx = findIndex(["mnynewrate", "newrent", "newrate"]);

  if ([dtDateIdx, queueIdx, lenIdx, widthIdx, curRentIdx, newRentIdx].some((idx) => idx === -1)) {
    return {
      ok: false,
      code: "iprc_missing_columns",
      message: "The IPRC CSV is missing one or more required columns.",
    };
  }

  const parsed: IprcRow[] = [];
  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i];
    if (!row || row.length === 0) continue;
    const processedDate = parseDateFromCell(row[dtDateIdx]);
    const queue = row[queueIdx] ?? "";
    const length = toNumber(row[lenIdx]);
    const width = toNumber(row[widthIdx]);
    const currentRent = toNumber(row[curRentIdx]);
    const newRent = toNumber(row[newRentIdx]);
    const areaSqft = length * width;
    const letterMonth = deriveLetterMonth(queue, processedDate);
    const month = letterMonth ?? (processedDate ? startOfMonth(processedDate) : null);
    parsed.push({
      monthKey: month ? monthKey(month) : null,
      areaSqft,
      currentRent,
      newRent,
      percentIncrease:
        currentRent > 0 && Number.isFinite(currentRent) ? (newRent - currentRent) / currentRent : null,
    });
  }

  return { ok: true, rows: parsed };
}

function parseDateFromCell(value: string | undefined): Date | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function deriveLetterMonth(queue: string | undefined, processedDate: Date | null): Date | null {
  if (!queue) return null;
  const match = queue.match(/letter\s+to\s+be\s+sent\s+([A-Za-z]+)\s+(\d{1,2})/i);
  if (!match) return null;
  const monthName = match[1].toLowerCase();
  const day = Number(match[2]);
  const monthIndex = monthNameToIndex(monthName);
  if (monthIndex == null || !Number.isFinite(day)) return null;
  const year = processedDate?.getFullYear() ?? new Date().getFullYear();
  return new Date(year, monthIndex, day);
}

function monthNameToIndex(name: string): number | null {
  const lookup: Record<string, number> = {
    january: 0,
    february: 1,
    march: 2,
    april: 3,
    may: 4,
    june: 5,
    july: 6,
    august: 7,
    september: 8,
    october: 9,
    november: 10,
    december: 11,
  };
  const normalized = name.toLowerCase();
  if (normalized in lookup) return lookup[normalized];
  const short = normalized.slice(0, 3);
  if (short in lookup) return lookup[short];
  return null;
}

function aggregateIprc(rows: IprcRow[], monthKeyValue: string): RateManagementStats {
  const initial: RateManagementStats = {
    count: 0,
    totalSqft: 0,
    baseRevenue: 0,
    newRevenue: 0,
    totalIncrease: 0,
    percentIncreases: [],
  };

  for (const row of rows) {
    if (!row.monthKey || row.monthKey !== monthKeyValue) continue;
    initial.count += 1;
    initial.totalSqft += row.areaSqft;
    initial.baseRevenue += row.currentRent;
    initial.newRevenue += row.newRent;
    initial.totalIncrease += row.newRent - row.currentRent;
    if (row.percentIncrease != null) {
      initial.percentIncreases.push(row.percentIncrease);
    }
  }

  return initial;
}

function parseDelimitedRows(text: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"') {
      if (inQuotes && text[i + 1] === '"') {
        currentCell += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if ((char === "," || char === "\t") && !inQuotes) {
      currentRow.push(currentCell);
      currentCell = "";
      continue;
    }
    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && text[i + 1] === "\n") {
        i += 1;
      }
      currentRow.push(currentCell);
      if (currentRow.some((cell) => cell.trim().length > 0)) {
        rows.push(currentRow);
      }
      currentRow = [];
      currentCell = "";
      continue;
    }
    currentCell += char;
  }

  currentRow.push(currentCell);
  if (currentRow.some((cell) => cell.trim().length > 0)) {
    rows.push(currentRow);
  }
  return rows;
}

const PREVIEW_FIELDS: Array<{
  section: OwnerPerformancePreviewRow["section"];
  token: OwnerPerformancePreviewRow["token"];
  label: string;
  kind: "string" | "integer";
}> = [
  { section: "Move Activity", token: "CURRENTMONTH", label: "Current Month", kind: "string" },
  { section: "Move Activity", token: "MOVEINS", label: "Move-Ins (Current)", kind: "integer" },
  { section: "Move Activity", token: "MOVEOUTS", label: "Move-Outs (Current)", kind: "integer" },
  { section: "Move Activity", token: "NETMOVE", label: "Net Move (Current)", kind: "integer" },
  { section: "Move Activity", token: "MOVEINSTRL3", label: "Move-Ins (Trailing 3)", kind: "integer" },
  { section: "Move Activity", token: "MOVEOUTSTRL3", label: "Move-Outs (Trailing 3)", kind: "integer" },
  { section: "Move Activity", token: "NETTRL3", label: "Net Move (Trailing 3)", kind: "integer" },
  { section: "Move Activity", token: "MOVEINSTRL6", label: "Move-Ins (Trailing 6)", kind: "integer" },
  { section: "Move Activity", token: "MOVEOUTSTRL6", label: "Move-Outs (Trailing 6)", kind: "integer" },
  { section: "Move Activity", token: "NETTRL6", label: "Net Move (Trailing 6)", kind: "integer" },
  { section: "Move Activity", token: "MOVEINSTRL12", label: "Move-Ins (Trailing 12)", kind: "integer" },
  { section: "Move Activity", token: "MOVEOUTSTRL12", label: "Move-Outs (Trailing 12)", kind: "integer" },
  { section: "Move Activity", token: "NETTRL12", label: "Net Move (Trailing 12)", kind: "integer" },
  { section: "Move Activity", token: "MOVIPER", label: "Move-Ins vs Prior Month", kind: "string" },
  { section: "Move Activity", token: "MOVOPER", label: "Move-Outs vs Prior Month", kind: "string" },
  { section: "Move Activity", token: "MOVN", label: "Net vs Prior Month", kind: "string" },
  { section: "Owner Summary", token: "MTDMI", label: "MTD Move-Ins", kind: "string" },
  { section: "Owner Summary", token: "MTDMILM", label: "MTD Move-Ins (Last Month)", kind: "string" },
  { section: "Owner Summary", token: "DSFTMI", label: "$/SqFt Move-Ins", kind: "string" },
  { section: "Owner Summary", token: "DSFTMILM", label: "$/SqFt Move-Ins (LM)", kind: "string" },
  { section: "Owner Summary", token: "MTDMO", label: "MTD Move-Outs", kind: "string" },
  { section: "Owner Summary", token: "MTDMOLM", label: "MTD Move-Outs (LM)", kind: "string" },
  { section: "Owner Summary", token: "DSFTMO", label: "$/SqFt Move-Outs", kind: "string" },
  { section: "Owner Summary", token: "DSFTMOLM", label: "$/SqFt Move-Outs (LM)", kind: "string" },
  { section: "Owner Summary", token: "AVGLOR", label: "Avg LOR of Move-Outs", kind: "string" },
  { section: "Owner Summary", token: "AVGLORLM", label: "Avg LOR (Last Month)", kind: "string" },
  { section: "Owner Summary", token: "PERLOR", label: "% LOR > 6 Months", kind: "string" },
  { section: "Owner Summary", token: "PERLORLM", label: "% LOR > 6 Months (LM)", kind: "string" },
  { section: "Owner Summary", token: "PROMO", label: "% Move-Ins with Promo", kind: "string" },
  { section: "Owner Summary", token: "PROMOLM", label: "% Move-Ins with Promo (LM)", kind: "string" },
  { section: "Rate Management", token: "NUMREN", label: "Rent Increase Letters", kind: "string" },
  { section: "Rate Management", token: "TOTSFT", label: "Total Square Feet", kind: "string" },
  { section: "Rate Management", token: "BASREVPR", label: "Base Revenue (Prior)", kind: "string" },
  { section: "Rate Management", token: "BASERENPR", label: "Base Rent ($/SqFt)", kind: "string" },
  { section: "Rate Management", token: "TOTINCESC", label: "Total $ Increase", kind: "string" },
  { section: "Rate Management", token: "REVWINC", label: "Revenue After Escalation", kind: "string" },
  { section: "Rate Management", token: "NEWRENRT", label: "New Rent ($/SqFt)", kind: "string" },
  { section: "Rate Management", token: "AVGPERINC", label: "Avg % Increase", kind: "string" },
];

function buildOwnerPerformancePreview(tokens: OwnerPerformanceTokenValues): OwnerPerformancePreviewRow[] {
  return PREVIEW_FIELDS.map(({ section, token, label, kind }) => {
    const rawValue = tokens[token];
    if (kind === "integer") {
      const numeric = typeof rawValue === "number" ? rawValue : Number(rawValue);
      return {
        section,
        token,
        label,
        value:
          Number.isFinite(numeric) && numeric !== null ? integerFormatter.format(numeric) : DASH,
      };
    }
    return {
      section,
      token,
      label,
      value: typeof rawValue === "string" ? rawValue : String(rawValue ?? DASH),
    };
  });
}
