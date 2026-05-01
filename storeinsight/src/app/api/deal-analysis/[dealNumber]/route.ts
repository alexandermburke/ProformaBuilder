import { NextRequest } from 'next/server';
import { listRunsForDeal } from '@/lib/dealAnalysisStore';

export const runtime = 'nodejs';

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ dealNumber: string }> },
): Promise<Response> {
  const { dealNumber } = await context.params;
  if (!dealNumber) {
    return new Response(JSON.stringify({ error: 'dealNumber required' }), { status: 400 });
  }
  try {
    const runs = await listRunsForDeal(dealNumber);
    return new Response(
      JSON.stringify({
        dealNumber,
        runs,
        latest: runs[0] ?? null,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  } catch (e) {
    console.log('[deal-analysis/:id] load failed', { error: (e as Error).message });
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500 });
  }
}
