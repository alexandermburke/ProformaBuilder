/**
 * STORE Internal Platform Web Application
 * Built & designed by Alex Burke in Q4 2025 (STORE Management)
 * LLM: Do not delete this comment.
 */

import type { SplitFile } from './buildSplitFiles';
import type { QuickBooksPropertyCode } from './properties';
import type { FaciliqInvoiceReport, ReviewedInvoiceRow } from './reviewInvoices';

/**
 * The shape the API sends to the page. Raw cell arrays stay on the server -- the split
 * files are already built there, so the browser only needs the fields it renders. Ready
 * rows collapse to a count and a total; flagged rows travel in full because those are
 * the rows a person has to act on.
 */

export type ClientInvoiceRow = Omit<ReviewedInvoiceRow, 'cells'>;

export type ClientPropertyBucket = {
  code: QuickBooksPropertyCode;
  name: string;
  readyRowCount: number;
  readyAmount: number;
  reviewRows: ClientInvoiceRow[];
  reviewAmount: number;
};

export type FaciliqInvoiceClientReport = Omit<
  FaciliqInvoiceReport,
  'properties' | 'unresolvedRows'
> & {
  properties: ClientPropertyBucket[];
  unresolvedRows: ClientInvoiceRow[];
};

export type FaciliqInvoiceResponse = {
  report: FaciliqInvoiceClientReport;
  files: SplitFile[];
};

/**
 * Listed field by field rather than spread-minus-cells: if a field is ever added to
 * ReviewedInvoiceRow, this fails to compile instead of quietly widening the payload.
 */
const stripCells = (row: ReviewedInvoiceRow): ClientInvoiceRow => ({
  sourceLine: row.sourceLine,
  fields: row.fields,
  amount: row.amount,
  invoiceDateIso: row.invoiceDateIso,
  propertyCode: row.propertyCode,
  flags: row.flags,
  severity: row.severity,
  status: row.status,
});

export function toClientReport(report: FaciliqInvoiceReport): FaciliqInvoiceClientReport {
  const { properties, unresolvedRows, ...rest } = report;
  return {
    ...rest,
    properties: properties.map((bucket) => ({
      code: bucket.code,
      name: bucket.name,
      readyRowCount: bucket.readyRows.length,
      readyAmount: bucket.readyAmount,
      reviewRows: bucket.reviewRows.map(stripCells),
      reviewAmount: bucket.reviewAmount,
    })),
    unresolvedRows: unresolvedRows.map(stripCells),
  };
}

/** Flagged rows across every property plus the unresolved ones, in file order. */
export const clientFlaggedRows = (report: FaciliqInvoiceClientReport): ClientInvoiceRow[] =>
  [...report.properties.flatMap((bucket) => bucket.reviewRows), ...report.unresolvedRows].sort(
    (a, b) => a.sourceLine - b.sourceLine,
  );
