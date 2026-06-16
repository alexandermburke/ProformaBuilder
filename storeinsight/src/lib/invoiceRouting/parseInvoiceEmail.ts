/**
 * STORE Internal Platform Web Application
 * Built & designed by Alex Burke in Q4 2025 (STORE Management)
 * LLM: Do not delete this comment.
 */

import { deriveRoutedEmail } from '@/types/invoiceRouting';

export type TicketPrefix = 'OBR' | 'RNM';
export type InvoiceType = 'CapEx' | 'R&M';

export type ParsedInvoice = {
  ticketNumber: string | null;
  ticketPrefix: TicketPrefix | null;
  invoiceType: InvoiceType | null;
  siteCode: string | null;
  /** How siteCode was found: a "Site:" label is trustworthy, a bare token is a guess. */
  siteCodeSource: 'labeled' | 'fallback' | null;
  destinationInbox: string | null;
  serviceDate: string | null;
  glCode: string | null;
  workDetails: string | null;
  amount: string | null;
};

/**
 * Best-effort extraction of the fields STORE needs from an approved-invoice email.
 * Shared by the Invoice Routing page (live preview) and the mailbox ingestion job so
 * the demo and the automation always parse identically.
 */
export function parseInvoiceEmail(raw: string): ParsedInvoice {
  // Normalize non-breaking spaces that often come from pasted/forwarded email HTML.
  const text = raw.replace(/\u00a0/g, ' ');

  const ticketMatch = text.match(/\b(OBR|RNM)[-\s]?(\d{3,8})\b/i);
  const ticketPrefix = (ticketMatch?.[1]?.toUpperCase() as TicketPrefix | undefined) ?? null;
  const ticketNumber = ticketMatch ? `${ticketPrefix}-${ticketMatch[2]}` : null;
  const invoiceType = ticketPrefix === 'OBR' ? 'CapEx' : ticketPrefix === 'RNM' ? 'R&M' : null;

  // Site code is a letter + three digits (e.g. L001). Prefer the value next to a
  // "Site" label so we do not grab PO numbers, suite numbers, or office codes that
  // share the same shape; fall back to the first site-shaped token otherwise.
  const labeledSite = text.match(/\bsite\b[\s:#-]*([A-Za-z]\d{3})\b/i)?.[1];
  const fallbackSite = (text.match(/\b([A-Za-z]\d{3})\b/g) ?? [])[0];
  const siteCode = (labeledSite ?? fallbackSite)?.toUpperCase() ?? null;
  const siteCodeSource: 'labeled' | 'fallback' | null = labeledSite
    ? 'labeled'
    : fallbackSite
      ? 'fallback'
      : null;
  const destinationInbox = siteCode ? deriveRoutedEmail(siteCode) || null : null;

  const serviceDate =
    text.match(/\b(\d{1,2}\/\d{1,2}\/\d{2,4})\b/)?.[1] ??
    text.match(/\b(\d{4}-\d{2}-\d{2})\b/)?.[1] ??
    null;

  // Allow an optional label word (code / account / acct) between "GL" and the number,
  // which is how invoice emails actually phrase it ("GL code: 5120-100").
  const glCode = text.match(/\bGL\s*(?:code|account|acct)?\s*[#:]?\s*([0-9][0-9-]{2,})\b/i)?.[1] ?? null;

  const workDetails = text.match(/\bwork\s*details?\b[\s:#-]*(.+)/i)?.[1]?.trim() || null;

  const amountMatch = text.match(/\$\s?([\d,]+(?:\.\d{2})?)/);
  const amount = amountMatch ? `$${amountMatch[1]}` : null;

  return {
    ticketNumber,
    ticketPrefix,
    invoiceType,
    siteCode,
    siteCodeSource,
    destinationInbox,
    serviceDate,
    glCode,
    workDetails,
    amount,
  };
}
