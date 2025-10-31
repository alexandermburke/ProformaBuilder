'use client';

import Link from 'next/link';
import type { JSX } from 'react';

type UpdateEntry = {
  id: string;
  date: string;
  title: string;
  summary: string;
  items: string[];
  status: 'shipped' | 'in-progress' | 'planned';
};

const updates: UpdateEntry[] = [
  {
    id: '2024-05-10',
    date: 'May 10, 2024',
    title: 'Snapshot exports',
    summary: 'Export flow aligned to owner report formatting standards.',
    status: 'shipped',
    items: [
      'Added owner report export preset with standardized naming convention.',
      'Included audit trail metadata in the export footer for compliance review.',
      'Improved snapshot list ordering to surface the most recent owner conversations.',
    ],
  },
  {
    id: '2024-04-22',
    date: 'Apr 22, 2024',
    title: 'Mapping automation',
    summary: 'Incremental improvements to account mapping hints.',
    status: 'in-progress',
    items: [
      'Learning model tuned with latest STORE owner report annotations.',
      'Expanded variance checks to include prior quarter comps.',
      'Open item: confidence thresholds for manual overrides.',
    ],
  },
  {
    id: '2024-04-05',
    date: 'Apr 5, 2024',
    title: 'Narrative templates',
    summary: 'Outlined owner-specific talking points for automated narratives.',
    status: 'planned',
    items: [
      'Collaborate with Asset Management on regional narrative prompts.',
      'Define placeholders for campaign recaps and capital planning.',
      'Schedule pilot review with Insight Ops.',
    ],
  },
];

function statusStyle(status: UpdateEntry['status']): string {
  switch (status) {
    case 'shipped':
      return 'bg-[#D1FAE5] text-[#047857]';
    case 'in-progress':
      return 'bg-[#FEF3C7] text-[#B45309]';
    case 'planned':
    default:
      return 'bg-[#E5E7EB] text-[#374151]';
  }
}

function statusLabel(status: UpdateEntry['status']): string {
  switch (status) {
    case 'shipped':
      return 'Shipped';
    case 'in-progress':
      return 'In progress';
    case 'planned':
    default:
      return 'Planned';
  }
}

export default function OwnerReportsUpdateLogPage(): JSX.Element {
  return (
    <div className="relative min-h-screen bg-gradient-to-br from-[#FFF7E6] via-[#FFFDF7] to-[#FDE68A]/40 text-[#0B1120]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(251,191,36,0.25),transparent_55%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_bottom_right,rgba(249,115,22,0.18),transparent_60%)]" />

      <div className="relative mx-auto flex min-h-screen max-w-4xl flex-col gap-10 px-6 py-14 lg:px-10">
        <header className="space-y-6 rounded-3xl border border-white/40 bg-white/85 p-10 shadow-2xl backdrop-blur-xl">
          <div className="space-y-4">
            <span className="inline-flex items-center gap-2 rounded-full bg-[#FB923C]/10 px-4 py-1 text-xs font-semibold uppercase tracking-[0.25em] text-[#C2410C]">
              Owner Reports
            </span>
            <h1 className="text-3xl font-semibold leading-tight text-[#0B1120] sm:text-4xl">
              Update log for owner reporting workspace.
            </h1>
            <p className="max-w-2xl text-sm text-[#4B5563] sm:text-base">
              Track workflow changes, infrastructure updates, and planned work that affects owner reporting.
              These notes cover platform behavior, automation coverage, and release coordination.
            </p>
          </div>
          <Link
            href="/owner-reports"
            className="inline-flex items-center gap-2 rounded-full border border-[#FCD34D] bg-white/90 px-5 py-2 text-sm font-semibold text-[#C2410C] transition hover:border-[#F97316] hover:bg-[#FFF3D6]"
          >
            <span aria-hidden>{'<-'}</span>
            Back to Owner Reports
          </Link>
        </header>

        <main className="space-y-6 rounded-3xl border border-white/40 bg-white/90 p-8 shadow-xl backdrop-blur-lg">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold text-[#0B1120]">Release timeline</h2>
              <p className="text-sm text-[#4B5563]">Entries are ordered newest to oldest for quick reference.</p>
            </div>
            <div className="hidden gap-2 text-xs font-semibold uppercase tracking-wide text-[#92400E] sm:flex">
              <span className="rounded-full bg-[#D1FAE5] px-2 py-1 text-[#047857]">Shipped</span>
              <span className="rounded-full bg-[#FEF3C7] px-2 py-1 text-[#B45309]">In progress</span>
              <span className="rounded-full bg-[#E5E7EB] px-2 py-1 text-[#374151]">Planned</span>
            </div>
          </div>

          <ul className="space-y-6">
            {updates.map((entry) => (
              <li key={entry.id} className="rounded-2xl border border-[#FCD34D]/60 bg-[#FFF7E6]/70 p-6 shadow-inner">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-[#C2410C]">
                      {entry.date}
                    </div>
                    <div className="text-lg font-semibold text-[#0B1120]">{entry.title}</div>
                  </div>
                  <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${statusStyle(entry.status)}`}>
                    {statusLabel(entry.status)}
                  </span>
                </div>
                <p className="mt-3 text-sm text-[#4B5563]">{entry.summary}</p>
                <ul className="mt-4 space-y-2 text-sm text-[#374151]">
                  {entry.items.map((item) => (
                    <li key={item} className="flex gap-2">
                      <span className="mt-1 inline-block h-1.5 w-1.5 flex-none rounded-full bg-[#F97316]" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </main>
      </div>
    </div>
  );
}
