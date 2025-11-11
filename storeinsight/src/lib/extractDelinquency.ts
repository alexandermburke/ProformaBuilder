import * as XLSX from "xlsx";
import {
  DELINQUENCY_BUCKET_KEYS,
  type DelinquencyBucketKey,
  type DelinquencyCellKind,
  DELINQ_CELL_MAP,
  DELINQ_SHEET_CANDIDATES,
} from "@/lib/delinqCellMap";

type WorkbookInput = ArrayBuffer | ArrayBufferView | Buffer;
type Cell = string | number | boolean | null;

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

export type DelinquencyTokenProvenance = Record<
  keyof DelinquencyTokens,
  {
    sheet: string;
    cells: string[];
  }
>;

type DelinquencyBucketMetrics = Record<DelinquencyCellKind, number>;

type DelinquencyBucketRecord = Record<DelinquencyBucketKey, DelinquencyBucketMetrics>;

type BucketGroupKey = "oneToThirty" | "thirtyOneToSixty" | "sixtyOnePlus";

const BUCKET_GROUPS: Record<BucketGroupKey, DelinquencyBucketKey[]> = {
  oneToThirty: ["0_10", "11_30"],
  thirtyOneToSixty: ["31_60"],
  sixtyOnePlus: ["61_90", "91_120", "121_180", "181_360", "361_PLUS"],
};

const METRICS: DelinquencyCellKind[] = ["dollars", "units", "percent"];

type AggregatedMetricValues = Record<DelinquencyCellKind, Record<BucketGroupKey, number>>;
type AggregatedMetricCells = Record<DelinquencyCellKind, Record<BucketGroupKey, string[]>>;

type TokenSpec = {
  token: keyof DelinquencyTokens;
  metric: DelinquencyCellKind;
  group: BucketGroupKey;
};

const TOKEN_SPECS: TokenSpec[] = [
  { token: "DELINDOL30", metric: "dollars", group: "oneToThirty" },
  { token: "DELINUNIT30", metric: "units", group: "oneToThirty" },
  { token: "DELINPER30", metric: "percent", group: "oneToThirty" },
  { token: "DELINDOL60", metric: "dollars", group: "thirtyOneToSixty" },
  { token: "DELINUNIT60", metric: "units", group: "thirtyOneToSixty" },
  { token: "DELINPER60", metric: "percent", group: "thirtyOneToSixty" },
  { token: "DELINDOL61", metric: "dollars", group: "sixtyOnePlus" },
  { token: "DELINUNIT61", metric: "units", group: "sixtyOnePlus" },
  { token: "DELINPER61", metric: "percent", group: "sixtyOnePlus" },
];

export type DelinquencyExtractionResult =
  | {
      ok: true;
      tokens: DelinquencyTokens;
      provenance: DelinquencyTokenProvenance;
      debug: {
        sheet: string;
        buckets: DelinquencyBucketRecord;
      };
    }
  | {
      ok: false;
      code: "PARSE_ERROR" | "SHEET_NOT_FOUND";
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

  const sheetName = selectSheet(workbook.SheetNames);
  if (!sheetName) {
    return {
      ok: false,
      code: "SHEET_NOT_FOUND",
      message: "Delinquency worksheet not found. Expected ESR tab.",
      hints: { sheets: workbook.SheetNames, candidates: DELINQ_SHEET_CANDIDATES },
    };
  }

  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    return {
      ok: false,
      code: "SHEET_NOT_FOUND",
      message: `Worksheet "${sheetName}" is missing from workbook.`,
    };
  }

  const buckets = readBucketValues(sheet);
  const aggregated = aggregateBuckets(buckets);
  const tokens = formatTokens(aggregated.values);
  const provenance = buildProvenance(aggregated.cells, sheetName);

  return {
    ok: true,
    tokens,
    provenance,
    debug: {
      sheet: sheetName,
      buckets,
    },
  };
}

