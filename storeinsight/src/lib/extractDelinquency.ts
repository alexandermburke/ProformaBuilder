import * as XLSX from "xlsx";

type WorkbookInput = ArrayBuffer | ArrayBufferView | Buffer;
type Cell = string | number | boolean | null;

type RowKey = "0_10" | "11_30" | "31_60" | "61_90" | "91_120" | "121_180" | "181_360" | "361_PLUS";

type RowMetrics = {
  dollars: number;
  units: number;
  percent: number | null;
};

type BucketTriple = {
  oneToThirty: number;
  thirtyOneToSixty: number;
  sixtyOnePlus: number;
};

type HeaderInfo = {
  rowIndex: number;
  moneyCol: number;
  countCol: number;
  percentCol: number | null;
};

const ANCHOR_CANDIDATES = [
  "delinquency by days",
  "delinquency aging",
  "accounts receivable aging",
  "delinquent rent",
  "delinquency",
];

const ROW_LABEL_MAP: Record<RowKey, RegExp> = {
  "0_10": /^0\s*[-–—]\s*10$/,
  "11_30": /^11\s*[-–—]\s*30$/,
  "31_60": /^31\s*[-–—]\s*60$/,
  "61_90": /^61\s*[-–—]\s*90$/,
  "91_120": /^91\s*[-–—]\s*120$/,
  "121_180": /^121\s*[-–—]\s*180$/,
  "181_360": /^181\s*[-–—]\s*360$/,
  "361_PLUS": /^361\s*(\+|plus)$/,
};

const STOP_ROWS = new Set(["total", "greaterthan30days", "greaterthan30days:"]);

const DENOM_LABELS = [
  "gross occupied revenue",
  "gross occupied rent",
  "occupied revenue",
  "occupied rent",
];

const DOLLAR_GROUP: RowKey[] = ["0_10", "11_30"];
const FIFTY_GROUP: RowKey[] = ["31_60"];
const SIXTYPLUS_GROUP: RowKey[] = ["61_90", "91_120", "121_180", "181_360", "361_PLUS"];

export type DelinquencyTokens = {
  DELINDOL30: string;
  DELINDOL60: string;
  DELINDOL61: string;
  DELINUNIT30: string;
  DELINUNIT60: string;
  DELINUNIT61: string;
  DELINPER30: string;
  DELINPER60: string;
  DELINPER61: string;
};

export type DelinquencyExtractionResult =
  | {
      ok: true;
      tokens: DelinquencyTokens;
      debug: {
        sheet: string;
        headers: { money: number; count: number; percent: number | null };
        bucketsRaw: Record<RowKey, RowMetrics>;
        bucketsComputed: {
          dollars: BucketTriple;
          units: BucketTriple;
          percents: BucketTriple;
        };
        percentSource: "percentColumn" | "denominator";
        denominatorValue: number | null;
      };
    }
  | {
      ok: false;
      code: "ANCHOR_NOT_FOUND" | "HEADERS_NOT_FOUND" | "ROWS_MISSING" | "PARSE_ERROR";
      message: string;
      hints?: Record<string, unknown>;
    };

