import fs from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import PizZip from "pizzip";
import { stripHiddenTokenCharacters } from "@/lib/pptTokens";

export const runtime = "nodejs";

const TEMPLATE_PATH = path.join(process.cwd(), "public", "COMPSETTEMPLATE.pptx");
const DASH = "-";
const PROP_NAME_MAX = 10;
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";

const SIZE_DEFS = [
  { key: "X25", width: 5, length: 5, area: 25 },
  { key: "X50", width: 5, length: 10, area: 50 },
  { key: "X100", width: 10, length: 10, area: 100 },
  { key: "X150", width: 10, length: 15, area: 150 },
  { key: "X200", width: 10, length: 20, area: 200 },
] as const;

const PROP_NAME_TOKENS = [
  "PROPONENAME",
  "PROPTWONAME",
  "PROPTHREENAME",
  "PROPFOURNAME",
  "PROPFIVENAME",
  "PROPSIXNAME",
] as const;

const COMPSET_TOKENS = [
  "ADDRESS",
  "MONTHYEAR",
  "MRSCC",
  "MRSFIRST",
  "PREPCOMP",
  "SUBPROP",
  ...PROP_NAME_TOKENS,
  ...Array.from({ length: 6 }, (_, idx) => `PP${idx + 1}ADDRESS`),
  ...Array.from({ length: 6 }, (_, idx) => `PP${idx + 1}FIRSTFLOORORAC`),
  ...Array.from({ length: 6 }, (_, idx) => `PP${idx + 1}DIST`),
  ...Array.from({ length: 6 }, (_, idx) => `PP${idx + 1}X25`),
  ...Array.from({ length: 6 }, (_, idx) => `PP${idx + 1}X50`),
  ...Array.from({ length: 6 }, (_, idx) => `PP${idx + 1}X100`),
  ...Array.from({ length: 6 }, (_, idx) => `PP${idx + 1}X150`),
  ...Array.from({ length: 6 }, (_, idx) => `PP${idx + 1}X200`),
  ...Array.from({ length: 6 }, (_, idx) => `PP${idx + 1}XAVG`),
];

type CompSetRow = {
  storeName: string;
  address: string;
  city: string;
  state: string;
  onlinePrice: number | null;
  regularPrice: number | null;
  width: number | null;
  length: number | null;
  cc: boolean;
  floor: number | null;
  description: string;
};

type CompProperty = {
  key: string;
  name: string;
  address: string;
  city: string;
  state: string;
  rows: CompSetRow[];
};

const truncateNameToken = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  if (trimmed.length <= PROP_NAME_MAX) return trimmed;
  return `${trimmed.slice(0, Math.max(0, PROP_NAME_MAX - 2))}..`;
};

const formatMiles = (value: number | null): string => {
  if (!Number.isFinite(value)) return DASH;
  return value.toFixed(1);
};

const haversineMiles = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 3958.8; // Earth radius in miles
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

const geocodeCache = new Map<string, { lat: number; lon: number } | null>();

