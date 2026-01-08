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
  rawNotes?: string | null;
  rawDetailNotes?: string | null;
  book: string | null;
  unit: string | null;
  debit: number | null;
  credit: number | null;
  passthrough?: boolean;
};

export type NormalizeResult = {
  rows: NormalizedRow[];
  logs: string[];
  warnings: string[];
  transactions?: number;
};

const MONTH_NAMES = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"];
const VENDOR_ALLOWLIST = ["AMAZON", "STAPLES", "VISTAPRINT", "HOME DEPOT", "LOWES", "COSTCO", "ULINE"] as const;
const cleanString = (value: unknown): string | null => {
  if (value == null) return null;
  const str = typeof value === "string" ? value : String(value);
  const trimmed = str.trim();
  return trimmed ? trimmed : null;
};
const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const vendorPattern = new RegExp(
  `\\b(${VENDOR_ALLOWLIST.map((name) => name.split(/\s+/).map(escapeRegex).join("\\s+")).join("|")})\\b`,
  "i",
);
const collapseWhitespace = (value: string): string => value.replace(/\s+/g, " ").trim();
const normalizeRawNotes = (value: unknown): string | null => {
  const cleaned = cleanString(value);
  if (!cleaned) return null;
  const collapsed = collapseWhitespace(cleaned);
  return collapsed || null;
};
const isNoisyToken = (token: string): boolean => {
  const normalized = token.replace(/[()]/g, "");
  if (!normalized) return false;
  if (/^#?\d{4,}$/.test(normalized)) return true;
  return /^(?=.*\d)[A-Z0-9-]{4,}$/i.test(normalized);
};
const stripTrailingIdTokens = (value: string): string => {
  const tokens = value.split(" ");
  while (tokens.length > 1 && isNoisyToken(tokens[tokens.length - 1])) {
    tokens.pop();
  }
  return tokens.join(" ").trim();
};
const normalizeNotes = (value: string | null): string | null => {
  if (!value) return null;
  const collapsed = collapseWhitespace(value);
  if (!collapsed) return null;
  if (/^deposit\s+home\s+banking(?:\s+transfer)?\b/i.test(collapsed)) {
    return "Transfer In (Home Banking)";
  }
  if (/^withdrawal\s+home\s+banking\b/i.test(collapsed)) {
    return "Transfer Out (Home Banking)";
  }
  const stripped = stripTrailingIdTokens(collapsed);
  return stripped || null;
};
const hasVendorDetail = (value: string | null): boolean => Boolean(value && vendorPattern.test(value));
const selectDetailNotes = (
  rawNotes: string | null,
  rawDetailNotes: string | null,
  cleanNotes: string | null,
): string | null => {
  if (hasVendorDetail(rawDetailNotes) || hasVendorDetail(rawNotes)) {
    return rawDetailNotes ?? rawNotes ?? cleanNotes;
  }
  return cleanNotes;
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

function normalizeBankRow(raw: Record<string, unknown>): NormalizedRow {
  const lowered = lowerEntries(raw);
  const journalDate = asDate(lowered.date);
  const description = (lowered.description as string) || "";
  const memo = (lowered.memo as string) || "";
  const debitVal = asNumber(lowered.amountdebit);
  const creditVal = asNumber(lowered.amountcredit);
  const rawNotes = normalizeRawNotes(description || memo);
  const rawDetailNotes = normalizeRawNotes(memo || description);
  const cleanNotes = normalizeNotes(rawNotes ?? rawDetailNotes);
  const detailNotes = selectDetailNotes(rawNotes, rawDetailNotes, cleanNotes);

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
    notes: cleanNotes,
    detailNotes,
    rawNotes,
    rawDetailNotes,
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
  const rawNotes = normalizeRawNotes(lowered.merchant ?? lowered.detailnotes ?? null);
  const rawDetailNotes = normalizeRawNotes(lowered.detailnotes ?? null);
  const cleanNotes = normalizeNotes(rawNotes ?? rawDetailNotes);
  const detailNotes = selectDetailNotes(rawNotes, rawDetailNotes, cleanNotes);

  return {
    source: "card",
    journalDate,
    postMonth,
    propertyName: null,
    account: lowered.account ? String(lowered.account) : null,
    reference: null,
    notes: cleanNotes,
    detailNotes,
    rawNotes,
    rawDetailNotes,
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
  const rawNotes = normalizeRawNotes(lowered.notes ?? lowered.detailnotes ?? null);
  const rawDetailNotes = normalizeRawNotes(lowered.detailnotes ?? lowered.notes ?? null);
  const cleanNotes = normalizeNotes(rawNotes ?? rawDetailNotes);
  const detailNotes = selectDetailNotes(rawNotes, rawDetailNotes, cleanNotes);

  return {
    source,
    journalDate,
    postMonth,
    propertyName: lowered.property_name ? String(lowered.property_name) : null,
    account: lowered.account ? String(lowered.account) : null,
    reference: lowered.reference ? String(lowered.reference) : null,
    notes: cleanNotes,
    detailNotes,
    rawNotes,
    rawDetailNotes,
    book: lowered.book ? String(lowered.book) : null,
    unit: lowered.unit ? String(lowered.unit) : null,
    debit: debit != null ? Math.abs(debit) : null,
    credit: credit != null ? Math.abs(credit) : null,
    passthrough: false,
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
  const rawNotes = normalizeRawNotes(notes || detailNotes);
  const rawDetailNotes = normalizeRawNotes(detailNotes || notes);
  const cleanNotes = normalizeNotes(rawNotes ?? rawDetailNotes);
  const cleanedDetailNotes = selectDetailNotes(rawNotes, rawDetailNotes, cleanNotes);

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
    notes: cleanNotes,
    detailNotes: cleanedDetailNotes,
    rawNotes,
    rawDetailNotes,
    book: book || null,
    unit: unit || null,
    debit: amountDebit ?? null,
    credit: amountCredit ?? null,
  };
}

function normalizeRow(row: ParsedRow, warnings: string[]): NormalizedRow {
  if (row.source === "bank") return normalizeBankRow(row.raw);
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
  const bankResult = normalizeSource(bank.rows, defaultProperty, "bank", warnings);
  const cardResult = normalizeSource(card.rows, defaultProperty, "card", warnings);
  const otherResult = normalizeSource(other.rows, defaultProperty, "other-bank", warnings);

  const rows = [...bankResult.rows, ...cardResult.rows, ...otherResult.rows];
  const logs = [...bank.logs, ...card.logs, ...other.logs, ...bankResult.logs, ...cardResult.logs, ...otherResult.logs];
  const transactions = rows.filter((row) => !row.passthrough).length;
  logs.push(`[normalize] created ${transactions} transactions`);

  return { rows, logs, warnings, transactions };
}

export function normalizeSource(
  rows: ParsedRow[],
  defaultProperty: string,
  sourceLabel?: string,
  warningsTarget?: string[],
): NormalizeResult {
  const warnings: string[] = warningsTarget ?? [];
  const logs: string[] = [];
  const normalizedRows: NormalizedRow[] = [];
  const trimmedDefault = defaultProperty.trim();
  let defaultApplied = 0;

  rows.forEach((row) => {
    const normalizedBase = normalizeRow(row, warnings);
    const propertyMissing = !cleanString(normalizedBase.propertyName);
    const normalized = applyDefaults(normalizedBase, defaultProperty);
    if (propertyMissing && normalized.propertyName === trimmedDefault) defaultApplied += 1;
    normalizedRows.push(normalized);
  });

  const label = sourceLabel ? ` (${sourceLabel})` : "";
  logs.push(`[normalize] normalized ${normalizedRows.length} rows${label}`);
  if (defaultApplied > 0) {
    logs.push(`[normalize] applied default property to ${defaultApplied} rows${label}`);
  }
  const transactions = normalizedRows.filter((row) => !row.passthrough).length;
  logs.push(`[normalize] created ${transactions} transactions${label}`);

  return { rows: normalizedRows, logs, warnings, transactions };
}
