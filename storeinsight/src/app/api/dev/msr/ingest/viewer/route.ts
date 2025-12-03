import { NextResponse } from 'next/server';
import { ingestManagementSummariesFromViewer } from '@/lib/ingestManagementSummary';
import { listProperties } from '@/app/api/daily-summary/store';

const devEnabled = process.env.ENABLE_MSR_DEV_UI === 'true' || process.env.NODE_ENV !== 'production';

export async function POST(request: Request) {
  if (!devEnabled) {
    return NextResponse.json({ error: 'MSR dev tools are disabled' }, { status: 404 });
  }

  try {
    const body = (await request.json()) as { viewerUrl?: string };
    const viewerUrl = typeof body.viewerUrl === 'string' ? body.viewerUrl.trim() : '';
    if (!viewerUrl) {
      return NextResponse.json({ error: 'viewerUrl is required' }, { status: 400 });
    }

    console.info('[dev/msr/viewer] ingesting', { viewerUrl });
    const propertyConfigs = await listProperties().catch(() => []);
    const reports = await ingestManagementSummariesFromViewer(viewerUrl, { propertyConfigs });
    console.info('[dev/msr/viewer] complete', { count: reports.length });

    if (!reports.length) {
      return NextResponse.json({ error: 'No XLSX links found for viewer URL' }, { status: 400 });
    }

    return NextResponse.json({
      viewerUrl,
      reportsIngested: reports,
    });
  } catch (err) {
    console.error('[dev/msr/viewer] failed', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unexpected error during viewer ingestion' },
      { status: 500 },
    );
  }
}
