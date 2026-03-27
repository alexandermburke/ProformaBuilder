import { NextRequest, NextResponse } from 'next/server';
import { getProformaRun } from '@/lib/proformaRuns';
import { getSupabaseAdmin } from '@/server/supabase';

export const runtime = 'nodejs';

type RouteContext = {
  params: Promise<{ runId: string }> | { runId: string };
};

async function resolveRunId(context: RouteContext): Promise<string> {
  const params = 'then' in context.params ? await context.params : context.params;
  return String(params.runId ?? '').trim();
}

export async function GET(_request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const runId = await resolveRunId(context);
  if (!runId) {
    return NextResponse.json({ error: 'runId is required' }, { status: 400 });
  }

  try {
    const run = await getProformaRun(getSupabaseAdmin(), runId);
    return NextResponse.json(run);
  } catch (error) {
    console.error('[finance/proforma-runs/:runId] get failed', error);
    const message = error instanceof Error ? error.message : 'Unable to load proforma run.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
