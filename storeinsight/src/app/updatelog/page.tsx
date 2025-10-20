'use client';

import Link from 'next/link';
import type { JSX } from 'react';

type TodoItem = {
  id: string;
  title: string;
  description: string;
  owner?: string;
  status: 'planned' | 'in-progress' | 'blocked';
};

type UpdateEntry = {
  id: string;
  date: string;
  title: string;
  highlights: string[];
  tags: string[];
};

const todoList: TodoItem[] = [
  {
    id: 'todo-automation-toggles',
    title: 'Expose automation toggles in UI',
    description: 'Surface auto-map and facility detection switches so analysts can adjust thresholds without digging into settings.',
    owner: 'Product',
    status: 'in-progress',
  },
  {
    id: 'todo-export-pdf',
    title: 'Owner PDF export',
    description: 'Replace placeholder alert with the actual PDF template pipeline once design signs off on the layout.',
    owner: 'Engineering',
    status: 'planned',
  },
  {
    id: 'todo-validation-report',
    title: 'Validation detail report',
    description: 'Collect per-line validation issues and show them inline before Generate, mirroring what QA tracks manually.',
    owner: 'QA',
    status: 'planned',
  },
  {
    id: 'todo-template-selector',
    title: 'Template selector',
    description: 'Support multiple proforma templates (STORE v3/v4) with a simple dropdown and persisted preference.',
    owner: 'Engineering',
    status: 'blocked',
  },
];

const updateEntries: UpdateEntry[] = [
  {
    id: 'update-2025-08-26',
    date: 'Aug 26, 2025',
    title: 'Wizard guidance & export polish',
    highlights: [
      'Added per-step guidance cards so analysts always know the next action.',
      'Surfaced NOI metrics and trend cards before export for a quick smell test.',
      'Expanded sidebar with automation health and an export checklist.',
    ],
    tags: ['UI', 'Guidance', 'Export'],
  },
  {
    id: 'update-2025-08-12',
    date: 'Aug 12, 2025',
    title: 'Snapshot rail & Firestore sync',
    highlights: [
      'Hooked the right rail into Firestore for live snapshot listings.',
      'Added optimistic updates after Generate to keep momentum.',
    ],
    tags: ['Realtime', 'Snapshots'],
  },
  {
    id: 'update-2025-08-01',
    date: 'Aug 1, 2025',
    title: 'Auto-mapping refresh',
    highlights: [
      'Improved vendor detection heuristics using filename hints.',
      'Learned header mappings persist to local storage for faster follow-up imports.',
    ],
    tags: ['Automation'],
  },
];

const statusStyles: Record<TodoItem['status'], string> = {
  'in-progress': 'bg-[#FDE68A] text-[#92400E]',
  planned: 'bg-[#E5E7EB] text-[#374151]',
  blocked: 'bg-[#FEE2E2] text-[#B91C1C]',
};

function StatusPill(props: { label: string; tone?: TodoItem['status'] }): JSX.Element {
  const tone = props.tone ?? 'planned';
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${statusStyles[tone]}`}>
      {props.label}
    </span>
  );
}

function TagPill(props: { label: string }): JSX.Element {
  return (
    <span className="inline-flex items-center rounded-full bg-[#EEF2FF] px-2 py-0.5 text-[11px] font-medium text-[#1D4ED8]">
      {props.label}
    </span>
  );
}

export default function UpdateLogPage(): JSX.Element {
  return (
    <div className="min-h-screen w-full bg-white text-[#111827]">
      <div className="mx-auto max-w-[1200px] p-6">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="text-[26px] font-semibold tracking-tight">Update Log</div>
            <div className="mt-1 text-sm text-[#6B7280]">
              Track what shipped recently and what is queued up next for the STORE report builder.
            </div>
          </div>
          <Link
            href="/"
            className="inline-flex items-center rounded-lg border border-[#D1D5DB] px-3 py-2 text-sm text-[#1D4ED8] hover:bg-[#EEF2FF]"
          >
            ← Back to Create Report
          </Link>
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-6">
            <section className="rounded-[14px] border border-[#E5E7EB] bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <div className="text-[17px] font-semibold">To-do</div>
                  <div className="text-xs uppercase tracking-wide text-[#9CA3AF]">Short horizon roadmap</div>
                </div>
                <StatusPill label={`${todoList.length} Items`} />
              </div>

              <ul className="space-y-4">
                {todoList.map((item) => (
                  <li key={item.id} className="rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="text-[15px] font-semibold text-[#111827]">{item.title}</div>
                      <StatusPill label={item.status.replace('-', ' ')} tone={item.status} />
                    </div>
                    <p className="mt-2 text-sm text-[#4B5563]">{item.description}</p>
                    <div className="mt-3 text-xs text-[#6B7280]">
                      Owner: <span className="font-medium text-[#1F2937]">{item.owner ?? 'Unassigned'}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            <section className="rounded-[14px] border border-[#E5E7EB] bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <div className="text-[17px] font-semibold">Update log</div>
                  <div className="text-xs uppercase tracking-wide text-[#9CA3AF]">Recent releases</div>
                </div>
              </div>

              <div className="space-y-5">
                {updateEntries.map((entry) => (
                  <article key={entry.id} className="rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="text-sm font-semibold text-[#111827]">{entry.title}</div>
                        <div className="text-xs text-[#6B7280]">{entry.date}</div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {entry.tags.map((tag) => (
                          <TagPill key={tag} label={tag} />
                        ))}
                      </div>
                    </div>
                    <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-[#4B5563]">
                      {entry.highlights.map((point) => (
                        <li key={point}>{point}</li>
                      ))}
                    </ul>
                  </article>
                ))}
              </div>
            </section>
          </div>

          <aside className="space-y-6">
            <section className="rounded-[14px] border border-[#E5E7EB] bg-white p-5 shadow-sm">
              <div className="text-[15px] font-semibold">Change review cadence</div>
              <p className="mt-2 text-sm text-[#4B5563]">
                We snapshot changes weekly on Fridays. If you land a major feature outside of that window,
                drop a note in <span className="font-medium text-[#1D4ED8]">#store-release</span> so we can
                update the log promptly.
              </p>
              <div className="mt-4 rounded-lg border border-dashed border-[#DBEAFE] bg-[#F8FBFF] p-4 text-xs text-[#1E40AF]">
                <div className="font-medium uppercase tracking-wide">Next sync</div>
                <div className="mt-1 text-sm text-[#1F2937]">Friday @ 4:00 PM ET</div>
                <p className="mt-2 leading-snug text-[#1E40AF]">
                  Agenda: owner PDF scope review, template selector feasibility, automation toggle UX.
                </p>
              </div>
            </section>

            <section className="rounded-[14px] border border-[#E5E7EB] bg-white p-5 shadow-sm">
              <div className="text-[15px] font-semibold">Changelog tips</div>
              <ul className="mt-3 list-disc space-y-2 pl-5 text-[13px] text-[#4B5563]">
                <li>Group related updates so the list stays skimmable.</li>
                <li>Call out analyst-facing wins; infra tweaks can sit in Git history.</li>
                <li>Include tags to help search later.</li>
              </ul>
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}
