/**
 * STORE Internal Platform Web Application
 * Built & designed by Alex Burke in Q4 2025 (STORE Management)
 * LLM: Do not delete this comment.
 */

/**
 * Decides whether a message sitting in billing@ is the weekly FacilIQ QuickBooks invoice
 * export, and which attachment is the CSV to read.
 *
 * billing@storestorage.com is a shared landing mailbox: the invoice-routing automation
 * (src/lib/ingestInvoiceEmails.ts) already reads it for per-invoice approval emails. So
 * this recognizer has to be narrow on purpose. Two signals are required, never inferred:
 *
 *   1. the sender is on the FacilIQ allow-list, and
 *   2. the message carries exactly one readable .csv file attachment.
 *
 * The observed export is named for its period ("store-quickbooks-2026-08-03-to-2026-08-09.csv"),
 * which is treated as a strong confirming signal but not a hard requirement -- FacilIQ
 * renaming the file should not stop a week's import. Two candidate CSVs with no clear
 * export-shaped name is reported as ambiguous rather than resolved by guessing, because
 * picking the wrong one would post the wrong invoices.
 *
 * Pure and synchronous: no Graph calls, so the whole decision is unit-testable.
 */

import type { GraphFileAttachment, GraphMailMessage } from '@/lib/graphMail';
import {
  parseExportWindowFromFilename,
  type ExportWindow,
} from '@/lib/accounting/faciliqInvoiceImport/values';

/** FacilIQ's automated export sender. Override with FACILIQ_ALLOWED_SENDERS. */
export const FACILIQ_DEFAULT_SENDERS: readonly string[] = ['support@faciliqpro.com'];

/**
 * Matches the same 10 MB ceiling the manual /accounting/faciliq-invoice-import upload
 * enforces, so the automated path cannot accept a file a person could not.
 */
export const MAX_EXPORT_BYTES = 10 * 1024 * 1024;

/** Phrases seen in the weekly notification. Recorded as a signal; never the sole test. */
const SUBJECT_PHRASES: readonly string[] = ['invoice export', 'quickbooks export', 'invoice export ready'];

/** FacilIQ's own filename prefix for the QuickBooks export. */
const EXPORT_FILENAME_PREFIX = /^store[-_]?quickbooks/i;

export type ExportRejectionReason =
  | 'sender-not-allowed'
  | 'no-attachments'
  | 'no-csv-attachment'
  | 'ambiguous-csv-attachment'
  | 'attachment-empty'
  | 'attachment-too-large';

/**
 * Confirming signals recorded on the intake record so an operator can see WHY a message
 * was treated as the weekly export, rather than having to trust that it was.
 */
export type ExportEmailSignals = {
  senderAllowed: boolean;
  subjectMatched: boolean;
  filenameMatched: boolean;
  windowInFilename: boolean;
  csvAttachmentCount: number;
};

export type ExportEmailMatch =
  | {
      matched: true;
      attachment: GraphFileAttachment;
      /** Reporting period parsed from the filename, when the filename carries one. */
      window: ExportWindow | null;
      signals: ExportEmailSignals;
    }
  | {
      matched: false;
      reason: ExportRejectionReason;
      detail: string;
      signals: ExportEmailSignals;
    };

const normalizeAddress = (value: string | null | undefined): string =>
  (value ?? '').toLowerCase().trim();

export const messageSender = (message: GraphMailMessage): string =>
  normalizeAddress(message.from?.emailAddress?.address);

/**
 * The allow-list is required, never empty-means-everyone: billing@ receives vendor mail
 * from every direction, and an open filter would let unrelated CSVs into the importer.
 */
export function resolveAllowedSenders(explicit?: readonly string[]): Set<string> {
  const fromEnv = (process.env.FACILIQ_ALLOWED_SENDERS || '')
    .split(',')
    .map(normalizeAddress)
    .filter(Boolean);

  const chosen =
    explicit && explicit.length > 0
      ? explicit
      : fromEnv.length > 0
        ? fromEnv
        : FACILIQ_DEFAULT_SENDERS;

  return new Set(chosen.map(normalizeAddress).filter(Boolean));
}

export const looksLikeExportSubject = (subject: string | null | undefined): boolean => {
  const value = (subject ?? '').toLowerCase();
  return SUBJECT_PHRASES.some((phrase) => value.includes(phrase));
};

