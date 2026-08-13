/**
 * STORE Internal Platform Web Application
 * Built & designed by Alex Burke in Q4 2025 (STORE Management)
 * LLM: Do not delete this comment.
 */

/**
 * Groups the converter's clean rows into one bill per invoice number, and turns a bill into
 * a QuickBooks Bill payload.
 *
 * Only rows the converter marked `ready` are eligible. A ready row has already been checked
 * for a present invoice number, vendor, amount, readable invoice date, resolvable property,
 * and GL code, and the converter has already refused any invoice number that spans two
 * properties -- so grouping by invoice number inside one property is safe here.
 *
 * Nothing is invented. Every field on the payload comes from a source cell or is omitted.
 */

import crypto from 'node:crypto';
import type { QuickBooksPropertyCode } from '@/lib/accounting/faciliqInvoiceImport/properties';
import type {
  FaciliqInvoiceReport,
  ReviewedInvoiceRow,
} from '@/lib/accounting/faciliqInvoiceImport/reviewInvoices';
import { parseCsvDate, roundCents } from '@/lib/accounting/faciliqInvoiceImport/values';

/**
 * QuickBooks field limits. A value over the limit is reported rather than silently cut,
 * except Description, where the FacilIQ work write-ups are genuinely long and truncating
 * with a visible marker is better than refusing the bill.
 */
export const QBO_DOC_NUMBER_MAX = 21;
export const QBO_DESCRIPTION_MAX = 4000;
export const QBO_PRIVATE_NOTE_MAX = 4000;

export type BillLineDraft = {
  /** Line number in the FacilIQ export, so a QuickBooks bill can be traced back to a row. */
  sourceLine: number;
  amount: number;
  description: string;
  item: string;
  glCode: string;
};

export type BillDraft = {
  /** Stable natural key: property, vendor, invoice number, and total. */
  billKey: string;
  propertyCode: QuickBooksPropertyCode;
  invoiceNumber: string;
  vendorName: string;
  invoiceDateIso: string;
  dueDateIso: string | null;
  memo: string;
  amount: number;
  lines: BillLineDraft[];
  sourceFilename: string;
};

const normalizeKeyPart = (value: string): string =>
  value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '');

/**
 * The duplicate-protection key. Deliberately built from what identifies a bill in the real
 * world rather than from anything QuickBooks or the mailbox assigned, so the same invoice
 * arriving in two different weekly exports collapses onto one key.
 */
export function billKeyFor(params: {
  propertyCode: QuickBooksPropertyCode;
  vendorName: string;
  invoiceNumber: string;
  amount: number;
}): string {
  const parts = [
    params.propertyCode,
    normalizeKeyPart(params.vendorName),
    normalizeKeyPart(params.invoiceNumber),
    roundCents(params.amount).toFixed(2),
  ].join('|');
  return crypto.createHash('sha256').update(parts).digest('hex');
}

const truncate = (value: string, max: number): string =>
  value.length <= max ? value : `${value.slice(0, max - 3)}...`;

/**
 * One draft per invoice number per property, in file order. Rows sharing an invoice number
 * become multiple lines on one bill, which is what FacilIQ's multi-line invoices mean.
 */
