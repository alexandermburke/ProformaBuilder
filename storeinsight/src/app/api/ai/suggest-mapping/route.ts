// src/app/api/ai/suggest-mapping/route.ts
import { NextRequest } from 'next/server';

export const runtime = 'nodejs';

type RequiredField = 'Total Operating Income' | 'Total Operating Expense' | 'Facility' | 'Period';

type SuggestRequest = {
  headers: string[];
  required: RequiredField[];
  vendorHint?: string | null;
};

type SuggestResponse = {
  mapping: Record<RequiredField, string | null>;
};

function isRecord(u: unknown): u is Record<string, unknown> {
  return typeof u === 'object' && u !== null;
}

function isSuggestRequest(u: unknown): u is SuggestRequest {
  if (!u || typeof u !== 'object') return false;
  const o = u as Record<string, unknown>;
  return Array.isArray(o.headers) && Array.isArray(o.required);
}

export async function POST(req: NextRequest): Promise<Response> {
  const bodyUnknown = await req.json();
  if (!isSuggestRequest(bodyUnknown)) {
    return new Response(JSON.stringify({ error: 'Bad request' }), { status: 400 });
  }
  const body = bodyUnknown;

  const apiKey = process.env.OPENAI_KEY;
  if (!apiKey) {
    console.log('[ai] OPENAI_KEY missing');
    return new Response(JSON.stringify({ error: 'OPENAI_KEY missing' }), { status: 500 });
  }

  const model = process.env.OPENAI_MODEL ?? 'gpt-4o-mini'; // set OPENAI_MODEL=gpt-5 if available
  console.log('[ai] suggest-mapping start', { model, vendorHint: body.vendorHint });

  const system = [
    'You map spreadsheet column headers to target financial fields.',
    'Return strict JSON with keys exactly matching required fields.',
    'Only choose from provided headers; if none match, use null.',
  ].join(' ');

  const user = JSON.stringify({
    headers: body.headers,
    required: body.required,
    vendorHint: body.vendorHint ?? null,
  });

  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [
        { role: 'system', content: system },
        {
          role: 'user',
          content:
            'Choose the best header for each required field. Respond ONLY with JSON like {"mapping":{"Total Operating Income":"TOI",...}}. Input: ' +
            user,
        },
      ],
      response_format: { type: 'json_object' },
    }),
  });

  if (!resp.ok) {
    const txt = await resp.text();
    console.log('[ai] API error', { status: resp.status, txt });
    return new Response(JSON.stringify({ error: 'AI call failed' }), { status: 500 });
  }

  const dataUnknown = (await resp.json()) as unknown;

  // Narrow the JSON
  let mapping: Record<RequiredField, string | null> | null = null;

  const choice = isRecord(dataUnknown) && Array.isArray((dataUnknown as { choices?: unknown }).choices)
    ? ((dataUnknown as { choices: unknown[] }).choices[0] as unknown)
    : null;

  if (isRecord(choice)) {
    const msg = (choice as { message?: unknown }).message;
    if (isRecord(msg)) {
      const content = (msg as { content?: unknown }).content;
      if (typeof content === 'string') {
        try {
          const parsed = JSON.parse(content) as unknown;
          if (isRecord(parsed) && isRecord((parsed as { mapping?: unknown }).mapping)) {
            mapping = parsed.mapping as Record<RequiredField, string | null>;
          }
        } catch (e) {
          console.log('[ai] JSON parse failed', { e: (e as Error).message });
        }
      }
    }
  }

  if (!mapping) {
    return new Response(JSON.stringify({ error: 'Bad AI response' }), { status: 500 });
  }

  console.log('[ai] suggest-mapping result', mapping);

  const out: SuggestResponse = { mapping };
  return new Response(JSON.stringify(out), { status: 200, headers: { 'Content-Type': 'application/json' } });
}