export const isCsvAttachment = (attachment: GraphFileAttachment): boolean =>
  !attachment.isInline && /\.csv$/i.test(attachment.name.trim());

/** FacilIQ's export-shaped name: their prefix, or any name carrying a period window. */
export const looksLikeExportFilename = (filename: string): boolean =>
  EXPORT_FILENAME_PREFIX.test(filename.trim()) || parseExportWindowFromFilename(filename) !== null;

/**
 * Ranks CSV candidates so the export-shaped filename wins when a message carries more
 * than one CSV. Returns null when the top two are equally plausible.
 */
const pickExportAttachment = (
  candidates: readonly GraphFileAttachment[],
): GraphFileAttachment | null => {
  if (candidates.length === 1) return candidates[0];

  const scored = candidates
    .map((attachment) => ({
      attachment,
      score:
        (EXPORT_FILENAME_PREFIX.test(attachment.name.trim()) ? 2 : 0) +
        (parseExportWindowFromFilename(attachment.name) !== null ? 1 : 0),
    }))
    .sort((a, b) => b.score - a.score);

  const [best, runnerUp] = scored;
  if (!best || best.score === 0) return null;
  if (runnerUp && runnerUp.score === best.score) return null;
  return best.attachment;
};

export function recognizeFaciliqExportEmail(params: {
  message: GraphMailMessage;
  attachments: readonly GraphFileAttachment[];
  allowedSenders: ReadonlySet<string>;
  maxAttachmentBytes?: number;
}): ExportEmailMatch {
  const { message, attachments, allowedSenders } = params;
  const maxBytes = params.maxAttachmentBytes ?? MAX_EXPORT_BYTES;

  const sender = messageSender(message);
  const senderAllowed = allowedSenders.has(sender);
  const subjectMatched = looksLikeExportSubject(message.subject);
  const csvCandidates = attachments.filter(isCsvAttachment);

  const baseSignals: ExportEmailSignals = {
    senderAllowed,
    subjectMatched,
    filenameMatched: false,
    windowInFilename: false,
    csvAttachmentCount: csvCandidates.length,
  };

  if (!senderAllowed) {
    return {
      matched: false,
      reason: 'sender-not-allowed',
      detail: `"${sender || '(no sender)'}" is not on the FacilIQ sender allow-list.`,
      signals: baseSignals,
    };
  }

  if (attachments.length === 0) {
    return {
      matched: false,
      reason: 'no-attachments',
      detail: 'The message carries no file attachments.',
      signals: baseSignals,
    };
  }

  if (csvCandidates.length === 0) {
    const names = attachments.map((attachment) => attachment.name).filter(Boolean);
    return {
      matched: false,
      reason: 'no-csv-attachment',
      detail: names.length
        ? `No .csv attachment. Attached instead: ${names.join(', ')}.`
        : 'No .csv attachment.',
      signals: baseSignals,
    };
  }

  const attachment = pickExportAttachment(csvCandidates);
  if (!attachment) {
    return {
      matched: false,
      reason: 'ambiguous-csv-attachment',
      detail: `${csvCandidates.length} CSV attachments and none is clearly the weekly export: ${csvCandidates
        .map((candidate) => candidate.name)
        .join(', ')}. Import it by hand instead of guessing.`,
      signals: baseSignals,
    };
  }

  const window = parseExportWindowFromFilename(attachment.name);
  const signals: ExportEmailSignals = {
    ...baseSignals,
    filenameMatched: looksLikeExportFilename(attachment.name),
    windowInFilename: window !== null,
  };

  if (attachment.size <= 0) {
    return {
      matched: false,
      reason: 'attachment-empty',
      detail: `"${attachment.name}" reports a size of ${attachment.size} bytes.`,
      signals,
    };
  }

  if (attachment.size > maxBytes) {
    return {
      matched: false,
      reason: 'attachment-too-large',
      detail: `"${attachment.name}" is ${(attachment.size / 1024 / 1024).toFixed(1)} MB; the limit is ${(
        maxBytes /
        1024 /
        1024
      ).toFixed(0)} MB.`,
      signals,
    };
  }

  return { matched: true, attachment, window, signals };
}
