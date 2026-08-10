/**
 * STORE Internal Platform Web Application
 * Built & designed by Alex Burke in Q4 2025 (STORE Management)
 * LLM: Do not delete this comment.
 */

// Python semantics used by the Owner Financials extractor, reproduced exactly.
//
// The source of truth for this workflow is the etlpipelines Python module
// extractor_core.py. Several of its decisions depend on CPython behaviour that
// JavaScript does not share, so those behaviours are reimplemented here rather
// than approximated:
//
//   * str(value)        - int vs float rendering, True/False, datetime repr
//   * float(value)      - accepts numeric strings and bools, raises on anything
//                         else (callers treat the raise as "skip this value")
//   * round(x, n)       - round-half-to-even on the exact binary value
//   * format(x, '.0%')  - multiply by 100, then round-half-to-even
//   * datetime.strptime - "%b %Y" needs a 3-letter month and exactly 4 digits
//
// Getting these wrong changes which rows survive the zero-row filter and which
// COA suggestions get flagged for review, so they are unit tested.

import type { CellValue } from './types';

/** Month abbreviations as CPython's %b renders them in the C locale. */
export const MONTH_ABBREVIATIONS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

/**
 * CPython str(). Dates read out of a workbook are UTC-midnight instants, so the
 * UTC accessors are the ones that reproduce openpyxl's naive datetime.
 */
export function pyStr(value: CellValue): string {
  if (value === null) return 'None';
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return value ? 'True' : 'False';
  if (value instanceof Date) {
    const base =
      `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1, 2)}-${pad(value.getUTCDate(), 2)}` +
      ` ${pad(value.getUTCHours(), 2)}:${pad(value.getUTCMinutes(), 2)}:${pad(value.getUTCSeconds(), 2)}`;
    const ms = value.getUTCMilliseconds();
    return ms === 0 ? base : `${base}.${pad(ms * 1000, 6)}`;
  }
  // openpyxl casts a cell whose stored text has no '.'/'E' to int, so an
  // integral worksheet number renders without a trailing ".0" in Python too.
  return String(value);
}

/** Normalize a cell label: strip whitespace, lowercase. */
export function cleanLabel(value: CellValue): string {
  if (value === null) return '';
  return pyStr(value).trim().toLowerCase();
}

/** Check if cell text starts with target label (case-insensitive). */
export function labelMatches(cellText: CellValue, target: string): boolean {
  return cleanLabel(cellText).startsWith(cleanLabel(target));
}

const EXR_DATE_PATTERN = /^[A-Z][a-z]{2}\s+\d{4}/;
const PS_DATE_PATTERN = /^[A-Z][a-z]{2}-\d{4}/;
const CS_DATE_PATTERN = /^[A-Z][a-z]{2}-\d{2}$/;

/** Check if a value is a date (Date, 'Mon YYYY', 'Mon-YYYY', or 'Mon-YY' string). */
export function isDateValue(value: CellValue): boolean {
  if (value instanceof Date) return true;
  if (typeof value === 'string') {
    if (EXR_DATE_PATTERN.test(value)) return true;
    if (PS_DATE_PATTERN.test(value)) return true;
    if (CS_DATE_PATTERN.test(value)) return true;
  }
  return false;
}

/** Convert a date cell to 'Feb 2025' format. Normalizes PS and CS hyphen formats. */
export function formatDate(value: CellValue): string {
  if (value instanceof Date) {
    return `${MONTH_ABBREVIATIONS[value.getUTCMonth()]} ${value.getUTCFullYear()}`;
  }
  if (value === null) return '';
  let s = pyStr(value).trim();
  // Normalize CS 2-digit year "Feb-26" -> "Feb 2026"
  // (century pivot: 2-digit years are assumed to be 20xx - accurate through 2099)
  const twoDigit = /^([A-Z][a-z]{2})-(\d{2})$/.exec(s);
  if (twoDigit) {
    return `${twoDigit[1]} 20${twoDigit[2]}`;
  }
  // Normalize PS hyphen format "Feb-2025" -> "Feb 2025"
  s = s.replace(/^([A-Z][a-z]{2})-(\d{4})$/, '$1 $2');
  return s;
}

const PY_FLOAT_PATTERN = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
const PY_SPECIAL_FLOAT_PATTERN = /^([+-]?)(inf(inity)?|nan)$/i;

/**
 * CPython float(). Returns null where Python would raise ValueError/TypeError -
 * every call site in the extractor catches that and skips the value.
 */
export function pyFloat(value: CellValue): number | null {
  if (value === null) return null;
  if (typeof value === 'number') return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value instanceof Date) return null; // TypeError in Python
  const s = value.trim();
  if (s === '') return null;
  const special = PY_SPECIAL_FLOAT_PATTERN.exec(s);
  if (special) {
    if (/nan/i.test(special[2])) return Number.NaN;
    return special[1] === '-' ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
  }
  if (!PY_FLOAT_PATTERN.test(s)) return null;
  return Number(s);
}

/**
 * Return true if every numeric value is 0 or None.
 *
 * Values Python cannot coerce with float() are skipped, not treated as zero -
 * so a row of text labels with no numbers is still a "zero row", while a row
 * holding the string "5" is not.
 */
export function isZeroRow(values: readonly CellValue[]): boolean {
  for (const value of values) {
    if (value === null) continue;
    const numeric = pyFloat(value);
    if (numeric === null) continue;
    if (numeric !== 0) return false;
  }
  return true;
}

