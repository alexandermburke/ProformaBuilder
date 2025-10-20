// src/lib/compute.ts
import { HeaderMapping, ParsedSheet, ProformaTotals } from './types';

/** Narrow, explicit helpers (no `any`). */

export function toNumber(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'string') {
    // Handle $, commas, spaces; parentheses = negative
    const neg = v.includes('(') && v.includes(')');
    const cleaned = v.replace(/[$,\s()]/g, '');
    const n = Number(cleaned);
    const out = Number.isFinite(n) ? (neg ? -n : n) : 0;
    return out;
  }
  return 0;
}

export function sum(nums: number[]): number {
  let s = 0;
  for (const n of nums) if (Number.isFinite(n)) s += n;
  return s;
}

/**
 * Given a parsed sheet, a header mapping, and the required fields,
 * pull the first matching row's values for TOI/TOE (MVP) and compute NOI.
 * For a real adapter you'd scan/group more intelligently; here we keep it tight.
 */
export function computeTotalsFromSheet(
  sheet: ParsedSheet,
  mapping: HeaderMapping
): ProformaTotals {
  const hdrTOI = mapping['Total Operating Income'];
  const hdrTOE = mapping['Total Operating Expense'];

  let toi = 0;
  let toe = 0;

  for (const row of sheet.rows) {
    // Using index access in a typed-safe manner:
    const rawToi = (row as Record<string, unknown>)[hdrTOI as string];
    const rawToe = (row as Record<string, unknown>)[hdrTOE as string];

    const vToi = toNumber(rawToi);
    const vToe = toNumber(rawToe);

    // Keep the last non-zero we see (basic MVP behavior)
    if (vToi !== 0) toi = vToi;
    if (vToe !== 0) toe = vToe;
  }

  const noi = toi - toe;
  console.log('[compute] totals from sheet', { toi, toe, noi, hdrTOI, hdrTOE, sheet: sheet.name });
  return { totalOperatingIncome: toi, totalOperatingExpense: toe, noi };
}

/**
 * Compute totals from monthly series (12-month arrays).
 * Useful when using the assumptions engine to generate arrays and then
 * pushing those into Excel named ranges.
 */
export function computeTotalsFromSeries(
  toiSeries: number[],
  toeSeries: number[]
): ProformaTotals {
  const toi = sum(toiSeries);
  const toe = sum(toeSeries);
  const noi = toi - toe;
  console.log('[compute] totals from series', {
    toiMonths: toiSeries.length,
    toeMonths: toeSeries.length,
    toi,
    toe,
    noi,
  });
  return { totalOperatingIncome: toi, totalOperatingExpense: toe, noi };
}

/** -------- Tie-outs / validations for monthly arrays (non-blocking) -------- */

export type TieoutResult = {
  errors: string[];
  warnings: string[];
};

/**
 * Check that NOI ≈ TOI − TOE month by month, and flag negative values.
 * Errors: hard mismatches beyond tolerance.
 * Warnings: negative totals or obvious anomalies.
 */
export function tieoutArrays(toi: number[], toe: number[], noi: number[]): TieoutResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const months = Math.min(toi.length, toe.length, noi.length);

  for (let i = 0; i < months; i++) {
    const calc = toi[i] - toe[i];
    const delta = Math.abs(calc - noi[i]);
    if (delta > 1e-4) {
      errors.push(`Month ${i + 1}: NOI mismatch (calc=${calc}, provided=${noi[i]})`);
    }
    if (toi[i] < 0) warnings.push(`Month ${i + 1}: TOI is negative`);
    if (toe[i] < 0) warnings.push(`Month ${i + 1}: TOE is negative`);
  }

  console.log('[compute] tieouts', { months, errorCount: errors.length, warningCount: warnings.length });
  return { errors, warnings };
}

/** Optional: coerce a subset of row fields to numbers for quick checks */
export function coerceRowNumbers(
  row: Record<string, unknown>,
  headers: string[]
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const h of headers) {
    const v = (row as Record<string, unknown>)[h];
    out[h] = toNumber(v);
  }
  console.log('[compute] coerceRowNumbers', { headers, sample: out });
  return out;
}