import { NextRequest, NextResponse } from 'next/server';
import { updateProformaRunMappings } from '@/lib/proformaRuns';
import { getSupabaseAdmin } from '@/server/supabase';

export const runtime = 'nodejs';

type RouteContext = {
  params: Promise<{ runId: string }> | { runId: string };
};

type MappingPayload = {
  mappings?: Array<{
    operatorAccountName?: string;
    standardizedCoaName?: string;
  }>;
};

async function resolveRunId(context: RouteContext): Promise<string> {
  const params = 'then' in context.params ? await context.params : context.params;
  return String(params.runId ?? '').trim();
}

function cleanCell(value: unknown): string {
  return String(value ?? '')
    .replace(/\u00A0/g, ' ')
    .replace(/\r?\n/g, ' ')
    .trim();
}

export async function PUT(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const runId = await resolveRunId(context);
  if (!runId) {
    return NextResponse.json({ error: 'runId is required' }, { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as MappingPayload | null;
  const mappings = (body?.mappings ?? [])
    .map((mapping) => ({
      operatorAccountName: cleanCell(mapping.operatorAccountName),
      standardizedCoaName: cleanCell(mapping.standardizedCoaName),
    }))
    .filter((mapping) => mapping.operatorAccountName && mapping.standardizedCoaName);

  if (mappings.length === 0) {
    return NextResponse.json({ error: 'At least one mapping is required.' }, { status: 400 });
  }

  try {
    const run = await updateProformaRunMappings(getSupabaseAdmin(), runId, mappings);
    return NextResponse.json(run);
  } catch (error) {
    console.error('[finance/proforma-runs/:runId/mappings] update failed', error);
    const message = error instanceof Error ? error.message : 'Unable to update proforma mappings.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
