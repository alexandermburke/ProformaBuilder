import { NextRequest } from 'next/server';
import { downloadDriveItem, resolveSharedDriveItem } from '@/lib/graph';
import { parseDealTrackerWorkbook, type DealTrackerEntry } from '@/lib/dealTracker';
import { listLatestVerdicts, type DealAnalysisLatest } from '@/lib/dealAnalysisStore';

export const runtime = 'nodejs';

type CacheEntry = {
  fetchedAt: number;
  filename: string;
  entries: DealTrackerEntry[];
  missingHeaders: string[];
};

const CACHE_TTL_MS = 5 * 60_000;

let cache: CacheEntry | null = null;

async function loadTracker(force: boolean): Promise<CacheEntry> {
  const now = Date.now();
  if (!force && cache && now - cache.fetchedAt < CACHE_TTL_MS) {
    return cache;
  }
  const shareUrl = process.env.MS_DEAL_TRACKER_SHARE_URL;
  if (!shareUrl) {
    throw new Error('MS_DEAL_TRACKER_SHARE_URL missing');
  }
  const ref = await resolveSharedDriveItem(shareUrl);
  const buffer = await downloadDriveItem(ref);
  const parsed = parseDealTrackerWorkbook(buffer);
  cache = {
    fetchedAt: now,
    filename: ref.name,
    entries: parsed.entries,
    missingHeaders: parsed.missingHeaders,
  };
  return cache;
}

export async function GET(req: NextRequest): Promise<Response> {
  const url = new URL(req.url);
  const force = url.searchParams.get('refresh') === '1';
  try {
    const data = await loadTracker(force);
    let verdicts: DealAnalysisLatest[] = [];
    try {
      verdicts = await listLatestVerdicts();
    } catch (e) {
      console.log('[deal-tracker] verdict lookup failed', { error: (e as Error).message });
    }
    const verdictByDeal = new Map(verdicts.map((v) => [v.dealNumber, v]));
    return new Response(
      JSON.stringify({
        filename: data.filename,
        fetchedAt: new Date(data.fetchedAt).toISOString(),
        entries: data.entries.map((e) => ({
          ...e,
          latestVerdict: verdictByDeal.get(e.dealNumber) ?? null,
        })),
        missingHeaders: data.missingHeaders,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  } catch (e) {
    console.log('[deal-tracker] load failed', { error: (e as Error).message });
    return new Response(
      JSON.stringify({ error: (e as Error).message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}
