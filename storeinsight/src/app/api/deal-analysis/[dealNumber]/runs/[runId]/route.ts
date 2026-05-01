import { NextRequest } from 'next/server';
import {
  deleteDealAnalysisRun,
  overrideDealAnalysisRun,
} from '@/lib/dealAnalysisStore';
import { writeAiVerdictToTracker } from '@/lib/dealTrackerWrite';
import type { DealAnalysis } from '@/lib/dealAnalysis';

export const runtime = 'nodejs';

function isVerdict(v: unknown): v is DealAnalysis['recommendation'] {
  return v === 'pursue' || v === 'pass' || v === 'investigate';
}

function isConfidence(v: unknown): v is DealAnalysis['confidence'] {
  return v === 'low' || v === 'medium' || v === 'high';
}

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ dealNumber: string; runId: string }> },
): Promise<Response> {
  const { dealNumber, runId } = await context.params;
  try {
    const result = await deleteDealAnalysisRun(dealNumber, runId);
    let writeBackError: string | null = null;
    if (result.latest) {
      try {
        const origin = req.nextUrl.origin;
        await writeAiVerdictToTracker({
          dealNumber,
          recommendation: result.latest.humanOverride?.recommendation ?? result.latest.analysis.recommendation,
          confidence: result.latest.humanOverride?.confidence ?? result.latest.analysis.confidence,
          runAtIso: result.latest.createdAt,
          analysisLink: `${origin}/deal-analysis/${encodeURIComponent(dealNumber)}`,
        });
      } catch (e) {
        writeBackError = (e as Error).message;
      }
    }
    return new Response(
      JSON.stringify({
        remainingRuns: result.remainingRuns,
        latest: result.latest,
        writeBackError,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ dealNumber: string; runId: string }> },
): Promise<Response> {
  const { dealNumber, runId } = await context.params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400 });
  }
  if (!body || typeof body !== 'object') {
    return new Response(JSON.stringify({ error: 'Invalid body' }), { status: 400 });
  }
  const obj = body as Record<string, unknown>;
  if (!isVerdict(obj.recommendation) || !isConfidence(obj.confidence)) {
    return new Response(
      JSON.stringify({
        error: 'recommendation must be pursue|pass|investigate; confidence must be low|medium|high',
      }),
      { status: 400 },
    );
  }
  const note = typeof obj.note === 'string' ? obj.note : '';
  try {
    const result = await overrideDealAnalysisRun(dealNumber, runId, {
      recommendation: obj.recommendation,
      confidence: obj.confidence,
      note,
    });
    let writeBackError: string | null = null;
    if (result.latest && result.latest.runId === runId) {
      try {
        const origin = req.nextUrl.origin;
        await writeAiVerdictToTracker({
          dealNumber,
          recommendation: obj.recommendation,
          confidence: obj.confidence,
          runAtIso: result.latest.createdAt,
          analysisLink: `${origin}/deal-analysis/${encodeURIComponent(dealNumber)}`,
        });
      } catch (e) {
        writeBackError = (e as Error).message;
      }
    }
    return new Response(
      JSON.stringify({ run: result.run, writeBackError }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500 });
  }
}
