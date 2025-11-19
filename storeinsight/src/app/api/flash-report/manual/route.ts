import fs from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import PizZip from "pizzip";
import { listProperties } from "@/app/api/daily-summary/store";
import { stripHiddenTokenCharacters } from "@/lib/pptTokens";

export const runtime = "nodejs";

type TokenMap = Record<string, string | number | unknown[]>;

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const propertyId = String(formData.get("propertyId") ?? "");
  const asOfDate = String(formData.get("asOfDate") ?? "");
  const file = formData.get("file");

  if (!propertyId) {
    return NextResponse.json({ error: "propertyId is required" }, { status: 400 });
  }

  if (!asOfDate) {
    return NextResponse.json({ error: "asOfDate is required" }, { status: 400 });
  }

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }

  const workbookBuffer = await file.arrayBuffer();
  const workbook = new ExcelJS.Workbook();

  try {
    await workbook.xlsx.load(workbookBuffer);
  } catch (err) {
    console.error("[flash-report/manual] unable to read workbook", err);
    return NextResponse.json({ error: "Uploaded file is not a valid XLSX workbook." }, { status: 400 });
  }

  const msrSheet = workbook.getWorksheet("MSR");
  const delinquenciesSheet = workbook.getWorksheet("Delinquencies");

  if (!msrSheet) {
    return NextResponse.json({ error: 'Workbook is missing required "MSR" worksheet.' }, { status: 400 });
  }

  if (!delinquenciesSheet) {
    return NextResponse.json({ error: 'Workbook is missing required "Delinquencies" worksheet.' }, { status: 400 });
  }

  let tokens: TokenMap;
  try {
    tokens = buildTokenMap(msrSheet, delinquenciesSheet);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unable to read workbook cells.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const templatePath = path.join(process.cwd(), "public", "FLATEMPLATE.pptx");

  let templateBuffer: Buffer;
  try {
    templateBuffer = fs.readFileSync(templatePath);
  } catch (err) {
    console.error("[flash-report/manual] unable to read PPTX template", err);
    return NextResponse.json({ error: "Template file not found." }, { status: 500 });
  }

  const zip = new PizZip(templateBuffer);
  scrubHiddenCharactersFromZip(zip);
  const rendered = renderTokensIntoZip(zip, tokens);

  const properties = await listProperties();
  const property = properties.find((p) => p.id === propertyId);
  if (!property) {
    return NextResponse.json({ error: "Unknown propertyId" }, { status: 404 });
  }

  const safePropertyId = propertyId.replace(/[^A-Za-z0-9._-]+/g, "_");
  const filename = `DailyFlash-${safePropertyId}-${asOfDate}.pptx`;

  return new NextResponse(rendered as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

function buildTokenMap(msrSheet: ExcelJS.Worksheet, delinquenciesSheet: ExcelJS.Worksheet): TokenMap {
  const propertyDisplayName = readString(msrSheet, "K1", "Property display name (MSR!K1)");
  const [facilityCode, facilityShortName] = deriveFacilitySegments(propertyDisplayName);
  const asOfDateCell = readDate(msrSheet, "A3", "As-of date (MSR!A3)");

  const mtdRentals = readNumber(msrSheet, "E61", "MTD rentals (MSR!E61)");
  const dailyRentals = readNumber(msrSheet, "D61", "Daily rentals (MSR!D61)");
  const dailyReservations = readNumber(msrSheet, "D65", "Daily reservations (MSR!D65)");
  const rybtmi = readNumber(msrSheet, "F61", "YTD move-ins (MSR!F61)");
  const mtdVacates = readNumber(msrSheet, "E62", "MTD vacates (MSR!E62)");
  const dailyVacates = readNumber(msrSheet, "D62", "Daily vacates (MSR!D62)");
  const mtdNetRentals = readNumber(msrSheet, "E63", "MTD net rentals (MSR!E63)");
  const webLeadsMtd = readNumber(msrSheet, "M47", "Web leads MTD (MSR!M47)");
  const walkInLeadsMtd = readNumber(msrSheet, "M48", "Walk-in leads MTD (MSR!M48)");
  const phoneLeadsMtd = readNumber(msrSheet, "M49", "Phone leads MTD (MSR!M49)");
  const otherLeadsMtd = readNumber(msrSheet, "M50", "Other leads MTD (MSR!M50)");
  const leadsMtd = webLeadsMtd + walkInLeadsMtd + phoneLeadsMtd + otherLeadsMtd;
  const leadsConvertedMtd = readNumber(msrSheet, "M51", "Leads converted MTD (MSR!M51)");
  const conv = formatPercent(leadsMtd > 0 ? leadsConvertedMtd / leadsMtd : 0);

  const totalRsf = readNumber(msrSheet, "M44", "Total RSF (MSR!M44)");
  const occRsf = readNumber(msrSheet, "M41", "Occupied RSF (MSR!M41)");
  const rsfOccPct = formatToTwo(readNumber(msrSheet, "N41", "RSF occupancy % (MSR!N41)"));
  const occUnits = readNumber(msrSheet, "K41", "Occupied units (MSR!K41)");
  const pmOccUnits = occUnits - mtdNetRentals;
  const coverage = formatPercent(readNumber(msrSheet, "N14", "Coverage enrollment % (MSR!N14)"));

  const totalArAll = formatToTwo(readNumber(msrSheet, "F47", "AR Balance (All leases) (MSR!F47)"));
  const ar30Plus = formatToTwo(sumArOverDays(delinquenciesSheet, 30));
  const ar60Plus = formatToTwo(sumArOverDays(delinquenciesSheet, 60));
  const arOver30Pct = formatPercent(totalArAll > 0 ? ar30Plus / totalArAll : 0);
  const arOver60Pct = formatPercent(totalArAll > 0 ? ar60Plus / totalArAll : 0);

  const occPctSqft = formatToTwo(readNumber(msrSheet, "E8", "SQ FT occupancy % (MSR!E8)"));
  const occPctSpaces = formatToTwo(readNumber(msrSheet, "E9", "Spaces occupancy % (MSR!E9)"));
  const occPctEcon = formatToTwo(readNumber(msrSheet, "E10", "Economic occupancy % (MSR!E10)"));

  const arAgingTokens: Record<string, number> = {
    ARAGING_0_10: formatToTwo(readNumber(msrSheet, "L72", "AR Aging 0-10 (MSR!L72)")),
    ARAGING_11_30: formatToTwo(readNumber(msrSheet, "L73", "AR Aging 11-30 (MSR!L73)")),
    ARAGING_31_60: formatToTwo(readNumber(msrSheet, "L74", "AR Aging 31-60 (MSR!L74)")),
    ARAGING_61_90: formatToTwo(readNumber(msrSheet, "L75", "AR Aging 61-90 (MSR!L75)")),
    ARAGING_91_120: formatToTwo(readNumber(msrSheet, "L76", "AR Aging 91-120 (MSR!L76)")),
    ARAGING_121_180: formatToTwo(readNumber(msrSheet, "L77", "AR Aging 121-180 (MSR!L77)")),
    ARAGING_181_360: formatToTwo(readNumber(msrSheet, "L78", "AR Aging 181-360 (MSR!L78)")),
    ARAGING_361_PLUS: formatToTwo(readNumber(msrSheet, "L79", "AR Aging 361+ (MSR!L79)")),
  };

  const projRent = readNumber(msrSheet, "L32", "Projected rent (MSR!L32)");
  const projRentPerSf = readNumber(msrSheet, "K32", "Projected rent per SF (MSR!K32)");
  const gpr = readNumber(msrSheet, "L26", "Gross potential rent (MSR!L26)");
  const gprPerSf = readNumber(msrSheet, "K26", "GPR per SF (MSR!K26)");
  const econOccPct = formatToTwo(readNumber(msrSheet, "J32", "Economic occupancy % (MSR!J32)"));

  return {
    PROPERTYDISPLAYNAME: propertyDisplayName,
    FACILITYCODE: facilityCode,
    FACILITYSHORTNAME: facilityShortName,
    ASOFDATE: formatDate(asOfDateCell),
    MTDRENTALS: mtdRentals,
    DAILYRENTALS: dailyRentals,
    DAILYRES: dailyReservations,
    RYTBMI: rybtmi,
    LEADSMTD: leadsMtd,
    CONV: conv,
    MTDVACATES: mtdVacates,
    DAILYVACATES: dailyVacates,
    MTDNETRENTALS: mtdNetRentals,
    TOTALRSF: formatNumberWithCommas(totalRsf),
    OCCRSF: formatNumberWithCommas(occRsf),
    RSFOCCPCT: formatPercent(rsfOccPct),
    OCCUNITS: occUnits,
    COVERAGE: coverage,
    PMOCCUNITS: pmOccUnits,
    MOMOCCGROWTHPCT: formatPercent(0),
    TOTALARALL: formatCurrency(totalArAll),
    AR30PLUS: formatCurrency(ar30Plus),
    AROVER30DAYSPCT: arOver30Pct,
    AROVER60DAYSPCT: arOver60Pct,
    PROJRENT: formatCurrency(projRent),
    PROJRENTPERSF: formatCurrency(projRentPerSf),
    PROJRENTMOMPCT: formatPercent(0),
    GROSSPOTRENT: formatCurrency(gpr),
    GPRPERSF: formatCurrency(gprPerSf),
    GPRMOMPCT: formatPercent(0),
    ECONOCCPCT: formatPercent(econOccPct),
    OCCPCT_SQFT: occPctSqft,
    OCCPCT_SPACES: occPctSpaces,
    OCCPCT_ECON: occPctEcon,
    ...arAgingTokens,
    RENTALSBYMONTHSERIES: [],
    VACATESBYMONTHSERIES: [],
    RSFOCCUPANCYBYMONTHSERIES: [],
    PROJECTEDRENTALREVENUESERIES: [],
    FACILITYOPENDATE: "",
  };
}

function deriveFacilitySegments(input: string): [string, string] {
  if (!input.includes(" - ")) {
    return [input, input];
  }
  const [code, name] = input.split(" - ");
  return [code?.trim() ?? input, name?.trim() ?? input];
}

function readString(sheet: ExcelJS.Worksheet, address: string, label: string): string {
  const value = normalizeCellValue(sheet.getCell(address).value);
  if (value == null) {
    throw new Error(`${label} is missing.`);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) throw new Error(`${label} is empty.`);
    return trimmed;
  }
  if (typeof value === "number" || value instanceof Date || typeof value === "boolean") {
    return String(value);
  }
  throw new Error(`${label} is invalid.`);
}

function readNumber(sheet: ExcelJS.Worksheet, address: string, label: string): number {
  const value = normalizeCellValue(sheet.getCell(address).value);
  if (value == null) {
    throw new Error(`${label} is missing.`);
  }
  const numeric = coerceNumber(value);
  if (!Number.isFinite(numeric)) {
    throw new Error(`${label} is not a number.`);
  }
  return numeric;
}

function readDate(sheet: ExcelJS.Worksheet, address: string, label: string): Date {
  const value = normalizeCellValue(sheet.getCell(address).value);
  if (value == null) {
    throw new Error(`${label} is missing.`);
  }
  if (value instanceof Date) return value;
  if (typeof value === "number" && Number.isFinite(value)) {
    return excelSerialDateToJsDate(value);
  }
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }
  throw new Error(`${label} is not a valid date.`);
}

