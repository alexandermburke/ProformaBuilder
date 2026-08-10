/**
 * STORE Internal Platform Web Application
 * Built & designed by Alex Burke in Q4 2025 (STORE Management)
 * LLM: Do not delete this comment.
 */

import { toCsvText } from './csv';
import type { QuickBooksPropertyCode } from './properties';
import {
  collectFlaggedRows,
  type FaciliqInvoiceReport,
  type ReviewedInvoiceRow,
} from './reviewInvoices';
import { roundCents } from './values';

/**
 * Builds the per-property import files and the single review file.
 *
 * The property files keep FacilIQ's original header text and cell values exactly, so
 * an existing QuickBooks import mapping still applies. Only rows that passed every
 * check are included -- anything flagged goes to the review file instead.
 */

export type SplitFileKind = 'property' | 'review';

export type SplitFile = {
  kind: SplitFileKind;
  propertyCode: QuickBooksPropertyCode | null;
  label: string;
  filename: string;
  rowCount: number;
  amount: number;
  csv: string;
};

const sanitizeSlug = (value: string): string =>
  value
    .replace(/\.csv$/i, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'export';

/**
 * Prefers the window in FacilIQ's filename, then the invoice-date range actually
 * present in the data, then the source filename. Never a timestamp: re-running the
 * same file must produce the same filenames.
 */
export function periodSlug(report: FaciliqInvoiceReport): string {
  if (report.window) return `${report.window.startIso}-to-${report.window.endIso}`;

  const dates = [
    ...report.properties.flatMap((bucket) =>
      [...bucket.readyRows, ...bucket.reviewRows].map((row) => row.invoiceDateIso),
    ),
    ...report.unresolvedRows.map((row) => row.invoiceDateIso),
  ].filter((value): value is string => value !== null);

  if (dates.length > 0) {
    const sorted = [...dates].sort();
    return `${sorted[0]}-to-${sorted[sorted.length - 1]}`;
  }

  return sanitizeSlug(report.sourceFilename);
}

/** Pads or trims a row to the header width so the output stays rectangular. */
const fit = (cells: readonly string[], width: number): string[] =>
  Array.from({ length: width }, (_, index) => cells[index] ?? '');

const sumAmount = (rows: readonly ReviewedInvoiceRow[]): number =>
  roundCents(rows.reduce((total, row) => total + (row.amount ?? 0), 0));

export function buildPropertyFiles(report: FaciliqInvoiceReport): SplitFile[] {
  if (!report.ok) return [];
  const slug = periodSlug(report);
  const width = report.header.length;

  return report.properties
    .filter((bucket) => bucket.readyRows.length > 0)
    .map((bucket) => ({
      kind: 'property' as const,
      propertyCode: bucket.code,
      label: `${bucket.code} - ${bucket.name}`,
      filename: `faciliq-${bucket.code.toLowerCase()}-${slug}.csv`,
      rowCount: bucket.readyRows.length,
      amount: bucket.readyAmount,
      csv: toCsvText([report.header, ...bucket.readyRows.map((row) => fit(row.cells, width))]),
    }));
}

const REVIEW_PREFIX_HEADERS = ['Source Row', 'Resolved Property', 'Severity', 'Flags'] as const;

export function buildReviewFile(report: FaciliqInvoiceReport): SplitFile | null {
  if (!report.ok) return null;
  const flagged = collectFlaggedRows(report);
  if (flagged.length === 0) return null;

  // A malformed row can be wider than the header; keep every cell rather than trim it
  // out of the one file a person is going to read.
  const width = Math.max(report.header.length, ...flagged.map((row) => row.cells.length));
  const extraHeaders = Array.from({ length: Math.max(0, width - report.header.length) }, (_, i) => `Extra ${i + 1}`);
  const header = [...REVIEW_PREFIX_HEADERS, ...report.header, ...extraHeaders];

  const body = flagged.map((row) => [
    String(row.sourceLine),
    row.propertyCode ?? 'unresolved',
    row.severity ?? '',
    row.flags.map((flag) => `${flag.label}${flag.detail ? ` (${flag.detail})` : ''}`).join('; '),
    ...fit(row.cells, width),
  ]);

  return {
    kind: 'review',
    propertyCode: null,
    label: 'Needs review',
    filename: `faciliq-needs-review-${periodSlug(report)}.csv`,
    rowCount: flagged.length,
    amount: sumAmount(flagged),
    csv: toCsvText([header, ...body]),
  };
}

export function buildOutputFiles(report: FaciliqInvoiceReport): SplitFile[] {
  const review = buildReviewFile(report);
  return [...buildPropertyFiles(report), ...(review ? [review] : [])];
}
