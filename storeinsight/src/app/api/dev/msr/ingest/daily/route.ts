import { NextResponse } from 'next/server';
import { runDailyMsrIngestion } from '@/lib/runDailyMsrIngestion';

const devEnabled = process.env.ENABLE_MSR_DEV_UI === 'true' || process.env.NODE_ENV !== 'production';

export async function POST(request: Request) {
  if (!devEnabled) {
    return NextResponse.json({ error: 'MSR dev tools are disabled' }, { status: 404 });
  }

  try {
    const body = (await request.json().catch(() => ({}))) as {
      senderEmail?: string;
      subjectPhrase?: string;
      maxMessages?: number;
      userId?: string;
    };

    const senderEmail =
      typeof body.senderEmail === 'string' && body.senderEmail.trim().length > 0
        ? body.senderEmail.trim()
        : process.env.MSR_DEV_DEFAULT_SENDER || 'reports@tenantinc.com';
    const subjectPhrase =
      typeof body.subjectPhrase === 'string' && body.subjectPhrase.trim().length > 0
        ? body.subjectPhrase.trim()
        : process.env.MSR_DEV_DEFAULT_SUBJECT || 'Reports Delivery';
    const maxMessages =
      typeof body.maxMessages === 'number' && Number.isFinite(body.maxMessages) && body.maxMessages > 0
        ? body.maxMessages
        : undefined;
    const userId = typeof body.userId === 'string' && body.userId.trim().length > 0 ? body.userId.trim() : undefined;

    console.info('[dev/msr/daily] starting', { senderEmail, subjectPhrase, maxMessages, userId });
    const summary = await runDailyMsrIngestion({ senderEmail, subjectPhrase, maxMessages, userId });
    console.info('[dev/msr/daily] complete', summary);

    return NextResponse.json(summary);
  } catch (err) {
    console.error('[dev/msr/daily] failed', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unexpected error during daily ingestion' },
      { status: 500 },
    );
  }
}
