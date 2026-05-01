import { NextRequest } from 'next/server';
import {
  buildAnalysisPrompt,
  parseAnalysisJson,
  summarizeWorkbook,
  type WorkbookSummary,
} from '@/lib/dealAnalysis';
import {
  formatTrackerEntryForPrompt,
  parseDealTrackerWorkbook,
  type DealTrackerEntry,
} from '@/lib/dealTracker';
import { downloadDriveItem, resolveSharedDriveItem } from '@/lib/graph';
import { saveDealAnalysisRun } from '@/lib/dealAnalysisStore';
import { writeAiVerdictToTracker } from '@/lib/dealTrackerWrite';

export const runtime = 'nodejs';

function isRecord(u: unknown): u is Record<string, unknown> {
  return typeof u === 'object' && u !== null;
}

async function loadTrackerEntry(dealNumber: string): Promise<DealTrackerEntry | null> {
  const shareUrl = process.env.MS_DEAL_TRACKER_SHARE_URL;
  if (!shareUrl) return null;
  const ref = await resolveSharedDriveItem(shareUrl);
  const buffer = await downloadDriveItem(ref);
  const parsed = parseDealTrackerWorkbook(buffer);
  return parsed.entries.find((e) => e.dealNumber === dealNumber) ?? null;
}

export async function POST(req: NextRequest): Promise<Response> {
  const form = await req.formData();
  const file = form.get('file');
  const notes = form.get('notes');
  const dealIdValue = form.get('dealId');
  const dealId = typeof dealIdValue === 'string' ? dealIdValue.trim() : '';
  const notesText = typeof notes === 'string' ? notes.trim() : '';
  const hasFile = file instanceof File && file.size > 0;

  if (!hasFile && !dealId) {
    return new Response(
      JSON.stringify({ error: 'Provide a tracker deal id or upload a workbook (or both).' }),
      { status: 400 },
    );
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'OPENAI_API_KEY missing' }), { status: 500 });
  }

  let summary: WorkbookSummary | null = null;
  if (hasFile) {
    try {
      const buffer = Buffer.from(await (file as File).arrayBuffer());
      summary = summarizeWorkbook(buffer, (file as File).name);
    } catch (e) {
      console.log('[deal-analysis] parse failed', { e: (e as Error).message });
      return new Response(JSON.stringify({ error: 'Could not parse workbook' }), { status: 400 });
    }
  }

  let trackerEntry: DealTrackerEntry | null = null;
  if (dealId) {
    try {
      trackerEntry = await loadTrackerEntry(dealId);
    } catch (e) {
      console.log('[deal-analysis] tracker fetch failed', { e: (e as Error).message });
      return new Response(
        JSON.stringify({ error: 'Could not fetch deal tracker from SharePoint.' }),
        { status: 502 },
      );
    }
    if (!trackerEntry) {
      return new Response(
        JSON.stringify({ error: `Deal #${dealId} not found in tracker.` }),
        { status: 404 },
      );
    }
  }

  // Deal Analysis is locked to gpt-5.5 by design. Do not switch back to
  // smaller models or read this from env — the smaller models produce
  // materially worse pursue/pass calls for this use case.
  const model = 'gpt-5.5';
  const { system, user } = buildAnalysisPrompt({
    summary,
    trackerContext: trackerEntry ? formatTrackerEntryForPrompt(trackerEntry) : null,
    notes: notesText,
  });

  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      response_format: { type: 'json_object' },
    }),
  });

  if (!resp.ok) {
    const txt = await resp.text();
    console.log('[deal-analysis] openai error', { status: resp.status, txt });
    return new Response(JSON.stringify({ error: 'AI call failed' }), { status: 500 });
  }

  const dataUnknown = (await resp.json()) as unknown;
  const choice =
    isRecord(dataUnknown) && Array.isArray((dataUnknown as { choices?: unknown }).choices)
      ? ((dataUnknown as { choices: unknown[] }).choices[0] as unknown)
      : null;
  const content =
    isRecord(choice) && isRecord((choice as { message?: unknown }).message)
      ? ((choice as { message: { content?: unknown } }).message.content as unknown)
      : null;
  if (typeof content !== 'string') {
    return new Response(JSON.stringify({ error: 'Bad AI response' }), { status: 500 });
  }
  const analysis = parseAnalysisJson(content);
  if (!analysis) {
    return new Response(JSON.stringify({ error: 'Bad AI response' }), { status: 500 });
  }

  let savedRunId: string | null = null;
  let writeBackError: string | null = null;
  if (trackerEntry) {
    try {
      const stored = await saveDealAnalysisRun({
        dealNumber: trackerEntry.dealNumber,
        facilityName: trackerEntry.facilityName,
        dealType: trackerEntry.dealType,
        modelUsed: model,
        inputs: {
          hasTrackerEntry: true,
          workbookFilename: summary?.filename ?? null,
          notes: notesText,
        },
        analysis,
      });
      savedRunId = stored.runId;
      const origin =
        process.env.PUBLIC_BASE_URL?.replace(/\/+$/, '') ?? req.nextUrl.origin;
      const analysisLink = `${origin}/deal-analysis/${encodeURIComponent(trackerEntry.dealNumber)}`;
      try {
        await writeAiVerdictToTracker({
          dealNumber: trackerEntry.dealNumber,
          recommendation: analysis.recommendation,
          confidence: analysis.confidence,
          runAtIso: stored.createdAt,
          analysisLink,
        });
      } catch (e) {
        writeBackError = (e as Error).message;
        console.log('[deal-analysis] tracker write-back failed', { error: writeBackError });
      }
    } catch (e) {
      console.log('[deal-analysis] firestore save failed', { error: (e as Error).message });
    }
  }

  return new Response(
    JSON.stringify({
      analysis,
      sheets: summary ? summary.sheets.map((s) => ({ name: s.name, rows: s.rows, cols: s.cols })) : [],
      tracker: trackerEntry
        ? {
            dealNumber: trackerEntry.dealNumber,
            facilityName: trackerEntry.facilityName,
            dealType: trackerEntry.dealType,
            dealStatus: trackerEntry.dealStatus,
          }
        : null,
      savedRunId,
      writeBackError,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}