/** Remove invalid Windows filename characters, replace spaces with underscores. */
export function makeSafeFilename(text: string): string {
  let safe = text.replace(/[\\/:*?"<>|]/g, '');
  safe = safe.replace(/ /g, '_');
  safe = safe.replace(/_+/g, '_');
  safe = safe.replace(/^_+/, '').replace(/_+$/, '');
  return safe;
}

/** os.path.splitext - only splits on a dot that is not the first character of the basename. */
function splitExt(filename: string): string {
  const sepIndex = Math.max(filename.lastIndexOf('/'), filename.lastIndexOf('\\'));
  const base = filename.slice(sepIndex + 1);
  const dotIndex = base.lastIndexOf('.');
  if (dotIndex <= 0) return filename;
  return filename.slice(0, sepIndex + 1 + dotIndex);
}

/**
 * Guess a default property name from the input filename.
 * 'Feb__2026_Owner_Financials_-_EXR_Chattanooga.xlsx' -> 'EXR Chattanooga'
 */
export function guessPropertyName(filename: string): string {
  let name = splitExt(filename);
  name = name.replace(/_/g, ' ');
  name = name.replace(/ +/g, ' ');
  if (name.includes(' - ')) {
    name = name.slice(name.lastIndexOf(' - ') + 3);
  } else if (name.includes(' – ')) {
    name = name.slice(name.lastIndexOf(' – ') + 3);
  }
  return name.trim();
}

/** Convert '10X13' to 130 (width * depth). */
export function calculateSqFt(sizeStr: CellValue): number | null {
  if (sizeStr === null) return null;
  const match = /^(\d+)\s*[Xx]\s*(\d+)/.exec(pyStr(sizeStr).trim());
  if (match) {
    return Number(match[1]) * Number(match[2]);
  }
  return null;
}

export type ParsedPeriod = {
  month: number | null;
  year: number | null;
  periodDate: Date | null;
};

const STRPTIME_B_Y = /^([A-Za-z]{3})\s+(\d{4})$/;

/**
 * datetime.strptime(dateStr, "%b %Y"). %b takes a 3-letter month name
 * case-insensitively and %Y takes exactly 4 digits; anything else is a
 * ValueError, which the Python helper reports as (None, None, None).
 *
 * The returned Date is built at UTC midnight so ExcelJS serializes it to the
 * same Excel serial openpyxl produced from a naive datetime.
 */
export function parseDateString(dateStr: string): ParsedPeriod {
  const match = STRPTIME_B_Y.exec(dateStr);
  if (!match) return { month: null, year: null, periodDate: null };
  const monthIndex = MONTH_ABBREVIATIONS.findIndex(
    (abbr) => abbr.toLowerCase() === match[1].toLowerCase(),
  );
  if (monthIndex < 0) return { month: null, year: null, periodDate: null };
  const year = Number(match[2]);
  return {
    month: monthIndex + 1,
    year,
    periodDate: new Date(Date.UTC(year, monthIndex, 1)),
  };
}

/**
 * Round half to even on the exact binary value of `x`, matching CPython's
 * round() and its float formatting. Reading 25 extra decimal places is enough
 * to tell a true tie (…5 followed by zeros) from a double that merely sits
 * near one, because a double in this workflow's range carries ~17 significant
 * digits.
 */
export function pyRound(x: number, digits: number): number {
  if (!Number.isFinite(x)) return x;
  const negative = x < 0;
  const magnitude = Math.abs(x);
  const expanded = magnitude.toFixed(Math.min(100, digits + 25));
  const dot = expanded.indexOf('.');
  const intPart = expanded.slice(0, dot);
  const fraction = expanded.slice(dot + 1);
  const kept = fraction.slice(0, digits);
  const rest = fraction.slice(digits);

  let roundUp = false;
  const firstDropped = rest.charCodeAt(0) - 48;
  if (firstDropped > 5) {
    roundUp = true;
  } else if (firstDropped === 5) {
    if (/[1-9]/.test(rest.slice(1))) {
      roundUp = true;
    } else {
      const lastKept = digits > 0 ? kept.charCodeAt(digits - 1) - 48 : Number(intPart) % 10;
      roundUp = lastKept % 2 === 1;
    }
  }

  let scaled = Number(`${intPart}${kept}`);
  if (roundUp) scaled += 1;
  const result = scaled / Math.pow(10, digits);
  return negative ? -result : result;
}

/** CPython format(x, '.0%') - e.g. 0.8571 -> "86%". */
export function pyFormatPercent0(x: number): string {
  return `${pyRound(x * 100, 0)}%`;
}

/**
 * CPython's sum() over floats, which since 3.12 uses the improved
 * Kahan-Babuska (Neumaier) compensated summation rather than naive
 * left-to-right addition.
 *
 * The rent roll averages are means over several hundred PSF values, and naive
 * addition drifts from the compensated result by tens of ULPs - enough to change
 * the 15th digit the extractor writes into the datapack. Using the same
 * algorithm keeps those cells identical, and it is the more accurate sum anyway.
 */
export function pySum(values: readonly number[]): number {
  let total = 0.0;
  let compensation = 0.0;
  for (const value of values) {
    const t = total + value;
    if (Math.abs(total) >= Math.abs(value)) {
      compensation += total - t + value;
    } else {
      compensation += value - t + total;
    }
    total = t;
  }
  return total + compensation;
}

/** datetime.now().isoformat() in local time, microsecond precision. */
export function pyNowIsoformat(now: Date): string {
  const base =
    `${now.getFullYear()}-${pad(now.getMonth() + 1, 2)}-${pad(now.getDate(), 2)}` +
    `T${pad(now.getHours(), 2)}:${pad(now.getMinutes(), 2)}:${pad(now.getSeconds(), 2)}`;
  const ms = now.getMilliseconds();
  return ms === 0 ? base : `${base}.${pad(ms * 1000, 6)}`;
}