function sumArOverDays(sheet: ExcelJS.Worksheet, minDays: number): number {
  let total = 0;
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // header row
    const days = coerceNumber(normalizeCellValue(row.getCell("D").value));
    const amount = coerceNumber(normalizeCellValue(row.getCell("E").value));
    if (Number.isFinite(days) && Number.isFinite(amount) && days >= minDays) {
      total += amount;
    }
  });
  return total;
}

function formatToTwo(value: number): number {
  if (!Number.isFinite(value)) return value;
  const factor = 100;
  return Math.round(value * factor) / factor;
}

function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return "";
  return `${formatToTwo(value)}%`;
}

function formatCurrency(value: number): string {
  if (!Number.isFinite(value)) return "";
  return value.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatNumberWithCommas(value: number): string {
  if (!Number.isFinite(value)) return "";
  return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function normalizeCellValue(value: ExcelJS.CellValue): ExcelJS.CellValue | null {
  if (value && typeof value === "object" && "result" in value && value.result != null) {
    return value.result as ExcelJS.CellValue;
  }
  return value ?? null;
}

function coerceNumber(value: ExcelJS.CellValue | null): number {
  if (value == null) return 0;
  if (typeof value === "number") return value;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string") {
    if (!value.trim()) return 0;
    const negative = /^\(.*\)$/.test(value);
    const cleaned = value.replace(/[,$\s]/g, "").replace(/%/g, "");
    const parsed = Number(cleaned);
    if (!Number.isFinite(parsed)) return Number.NaN;
    return negative ? -parsed : parsed;
  }
  return Number.NaN;
}

function excelSerialDateToJsDate(serial: number): Date {
  // Excel serial dates start on Jan 1, 1900. Adjust for Leap year bug by subtracting 1.
  const epoch = new Date(Date.UTC(1899, 11, 30));
  const date = new Date(epoch.getTime() + serial * 24 * 60 * 60 * 1000);
  return date;
}

function formatDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const year = date.getFullYear();
  return `${month}/${day}/${year}`;
}