export function extractDelinquencyMetrics(input: WorkbookInput): DelinquencyExtractionResult {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(toArrayBuffer(input), { type: "array" });
  } catch (err) {
    return {
      ok: false,
      code: "PARSE_ERROR",
      message: err instanceof Error ? err.message : "Unable to read workbook.",
    };
  }

  let lastError: DelinquencyExtractionResult | null = null;

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const grid = XLSX.utils.sheet_to_json<Cell[]>(sheet, { header: 1, defval: null, raw: true });
    if (grid.length === 0) continue;

    const anchorRow = findAnchorRow(grid);
    if (anchorRow == null) {
      lastError = {
        ok: false,
        code: "ANCHOR_NOT_FOUND",
        message: "Delinquency section not found in sheet.",
        hints: { sheet: sheetName },
      };
      continue;
    }

    const header = detectHeaderRow(grid, anchorRow);
    if (!header) {
      lastError = {
        ok: false,
        code: "HEADERS_NOT_FOUND",
        message: "Unable to classify delinquency headers.",
        hints: { sheet: sheetName, anchorRow },
      };
      continue;
    }

    const rowResult = collectRows(grid, header);
    if (!rowResult.ok) {
      lastError = { ok: false, code: "ROWS_MISSING", message: rowResult.message, hints: { sheet: sheetName } };
      continue;
    }

    const buckets = summarizeBuckets(rowResult.map);
    let percentBuckets: BucketTriple;
    let percentSource: "percentColumn" | "denominator";
    let denominatorVal: number | null = null;

    if (rowResult.percentAvailable) {
      percentBuckets = summarizePercentBuckets(rowResult.map);
      percentSource = "percentColumn";
    } else {
      denominatorVal = findDenominator(grid);
      if (denominatorVal == null || Math.abs(denominatorVal) < 1e-6) {
        percentBuckets = { oneToThirty: 0, thirtyOneToSixty: 0, sixtyOnePlus: 0 };
      } else {
        percentBuckets = {
          oneToThirty: (buckets.dollars.oneToThirty / denominatorVal) * 100,
          thirtyOneToSixty: (buckets.dollars.thirtyOneToSixty / denominatorVal) * 100,
          sixtyOnePlus: (buckets.dollars.sixtyOnePlus / denominatorVal) * 100,
        };
      }
      percentSource = "denominator";
    }

    const tokens = formatTokens(buckets, percentBuckets);

    console.debug(
      "[delinq] buckets =>",
      `1-30:${tokens.DELINDOL30} ${tokens.DELINUNIT30}/${tokens.DELINPER30}`,
      `31-60:${tokens.DELINDOL60} ${tokens.DELINUNIT60}/${tokens.DELINPER60}`,
      `61+:${tokens.DELINDOL61} ${tokens.DELINUNIT61}/${tokens.DELINPER61}`,
      `(src:${percentSource})`,
    );

    const bucketsRaw = mapToRowRecord(rowResult.map);

    return {
      ok: true,
      tokens,
      debug: {
        sheet: sheetName,
        headers: { money: header.moneyCol, count: header.countCol, percent: header.percentCol },
        bucketsRaw,
        bucketsComputed: {
          dollars: buckets.dollars,
          units: buckets.units,
          percents: percentBuckets,
        },
        percentSource,
        denominatorValue: denominatorVal,
      },
    };
  }

  return (
    lastError ?? {
      ok: false,
      code: "ANCHOR_NOT_FOUND",
      message: "Delinquency section not found.",
    }
  );
}

function findAnchorRow(grid: Cell[][]): number | null {
  const normalizedAnchors = new Set(ANCHOR_CANDIDATES.map(normalizeAnchorText));
  for (let r = 0; r < grid.length; r += 1) {
    const row = grid[r];
    for (const cell of row) {
      if (typeof cell !== "string") continue;
      if (normalizedAnchors.has(normalizeAnchorText(cell))) {
        return r;
      }
    }
  }
  return null;
}

function detectHeaderRow(grid: Cell[][], anchorRow: number): HeaderInfo | null {
  const maxRow = Math.min(grid.length, anchorRow + 5);
  for (let r = anchorRow; r <= maxRow; r += 1) {
    const row = grid[r];
    if (!row) continue;
    let previous: string | null = null;
    let moneyCol: number | null = null;
    let countCol: number | null = null;
    let percentCol: number | null = null;
    let matches = 0;
    for (let c = 0; c < row.length; c += 1) {
      const cell = row[c];
      const headerValue: string | null = typeof cell === "string" && cell.trim() ? cell : previous;
      if (!headerValue) continue;
      previous = headerValue;
      const role = classifyHeader(headerValue);
      if (!role) continue;
      if (role === "money" && moneyCol == null) {
        moneyCol = c;
        matches += 1;
      } else if (role === "count" && countCol == null) {
        countCol = c;
        matches += 1;
      } else if (role === "percent" && percentCol == null) {
        percentCol = c;
        matches += 1;
      }
    }
    if (moneyCol != null && countCol != null && matches >= 2) {
      return { rowIndex: r, moneyCol, countCol, percentCol };
    }
  }
  return null;
}

function classifyHeader(value: string): "money" | "count" | "percent" | null {
  const lower = value.toLowerCase();
  if (value.includes("$")) return "money";
  if (value.includes("%")) return "percent";
  if (/(amount|balance|dollars)/.test(lower)) return "money";
  if (/(count|units)/.test(lower)) return "count";
  if (/(percent|%total|% total)/.test(lower)) return "percent";
  return null;
}

