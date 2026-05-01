import { listAllSavedDeals } from '@/lib/dealAnalysisStore';

export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  try {
    const deals = await listAllSavedDeals();
    return new Response(JSON.stringify({ deals }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.log('[deal-analysis/saved] failed', { error: (e as Error).message });
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500 });
  }
}
