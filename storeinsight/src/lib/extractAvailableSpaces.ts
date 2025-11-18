import * as XLSX from "xlsx";
import { toNumber } from "@/lib/compute";

type Segment = "F1" | "EV";

const TOKEN_MAPPING: Record<string, Partial<Record<Segment, string>>> = {
  "5X5": { F1: "5X5WEBPR", EV: "5X5WEBPREV" },
  "10X5": { F1: "10X5WEBPR", EV: "10X5WEBPREV" },
  "10X10": { F1: "10X10WEBPR", EV: "10X10WEBPREV" },
  "10X15": { F1: "10X15WEBPR", EV: "10X15WEBPREV" },
  "10X20": { F1: "10X20WEBPR", EV: "10X20WEBPREV" },
  "15X5": { F1: "15X5WEBPR", EV: "15X5WEBPREV" },
  "20X15": { F1: "20X15WEBPR", EV: "20X15WEBPREV" },
};

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const normalizeHeader = (value: unknown): string =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

const normalizeSize = (value: unknown): string | null => {
  if (value == null) return null;
  const cleaned = String(value).replace(/['"]/g, "").replace(/\s+/g, "");
  const match = cleaned.match(/(\d+(?:\.\d+)?)[xX×](\d+(?:\.\d+)?)/);
  if (!match) return null;
  const width = Number.parseFloat(match[1]);
  const depth = Number.parseFloat(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(depth)) return null;
  const normalizeDimension = (dimension: number): string =>
    Number.isInteger(dimension) ? String(dimension) : String(dimension).replace(/\.0+$/, "");
  const widthLabel = normalizeDimension(width);
  const depthLabel = normalizeDimension(depth);
  return `${widthLabel}X${depthLabel}`;
};

const toSegment = (floorValue: unknown): Segment => {
  const numeric = toNumber(floorValue);
  if (Number.isFinite(numeric)) {
    return Math.round(numeric) === 1 ? "F1" : "EV";
  }
  const normalized = String(floorValue ?? "").trim();
  return normalized === "1" ? "F1" : "EV";
};

const REQUIRED_HEADERS = ["space type", "size", "floor", "sell rate"];
const HEADER_LOOKUP = new Map(REQUIRED_HEADERS.map((key) => [normalizeHeader(key), key]));

export type AvailableSpacesTokenMap = Record<string, string>;

export function extractWebRateTokensFromAvailableSpaces(
  workbook: XLSX.WorkBook,
): AvailableSpacesTokenMap {
  const summarySheetName = workbook.SheetNames.find(
    (name) => name.trim().toLowerCase() === "summary",
  );
  if (!summarySheetName) return {};
  const sheet = workbook.Sheets[summarySheetName];
  if (!sheet) return {};

  const rows = XLSX.utils.sheet_to_json<(string | number | null | undefined)[]>(sheet, {
    header: 1,
    defval: null,
  });

  let headerRowIndex = -1;
  const columnIndex: Partial<Record<typeof REQUIRED_HEADERS[number], number>> = {};

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    if (!row || row.length === 0) continue;
    for (let col = 0; col < row.length; col += 1) {
      const normalized = normalizeHeader(row[col]);
      const field = HEADER_LOOKUP.get(normalized);
      if (field !== undefined && columnIndex[field] === undefined) {
        columnIndex[field] = col;
      }
    }
    const hasAllHeaders = REQUIRED_HEADERS.every(
      (key) => typeof columnIndex[key] === "number" && columnIndex[key]! >= 0,
    );
    if (hasAllHeaders) {
      headerRowIndex = i;
      break;
    }
  }

  if (headerRowIndex === -1) {
    return {};
  }

  const sellRateCol = columnIndex["sell rate"];
  const sizeCol = columnIndex["size"];
  const floorCol = columnIndex["floor"];
  const spaceTypeCol = columnIndex["space type"];
  if (
    sellRateCol == null ||
    sizeCol == null ||
    floorCol == null ||
    spaceTypeCol == null
  ) {
    return {};
  }

  const rateBySegment = new Map<string, number>();

  for (let i = headerRowIndex + 1; i < rows.length; i += 1) {
    const row = rows[i];
    if (!row) continue;
    const spaceTypeValue = normalizeHeader(row[spaceTypeCol]);
    if (spaceTypeValue !== "storage") continue;
    const sizeKey = normalizeSize(row[sizeCol]);
    if (!sizeKey) continue;
    const segment = toSegment(row[floorCol]);
    const sellRateRaw = row[sellRateCol];
    const sellRate = toNumber(sellRateRaw);
    const hasRawRate =
      typeof sellRateRaw === "number" ||
      (typeof sellRateRaw === "string" && sellRateRaw.trim().length > 0);
    if (!hasRawRate || !Number.isFinite(sellRate) || sellRate <= 0) continue;
    const key = `${sizeKey}-${segment}`;
    const current = rateBySegment.get(key);
    if (current == null || sellRate < current) {
      rateBySegment.set(key, sellRate);
    }
  }

  const tokens: AvailableSpacesTokenMap = {};
  for (const [composite, rate] of rateBySegment.entries()) {
    const [sizeKey, segmentLabel] = composite.split("-");
    const segment = segmentLabel === "F1" ? "F1" : "EV";
    const token =
      segment === "F1" ? TOKEN_MAPPING[sizeKey]?.F1 : TOKEN_MAPPING[sizeKey]?.EV;
    if (!token) continue;
    tokens[token] = currencyFormatter.format(rate);
  }

  return tokens;
}