function collectRows(
  grid: Cell[][],
  header: HeaderInfo,
): { ok: true; map: Map<RowKey, RowMetrics>; percentAvailable: boolean } | { ok: false; message: string } {
  const map = new Map<RowKey, RowMetrics>();
  let seenRows = 0;
  let percentAvailable = header.percentCol != null;

  for (let r = header.rowIndex + 1; r < grid.length; r += 1) {
    const row = grid[r];
    if (!row || isRowBlank(row)) {
      if (seenRows > 0) break;
      continue;
    }
    const rawLabel = firstLabelCell(row);
    if (!rawLabel) {
      if (seenRows > 0) break;
      continue;
    }
    const normalized = normalizeRowLabel(rawLabel);
    const rowKey = resolveRowKey(normalized);
    if (!rowKey) {
      const compact = normalizeStopLabel(rawLabel);
      if (STOP_ROWS.has(compact) && seenRows > 0) break;
      continue;
    }

    const dollars = coerceNumber(row[header.moneyCol]);
    const units = coerceNumber(row[header.countCol]);
    const percentVal =
      header.percentCol != null ? coercePercent(row[header.percentCol]) : Number.NaN;
    if (!Number.isFinite(percentVal)) percentAvailable = false;

    map.set(rowKey, {
      dollars,
      units,
      percent: Number.isFinite(percentVal) ? percentVal : null,
    });

    console.debug(
      "[delinq] row",
      rowKey,
      "=>",
      `$${dollars.toLocaleString("en-US")}`,
      "/",
      units,
      "/",
      Number.isFinite(percentVal) ? `${percentVal.toFixed(2)}%` : "–",
    );

    seenRows += 1;
  }

  if (seenRows === 0) {
    return { ok: false, message: "No delinquency rows detected beneath headers." };
  }

  return { ok: true, map, percentAvailable };
}

function resolveRowKey(label: string): RowKey | null {
  const simple = label.replace(/\s+/g, "");
  for (const [key, regex] of Object.entries(ROW_LABEL_MAP)) {
    if (regex.test(simple.replace(/\+/g, "+"))) {
      return key as RowKey;
    }
  }
  return null;
}

function coerceNumber(value: Cell): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value == null) return 0;
  const text = String(value).trim();
  if (!text) return 0;
  const negative = /^\(.*\)$/.test(text);
  const cleaned = text.replace(/[,$\s]/g, "").replace(/%/g, "");
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) return 0;
  return negative ? -parsed : parsed;
}

function coercePercent(value: Cell): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value == null) return NaN;
  const text = String(value).trim();
  if (!text) return NaN;
  const cleaned = text.replace(/[%\s]/g, "");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function summarizeBuckets(rowMap: Map<RowKey, RowMetrics>) {
  const sum = (rows: RowKey[], selector: (row: RowMetrics | undefined) => number) =>
    rows.reduce((total, key) => total + selector(rowMap.get(key)), 0);

  const dollars: BucketTriple = {
    oneToThirty: sum(DOLLAR_GROUP, (row) => row?.dollars ?? 0),
    thirtyOneToSixty: sum(FIFTY_GROUP, (row) => row?.dollars ?? 0),
    sixtyOnePlus: sum(SIXTYPLUS_GROUP, (row) => row?.dollars ?? 0),
  };

  const units: BucketTriple = {
    oneToThirty: sum(DOLLAR_GROUP, (row) => row?.units ?? 0),
    thirtyOneToSixty: sum(FIFTY_GROUP, (row) => row?.units ?? 0),
    sixtyOnePlus: sum(SIXTYPLUS_GROUP, (row) => row?.units ?? 0),
  };

  return { dollars, units };
}

function summarizePercentBuckets(rowMap: Map<RowKey, RowMetrics>): BucketTriple {
  const sumPercent = (rows: RowKey[]) =>
    rows.reduce((total, key) => total + (rowMap.get(key)?.percent ?? 0), 0);
  return {
    oneToThirty: sumPercent(DOLLAR_GROUP),
    thirtyOneToSixty: sumPercent(FIFTY_GROUP),
    sixtyOnePlus: sumPercent(SIXTYPLUS_GROUP),
  };
}

