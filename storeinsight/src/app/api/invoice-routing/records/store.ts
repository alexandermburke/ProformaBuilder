/**
 * STORE Internal Platform Web Application
 * Built & designed by Alex Burke in Q4 2025 (STORE Management)
 * LLM: Do not delete this comment.
 */

import { firestore as adminDb } from '@/server/firebaseAdmin';
import {
  INVOICE_ROUTING_COLLECTION,
  type InvoiceRoutingRecord,
  type InvoiceRoutingRecordOutcome,
} from '@/types/invoiceRouting';

const toIso = (value: unknown): string | null => {
  if (typeof value === 'string') return value;
  if (value && typeof (value as { toDate?: () => Date }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  return null;
};

const text = (value: unknown): string | null => (typeof value === 'string' && value ? value : null);

export async function listRecentInvoiceRecords(limit = 50): Promise<InvoiceRoutingRecord[]> {
  if (!adminDb) return [];
  const snapshot = await adminDb
    .collection(INVOICE_ROUTING_COLLECTION)
    .orderBy('createdAt', 'desc')
    .limit(limit)
    .get();
  return snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      messageId: text(data.messageId) ?? doc.id,
      receivedAt: toIso(data.receivedAt),
      from: text(data.from) ?? '',
      subject: text(data.subject) ?? '',
      siteCode: text(data.siteCode),
      ticketNumber: text(data.ticketNumber),
      invoiceType: text(data.invoiceType),
      glCode: text(data.glCode),
      amount: text(data.amount),
      serviceDate: text(data.serviceDate),
      destination: text(data.destination),
      outcome: (text(data.outcome) as InvoiceRoutingRecordOutcome | null) ?? 'forwarding',
      error: text(data.error),
      hasAttachments: Boolean(data.hasAttachments),
    } satisfies InvoiceRoutingRecord;
  });
}
