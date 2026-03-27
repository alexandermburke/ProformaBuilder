import { NextRequest, NextResponse } from 'next/server';
import { updateProformaRunInputs, type ProformaInputKey } from '@/lib/proformaRuns';
import { getSupabaseAdmin } from '@/server/supabase';

export const runtime = 'nodejs';

type RouteContext = {
  params: Promise<{ runId: string }> | { runId: string };
};

type InputsPayload = {
  inputs?: Partial<Record<ProformaInputKey, string>>;
};

async function resolveRunId(context: RouteContext): Promise<string> {
  const params = 'then' in context.params ? await context.params : context.params;
  return String(params.runId ?? '').trim();
}

export async function PUT(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const runId = await resolveRunId(context);
  if (!runId) {
    return NextResponse.json({ error: 'runId is required' }, { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as InputsPayload | null;
  if (!body?.inputs || typeof body.inputs !== 'object') {
    return NextResponse.json({ error: 'inputs payload is required' }, { status: 400 });
  }

  try {
    const run = await updateProformaRunInputs(getSupabaseAdmin(), runId, body.inputs);
    return NextResponse.json(run);
  } catch (error) {
    console.error('[finance/proforma-runs/:runId/inputs] update failed', error);
    const message = error instanceof Error ? error.message : 'Unable to update proforma inputs.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
