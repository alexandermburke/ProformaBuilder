import * as XLSX from "xlsx";
import type { NormalizedRow } from "./normalize";

const AMAZON_WITHDRAWAL_PATTERN = /\bamazon\b/i;
const WITHDRAWAL_PATTERN = /\bwithdr(?:awal)?\b/i;
const DAY_MS = 24 * 60 * 60 * 1000;

export type AmazonOrderRow = {
  title: string;
  amountCents: number;
  orderDate: Date | null;
  used: boolean;
};

export type AmazonOrderParseResult = {
  rows: AmazonOrderRow[];
  logs: string[];
  warnings: string[];
};

export type AmazonOrderApplyResult = {
  rows: NormalizedRow[];
  matched: number;
  unmatched: number;
  logs: string[];
};

function asNumber(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const asString = String(value).trim().replace(/[$,]/g, "");
  if (!asString) return null;
  const parsed = Number(asString);
  return Number.isFinite(parsed) ? parsed : null;
}

function asDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) return value;
  if (typeof value === "number") {
    const excelDate = new Date(Math.round((value - 25569) * 86400 * 1000));
    return Number.isNaN(excelDate.valueOf()) ? null : excelDate;
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const mdy = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (mdy) {
    const year = Number(mdy[3].length === 2 ? `20${mdy[3]}` : mdy[3]);
    const date = new Date(year, Number(mdy[1]) - 1, Number(mdy[2]));
    return Number.isNaN(date.valueOf()) ? null : date;
  }
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.valueOf()) ? null : parsed;
}

function amountToCents(value: number | null): number | null {
  if (value == null) return null;
  return Math.round(Math.abs(value) * 100);
}

function asTrimmedString(value: unknown): string | null {
  if (value == null) return null;
  const str = String(value).trim();
  return str || null;
}

function isAmazonWithdrawalRow(row: NormalizedRow): boolean {
  if (row.source !== "bank") return false;
  const note = [row.notes, row.detailNotes, row.rawNotes, row.rawDetailNotes].filter(Boolean).join(" ");
  return AMAZON_WITHDRAWAL_PATTERN.test(note) && WITHDRAWAL_PATTERN.test(note);
}

function dateDistanceDays(a: Date | null, b: Date | null): number {
  if (!a || !b) return Number.POSITIVE_INFINITY;
  const aUtc = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const bUtc = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.abs(aUtc - bUtc) / DAY_MS;
}

export function parseAmazonOrders(buffer: Buffer): AmazonOrderParseResult {
  const logs: string[] = [];
  const warnings: string[] = [];
  const parsedRows: AmazonOrderRow[] = [];

  try {
    const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      warnings.push("[amazon-map] no sheets detected in uploaded file.");
      return { rows: [], logs, warnings };
    }

    const sheet = workbook.Sheets[sheetName];
    const jsonRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
    logs.push(`[amazon-map] parsed ${jsonRows.length} raw rows from "${sheetName}"`);

    jsonRows.forEach((raw) => {
      const title = asTrimmedString(raw.Title ?? raw.title);
      const amount =
        asNumber(raw["Item Net Total"]) ??
        asNumber(raw["Payment Amount"]) ??
        asNumber(raw["Order Net Total"]) ??
        asNumber(raw["Total Amount"]);
      const orderDate = asDate(raw["Order Date"] ?? raw["Payment Date"] ?? raw.Date);
      const amountCents = amountToCents(amount);
      if (!title || amountCents == null || amountCents <= 0) return;
      parsedRows.push({
        title,
        amountCents,
        orderDate,
        used: false,
      });
    });
  } catch (err) {
    warnings.push(`[amazon-map] failed to parse file: ${(err as Error)?.message ?? "unknown error"}`);
    return { rows: [], logs, warnings };
  }

  if (parsedRows.length === 0) {
    warnings.push("[amazon-map] no order rows with both Title and amount were detected.");
  } else {
    logs.push(`[amazon-map] usable rows: ${parsedRows.length}`);
  }

  return { rows: parsedRows, logs, warnings };
}

export function applyAmazonOrderMapping(rows: NormalizedRow[], orderRows: AmazonOrderRow[]): AmazonOrderApplyResult {
  if (!orderRows.length) {
    return { rows, matched: 0, unmatched: 0, logs: ["[amazon-map] skipped (no usable amazon order rows)"] };
  }

  let matched = 0;
  let unmatched = 0;
  const updatedRows = rows.map((row) => {
    if (!isAmazonWithdrawalRow(row)) return row;
    const amountCents = amountToCents(row.debit ?? null);
    if (!amountCents || amountCents <= 0) {
      unmatched += 1;
      return row;
    }

    const candidates = orderRows.filter((candidate) => !candidate.used && candidate.amountCents === amountCents);
    if (candidates.length === 0) {
      unmatched += 1;
      return row;
    }

    candidates.sort((a, b) => {
      const distanceA = dateDistanceDays(row.journalDate, a.orderDate);
      const distanceB = dateDistanceDays(row.journalDate, b.orderDate);
      if (distanceA !== distanceB) return distanceA - distanceB;
      const timeA = a.orderDate?.getTime() ?? Number.POSITIVE_INFINITY;
      const timeB = b.orderDate?.getTime() ?? Number.POSITIVE_INFINITY;
      return timeA - timeB;
    });

    const best = candidates[0];
    best.used = true;
    matched += 1;

    return {
      ...row,
      notes: best.title,
      detailNotes: best.title,
    };
  });

  const logs = [`[amazon-map] matched ${matched} Amazon withdrawal rows by amount`, `[amazon-map] unmatched candidate rows: ${unmatched}`];
  return { rows: updatedRows, matched, unmatched, logs };
}
