import * as XLSX from "xlsx";
import type { NormalizedRow } from "./normalize";

const AMAZON_WITHDRAWAL_PATTERN = /\bamazon\b/i;
const WITHDRAWAL_PATTERN = /\bwithdr(?:awal)?\b/i;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_DATE_DIFF_DAYS = 7;
const WITHDRAWAL_PREFIX = "Amazon Withdrawal - ";

export type AmazonOrderGroup = {
  orderId: string;
  amountCents: number;
  orderDate: Date;
  titles: string[];
  used: boolean;
};

export type AmazonOrderParseResult = {
  rows: AmazonOrderGroup[];
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

function getField(raw: Record<string, unknown>, field: string): unknown {
  const wanted = field.trim().toLowerCase().replace(/\s+/g, " ");
  for (const [key, value] of Object.entries(raw)) {
    const normalizedKey = key.trim().toLowerCase().replace(/\s+/g, " ");
    if (normalizedKey === wanted) return value;
  }
  return undefined;
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

function summarizeTitles(titles: string[]): string[] {
  const counts = new Map<string, number>();
  titles.forEach((title) => {
    const current = counts.get(title) ?? 0;
    counts.set(title, current + 1);
  });
  return Array.from(counts.entries()).map(([title, count]) => (count > 1 ? `${title} (x${count})` : title));
}

function formatMappedNotes(titles: string[]): string {
  const summary = summarizeTitles(titles);
  return `${WITHDRAWAL_PREFIX}${summary.join("; ")}`;
}

type ParsedAmazonLine = {
  orderId: string | null;
  title: string;
  orderDate: Date;
  itemAmountCents: number | null;
  fallbackAmountCents: number | null;
};

export function parseAmazonOrders(buffer: Buffer): AmazonOrderParseResult {
  const logs: string[] = [];
  const warnings: string[] = [];
  const parsedLines: ParsedAmazonLine[] = [];

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
      const title = asTrimmedString(getField(raw, "Title"));
      const orderId = asTrimmedString(getField(raw, "Order ID"));
      const itemAmount = asNumber(getField(raw, "Item Net Total"));
      const fallbackAmount =
        asNumber(getField(raw, "Item Net Total")) ??
        asNumber(getField(raw, "Payment Amount")) ??
        asNumber(getField(raw, "Order Net Total")) ??
        asNumber(getField(raw, "Total Amount"));
      const orderDate =
        asDate(getField(raw, "Order Date")) ??
        asDate(getField(raw, "Payment Date")) ??
        asDate(getField(raw, "Date"));
      const itemAmountCents = amountToCents(itemAmount);
      const fallbackAmountCents = amountToCents(fallbackAmount);
      if (!title || !orderDate) return;
      if ((!itemAmountCents || itemAmountCents <= 0) && (!fallbackAmountCents || fallbackAmountCents <= 0)) {
        return;
      }
      parsedLines.push({
        orderId,
        title,
        orderDate,
        itemAmountCents,
        fallbackAmountCents,
      });
    });
  } catch (err) {
    warnings.push(`[amazon-map] failed to parse file: ${(err as Error)?.message ?? "unknown error"}`);
    return { rows: [], logs, warnings };
  }

  if (parsedLines.length === 0) {
    warnings.push("[amazon-map] no order rows with Title, amount, and date were detected.");
    return { rows: [], logs, warnings };
  }

  const grouped = new Map<
    string,
    {
      orderId: string;
      orderDate: Date;
      titles: string[];
      itemAmountCentsSum: number;
      fallbackAmountCents: number | null;
      hasItemAmount: boolean;
    }
  >();
  const standaloneGroups: AmazonOrderGroup[] = [];

  parsedLines.forEach((line, idx) => {
    if (!line.orderId) {
      const amountCents = line.itemAmountCents ?? line.fallbackAmountCents;
      if (!amountCents || amountCents <= 0) return;
      standaloneGroups.push({
        orderId: `row-${idx + 1}`,
        amountCents,
        orderDate: line.orderDate,
        titles: [line.title],
        used: false,
      });
      return;
    }

    const existing = grouped.get(line.orderId);
    if (!existing) {
      grouped.set(line.orderId, {
        orderId: line.orderId,
        orderDate: line.orderDate,
        titles: [line.title],
        itemAmountCentsSum: line.itemAmountCents ?? 0,
        fallbackAmountCents: line.fallbackAmountCents ?? null,
        hasItemAmount: line.itemAmountCents != null,
      });
      return;
    }

    existing.titles.push(line.title);
    if (line.orderDate.getTime() < existing.orderDate.getTime()) {
      existing.orderDate = line.orderDate;
    }
    if (line.itemAmountCents != null) {
      existing.itemAmountCentsSum += line.itemAmountCents;
      existing.hasItemAmount = true;
    } else if (existing.fallbackAmountCents == null && line.fallbackAmountCents != null) {
      existing.fallbackAmountCents = line.fallbackAmountCents;
    }
  });

  const groupedOrders: AmazonOrderGroup[] = [];
  grouped.forEach((entry) => {
    const amountCents = entry.hasItemAmount ? entry.itemAmountCentsSum : entry.fallbackAmountCents;
    if (!amountCents || amountCents <= 0) return;
    groupedOrders.push({
      orderId: entry.orderId,
      amountCents,
      orderDate: entry.orderDate,
      titles: entry.titles,
      used: false,
    });
  });

  const parsedRows = [...groupedOrders, ...standaloneGroups];
  if (parsedRows.length === 0) {
    warnings.push("[amazon-map] no grouped orders with usable amount/date were detected.");
  } else {
    const multiItemOrders = groupedOrders.filter((row) => row.titles.length > 1).length;
    logs.push(`[amazon-map] usable grouped orders: ${parsedRows.length}`);
    logs.push(`[amazon-map] multi-item orders: ${multiItemOrders}`);
  }

  return { rows: parsedRows, logs, warnings };
}

