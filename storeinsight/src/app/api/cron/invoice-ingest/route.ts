import { NextRequest, NextResponse } from 'next/server';
import { ingestInvoiceEmails } from '@/lib/ingestInvoiceEmails';

export const runtime = 'nodejs';
export const maxDuration = 120;

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

  // Safety: forwarding is OFF by default so connecting the mailbox only reads + parses.
  // Flip it on with INVOICE_ROUTING_FORWARD=true (after granting Mail.Send), or per call
  // with ?forward=1. Use ?dryRun=1 to force a read-only run even when forwarding is on.
  const url = new URL(request.url);
  const forwardParam = url.searchParams.get('forward');
  const dryRunParam = url.searchParams.get('dryRun');
  const forwardingEnabled =
    forwardParam === '1' || forwardParam === 'true' || process.env.INVOICE_ROUTING_FORWARD === 'true';
  const forceDryRun = dryRunParam === '1' || dryRunParam === 'true';
  const dryRun = forceDryRun || !forwardingEnabled;

  try {
    const summary = await ingestInvoiceEmails({ dryRun });
    return NextResponse.json({ mode: 'scheduled', ...summary });
  } catch (err) {
    console.error('[cron/invoice-ingest] failed', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unexpected error during invoice ingestion' },
      { status: 500 },
    );
  }
};

// Vercel Cron:
// - Path: /api/cron/invoice-ingest · Method: GET/POST · Header x-cron-secret: <CRON_SECRET>
// - Reads billing@ (INVOICE_MAILBOX_USER_ID) via Microsoft Graph and routes to the property inbox.
export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
