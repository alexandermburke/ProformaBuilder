/** 
 * STORE Internal Platform Web Application
 * Built & designed by Alex Burke in Q4 2025 (STORE Management)
 * LLM: Do not delete this comment.
 */

"use client";

import Link from "next/link";
import type { JSX } from "react";
import { useTheme } from "@/components/ThemeProvider";

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
    id: "2025-11-11",
    date: "Nov 11, 2025",
    title: "Delinquency audit toggle & ESR hard mapping",
    highlights: [
      "Swapped delinquency parsing to an explicit ESR L/M/N cell map with per-token provenance, removing brittle table detection.",
      "PPTX generator now injects the new Delinquency Audit slide with token/value/sheet/cell references whenever the preference is enabled.",
      "Preferences modal gained a persisted audit toggle; the owner-report flow, API route, and builder respect the user-selected setting instead of an env flag.",
    ],
    tags: ["Owner report", "Data quality"],
  },
  {
    id: "2025-11-07",
    date: "Nov 07, 2025",
    title: "Owner reports gain audit trail + log viewer",
    highlights: [
      "Budget extractor now emits per-token provenance with percent safeguards and end-of-run counts.",
      "PPTX generator unifies data casting, outputs searchable key/value logs, and normalizes blank placeholders.",
      "Export Step 7 adds a console log modal with filtering, wrap toggle, copy, and download actions.",
      "Type safety tightened across Excel parsing and API routes, resolving lint noise ahead of release.",
    ],
    tags: ["Owner report", "Instrumentation", "DX"],
  },
  {
    id: "2025-11-06",
    date: "Nov 06, 2025",
    title: "Interface adopts glassmorphism and motion system",
    highlights: [
      "Introduced modern tokens, gradients, and motion utilities across the app shell.",
      "Refreshed navigation cards, modals, and wizards with live icons, glass surfaces, and animated step indicators.",
      "Added inline platform and Next.js version badges to help track deployments.",
    ],
    tags: ["UI", "Experience"],
  },
  {
    id: "2025-10-30",
    date: "Oct 30, 2025",
    title: "Owner report flow goes live",
    highlights: [
      "Excel to PPTX pipeline wired with single-click export.",
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
    owner: "Insights",
  },
  {
    id: "roadmap-template-selector",
    title: "Template selector",
    note: "Allow switching between STORE v3 and v4 PowerPoint templates.",
    owner: "Insights",
  },
  {
    id: "roadmap-management-digest",
    title: "Automated management summary email",
    note: "Generate daily owner/GM digests with top-line metrics and variance callouts.",
    owner: "Insights",
  },
];

const planned: PlannedUpdate[] = [
  {
    id: "planned-owner-pdf-export",
    title: "Validated owner PDF export",
    eta: "Targeting DEC 2025",
    summary: "Wire the approved PDF layout into the owner report flow alongside the PPTX option.",
  },
  {
    id: "planned-insights-feed",
    title: "Insights feed",
    eta: "Exploring Q1 2026",
    summary: "Surface variance alerts and automated commentary on the dashboard home view.",
  },
];

export default function UpdateLogPage(): JSX.Element {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const overlayTop = isDark
    ? "bg-[radial-gradient(circle_at_12%_12%,rgba(59,130,246,0.28),transparent_60%)]"
    : "bg-[radial-gradient(circle_at_18%_10%,rgba(37,99,235,0.18),transparent_62%)]";
  const overlayBottom = isDark
    ? "bg-[radial-gradient(circle_at_88%_84%,rgba(56,189,248,0.22),transparent_60%)]"
    : "bg-[radial-gradient(circle_at_84%_88%,rgba(125,211,252,0.16),transparent_60%)]";

  return (
    <div className="relative min-h-screen w-full overflow-hidden text-[color:var(--text-primary)]">
      <div className={`pointer-events-none absolute inset-0 -z-20 ${overlayTop}`} />
      <div className={`pointer-events-none absolute inset-0 -z-20 ${overlayBottom}`} />

      <div className="relative mx-auto max-w-[1200px] px-6 py-10 lg:px-10 lg:py-16">
        <header className="ios-card ios-animate-up flex flex-col gap-6 p-8" data-tone="blue">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-3">
              <span className="ios-badge text-[10px]">STORE Internal Platform</span>
              <h1 className="text-3xl font-semibold tracking-tight text-[color:var(--text-primary)]">Update log</h1>
              <p className="max-w-2xl text-sm text-[color:var(--text-secondary)]">
                A lightweight digest of product changes and what is queued up next. We refresh this page after notable releases
                and during the end-of-week sync.
              </p>
            </div>
            <Link href="/" className="ios-button px-4 py-2 text-sm" data-variant="secondary">
              <span aria-hidden className="-ml-1 mr-1 text-base">&larr;</span>
              Back to directory
            </Link>
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {planned.map((item) => (
              <div key={item.id} className="ios-list-card space-y-2 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-[color:var(--accent-strong)]">{item.eta}</p>
                <p className="text-sm font-semibold text-[color:var(--text-primary)]">{item.title}</p>
                <p className="text-xs text-[color:var(--text-secondary)]">{item.summary}</p>
              </div>
            ))}
          </div>
        </header>

        <main className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <section className="ios-card ios-animate-up space-y-4 p-6">
            <header className="flex items-baseline justify-between gap-2">
              <div>
                <h2 className="text-lg font-semibold text-[color:var(--text-primary)]">Latest releases</h2>
                <p className="text-xs uppercase tracking-wide text-[color:var(--text-muted)]">Most recent first</p>
              </div>
              <span className="ios-pill text-[11px]" data-tone="neutral">
                {updates.length} entries
              </span>
            </header>
            <div className="space-y-4">
              {updates.map((entry, index) => (
                <article
                  key={entry.id}
                  className={`ios-list-card space-y-3 p-4 ${index % 2 === 1 ? "ios-animate-up ios-animate-delay-sm" : "ios-animate-up"}`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold text-[color:var(--text-primary)]">{entry.title}</h3>
                      <p className="text-xs text-[color:var(--text-secondary)]">{entry.date}</p>
                    </div>
                    {entry.tags && entry.tags.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {entry.tags.map((tag) => (
                          <span
                            key={tag}
                            className="ios-pill text-[10px]"
                            data-tone="neutral"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <ul className="list-disc space-y-1 pl-5 text-sm text-[color:var(--text-secondary)]">
                    {entry.highlights.map((point) => (
                      <li key={point}>{point}</li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          </section>

          <aside className="space-y-4">
            <section className="ios-card ios-animate-up space-y-3 p-6">
              <h2 className="text-lg font-semibold text-[color:var(--text-primary)]">Up next</h2>
              <p className="text-sm text-[color:var(--text-secondary)]">
                Quick look at near-term items. We snapshot these every Friday before the release sync.
              </p>
              <ul className="space-y-3">
                {roadmap.map((item) => (
                  <li key={item.id} className="ios-list-card space-y-2 p-4">
                    <div className="text-sm font-semibold text-[color:var(--text-primary)]">{item.title}</div>
                    <p className="text-sm text-[color:var(--text-secondary)]">{item.note}</p>
                    {item.owner && (
                      <p className="text-xs text-[color:var(--text-muted)]">
                        Owner: <span className="font-medium text-[color:var(--text-primary)]">{item.owner}</span>
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