export function applyAmazonOrderMapping(rows: NormalizedRow[], orderRows: AmazonOrderGroup[]): AmazonOrderApplyResult {
  if (!orderRows.length) {
    return { rows, matched: 0, unmatched: 0, logs: ["[amazon-map] skipped (no usable amazon order rows)"] };
  }

  let matched = 0;
  let unmatched = 0;
  let multiItemMatches = 0;
  const updatedRows = rows.map((row) => {
    if (!isAmazonWithdrawalRow(row)) return row;
    const amountCents = amountToCents(row.debit ?? null);
    if (!amountCents || amountCents <= 0) {
      unmatched += 1;
      return row;
    }

    if (!row.journalDate) {
      unmatched += 1;
      return row;
    }

    const candidates = orderRows.filter(
      (candidate) =>
        !candidate.used &&
        candidate.amountCents === amountCents &&
        dateDistanceDays(row.journalDate, candidate.orderDate) <= MAX_DATE_DIFF_DAYS,
    );
    if (candidates.length === 0) {
      unmatched += 1;
      return row;
    }

    candidates.sort((a, b) => {
      const distanceA = dateDistanceDays(row.journalDate, a.orderDate);
      const distanceB = dateDistanceDays(row.journalDate, b.orderDate);
      if (distanceA !== distanceB) return distanceA - distanceB;
      if (a.titles.length !== b.titles.length) return b.titles.length - a.titles.length;
      const timeA = a.orderDate.getTime();
      const timeB = b.orderDate.getTime();
      return timeA - timeB;
    });

    const best = candidates[0];
    best.used = true;
    matched += 1;
    if (best.titles.length > 1) multiItemMatches += 1;
    const combinedNotes = formatMappedNotes(best.titles);

    return {
      ...row,
      detailNotes: combinedNotes,
    };
  });

  const logs = [
    `[amazon-map] matched ${matched} Amazon withdrawal rows by grouped order amount + date (<= ${MAX_DATE_DIFF_DAYS} days)`,
    `[amazon-map] multi-item withdrawal matches: ${multiItemMatches}`,
    `[amazon-map] unmatched candidate rows: ${unmatched}`,
  ];
  return { rows: updatedRows, matched, unmatched, logs };
}