const PPT_XML_FILE_PATTERN = /^ppt\/(slides|slideLayouts|slideMasters)\/.*\.xml$/;

function scrubHiddenCharactersFromZip(zip: PizZip): void {
  const xmlPaths = Object.keys(zip.files).filter((filename) => PPT_XML_FILE_PATTERN.test(filename));
  for (const filename of xmlPaths) {
    const file = zip.file(filename);
    if (!file) continue;
    const original = file.asText();
    const sanitized = normalizeTemplateXml(original);
    if (sanitized !== original) {
      zip.file(filename, sanitized);
    }
  }
}

const TOKEN_SPAN_PATTERN = /\{\{[\s\S]*?\}\}/g;
const XML_TAG_PATTERN = /<[^>]+>/g;

function normalizeTemplateXml(xml: string): string {
  // Remove hidden chars and heal tokens that were split across XML nodes (e.g., {{DAIL</a:t><a:t>Y_RENTALS}})
  const withoutHidden = stripHiddenTokenCharacters(xml);
  return withoutHidden.replace(TOKEN_SPAN_PATTERN, (segment) => {
    const withoutTags = segment.replace(XML_TAG_PATTERN, "");
    const tokenText = withoutTags.replace(/[{}]/g, "").replace(/\s+/g, "");
    if (!tokenText) return segment;
    return `{{${tokenText}}}`;
  });
}

function renderTokensIntoZip(zip: PizZip, tokens: TokenMap): Buffer {
  const normalizedTokens: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(tokens)) {
    if (value == null) {
      normalizedTokens[normalizeKey(key)] = "";
      continue;
    }
    normalizedTokens[normalizeKey(key)] = typeof value === "number" ? value : String(value);
  }

  const xmlPaths = Object.keys(zip.files).filter((filename) => PPT_XML_FILE_PATTERN.test(filename));
  for (const filename of xmlPaths) {
    const file = zip.file(filename);
    if (!file) continue;
    const original = file.asText();
    const replaced = original.replace(/{{\s*([^{}]+?)\s*}}/g, (match, rawKey) => {
      const key = normalizeKey(String(rawKey));
      const value = key && key in normalizedTokens ? normalizedTokens[key] : "";
      return value == null ? "" : String(value);
    });
    zip.file(filename, replaced);
  }

  return zip.generate({ type: "nodebuffer" });
}

function normalizeKey(key: string): string {
  return stripHiddenTokenCharacters(key).replace(/\s+/g, "").toUpperCase();
}
