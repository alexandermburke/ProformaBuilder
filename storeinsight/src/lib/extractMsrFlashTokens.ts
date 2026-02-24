import type { Buffer } from "buffer";
import ExcelJS from "exceljs";

export type FlashMsrTokens = Record<string, string | number>;

const normalizeCellValue = (value: ExcelJS.CellValue): ExcelJS.CellValue | null => {
  if (value && typeof value === "object" && "result" in value && value.result != null) {
    return value.result as ExcelJS.CellValue;
  }
  if (value && typeof value === "object" && "error" in value && typeof value.error === "string") {
    return value.error;
  }
  if (value && typeof value === "object" && "richText" in value && Array.isArray(value.richText)) {
    const text = value.richText
      .map((part) => (part && typeof part === "object" && "text" in part ? String(part.text ?? "") : ""))
      .join("");
    return text;
  }
  return value ?? null;
};

const coerceNumber = (value: ExcelJS.CellValue | null): number => {
  if (value == null) return 0;
  if (typeof value === "number") return value;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return 0;
    const lower = trimmed.toLowerCase();
    if (
      lower === "-" ||
      lower === "--" ||
      lower === "n/a" ||
      lower === "na" ||
      lower === "#n/a" ||
      lower === "#value!" ||
      lower === "#div/0!"
    ) {
      return 0;
    }
    const negative = /^\(.*\)$/.test(value);
    const cleaned = value.replace(/[,$\s]/g, "").replace(/%/g, "").replace(/[()]/g, "");
    const parsed = Number(cleaned);
    if (Number.isFinite(parsed)) {
      return negative ? -Math.abs(parsed) : parsed;
    }

    // Support display strings like "12,345 SF" by extracting the first numeric token.
    const tokenMatch = trimmed.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
    if (!tokenMatch) return Number.NaN;
    const tokenValue = Number(tokenMatch[0]);
    if (!Number.isFinite(tokenValue)) return Number.NaN;
    return negative ? -Math.abs(tokenValue) : tokenValue;
  }
  return Number.NaN;
};

const readNumber = (sheet: ExcelJS.Worksheet, address: string, label: string): number => {
  const primaryValue = normalizeCellValue(sheet.getCell(address).value);
  const primaryNumeric = coerceNumber(primaryValue);
  if (Number.isFinite(primaryNumeric)) {
    return primaryNumeric;
  }

  const shiftedAddress = shiftAddressByRow(address, 1);
  if (shiftedAddress) {
    const shiftedValue = normalizeCellValue(sheet.getCell(shiftedAddress).value);
    const shiftedNumeric = coerceNumber(shiftedValue);
    if (Number.isFinite(shiftedNumeric)) {
      return shiftedNumeric;
    }
  }

  if (primaryValue == null) {
    throw new Error(`${label} is missing.`);
  }
  throw new Error(`${label} is not a number.`);
};

const formatToTwo = (value: number): number => {
  if (!Number.isFinite(value)) return value;
  const factor = 100;
  return Math.round(value * factor) / factor;
};

const formatPercent = (value: number): string => {
  if (!Number.isFinite(value)) return "";
  return `${formatToTwo(value)}%`;
};

const formatCurrency = (value: number): string => {
  if (!Number.isFinite(value)) return "";
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
};

const normalizeArrayBuffer = (
  source: ArrayBuffer | ArrayBufferView | Buffer,
): ArrayBuffer => {
  if (source instanceof ArrayBuffer) {
    // Copy to avoid issues when the original buffer is reused or sliced.
    return source.slice(0);
  }

  const view = new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
  const copy = new Uint8Array(view.byteLength);
  copy.set(view);

  return copy.buffer;
};

const shiftAddressByRow = (address: string, delta: number): string | null => {
  const match = /^([A-Za-z]+)(\d+)$/.exec(address.trim());
  if (!match) return null;
  const column = match[1];
  const row = Number(match[2]);
  if (!Number.isFinite(row)) return null;
  // New MSR templates inserted one row below the performance indicator block.
  if (row <= 22) return null;
  return `${column}${row + delta}`;
};

export async function extractMsrFlashTokens(
  buffer: ArrayBuffer | ArrayBufferView | Buffer,
): Promise<FlashMsrTokens> {
  const workbook = new ExcelJS.Workbook();
  const input = normalizeArrayBuffer(buffer);

  await workbook.xlsx.load(input);
  const msrSheet = workbook.getWorksheet("MSR");
  if (!msrSheet) {
    throw new Error('Workbook is missing required "MSR" worksheet.');
  }

  const mtdRentals = readNumber(msrSheet, "J8", "MTD rentals (MSR!J8)");
  const dailyRentals = readNumber(msrSheet, "I8", "Daily rentals (MSR!I8)");
  const mtdVacates = readNumber(msrSheet, "J9", "MTD vacates (MSR!J9)");
  const mtdNetRentals = readNumber(msrSheet, "J10", "MTD net rentals (MSR!J10)");
  const leadConversion = readNumber(msrSheet, "O10", "Lead conversion % (MSR!O10)");

  const projRent = readNumber(msrSheet, "L32", "Projected rent (MSR!L32)");
  const projRentPerSf = readNumber(msrSheet, "K33", "Projected rent per SF (MSR!K33)");
  const grossVacantRevenue = readNumber(msrSheet, "I28", "Gross Vacant Revenue (MSR!I28)");
  const effPotRent = projRent + grossVacantRevenue;
  const avgSfVaca = readNumber(msrSheet, "L39", "Average SF Vacant (MSR!L39)");
  const grossPotRent = readNumber(msrSheet, "L27", "Gross potential rent (MSR!L27)");
  const grossPotRentRate = readNumber(msrSheet, "N27", "Gross potential rent rate (MSR!N27)");

  return {
    MTDRENTALS: mtdRentals,
    DAILYRENTALS: dailyRentals,
    CONV: formatPercent(leadConversion),
    MTDVACATES: mtdVacates,
    MTDNETRENTALS: mtdNetRentals,
    PROJRENT: formatCurrency(projRent),
    PROJRENTPERSF: formatCurrency(projRentPerSf),
    EFFPOTRENT: formatCurrency(effPotRent),
    AVGSFVACA: formatCurrency(avgSfVaca),
    GROSSPOTRENT: formatCurrency(grossPotRent),
    GROSSPOTRENTRATE: formatCurrency(grossPotRentRate),
  };
}