const geocodeAddress = async (address: string): Promise<{ lat: number; lon: number } | null> => {
  const trimmed = address.trim();
  if (!trimmed) return null;
  const cacheHit = geocodeCache.get(trimmed);
  if (cacheHit !== undefined) return cacheHit;
  const url = new URL(NOMINATIM_URL);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "1");
  url.searchParams.set("q", trimmed);

  try {
    const res = await fetch(url.toString(), {
      headers: {
        "User-Agent": "storeinsight-comp-sets/1.0",
      },
    });
    if (!res.ok) {
      geocodeCache.set(trimmed, null);
      return null;
    }
    const data = (await res.json()) as Array<{ lat?: string; lon?: string }>;
    const first = data?.[0];
    const lat = first?.lat ? Number(first.lat) : Number.NaN;
    const lon = first?.lon ? Number(first.lon) : Number.NaN;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      geocodeCache.set(trimmed, null);
      return null;
    }
    const result = { lat, lon };
    geocodeCache.set(trimmed, result);
    return result;
  } catch {
    geocodeCache.set(trimmed, null);
    return null;
  }
};

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const subjectName = String(formData.get("subjectName") ?? "").trim();
  const subjectAddress = String(formData.get("subjectAddress") ?? "").trim();
  const preparedFor = String(formData.get("preparedFor") ?? "").trim();
  const propertyId = String(formData.get("propertyId") ?? "").trim();
  const asOfDate = String(formData.get("asOfDate") ?? "").trim();
  const file = formData.get("file");

  if (!subjectName) {
    return NextResponse.json({ error: "subjectName is required" }, { status: 400 });
  }

  if (!subjectAddress) {
    return NextResponse.json({ error: "subjectAddress is required" }, { status: 400 });
  }

  if (!preparedFor) {
    return NextResponse.json({ error: "preparedFor is required" }, { status: 400 });
  }

  if (!asOfDate) {
    return NextResponse.json({ error: "asOfDate is required" }, { status: 400 });
  }

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }

  const lowerName = file.name.toLowerCase();
  if (!lowerName.endsWith(".xlsx") && !lowerName.endsWith(".csv")) {
    return NextResponse.json({ error: "Upload must be a .xlsx or .csv file." }, { status: 400 });
  }

  const workbookBuffer = Buffer.from(await file.arrayBuffer());
  const workbook = XLSX.read(workbookBuffer, { type: "buffer" });
  const rows = extractCompSetRows(workbook);

  if (rows.length === 0) {
    return NextResponse.json(
      { error: "No comp set rows detected. Confirm the CSV includes store name, address, and pricing columns." },
      { status: 400 },
    );
  }

  const properties = groupProperties(rows);
  const orderedComps = properties.sort((a, b) => {
    const countDiff = b.rows.length - a.rows.length;
    if (countDiff !== 0) return countDiff;
    const nameDiff = a.name.localeCompare(b.name);
    if (nameDiff !== 0) return nameDiff;
    return a.address.localeCompare(b.address);
  });
  const distanceMap = new Map<string, number | null>();

  const monthYear = formatMonthYear(asOfDate);
  const subjectCoords = subjectAddress ? await geocodeAddress(subjectAddress) : null;

  let sortedComps = orderedComps;
  if (subjectCoords) {
    const withDistance: Array<{ property: CompProperty; distance: number | null; order: number }> = [];
    for (let index = 0; index < orderedComps.length; index += 1) {
      const property = orderedComps[index];
      const compCoords = await geocodeAddress(formatFullAddress(property));
      const distance =
        compCoords
          ? haversineMiles(subjectCoords.lat, subjectCoords.lon, compCoords.lat, compCoords.lon)
          : null;
      distanceMap.set(property.key, distance);
      withDistance.push({ property, distance, order: index });
    }
    withDistance.sort((a, b) => {
      const aDist = Number.isFinite(a.distance) ? (a.distance as number) : Number.POSITIVE_INFINITY;
      const bDist = Number.isFinite(b.distance) ? (b.distance as number) : Number.POSITIVE_INFINITY;
      if (aDist !== bDist) return aDist - bDist;
      return a.order - b.order;
    });
    sortedComps = withDistance.map((entry) => entry.property);
  }

  const selectedComps = sortedComps.slice(0, 6);

  const marketRates = computeMarketRates(rows);

  const tokens: Record<string, string> = {
    MONTHYEAR: monthYear || DASH,
    SUBPROP: subjectName,
    PREPCOMP: preparedFor,
    ADDRESS: subjectAddress || DASH,
    MRSFIRST: formatRate(marketRates.firstFloor ?? marketRates.overall),
    MRSCC: formatRate(marketRates.climate ?? marketRates.overall),
  };

  for (let index = 0; index < selectedComps.length; index += 1) {
    const property = selectedComps[index];
    const propNumber = index + 1;
    const nameToken = PROP_NAME_TOKENS[index];
    if (nameToken) {
      tokens[nameToken] = property.name ? truncateNameToken(property.name) : DASH;
    }
    tokens[`PP${propNumber}ADDRESS`] = formatFullAddress(property) || DASH;

    const cachedDistance = distanceMap.get(property.key);
    let distanceMiles: number | null =
      cachedDistance === undefined ? null : cachedDistance;
    if (cachedDistance === undefined && subjectCoords) {
      const compCoords = await geocodeAddress(formatFullAddress(property));
      distanceMiles =
        compCoords && subjectCoords
          ? haversineMiles(subjectCoords.lat, subjectCoords.lon, compCoords.lat, compCoords.lon)
          : null;
      distanceMap.set(property.key, distanceMiles);
    }
    tokens[`PP${propNumber}DIST`] = formatMiles(distanceMiles);

    const pricing = computePropertyPricing(property.rows);
    tokens[`PP${propNumber}FIRSTFLOORORAC`] = pricing.label;
    for (const sizeDef of SIZE_DEFS) {
      tokens[`PP${propNumber}${sizeDef.key}`] = formatRate(pricing.bySize[sizeDef.key]);
    }
    tokens[`PP${propNumber}XAVG`] = formatRate(pricing.average);
  }

  for (const token of COMPSET_TOKENS) {
    if (tokens[token] == null || tokens[token]?.trim() === "") {
      tokens[token] = DASH;
    }
  }

  const templateBuffer = await fs.readFile(TEMPLATE_PATH);
  const zip = new PizZip(templateBuffer);
  scrubHiddenCharactersFromZip(zip);
  const pptxBuffer = await renderTokensIntoZip(zip, tokens);

  const safeProperty = (subjectName || propertyId || "CompSet").replace(/[^A-Za-z0-9._-]+/g, "_");
  const safeAsOfSegment = (asOfDate || "latest").replace(/[^0-9A-Za-z._-]+/g, "_");
  const filename = `CompSet-${safeProperty}-${safeAsOfSegment}.pptx`;

  return new NextResponse(pptxBuffer as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

function extractCompSetRows(workbook: XLSX.WorkBook): CompSetRow[] {
  for (const sheetName of workbook.SheetNames ?? []) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, blankrows: false }) as unknown[][];
    if (!rows || rows.length === 0) continue;
    const headerInfo = findCompSetHeaderRow(rows);
    if (!headerInfo) continue;
    const { index, columns } = headerInfo;

    const results: CompSetRow[] = [];
    for (let rowIdx = index + 1; rowIdx < rows.length; rowIdx += 1) {
      const row = rows[rowIdx] ?? [];
      const storeName = getCellString(row, columns.storeName);
      const address = getCellString(row, columns.address);
      const city = getCellString(row, columns.city);
      const state = getCellString(row, columns.state);
      if (!storeName || !address) continue;
      const description = getCellString(row, columns.description);
      const ccValue = getCellString(row, columns.cc);
      const floorValue = getCellString(row, columns.floor);
      const width = toNumber(getCellString(row, columns.width));
      const length = toNumber(getCellString(row, columns.length));

      results.push({
        storeName,
        address,
        city,
        state,
        onlinePrice: toNumber(getCellString(row, columns.onlinePrice)),
        regularPrice: toNumber(getCellString(row, columns.regularPrice)),
        width: Number.isFinite(width) ? width : null,
        length: Number.isFinite(length) ? length : null,
        cc: isTruthy(ccValue) || /climate|air\s*cooled/i.test(description),
        floor: Number.isFinite(toNumber(floorValue)) ? toNumber(floorValue) : null,
        description,
      });
    }

    if (results.length > 0) {
      return results;
    }
  }

  return [];
}

