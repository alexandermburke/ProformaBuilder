'use client';

import type { JSX } from 'react';

export type Analysis = {
  recommendation: 'pursue' | 'pass' | 'investigate';
  confidence: 'low' | 'medium' | 'high';
  summary: string;
  strengths: string[];
  concerns: string[];
  keyMetrics: { label: string; value: string }[];
  followUps: string[];
};

const recColor: Record<Analysis['recommendation'], string> = {
  pursue: 'bg-emerald-600 text-white border-emerald-700 dark:bg-emerald-500 dark:border-emerald-400',
  pass: 'bg-rose-600 text-white border-rose-700 dark:bg-rose-500 dark:border-rose-400',
  investigate: 'bg-sky-600 text-white border-sky-700 dark:bg-sky-500 dark:border-sky-400',
};

const recLabel: Record<Analysis['recommendation'], string> = {
  pursue: 'Pursue',
  pass: 'Pass',
  investigate: 'Investigate further',
};

export function VerdictPill({
  recommendation,
}: {
  recommendation: Analysis['recommendation'];
}): JSX.Element {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wide ${recColor[recommendation]}`}
    >
      {recLabel[recommendation]}
    </span>
  );
}

export function AnalysisDisplay({
  analysis,
  sheets,
  trackerHeader,
}: {
  analysis: Analysis;
  sheets?: { name: string; rows: number; cols: number }[];
  trackerHeader?: { dealNumber: string; facilityName: string; dealType?: string; dealStatus?: string } | null;
}): JSX.Element {
  return (
    <section className="ios-card ios-animate-up flex flex-col gap-6 p-8">
      <div className="rounded-2xl border border-slate-300 bg-slate-100 p-3 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-100">
        <strong>LLM-inferred output.</strong> All values below including the recommendation, key
        metrics, strengths, and concerns are produced by an LLM from a tracker row and (if
        provided) a truncated workbook preview. They are <em>not</em> directly extracted from named
        cells. Verify against the source tracker and workbook before acting.
      </div>
      {trackerHeader ? (
        <div className="text-xs text-[color:var(--text-secondary)]">
          Analyzed:{' '}
          <span className="font-medium text-[color:var(--text-primary)]">
            #{trackerHeader.dealNumber} — {trackerHeader.facilityName}
          </span>
          {trackerHeader.dealType ? ` · ${trackerHeader.dealType}` : ''}
          {trackerHeader.dealStatus ? ` · ${trackerHeader.dealStatus}` : ''}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <VerdictPill recommendation={analysis.recommendation} />
        <span className="text-xs uppercase tracking-wide text-[color:var(--text-secondary)]">
          Confidence: {analysis.confidence}
        </span>
      </div>

      <p className="text-sm leading-relaxed text-[color:var(--text-primary)] sm:text-base">
        {analysis.summary}
      </p>

      {analysis.keyMetrics.length > 0 ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {analysis.keyMetrics.map((m) => (
            <div
              key={m.label}
              className="rounded-2xl border border-[color:var(--border-soft)] bg-[color:var(--surface)] p-4"
            >
              <div className="text-xs uppercase tracking-wide text-[color:var(--text-secondary)]">
                {m.label}
              </div>
              <div className="mt-1 text-base font-semibold text-[color:var(--text-primary)]">
                {m.value}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <BulletList title="Strengths" items={analysis.strengths} tone="emerald" />
        <BulletList title="Concerns" items={analysis.concerns} tone="rose" />
      </div>

      {analysis.followUps.length > 0 ? (
        <BulletList title="Suggested follow-ups" items={analysis.followUps} tone="sky" />
      ) : null}

      {sheets && sheets.length > 0 ? (
        <details className="text-xs text-[color:var(--text-secondary)]">
          <summary className="cursor-pointer">Sheets parsed ({sheets.length})</summary>
          <ul className="mt-2 list-disc pl-5">
            {sheets.map((s) => (
              <li key={s.name}>
                {s.name} — {s.rows} rows × {s.cols} cols
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

function BulletList({
  title,
  items,
  tone,
}: {
  title: string;
  items: string[];
  tone: 'emerald' | 'rose' | 'sky';
}): JSX.Element {
  const dot =
    tone === 'emerald'
      ? 'bg-emerald-500'
      : tone === 'rose'
        ? 'bg-rose-500'
        : 'bg-sky-500';
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold text-[color:var(--text-primary)]">{title}</h3>
      {items.length === 0 ? (
        <p className="text-xs text-[color:var(--text-secondary)]">None reported.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((item, i) => (
            <li key={i} className="flex gap-2 text-sm text-[color:var(--text-primary)]">
              <span className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
