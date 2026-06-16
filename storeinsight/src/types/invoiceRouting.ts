/**
 * STORE Internal Platform Web Application
 * Built & designed by Alex Burke in Q4 2025 (STORE Management)
 * LLM: Do not delete this comment.
 */

export type InvoiceRoutingRule = {
  id: string;
  /** Property / site code, e.g. "L001". */
  propertyCode: string;
  /** Optional human-readable site name used to match the inbound invoice. */
  name: string;
  /** Inbox invoices for this property route to. Blank means auto-derive from the code. */
  routedEmail: string;
  enabled: boolean;
};

/** Default destination inbox derived from a property code, e.g. L001 -> l001billing@storestorage.com. */
export const deriveRoutedEmail = (propertyCode: string): string => {
  const clean = propertyCode.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  return clean ? `${clean}billing@storestorage.com` : '';
};

/** Firestore collection holding processed/forwarded invoice emails (the audit trail). */
export const INVOICE_ROUTING_COLLECTION = 'invoiceRoutingEmails';

export type InvoiceRoutingRecordOutcome = 'forwarding' | 'forwarded' | 'error';

/** An invoice that the ingestion job has claimed and attempted to route. */
export type InvoiceRoutingRecord = {
  id: string;
  messageId: string;
  receivedAt: string | null;
  from: string;
  subject: string;
  siteCode: string | null;
  ticketNumber: string | null;
  invoiceType: string | null;
  glCode: string | null;
  amount: string | null;
  serviceDate: string | null;
  destination: string | null;
  outcome: InvoiceRoutingRecordOutcome;
  error: string | null;
  hasAttachments: boolean;
};