type HeaderInfo = {
  index: number;
  columns: {
    storeName: number;
    address: number;
    city: number;
    state: number;
    onlinePrice: number;
    regularPrice: number;
    width: number;
    length: number;
    cc: number;
    floor: number;
    description: number;
  };
};

const HEADER_ALIASES = {
  storeName: ["storename", "store name", "facility name", "property name"],
  address: ["address", "street", "address1"],
  city: ["city"],
  state: ["state", "st"],
  onlinePrice: ["onlineprice", "online price", "web price", "online rate"],
  regularPrice: ["regularprice", "regular price", "street price", "standard price"],
  width: ["width"],
  length: ["length"],
  cc: ["cc", "climate", "climatecontrolled"],
  floor: ["floor", "level"],
  description: ["description", "desc"],
} as const;

function findCompSetHeaderRow(rows: unknown[][]): HeaderInfo | null {
  const scanLimit = Math.min(rows.length, 15);
  for (let idx = 0; idx < scanLimit; idx += 1) {
    const row = rows[idx] ?? [];
    const headerTokens = row.map((cell) => normalizeHeader(cell));
    const storeName = findHeaderIndex(headerTokens, HEADER_ALIASES.storeName);
    const address = findHeaderIndex(headerTokens, HEADER_ALIASES.address);
    if (storeName === -1 || address === -1) continue;

    const info: HeaderInfo = {
      index: idx,
      columns: {
        storeName,
        address,
        city: findHeaderIndex(headerTokens, HEADER_ALIASES.city),
        state: findHeaderIndex(headerTokens, HEADER_ALIASES.state),
        onlinePrice: findHeaderIndex(headerTokens, HEADER_ALIASES.onlinePrice),
        regularPrice: findHeaderIndex(headerTokens, HEADER_ALIASES.regularPrice),
        width: findHeaderIndex(headerTokens, HEADER_ALIASES.width),
        length: findHeaderIndex(headerTokens, HEADER_ALIASES.length),
        cc: findHeaderIndex(headerTokens, HEADER_ALIASES.cc),
        floor: findHeaderIndex(headerTokens, HEADER_ALIASES.floor),
        description: findHeaderIndex(headerTokens, HEADER_ALIASES.description),
      },
    };

    return info;
  }
  return null;
}

