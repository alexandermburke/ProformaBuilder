"use client";

import Link from "next/link";

type UpdateItem = {
  id: string;
  date: string;
  title: string;
  highlights: string[];
  tags?: string[];
};

type RoadmapItem = {
  id: string;
  title: string;
  note: string;
  owner?: string;
};

type PlannedUpdate = {
  id: string;
  title: string;
  eta: string;
  summary: string;
};

const updates: UpdateItem[] = [
  {
    id: "2025-10-30",
    date: "Oct 30, 2025",
    title: "Owner report flow goes live",
    highlights: [
      "Excel > PPTX pipeline wired with single-click export.",
      "Field overrides, validation, and download recap added to the flow.",
      "Docxtemplater safeguards normalize tokens coming from PPT design.",
    ],
    tags: ["Owner report", "Automation"],
  },
  {
    id: "2025-10-18",
    date: "Oct 18, 2025",
    title: "UI refresh and rails",
    highlights: [
      "Gradient layout rolled out across wizard surfaces.",
      "Sidebar quick actions updated with production copy.",
    ],
    tags: ["UI"],
  },
  {
    id: "2025-09-29",
    date: "Sep 29, 2025",
    title: "Upload detection polish",
    highlights: [
      "Filename date heuristics tuned for ISO and MMDDYYYY formats.",
      "Core totals backfilled when labels are missing from vendor exports.",
    ],
    tags: ["Parsing"],
  },
];

const roadmap: RoadmapItem[] = [
  {
    id: "roadmap-owner-pdf",
    title: "Owner PDF layout",
    note: "Finalize the PDF design pass and hook into the export step.",
    owner: "Design & Engineering",
  },
  {
    id: "roadmap-template-selector",
    title: "Template selector",
    note: "Allow switching between STORE v3/v4 PowerPoint templates.",
    owner: "Engineering",
  },
  {
    id: "roadmap-automation-tuning",
    title: "Automation toggles",
    note: "Expose auto-map and facility detection switches in the wizard sidebar.",
    owner: "Product",
  },
];

const planned: PlannedUpdate[] = [
  {
    id: "planned-owner-pdf-export",
    title: "Owner PDF export",
    eta: "Targeting Nov 2025",
    summary: "Wire the approved PDF layout into the owner report flow alongside the PPTX option.",
  },
  {
    id: "planned-insights-feed",
    title: "Insights feed",
    eta: "Exploring Q1 2026",
    summary: "Surface variance alerts and automated commentary on the dashboard home view.",
  },
];

export default function UpdateLogPage() {
  return (
    <div className="relative min-h-screen w-full bg-gradient-to-br from-[#EEF2FF] via-[#F8FAFF] to-[#E0F2FE] text-[#0B1120]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(37,99,235,0.12),transparent_55%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_bottom_right,rgba(56,189,248,0.14),transparent_60%)]" />

      <div className="relative mx-auto max-w-[1200px] px-6 py-10 lg:px-10 lg:py-16">
        <header className="flex flex-col gap-6 rounded-2xl border border-white/30 bg-white/90 p-8 shadow-xl backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.35em] text-[#2563EB]">Store insight</p>
              <h1 className="text-3xl font-semibold tracking-tight text-[#0B1120]">Update Log</h1>
              <p className="mt-2 max-w-2xl text-sm text-[#4B5563]">
                A lightweight digest of product changes and what is queued up next. We refresh this page after each notable
                release and during the end-of-week sync.
              </p>
            </div>
            <Link
              href="/"
              className="inline-flex items-center gap-2 rounded-full border border-[#CBD5F5] bg-white px-4 py-2 text-sm font-medium text-[#1E3A8A] transition hover:border-[#2563EB] hover:bg-[#EEF2FF]"
            >
              <span aria-hidden>←</span> Back to dashboard
            </Link>
          </div>
        </header>

        <main className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <section className="space-y-4 rounded-2xl border border-white/25 bg-white/95 p-6 shadow-lg backdrop-blur">
            <header className="flex items-baseline justify-between gap-2">
              <div>
                <h2 className="text-lg font-semibold text-[#0B1120]">Latest releases</h2>
                <p className="text-xs uppercase tracking-wide text-[#9CA3AF]">Most recent first</p>
              </div>
              <span className="rounded-full bg-[#EEF2FF] px-3 py-1 text-xs font-semibold text-[#1E40AF]">
                {updates.length} entries
              </span>
            </header>

            <div className="space-y-4">
              {updates.map((entry) => (
                <article
                  key={entry.id}
                  className="rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] p-4 shadow-sm transition hover:border-[#CBD5F5] hover:shadow-md"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="text-[15px] font-semibold text-[#111827]">{entry.title}</h3>
                      <p className="text-xs text-[#6B7280]">{entry.date}</p>
                    </div>
                    {entry.tags && entry.tags.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {entry.tags.map((tag) => (
                          <span
                            key={tag}
                            className="inline-flex items-center rounded-full bg-[#EEF2FF] px-2 py-0.5 text-[11px] font-medium text-[#1D4ED8]"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
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

          <aside className="space-y-4">
            <section className="rounded-2xl border border-white/25 bg-white/95 p-6 shadow-lg backdrop-blur">
              <h2 className="text-lg font-semibold text-[#0B1120]">Up next</h2>
              <p className="mt-1 text-sm text-[#4B5563]">
                Quick look at near-term items. We snapshot these every Friday before the release sync.
              </p>
              <ul className="mt-4 space-y-3">
                {roadmap.map((item) => (
                  <li key={item.id} className="rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] p-4">
                    <div className="text-[15px] font-semibold text-[#111827]">{item.title}</div>
                    <p className="mt-1 text-sm text-[#4B5563]">{item.note}</p>
                    {item.owner && (
                      <p className="mt-2 text-xs text-[#6B7280]">
                        Owner: <span className="font-medium text-[#1F2937]">{item.owner}</span>
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          </aside>
        </main>
      </div>
    </div>
  );
}
