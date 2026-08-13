/**
 * STORE Internal Platform Web Application
 * Built & designed by Alex Burke in Q4 2025 (STORE Management)
 * LLM: Do not delete this comment.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { runFaciliqInvoiceIntake } from '@/lib/accounting/faciliqInvoiceIntake/runFaciliqInvoiceIntake';
import { uploadPendingFaciliqExports } from '@/lib/accounting/quickbooks/uploadPendingExports';

export const runtime = 'nodejs';
export const maxDuration = 300;

const isCronRequest = (req: NextRequest): boolean =>
  req.headers.get('user-agent')?.toLowerCase().startsWith('vercel-cron') === true;

const authorize = (req: NextRequest): boolean => {
  const header = req.headers.get('x-cron-secret');
  const secret = process.env.CRON_SECRET;
  if (header != null) {
    return !!secret && header === secret;
  }
  if (isCronRequest(req)) {
    return true;
  }
  return false;
};

const handle = async (request: NextRequest): Promise<NextResponse> => {
  if (!authorize(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // ?dryRun=1 reads and converts without claiming, archiving, or recording anything --
  // useful for confirming mailbox access before the first real run.
  const url = new URL(request.url);
  const dryRunParam = url.searchParams.get('dryRun');
  const dryRun = dryRunParam === '1' || dryRunParam === 'true';

  try {
    const intake = await runFaciliqInvoiceIntake({ dryRun });

    // The upload runs in the same pass so a new export reaches QuickBooks the same day it
    // arrives. It is a separate concern with its own guards, so an intake failure above
    // does not reach here, and an upload failure below does not undo a good intake.
    // QUICKBOOKS_LIVE_CREATE decides whether bills are actually created; without it this
    // resolves references and builds payloads and writes nothing.
    let upload = null;
    try {
      upload = await uploadPendingFaciliqExports({ dryRun });
    } catch (err) {
      console.error('[cron/faciliq-invoice-intake] upload step failed', err);
      return NextResponse.json({
        mode: 'scheduled',
        intake,
        upload: null,
        uploadError: err instanceof Error ? err.message : 'Unexpected error during the upload step',
      });
    }

    return NextResponse.json({ mode: 'scheduled', intake, upload });
  } catch (err) {
    console.error('[cron/faciliq-invoice-intake] failed', err);
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : 'Unexpected error during FacilIQ invoice intake',
      },
      { status: 500 },
    );
  }
};

// Vercel Cron:
// - Path: /api/cron/faciliq-invoice-intake · Method: GET/POST · Header x-cron-secret: <CRON_SECRET>
// - Reads billing@ (FACILIQ_MAILBOX_USER_ID, falling back to INVOICE_MAILBOX_USER_ID) via
//   Microsoft Graph, converts the weekly FacilIQ QuickBooks export, then sends any bills
//   still outstanding to each property's QuickBooks company.
// - Runs daily rather than weekly on purpose: a late or re-sent export still gets picked
//   up, and the intake ledger makes a repeat run a no-op.
// - Schedule: 0 17 * * *, i.e. somewhere in 17:00-17:59 UTC on Hobby, which fires at the
//   stated hour rather than the stated minute. FacilIQ has delivered between 09:00 and
//   15:15 UTC, so 17:00 clears the latest observed arrival by well over an hour and the
//   export is picked up the same day instead of the next one.
export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