function normalizeHeader(value: unknown): string {
  if (value == null) return "";
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "").trim();
}

function findHeaderIndex(headers: string[], aliases: readonly string[]): number {
  const normalizedAliases = aliases.map((alias) => alias.replace(/[^a-z0-9]+/g, ""));
  return headers.findIndex((header) => normalizedAliases.includes(header));
}

function getCellString(row: unknown[], index: number): string {
  if (index < 0) return "";
  const raw = row?.[index];
  if (raw == null) return "";
  return String(raw).trim();
}

function toNumber(raw: string | number): number {
  if (typeof raw === "number") return raw;
  if (!raw) return Number.NaN;
  const cleaned = raw.replace(/[,$()%]/g, "");
  if (!cleaned) return Number.NaN;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function isTruthy(value: string): boolean {
  const trimmed = value.trim().toLowerCase();
  return trimmed === "1" || trimmed === "true" || trimmed === "yes";
}

function groupProperties(rows: CompSetRow[]): CompProperty[] {
  const map = new Map<string, CompProperty>();
  for (const row of rows) {
    const key = normalizeKey(`${row.storeName}|${row.address}|${row.city}|${row.state}`);
    if (!key) continue;
    const existing = map.get(key);
    if (existing) {
      existing.rows.push(row);
      continue;
    }
    map.set(key, {
      key,
      name: row.storeName,
      address: row.address,
      city: row.city,
      state: row.state,
      rows: [row],
    });
  }
  return Array.from(map.values());
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "").trim();
}

function formatMonthYear(value: string): string {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  const formatter = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  return formatter.format(parsed);
}

function formatFullAddress(property: { address: string; city: string; state: string }): string {
  const parts = [property.address, property.city, property.state].filter(Boolean);
  return parts.join(", ").trim();
}