function selectSheet(sheetNames: string[]): string | null {
  const normalized = sheetNames.map((name) => normalizeSheetName(name));
  for (const candidate of DELINQ_SHEET_CANDIDATES) {
    const target = normalizeSheetName(candidate);
    const index = normalized.findIndex((sheet) => sheet === target);
    if (index >= 0) return sheetNames[index] ?? null;
  }
  return null;
}

function normalizeSheetName(name: string): string {
  return name.trim().toLowerCase();
}

function readBucketValues(sheet: XLSX.WorkSheet): DelinquencyBucketRecord {
  const record = {} as DelinquencyBucketRecord;
  for (const bucket of DELINQUENCY_BUCKET_KEYS) {
    const cells = DELINQ_CELL_MAP[bucket];
    record[bucket] = {
      dollars: readCellNumber(sheet, cells.dollars),
      units: readCellNumber(sheet, cells.units),
      percent: readCellNumber(sheet, cells.percent),
    };
  }
  return record;
}

function readCellNumber(sheet: XLSX.WorkSheet, address: string): number {
  const value = sheet[address]?.v;
  return coerceNumber(value as Cell);
}

function aggregateBuckets(buckets: DelinquencyBucketRecord): {
  values: AggregatedMetricValues;
  cells: AggregatedMetricCells;
} {
  const values = {} as AggregatedMetricValues;
  const cells = {} as AggregatedMetricCells;

  for (const metric of METRICS) {
    values[metric] = {
      oneToThirty: 0,
      thirtyOneToSixty: 0,
      sixtyOnePlus: 0,
    };
    cells[metric] = {
      oneToThirty: [],
      thirtyOneToSixty: [],
      sixtyOnePlus: [],
    };
  }

  for (const group of Object.keys(BUCKET_GROUPS) as BucketGroupKey[]) {
    const bucketList = BUCKET_GROUPS[group];
    for (const metric of METRICS) {
      let total = 0;
      const cellRefs: string[] = [];
      for (const bucket of bucketList) {
        const bucketMetrics = buckets[bucket];
        total += bucketMetrics[metric] ?? 0;
        const ref = DELINQ_CELL_MAP[bucket][metric];
        if (ref) cellRefs.push(ref);
      }
      values[metric][group] = total;
      cells[metric][group] = cellRefs;
    }
  }

  return { values, cells };
}

function buildProvenance(
  cells: AggregatedMetricCells,
  sheet: string,
): DelinquencyTokenProvenance {
  const provenance = {} as DelinquencyTokenProvenance;
  for (const spec of TOKEN_SPECS) {
    const key = spec.token;
    const list = cells[spec.metric][spec.group] ?? [];
    provenance[key] = {
      sheet,
      cells: list.filter(Boolean),
    };
  }
  return provenance;
}

function formatTokens(values: AggregatedMetricValues): DelinquencyTokens {
  const formatCurrency = (value: number) => `$${Math.round(value).toLocaleString("en-US")}`;
  const formatUnits = (value: number) => `${Math.round(value).toLocaleString("en-US")}`;
  const formatPercent = (value: number) => `${(Math.round(value * 100) / 100).toFixed(2)}%`;

  return {
    DELINDOL30: formatCurrency(values.dollars.oneToThirty),
    DELINUNIT30: formatUnits(values.units.oneToThirty),
    DELINPER30: formatPercent(values.percent.oneToThirty),
    DELINDOL60: formatCurrency(values.dollars.thirtyOneToSixty),
    DELINUNIT60: formatUnits(values.units.thirtyOneToSixty),
    DELINPER60: formatPercent(values.percent.thirtyOneToSixty),
    DELINDOL61: formatCurrency(values.dollars.sixtyOnePlus),
    DELINUNIT61: formatUnits(values.units.sixtyOnePlus),
    DELINPER61: formatPercent(values.percent.sixtyOnePlus),
  };
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
