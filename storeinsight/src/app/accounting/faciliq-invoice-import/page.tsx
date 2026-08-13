/**
 * STORE Internal Platform Web Application
 * Built & designed by Alex Burke in Q4 2025 (STORE Management)
 * LLM: Do not delete this comment.
 */

import type { JSX } from 'react';
import {
  listRecentIntakes,
  type FaciliqIntakeRecord,
} from '@/lib/accounting/faciliqInvoiceIntake/records';
import { isLiveCreateEnabled } from '@/lib/accounting/quickbooks/config';
import FaciliqInvoiceImportScreen from './ui/FaciliqInvoiceImportScreen';

/**
 * Reads the automated intake ledger on the server so the page renders with real history
 * instead of fetching it from an effect after mount.
 */
export const dynamic = 'force-dynamic';

const INTAKE_HISTORY_LIMIT = 20;

const mailboxLabel = (): string =>
  process.env.FACILIQ_MAILBOX_USER_ID?.trim() ||
  process.env.INVOICE_MAILBOX_USER_ID?.trim() ||
  'the billing mailbox';

export default async function FaciliqInvoiceImportPage(): Promise<JSX.Element> {
  let intakeRecords: FaciliqIntakeRecord[] = [];
  let intakeLoadError: string | null = null;

  // The manual drop zone works with or without Firebase, so a ledger read failure is
  // surfaced in the panel rather than taking the whole page down.
  try {
    intakeRecords = await listRecentIntakes(INTAKE_HISTORY_LIMIT);
  } catch (err) {
    intakeLoadError = err instanceof Error ? err.message : 'Unknown error.';
    console.error('[accounting/faciliq-invoice-import] intake history unavailable', err);
  }

  return (
    <FaciliqInvoiceImportScreen
      intakeRecords={intakeRecords}
      intakeLoadError={intakeLoadError}
      mailboxLabel={mailboxLabel()}
      liveCreateEnabled={isLiveCreateEnabled()}
    />
  );
}
