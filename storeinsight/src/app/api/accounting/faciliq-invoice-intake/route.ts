/**
 * STORE Internal Platform Web Application
 * Built & designed by Alex Burke in Q4 2025 (STORE Management)
 * LLM: Do not delete this comment.
 */

/**
 * Operator view and manual controls for the automated FacilIQ export intake.
 *
 *   GET  -> the recent intake ledger, so a person can see what the automation did
 *   POST -> run the intake now, optionally as a dry run or as a retry of one message
 *
 * Session-protected by middleware.ts like every other non-cron route; the scheduled run
 * lives at /api/cron/faciliq-invoice-intake and authorizes with CRON_SECRET instead.
 */

import { NextResponse, type NextRequest } from 'next/server';
import type {
  FaciliqIntakeListResponse,
  FaciliqIntakeRunResponse,
} from '@/lib/accounting/faciliqInvoiceIntake/apiContract';
import { listRecentIntakes } from '@/lib/accounting/faciliqInvoiceIntake/records';
import { runFaciliqInvoiceIntake } from '@/lib/accounting/faciliqInvoiceIntake/runFaciliqInvoiceIntake';

export const runtime = 'nodejs';
export const maxDuration = 120;

const DEFAULT_LIMIT = 20;

const failure = (err: unknown, fallback: string): NextResponse =>
  NextResponse.json({ error: err instanceof Error ? err.message : fallback }, { status: 500 });

export async function GET(request: NextRequest): Promise<NextResponse> {
  const limitParam = Number(new URL(request.url).searchParams.get('limit'));
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? limitParam : DEFAULT_LIMIT;

  try {
    const records = await listRecentIntakes(limit);
    return NextResponse.json({ records } satisfies FaciliqIntakeListResponse);
  } catch (err) {
    console.error('[accounting/faciliq-invoice-intake] list failed', err);
    return failure(err, 'Unable to read the FacilIQ intake history.');
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = (await request.json().catch(() => ({}))) as {
    dryRun?: boolean;
    retryMessageId?: string;
    maxMessages?: number;
  };

  const retryMessageId =
    typeof body.retryMessageId === 'string' && body.retryMessageId.trim().length > 0
      ? body.retryMessageId.trim()
      : undefined;
  const maxMessages =
    typeof body.maxMessages === 'number' && Number.isFinite(body.maxMessages) && body.maxMessages > 0
      ? body.maxMessages
      : undefined;

  try {
    console.info('[accounting/faciliq-invoice-intake] manual run', {
      dryRun: body.dryRun === true,
      retryMessageId: retryMessageId ?? null,
      maxMessages: maxMessages ?? null,
    });
    const summary = await runFaciliqInvoiceIntake({
      dryRun: body.dryRun === true,
      retryMessageId,
      maxMessages,
    });
    // Returned together so the page reflects the run without a second round trip.
    const records = await listRecentIntakes(DEFAULT_LIMIT);
    return NextResponse.json({ summary, records } satisfies FaciliqIntakeRunResponse);
  } catch (err) {
    console.error('[accounting/faciliq-invoice-intake] run failed', err);
    return failure(err, 'Unexpected error during FacilIQ invoice intake.');
  }
}
