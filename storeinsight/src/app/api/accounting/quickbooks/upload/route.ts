/**
 * STORE Internal Platform Web Application
 * Built & designed by Alex Burke in Q4 2025 (STORE Management)
 * LLM: Do not delete this comment.
 */

/**
 * Runs the QuickBooks bill upload for one parsed FacilIQ export, and reads back the
 * bill-level ledger for it. Session-protected by middleware.ts.
 *
 * There is no cron entry for this on purpose. Bills are created only when a person asks,
 * and only when QUICKBOOKS_LIVE_CREATE is enabled; every other call is a dry run.
 */

import { NextResponse, type NextRequest } from 'next/server';
import {
  QUICKBOOKS_PROPERTY_CODES,
  type QuickBooksPropertyCode,
} from '@/lib/accounting/faciliqInvoiceImport/properties';
import type {
  QuickBooksBillsResponse,
  QuickBooksUploadResponse,
} from '@/lib/accounting/quickbooks/apiContract';
import { listBillsForExport } from '@/lib/accounting/quickbooks/billRecords';
import { uploadFaciliqExportBills } from '@/lib/accounting/quickbooks/uploadFaciliqBills';

export const runtime = 'nodejs';
export const maxDuration = 300;

const isPropertyCode = (value: unknown): value is QuickBooksPropertyCode =>
  typeof value === 'string' && (QUICKBOOKS_PROPERTY_CODES as readonly string[]).includes(value);

export async function GET(request: NextRequest): Promise<NextResponse> {
  const messageId = new URL(request.url).searchParams.get('messageId');
  if (!messageId) {
    return NextResponse.json({ error: 'Expected ?messageId=' }, { status: 400 });
  }

  try {
    const bills = await listBillsForExport(messageId);
    return NextResponse.json({ messageId, bills } satisfies QuickBooksBillsResponse);
  } catch (err) {
    console.error('[quickbooks/upload] list failed', { messageId }, err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unable to read the bill ledger.' },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = (await request.json().catch(() => ({}))) as {
    messageId?: string;
    dryRun?: boolean;
    propertyCode?: string;
    billKey?: string;
    limit?: number;
  };

  const messageId = typeof body.messageId === 'string' ? body.messageId.trim() : '';
  if (!messageId) {
    return NextResponse.json({ error: 'Expected a messageId.' }, { status: 400 });
  }

  try {
    const summary = await uploadFaciliqExportBills({
      messageId,
      // Anything other than an explicit `false` stays a dry run.
      dryRun: body.dryRun === false ? false : true,
      propertyCode: isPropertyCode(body.propertyCode) ? body.propertyCode : undefined,
      billKey: typeof body.billKey === 'string' && body.billKey.trim() ? body.billKey.trim() : undefined,
      limit:
        typeof body.limit === 'number' && Number.isFinite(body.limit) && body.limit > 0
          ? Math.floor(body.limit)
          : undefined,
    });
    const bills = await listBillsForExport(messageId);
    return NextResponse.json({ summary, bills } satisfies QuickBooksUploadResponse);
  } catch (err) {
    console.error('[quickbooks/upload] run failed', { messageId }, err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'The QuickBooks upload could not be run.' },
      { status: 500 },
    );
  }
}
