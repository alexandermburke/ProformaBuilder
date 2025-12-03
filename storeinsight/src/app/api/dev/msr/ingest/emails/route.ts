import { NextResponse } from 'next/server';
import { ingestMsrEmails } from '@/lib/ingestMsrEmails';

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
    };

    const senderEmail =
      typeof body.senderEmail === 'string' && body.senderEmail.trim().length > 0
        ? body.senderEmail.trim()
        : process.env.MSR_DEV_DEFAULT_SENDER || 'reports@tenantinc.com';
    const subjectPhrase =
      typeof body.subjectPhrase === 'string' && body.subjectPhrase.trim().length > 0
        ? body.subjectPhrase.trim()
        : process.env.MSR_DEV_DEFAULT_SUBJECT || 'Reports Delivery';

    const maxMessagesRaw = body.maxMessages;
    const maxMessages =
      typeof maxMessagesRaw === 'number' && Number.isFinite(maxMessagesRaw) && maxMessagesRaw > 0
        ? maxMessagesRaw
        : undefined;

    console.info('[dev/msr/emails] starting', { senderEmail, subjectPhrase, maxMessages });
    const created = await ingestMsrEmails({ senderEmail, subjectPhrase, maxMessages });
    console.info('[dev/msr/emails] complete', { createdCount: created.length });

    return NextResponse.json({
      createdCount: created.length,
      createdEmails: created,
      message: `Ingested ${created.length} email(s).`,
    });
  } catch (err) {
    console.error('[dev/msr/emails] failed', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unexpected error during email ingestion' },
      { status: 500 },
    );
  }
}
