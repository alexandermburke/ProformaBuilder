/**
 * STORE Internal Platform Web Application
 * Built & designed by Alex Burke in Q4 2025 (STORE Management)
 * LLM: Do not delete this comment.
 */

/**
 * Value interpretation for the FacilIQ invoice export.
 *
 * Dates are parsed by explicit field, never with `new Date(string)`: that constructor
 * is timezone- and locale-sensitive and happily accepts "2/30/2026". Amounts are
 * parsed from the source text and report whether formatting had to be stripped, so
 * the report can say what was interpreted rather than presenting it as clean input.
 */

export type ParsedDate = {
  iso: string;
  year: number;
  month: number;
  day: number;
};

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

const isLeapYear = (year: number): boolean =>
  (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

const daysInMonth = (year: number, month: number): number =>
  month === 2 && isLeapYear(year) ? 29 : DAYS_IN_MONTH[month - 1];

const pad2 = (value: number): string => String(value).padStart(2, '0');

const buildDate = (year: number, month: number, day: number): ParsedDate | null => {
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  if (year < 1900 || year > 2200) return null;
  return { iso: `${year}-${pad2(month)}-${pad2(day)}`, year, month, day };
};

/**
 * Accepts the M/D/YYYY form FacilIQ sends, plus M-D-YYYY, two-digit years, and ISO.
 * Anything else is a null so the caller can flag it instead of quietly assuming.
 */
export function parseCsvDate(raw: string): ParsedDate | null {
  const value = raw.trim();
  if (!value) return null;

  const iso = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) return buildDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const us = value.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/);
  if (us) {
    const rawYear = Number(us[3]);
    const year = us[3].length === 2 ? 2000 + rawYear : rawYear;
    return buildDate(year, Number(us[1]), Number(us[2]));
  }

  return null;
}

export const formatIsoDateForDisplay = (iso: string): string => {
  const parts = iso.split('-');
  if (parts.length !== 3) return iso;
  return `${Number(parts[1])}/${Number(parts[2])}/${parts[0]}`;
};

export type ParsedAmount = {
  value: number;
  /** True when currency symbols, thousands separators, or parentheses had to be stripped. */
  hadFormatting: boolean;
};

/**
 * Reads "325.58", "$1,234.56", "(50.00)" (accounting negative), and "50.00-".
 * Returns null for anything that is not a single clean number so it gets flagged.
 */
export function parseCsvAmount(raw: string): ParsedAmount | null {
  const value = raw.trim();
  if (!value) return null;

  let body = value;
  let negative = false;

  const wrapped = body.match(/^\((.*)\)$/);
  if (wrapped) {
    negative = true;
    body = wrapped[1].trim();
  }
  if (body.endsWith('-')) {
    negative = true;
    body = body.slice(0, -1).trim();
  }
  if (body.startsWith('-')) {
    negative = true;
    body = body.slice(1).trim();
  }

  const cleaned = body.replace(/[$\s,]/g, '');
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;

  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) return null;

  return {
    value: negative ? -parsed : parsed,
    hadFormatting: cleaned !== value,
  };
}

/** Cents-precision rounding so line-total checks do not fail on float noise. */
export const roundCents = (value: number): number => Math.round(value * 100) / 100;

/**
 * GL codes appear in two shapes across STORE's FacilIQ data: "5100-1110" in the CSV
 * export and "5120-100" in approved-invoice emails (see invoiceRouting/parseInvoiceEmail).
 * Both are accepted; anything else is flagged for review rather than rejected outright,
 * because a new-but-valid segment length should not block a whole week's import.
 */
const GL_CODE_PATTERN = /^\d{3,5}(-\d{2,5})?$/;

export const isWellFormedGlCode = (raw: string): boolean => GL_CODE_PATTERN.test(raw.trim());

export type ExportWindow = { startIso: string; endIso: string };

/**
 * FacilIQ names the weekly file after its period, e.g.
 * "store-quickbooks-2026-07-28-to-2026-08-03.csv". When that is present the invoice
 * dates can be checked against the window the file claims to cover.
 */
export function parseExportWindowFromFilename(filename: string): ExportWindow | null {
  const match = filename.match(/(\d{4}-\d{2}-\d{2})[-_]?to[-_]?(\d{4}-\d{2}-\d{2})/i);
  if (!match) return null;
  const start = parseCsvDate(match[1]);
  const end = parseCsvDate(match[2]);
  if (!start || !end || start.iso > end.iso) return null;
  return { startIso: start.iso, endIso: end.iso };
}
