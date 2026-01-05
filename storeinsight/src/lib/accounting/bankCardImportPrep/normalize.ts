import type { ParsedRow, ParseResult } from "./parseShared";

export type NormalizedRow = {
  source: string;
  journalDate: Date | null;
  postMonth: string | null;
  propertyName: string | null;
  account: string | null;
  reference: string | null;
  notes: string | null;
  detailNotes: string | null;
  book: string | null;
  unit: string | null;
  debit: number | null;
  credit: number | null;
};

export type NormalizeResult = {
  rows: NormalizedRow[];
  logs: string[];
  warnings: string[];
};

const MONTH_NAMES = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"];
const cleanString = (value: unknown): string | null => {
  if (value == null) return null;
  const str = typeof value === "string" ? value : String(value);
  const trimmed = str.trim();
  return trimmed ? trimmed : null;
};

function asNumber(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const cleaned = value.replace(/[$,]/g, "").trim();
    if (!cleaned) return null;
    const num = Number(cleaned);
    return Number.isFinite(num) ? num : null;
  }
  return null;
}

function asDate(value: unknown): Date | null {
  if (value == null) return null;
  if (value instanceof Date && !Number.isNaN(value.valueOf())) return value;
  if (typeof value === "number") {
    const excelDate = new Date(Math.round((value - 25569) * 86400 * 1000));
    if (!Number.isNaN(excelDate.valueOf())) return excelDate;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    // Try M/D/YYYY, MM/DD/YYYY patterns first
    const mdY = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
    if (mdY) {
      const month = Number(mdY[1]) - 1;
      const day = Number(mdY[2]);
      const year = Number(mdY[3].length === 2 ? `20${mdY[3]}` : mdY[3]);
      const candidate = new Date(year, month, day);
      if (!Number.isNaN(candidate.valueOf())) return candidate;
    }
    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.valueOf())) return parsed;
  }
  return null;
}

function toPostMonth(date: Date | null): string | null {
  if (!date) return null;
  const month = MONTH_NAMES[date.getMonth()];
  const year = date.getFullYear();
  return `${month}/${year}`;
}

function lowerEntries(raw: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k.toLowerCase(), v]));
}

function pickValue(row: ParsedRow, candidates: string[]): unknown {
  const lowered = lowerEntries(row.raw);
  for (const key of candidates) {
    const value = lowered[key.toLowerCase()];
    if (value !== undefined) return value;
  }
  return null;
}

function hasYardiHeaders(raw: Record<string, unknown>): boolean {
  const lowered = lowerEntries(raw);
  const required = ["journaldate", "postmonth", "property_name", "account"];
  return required.every((key) => lowered[key] !== undefined);
}

function normalizeBankRow(raw: Record<string, unknown>, warnings: string[]): NormalizedRow {
  const lowered = lowerEntries(raw);
  const journalDate = asDate(lowered.date);
  const description = (lowered.description as string) || "";
  const memo = (lowered.memo as string) || "";
  const debitVal = asNumber(lowered.amountdebit);
  const creditVal = asNumber(lowered.amountcredit);

  let debit: number | null = null;
  let credit: number | null = null;
  if (debitVal != null) {
    debit = Math.abs(debitVal);
  } else if (creditVal != null) {
    credit = Math.abs(creditVal);
  }

  return {
    source: "bank",
    journalDate,
    postMonth: toPostMonth(journalDate),
    propertyName: null,
    account: null,
    reference: null,
    notes: description || memo || null,
    detailNotes: memo || null,
    book: null,
    unit: null,
    debit,
    credit,
  };
}

function normalizeCardRow(raw: Record<string, unknown>): NormalizedRow {
  const lowered = lowerEntries(raw);
  const amount = asNumber(lowered.amount);
  const journalDate = asDate(lowered.date);
  const postMonth = toPostMonth(journalDate);

  return {
    source: "card",
    journalDate,
    postMonth,
    propertyName: null,
    account: lowered.account ? String(lowered.account) : null,
    reference: null,
    notes: lowered.merchant ? String(lowered.merchant) : null,
    detailNotes: lowered.detailnotes ? String(lowered.detailnotes) : null,
    book: null,
    unit: null,
    debit: amount != null ? Math.abs(amount) : null,
    credit: null,
  };
}

function normalizePassthrough(raw: Record<string, unknown>, source: string): NormalizedRow {
  const lowered = lowerEntries(raw);
  const journalDate = asDate(lowered.journaldate ?? lowered.date ?? lowered.postdate ?? null);
  const postMonth =
    typeof lowered.postmonth === "string" && lowered.postmonth.trim()
      ? lowered.postmonth.trim()
      : toPostMonth(journalDate);

  const debit = asNumber(lowered.debit);
  const credit = asNumber(lowered.credit);

  return {
    source,
    journalDate,
    postMonth,
    propertyName: lowered.property_name ? String(lowered.property_name) : null,
    account: lowered.account ? String(lowered.account) : null,
    reference: lowered.reference ? String(lowered.reference) : null,
    notes: lowered.notes ? String(lowered.notes) : null,
    detailNotes: lowered.detailnotes ? String(lowered.detailnotes) : null,
    book: lowered.book ? String(lowered.book) : null,
    unit: lowered.unit ? String(lowered.unit) : null,
    debit: debit != null ? Math.abs(debit) : null,
    credit: credit != null ? Math.abs(credit) : null,
  };
}