function computeMarketRates(rows: CompSetRow[]): { overall: number | null; climate: number | null; firstFloor: number | null } {
  const allRates: number[] = [];
  const climateRates: number[] = [];
  const firstFloorRates: number[] = [];

  for (const row of rows) {
    const rate = getRowRate(row);
    if (rate == null) continue;
    allRates.push(rate);
    if (isClimateRow(row)) climateRates.push(rate);
    if (isFirstFloorRow(row)) firstFloorRates.push(rate);
  }

  return {
    overall: average(allRates),
    climate: average(climateRates),
    firstFloor: average(firstFloorRates),
  };
}

function computePropertyPricing(rows: CompSetRow[]): { label: string; bySize: Record<string, number | null>; average: number | null } {
  const climateRows = rows.filter((row) => isClimateRow(row));
  const firstFloorRows = rows.filter((row) => isFirstFloorRow(row));
  let filterLabel = "Standard";
  let filteredRows = rows;

  if (climateRows.length > 0) {
    filterLabel = "Climate Controlled";
    filteredRows = climateRows;
  } else if (firstFloorRows.length > 0) {
    filterLabel = "First Floor";
    filteredRows = firstFloorRows;
  }

  const bySize: Record<string, number | null> = {};
  let fallbackUsed = false;

  for (const sizeDef of SIZE_DEFS) {
    const sizeRates = collectRatesForSize(filteredRows, sizeDef);
    if (sizeRates.length === 0 && filteredRows !== rows) {
      fallbackUsed = true;
      sizeRates.push(...collectRatesForSize(rows, sizeDef));
    }
    bySize[sizeDef.key] = average(sizeRates);
  }

  if (fallbackUsed && filterLabel !== "Standard") {
    filterLabel = "First Floor / A/C";
  }

  const sizeValues = Object.values(bySize).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const averageValue = average(sizeValues);

  return { label: filterLabel, bySize, average: averageValue };
}

function collectRatesForSize(rows: CompSetRow[], sizeDef: (typeof SIZE_DEFS)[number]): number[] {
  const rates: number[] = [];
  for (const row of rows) {
    const sizeKey = resolveSizeKey(row);
    if (sizeKey !== sizeDef.key) continue;
    const rate = getRowRate(row);
    if (rate == null) continue;
    rates.push(rate);
  }
  return rates;
}

function resolveSizeKey(row: CompSetRow): string | null {
  if (!Number.isFinite(row.width ?? Number.NaN) || !Number.isFinite(row.length ?? Number.NaN)) return null;
  const width = Math.abs(row.width ?? 0);
  const length = Math.abs(row.length ?? 0);
  const min = Math.min(width, length);
  const max = Math.max(width, length);
  for (const sizeDef of SIZE_DEFS) {
    const targetMin = Math.min(sizeDef.width, sizeDef.length);
    const targetMax = Math.max(sizeDef.width, sizeDef.length);
    if (Math.abs(min - targetMin) < 0.01 && Math.abs(max - targetMax) < 0.01) {
      return sizeDef.key;
    }
  }
  return null;
}

function getRowRate(row: CompSetRow): number | null {
  const width = row.width ?? Number.NaN;
  const length = row.length ?? Number.NaN;
  if (!Number.isFinite(width) || !Number.isFinite(length)) return null;
  const area = Math.abs(width * length);
  if (!Number.isFinite(area) || area <= 0) return null;
  const price = Number.isFinite(row.onlinePrice ?? Number.NaN)
    ? (row.onlinePrice as number)
    : Number.isFinite(row.regularPrice ?? Number.NaN)
      ? (row.regularPrice as number)
      : Number.NaN;
  if (!Number.isFinite(price) || price <= 0) return null;
  return price / area;
}

function isClimateRow(row: CompSetRow): boolean {
  if (row.cc) return true;
  const description = row.description.toLowerCase();
  return /climate|air\s*cooled/.test(description);
}

