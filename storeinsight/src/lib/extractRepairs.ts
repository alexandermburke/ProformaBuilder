import * as XLSX from "xlsx";
import { toNumber } from "@/lib/compute";

type RowValue = {
  dateTs: number;
  dateText: string;
  description: string;
  cost: string;
  status: string;
};

const normalizeHeader = (value: unknown): string =>
  String(value ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const excelSerialToDate = (serial: number): Date | null => {
  if (!Number.isFinite(serial)) return null;
  const excelEpoch = new Date(Date.UTC(1899, 11, 30));
  const ms = Math.round(serial * 86400 * 1000);
  const date = new Date(excelEpoch.getTime() + ms);
  return Number.isNaN(date.getTime()) ? null : date;
};

const parseDateValue = (value: unknown): Date | null => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "number") return excelSerialToDate(value);
  const str = String(value ?? "").trim();
  if (!str) return null;
  const parsed = new Date(str);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const formatDate = (date: Date): string => {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
};

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const pickCost = (finalCost: unknown, contracted: unknown, estimated: unknown): string => {
  const candidates = [finalCost, contracted, estimated];
  for (const value of candidates) {
    if (value == null) continue;
    const numeric = toNumber(value);
    if (Number.isFinite(numeric) && numeric !== 0) {
      return currencyFormatter.format(numeric);
    }
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
};

const buildDescription = (asset: unknown, description: unknown): string => {
  const assetText = String(asset ?? "").trim();
  const descText = String(description ?? "").trim();
  if (assetText && descText) return `${assetText}: ${descText}`;
  if (descText) return descText;
  if (assetText) return assetText;
  return "";
};

export type RepairTokens = Partial<Record<"REPAIRDATE" | "REPAIRDESCRIP" | "REPAIRCOST" | "REPAIRSTATUS", string>>;

export function extractRepairTokens(buffer: Buffer): RepairTokens {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  } catch {
    return {};
  }
  const firstSheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[firstSheetName];
  if (!sheet) return {};

  const rows = XLSX.utils.sheet_to_json<(string | number | null | undefined)[]>(sheet, {
    header: 1,
    defval: null,
  });
  if (!rows.length) return {};

  const header = rows[0] ?? [];
  const headerIndex: Record<string, number> = {};
  header.forEach((cell, idx) => {
    const normalized = normalizeHeader(cell);
    if (!normalized) return;
    headerIndex[normalized] = idx;
  });

  const colDate = headerIndex["date approved"];
  const colDesc = headerIndex["description"];
  const colAsset = headerIndex["asset"];
  const colStatus = headerIndex["status"];
  const colFinalCost = headerIndex["final cost"];
  const colContracted = headerIndex["contracted amount"];
  const colEstimated = headerIndex["estimated cost"];

  if (
    colDate === undefined &&
    colDesc === undefined &&
    colAsset === undefined &&
    colStatus === undefined &&
    colFinalCost === undefined &&
    colContracted === undefined &&
    colEstimated === undefined
  ) {
    return {};
  }

  const entries: RowValue[] = [];

  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i] ?? [];
    const dateValue = colDate !== undefined ? row[colDate] : null;
    const assetValue = colAsset !== undefined ? row[colAsset] : null;
    const descValue = colDesc !== undefined ? row[colDesc] : null;
    const statusValue = colStatus !== undefined ? row[colStatus] : null;
    const finalCostValue = colFinalCost !== undefined ? row[colFinalCost] : null;
    const contractedValue = colContracted !== undefined ? row[colContracted] : null;
    const estimatedValue = colEstimated !== undefined ? row[colEstimated] : null;

    const parsedDate = parseDateValue(dateValue);
    const dateText = parsedDate ? formatDate(parsedDate) : "";
    const dateTs = parsedDate ? parsedDate.getTime() : -Infinity;
    const description = buildDescription(assetValue, descValue);
    const cost = pickCost(finalCostValue, contractedValue, estimatedValue);
    const status = String(statusValue ?? "").trim();

    const isBlank = !dateText && !description && !cost && !status;
    if (isBlank) continue;

    entries.push({ dateTs, dateText, description, cost, status });
  }

  if (entries.length === 0) return {};

  entries.sort((a, b) => b.dateTs - a.dateTs);

  const join = (selector: (row: RowValue) => string) =>
    entries.map((row) => selector(row) || "").join("\n");

  return {
    REPAIRDATE: join((row) => row.dateText),
    REPAIRDESCRIP: join((row) => row.description),
    REPAIRCOST: join((row) => row.cost),
    REPAIRSTATUS: join((row) => row.status),
  };
}