export function buildBillDrafts(report: FaciliqInvoiceReport): BillDraft[] {
  const drafts: BillDraft[] = [];

  for (const bucket of report.properties) {
    const groups = new Map<string, ReviewedInvoiceRow[]>();
    for (const row of bucket.readyRows) {
      const key = normalizeKeyPart(row.fields.invoiceNumber);
      const existing = groups.get(key);
      if (existing) existing.push(row);
      else groups.set(key, [row]);
    }

    for (const rows of groups.values()) {
      const first = rows[0];
      if (!first || !first.invoiceDateIso) continue;

      const amount = roundCents(rows.reduce((total, row) => total + (row.amount ?? 0), 0));
      const dueDate = first.fields.dueDate ? parseCsvDate(first.fields.dueDate) : null;
      const memo = rows
        .map((row) => row.fields.memo.trim())
        .filter(Boolean)
        .join(' ');

      drafts.push({
        billKey: billKeyFor({
          propertyCode: bucket.code,
          vendorName: first.fields.vendor,
          invoiceNumber: first.fields.invoiceNumber,
          amount,
        }),
        propertyCode: bucket.code,
        invoiceNumber: first.fields.invoiceNumber,
        vendorName: first.fields.vendor,
        invoiceDateIso: first.invoiceDateIso,
        dueDateIso: dueDate?.iso ?? null,
        memo,
        amount,
        lines: rows.map((row) => ({
          sourceLine: row.sourceLine,
          amount: roundCents(row.amount ?? 0),
          description: row.fields.description,
          item: row.fields.item,
          glCode: row.fields.glCode,
        })),
        sourceFilename: report.sourceFilename,
      });
    }
  }

  return drafts.sort((a, b) => (a.lines[0]?.sourceLine ?? 0) - (b.lines[0]?.sourceLine ?? 0));
}

export type QuickBooksBillLine = {
  DetailType: 'AccountBasedExpenseLineDetail';
  Amount: number;
  Description?: string;
  AccountBasedExpenseLineDetail: {
    AccountRef: { value: string };
    BillableStatus: 'NotBillable';
  };
};

export type QuickBooksBillPayload = {
  VendorRef: { value: string };
  TxnDate: string;
  DueDate?: string;
  DocNumber?: string;
  PrivateNote?: string;
  Line: QuickBooksBillLine[];
};

export type BillPayloadResult =
  | { ok: true; payload: QuickBooksBillPayload }
  | { ok: false; reason: string };

/**
 * Assembles the QuickBooks payload from a draft plus the ids resolved in the destination
 * company. Account ids are passed in per line because two lines on one invoice can carry
 * different GL codes.
 */
export function buildBillPayload(params: {
  draft: BillDraft;
  vendorId: string;
  accountIdBySourceLine: ReadonlyMap<number, string>;
}): BillPayloadResult {
  const { draft, vendorId, accountIdBySourceLine } = params;

  if (draft.invoiceNumber.length > QBO_DOC_NUMBER_MAX) {
    // Not truncated: DocNumber is what a person matches against the paper invoice, and a
    // shortened one would also break the duplicate check against QuickBooks.
    return {
      ok: false,
      reason: `Invoice number "${draft.invoiceNumber}" is ${draft.invoiceNumber.length} characters; QuickBooks allows ${QBO_DOC_NUMBER_MAX}.`,
    };
  }

  const lines: QuickBooksBillLine[] = [];
  for (const line of draft.lines) {
    const accountId = accountIdBySourceLine.get(line.sourceLine);
    if (!accountId) {
      return { ok: false, reason: `Row ${line.sourceLine} has no resolved QuickBooks account.` };
    }
    const description = line.description.trim() || line.item.trim();
    lines.push({
      DetailType: 'AccountBasedExpenseLineDetail',
      Amount: line.amount,
      ...(description ? { Description: truncate(description, QBO_DESCRIPTION_MAX) } : {}),
      AccountBasedExpenseLineDetail: {
        AccountRef: { value: accountId },
        // Vendor work on STORE's own sites is not rebilled to a customer.
        BillableStatus: 'NotBillable',
      },
    });
  }

  if (lines.length === 0) {
    return { ok: false, reason: 'The bill has no lines.' };
  }

  // Provenance, so accounting can see which FacilIQ export a bill came from without
  // leaving QuickBooks. Kept separate from the vendor's own memo text.
  const provenance = `Imported from FacilIQ export ${draft.sourceFilename}`;
  const privateNote = draft.memo ? `${draft.memo}\n${provenance}` : provenance;

  return {
    ok: true,
    payload: {
      VendorRef: { value: vendorId },
      TxnDate: draft.invoiceDateIso,
      ...(draft.dueDateIso ? { DueDate: draft.dueDateIso } : {}),
      DocNumber: draft.invoiceNumber,
      PrivateNote: truncate(privateNote, QBO_PRIVATE_NOTE_MAX),
      Line: lines,
    },
  };
}
