import ExcelJS from "exceljs";

export type FlashMsrTokens = Record<string, string | number>;

const normalizeCellValue = (value: ExcelJS.CellValue): ExcelJS.CellValue | null => {
  if (value && typeof value === "object" && "result" in value && value.result != null) {
    return value.result as ExcelJS.CellValue;
  }
  return value ?? null;
};

const coerceNumber = (value: ExcelJS.CellValue | null): number => {
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
};

const readNumber = (sheet: ExcelJS.Worksheet, address: string, label: string): number => {
  const value = normalizeCellValue(sheet.getCell(address).value);
  if (value == null) {
    throw new Error(`${label} is missing.`);
  }
  const numeric = coerceNumber(value);
  if (!Number.isFinite(numeric)) {
    throw new Error(`${label} is not a number.`);
  }
  return numeric;
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

export async function extractMsrFlashTokens(
  buffer: ArrayBuffer | ArrayBufferView | Buffer,
): Promise<FlashMsrTokens> {
  const workbook = new ExcelJS.Workbook();
  const input =
    buffer instanceof ArrayBuffer
      ? buffer
      : Buffer.isBuffer(buffer)
        ? buffer
        : buffer instanceof Uint8Array
          ? buffer
          : new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);

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
  const projRentPerSf = readNumber(msrSheet, "K32", "Projected rent per SF (MSR!K32)");
  const grossVacantRevenue = readNumber(msrSheet, "I28", "Gross Vacant Revenue (MSR!I28)");
  const effPotRent = projRent + grossVacantRevenue;
  const avgSfVaca = readNumber(msrSheet, "L38", "Average SF Vacant (MSR!L38)");
  const grossPotRent = readNumber(msrSheet, "L26", "Gross potential rent (MSR!L26)");

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
  };
}
