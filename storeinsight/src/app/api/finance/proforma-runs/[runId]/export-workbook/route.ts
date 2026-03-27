import { NextRequest } from 'next/server';
import { exportProformaRunWorkbook } from '@/lib/proformaRuns';
import { getSupabaseAdmin } from '@/server/supabase';

export const runtime = 'nodejs';

type RouteContext = {
  params: Promise<{ runId: string }> | { runId: string };
};

async function resolveRunId(context: RouteContext): Promise<string> {
  const params = 'then' in context.params ? await context.params : context.params;
  return String(params.runId ?? '').trim();
}

export async function POST(_request: NextRequest, context: RouteContext): Promise<Response> {
  const runId = await resolveRunId(context);
  if (!runId) {
    return Response.json({ error: 'runId is required' }, { status: 400 });
  }

  try {
    const { buffer, fileName } = await exportProformaRunWorkbook(getSupabaseAdmin(), runId);
    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('[finance/proforma-runs/:runId/export-workbook] export failed', error);
    const message = error instanceof Error ? error.message : 'Unable to export workbook.';
    return Response.json({ error: message }, { status: 500 });
  }
}