function isFirstFloorRow(row: CompSetRow): boolean {
  const floor = row.floor;
  if (Number.isFinite(floor ?? Number.NaN) && floor != null) {
    if (floor === 0 || floor === 1) return true;
  }
  const description = row.description.toLowerCase();
  return /\b(1st|first|ground)\b/.test(description);
}

function average(values: number[]): number | null {
  if (!values || values.length === 0) return null;
  const total = values.reduce((sum, value) => sum + value, 0);
  return total / values.length;
}

function formatRate(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return DASH;
  return `$${value.toFixed(2)}`;
}

const PPT_XML_FILE_PATTERN = /^ppt\/(slides|slideLayouts|slideMasters)\/.*\.xml$/;

function scrubHiddenCharactersFromZip(zip: PizZip): void {
  const xmlPaths = Object.keys(zip.files).filter((filename) => PPT_XML_FILE_PATTERN.test(filename));
  for (const filename of xmlPaths) {
    const file = zip.file(filename);
    if (!file) continue;
    const original = file.asText();
    const sanitized = stripHiddenTokenCharacters(original);
    if (sanitized !== original) {
      zip.file(filename, sanitized);
    }
  }
}

function normalizeTokenKey(key: string): string {
  return stripHiddenTokenCharacters(key).replace(/\s+/g, "").toUpperCase();
}

async function renderTokensIntoZip(zip: PizZip, tokens: Record<string, string>): Promise<Buffer> {
  const normalizedTokens: Record<string, string> = {};
  for (const [key, value] of Object.entries(tokens)) {
    const normalizedKey = normalizeTokenKey(key);
    if (!normalizedKey) continue;
    normalizedTokens[normalizedKey] = value ?? "";
  }

  const pptXmlPaths = Object.keys(zip.files).filter(
    (filename) => filename.startsWith("ppt/") && filename.endsWith(".xml") && !filename.startsWith("ppt/embeddings/"),
  );
  for (const filename of pptXmlPaths) {
    const file = zip.file(filename);
    if (!file) continue;
    const original = file.asText();
    const replaced = replaceTokensInContent(original, normalizedTokens);
    if (replaced !== original) {
      zip.file(filename, replaced);
    }
  }

  await processEmbeddedWorkbooks(zip, normalizedTokens);

  return zip.generate({ type: "nodebuffer" });
}

function replaceTokensInContent(content: string, normalizedTokens: Record<string, string>): string {
  return content.replace(/{{\s*([^{}]+?)\s*}}/g, (_match, rawKey) => {
    const key = normalizeTokenKey(String(rawKey));
    if (!key) return "";
    const value = normalizedTokens[key];
    return value ?? "";
  });
}

async function processEmbeddedWorkbooks(zip: PizZip, normalizedTokens: Record<string, string>): Promise<void> {
  const embeddedPaths = Object.keys(zip.files).filter((p) => p.startsWith("ppt/embeddings/") && p.endsWith(".xlsx"));

  for (const embeddedPath of embeddedPaths) {
    const file = zip.file(embeddedPath);
    if (!file) continue;
    const buffer =
      typeof file.asUint8Array === "function"
        ? file.asUint8Array()
        : file.asNodeBuffer
          ? file.asNodeBuffer()
          : new Uint8Array(Buffer.from(file.asBinary(), "binary"));
    const workbookZip = new PizZip(buffer);
    const innerXmlPaths = Object.keys(workbookZip.files).filter(
      (innerPath) => innerPath.startsWith("xl/") && innerPath.endsWith(".xml"),
    );
    let mutated = false;
    for (const innerPath of innerXmlPaths) {
      const workbookFile = workbookZip.file(innerPath);
      if (!workbookFile) continue;
      const original = workbookFile.asText();
      const replaced = replaceTokensInContent(original, normalizedTokens);
      if (replaced !== original) {
        workbookZip.file(innerPath, replaced);
        mutated = true;
      }
    }
    if (mutated) {
      const updatedBuffer = workbookZip.generate({ type: "uint8array" });
      zip.file(embeddedPath, updatedBuffer);
    }
  }
}