function findDenominator(grid: Cell[][]): number | null {
  for (let r = 0; r < grid.length; r += 1) {
    const row = grid[r];
    for (let c = 0; c < row.length; c += 1) {
      const cell = row[c];
      if (typeof cell !== "string") continue;
      if (!DENOM_LABELS.includes(normalizeAnchorText(cell))) continue;

      const right = row[c + 1];
      const below = grid[r + 1]?.[c];
      const candidate = coerceNumber(right ?? below ?? null);
      if (Number.isFinite(candidate) && candidate !== 0) {
        return candidate;
      }
    }
  }
  return null;
}

function formatTokens(dollars: { dollars: BucketTriple; units: BucketTriple }, percents: BucketTriple): DelinquencyTokens {
  const formatCurrency = (value: number) => `$${Math.round(value).toLocaleString("en-US")}`;
  const formatInt = (value: number) => `${Math.round(value)}`;
  const formatPercent = (value: number) => `${(Math.round(value * 100) / 100).toFixed(2)}%`;

  return {
    DELINDOL30: formatCurrency(dollars.dollars.oneToThirty),
    DELINUNIT30: formatInt(dollars.units.oneToThirty),
    DELINPER30: formatPercent(percents.oneToThirty),
    DELINDOL60: formatCurrency(dollars.dollars.thirtyOneToSixty),
    DELINUNIT60: formatInt(dollars.units.thirtyOneToSixty),
    DELINPER60: formatPercent(percents.thirtyOneToSixty),
    DELINDOL61: formatCurrency(dollars.dollars.sixtyOnePlus),
    DELINUNIT61: formatInt(dollars.units.sixtyOnePlus),
    DELINPER61: formatPercent(percents.sixtyOnePlus),
  };
}

function normalizeRowLabel(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\u00A0]/g, " ")
    .replace(/[–—]/g, "-")
    .replace(/361\s*plus/gi, "361+")
    .replace(/\s+/g, "");
}

function normalizeStopLabel(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\u00A0]/g, "")
    .replace(/\s+/g, "")
    .replace(/[^a-z]/g, "");
}

function normalizeAnchorText(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[\u00A0]/g, " ")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isRowBlank(row: Cell[] | undefined): boolean {
  if (!row) return true;
  return row.every((cell) => {
    if (cell == null) return true;
    if (typeof cell === "number") return false;
    if (typeof cell === "boolean") return false;
    return String(cell).trim().length === 0;
  });
}

function firstLabelCell(row: Cell[] | undefined): string | null {
  if (!row) return null;
  for (const cell of row) {
    if (typeof cell === "string" && cell.trim()) return cell;
  }
  return null;
}

function mapToRowRecord(map: Map<RowKey, RowMetrics>): Record<RowKey, RowMetrics> {
  const blank = (): RowMetrics => ({ dollars: 0, units: 0, percent: null });
  return {
    "0_10": map.get("0_10") ?? blank(),
    "11_30": map.get("11_30") ?? blank(),
    "31_60": map.get("31_60") ?? blank(),
    "61_90": map.get("61_90") ?? blank(),
    "91_120": map.get("91_120") ?? blank(),
    "121_180": map.get("121_180") ?? blank(),
    "181_360": map.get("181_360") ?? blank(),
    "361_PLUS": map.get("361_PLUS") ?? blank(),
  };
}

function toArrayBuffer(input: WorkbookInput): ArrayBuffer {
  if (isNodeBuffer(input)) {
    const slice = input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength);
    if (slice instanceof ArrayBuffer) return slice;
    const copy = new Uint8Array(input.length);
    copy.set(input);
    return copy.buffer;
  }
  if (input instanceof ArrayBuffer) return input;
  if (ArrayBuffer.isView(input)) {
    const view = input as ArrayBufferView;
    const clone = new Uint8Array(view.byteLength);
    clone.set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
    return clone.buffer;
  }
  throw new Error("Unsupported workbook input");
}

function isNodeBuffer(value: unknown): value is Buffer {
  return typeof Buffer !== "undefined" && Buffer.isBuffer(value);
}