function normalizeFallback(row: ParsedRow, warnings: string[]): NormalizedRow {
  const dateValue = pickValue(row, ["journaldate", "date", "transactiondate", "postdate"]);
  const journalDate = asDate(dateValue);
  const postMonthRaw = pickValue(row, ["postmonth", "period", "post period"]);
  const propertyName = (pickValue(row, ["property", "property_name", "property name", "facility", "site"]) ??
    "") as string;
  const account = (pickValue(row, ["account", "gl", "g/l", "glcode", "gl number", "glnumber"]) ??
    "") as string;
  const reference = (pickValue(row, ["reference", "ref", "memo"]) ?? "") as string;
  const notes = (pickValue(row, ["notes", "description", "memo", "merchant"]) ?? "") as string;
  const detailNotes = (pickValue(row, ["detailnotes", "details", "detail"]) ?? "") as string;
  const book = (pickValue(row, ["book"]) ?? "") as string;
  const unit = (pickValue(row, ["unit", "unit_id", "space"]) ?? "") as string;

  const debitValue = asNumber(pickValue(row, ["debit", "debits", "debitamount"]));
  const creditValue = asNumber(pickValue(row, ["credit", "credits", "creditamount"]));
  let amountDebit = debitValue;
  let amountCredit = creditValue;

  if (amountDebit == null && amountCredit == null) {
    const amount = asNumber(pickValue(row, ["amount", "amt", "total"]));
    if (amount != null) {
      if (amount < 0) {
        amountCredit = Math.abs(amount);
      } else {
        amountDebit = amount;
      }
    }
  }

  if (amountDebit != null && amountCredit != null && amountDebit > 0 && amountCredit > 0) {
    warnings.push(`[${row.source}] Row has both debit and credit; keeping debit, zeroing credit.`);
    amountCredit = 0;
  }

  const postMonth =
    typeof postMonthRaw === "string" && postMonthRaw.trim() ? postMonthRaw.trim() : toPostMonth(journalDate);

  return {
    source: row.source,
    journalDate,
    postMonth: postMonth ?? null,
    propertyName: propertyName || null,
    account: account || null,
    reference: reference || null,
    notes: notes || null,
    detailNotes: detailNotes || null,
    book: book || null,
    unit: unit || null,
    debit: amountDebit ?? null,
    credit: amountCredit ?? null,
  };
}

function normalizeRow(row: ParsedRow, warnings: string[]): NormalizedRow {
  if (row.source === "bank") return normalizeBankRow(row.raw, warnings);
  if (row.source === "card") return normalizeCardRow(row.raw);
  if (row.source === "other-bank" && hasYardiHeaders(row.raw)) {
    return normalizePassthrough(row.raw, row.source);
  }
  return normalizeFallback(row, warnings);
}

function applyDefaults(row: NormalizedRow, defaultProperty: string): NormalizedRow {
  const defaultProp = defaultProperty.trim();
  const propertyName = cleanString(row.propertyName) ?? (defaultProp ? defaultProp : null);
  const account = cleanString(row.account);
  return {
    ...row,
    propertyName,
    account,
  };
}

export async function normalizeAll(
  bank: ParseResult,
  card: ParseResult,
  other: ParseResult,
  defaultProperty: string,
): Promise<NormalizeResult> {
  const warnings: string[] = [...bank.warnings, ...card.warnings, ...other.warnings];
  const logs: string[] = [];
  const rows: NormalizedRow[] = [];
  const trimmedDefault = defaultProperty.trim();
  let defaultApplied = 0;

  const pushWithDefault = (row: ParsedRow) => {
    const normalizedBase = normalizeRow(row, warnings);
    const propertyMissing = !cleanString(normalizedBase.propertyName);
    const normalized = applyDefaults(normalizedBase, defaultProperty);
    if (propertyMissing && normalized.propertyName === trimmedDefault) defaultApplied += 1;
    rows.push(normalized);
  };

  for (const row of bank.rows) pushWithDefault(row);
  for (const row of card.rows) pushWithDefault(row);
  for (const row of other.rows) pushWithDefault(row);

  logs.push(`[normalize] normalized ${rows.length} rows across all sources`);
  if (defaultApplied > 0) {
    logs.push(`[normalize] applied default property to ${defaultApplied} rows`);
  }

  return { rows, logs, warnings };
}
