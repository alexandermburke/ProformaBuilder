"use client";

import Link from "next/link";

const intakePoints = [
  {
    title: "Operating / trust bank activity",
    detail: "Statement or transaction export per account with running balance and dates.",
    fileTypes: "CSV / XLSX",
    cta: "Upload bank activity",
  },
  {
    title: "Corporate card activity",
    detail: "P-card or travel card exports with merchant, memo, and employee fields.",
    fileTypes: "CSV / XLSX",
    cta: "Upload card activity",
  },
  {
    title: "Reference mappings (optional)",
    detail: "Payee normalizations and GL/class crosswalks applied during mapping.",
    fileTypes: "CSV / XLSX",
    cta: "Upload reference data",
  },
  {
    title: "Exceptions log (optional)",
    detail: "Prior-period exceptions to suppress duplicates and overlaps.",
    fileTypes: "CSV",
    cta: "Upload exception log",
  },
];

const flowSteps = [
  {
    title: "Upload kits",
    description: "Bank, card, reference crosswalks, and exception log per run.",
  },
  {
    title: "Template select",
    description: "Choose saved mappings for each bank/card format.",
  },
  {
    title: "Field mapping",
    description: "Apply presets; override oddball headers inline.",
  },
  {
    title: "Validate",
    description: "Check periods, signs, duplicates, and header completeness.",
  },
  {
    title: "Export",
    description: "Yardi-ready CSVs + audit log with all normalization calls.",
  },
];

const guardrails = [
  "Period detection blocks overlapping statements",
  "Debit/credit sign checks by source type",
  "Header templates per bank/card exporter",
  "Duplicate and gap detection on dates + refs",
  "Audit log of every normalization and override",
];

const outputTiles = [
  {
    title: "Yardi imports",
    detail: "Cleaned CSVs for bank and card activity, split by account and source.",
    badge: "Primary",
  },
  {
    title: "Exception log",
    detail: "Duplicates, header gaps, sign errors, and period overlaps flagged with row context.",
    badge: "Review",
  },
  {
    title: "Mapping library",
    detail: "Reusable presets per bank/card exporter plus payee + GL crosswalks.",
    badge: "Templates",
  },
];

export default function BankCardImportPrepPage() {
  return (
    <div className="relative min-h-screen bg-[color:var(--surface)] text-[color:var(--text-primary)]">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_20%_10%,rgba(37,99,235,0.18),transparent_60%)] dark:bg-[radial-gradient(circle_at_18%_12%,rgba(59,130,246,0.22),transparent_62%)]" />
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_82%_86%,rgba(125,211,252,0.18),transparent_62%)] dark:bg-[radial-gradient(circle_at_84%_88%,rgba(56,189,248,0.22),transparent_62%)]" />

      <main className="relative mx-auto flex max-w-6xl flex-col gap-10 px-6 py-12 lg:gap-12 lg:px-10 lg:py-16">
        <header className="ios-card ios-animate-up grid gap-6 p-8">
          <div className="flex items-center justify-between gap-3">
            <span className="ios-badge inline-flex items-center gap-2 text-[10px]" data-tone="neutral">
              WIP / Coming Soon
            </span>
            <Link href="/" className="ios-button px-4 py-2 text-sm" data-variant="secondary">
              <span aria-hidden className="-ml-1 mr-1 text-base">&larr;</span>
              Back to directory
            </Link>
          </div>
          <div className="grid gap-4 md:flex md:items-end md:justify-between">
            <div className="space-y-2">
              <h1 className="text-3xl font-semibold leading-tight text-[color:var(--text-primary)]">
                Bank &amp; Card Import Prep
              </h1>
              <p className="text-base text-[color:var(--text-secondary)]">
                Clean, map, and validate bank and card spreadsheets with the same polish as Owner Reports—before you
                export to Yardi.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="ios-pill text-[11px]" data-tone="neutral">
                Multi-source intake
              </span>
              <span className="ios-pill text-[11px]" data-tone="neutral">
                Templates
              </span>
              <span className="ios-pill text-[11px]" data-tone="neutral">
                Validation-first
              </span>
            </div>
          </div>
        </header>

        <section className="grid gap-5 lg:grid-cols-5">
          <div className="ios-card ios-animate-up lg:col-span-3 p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-[color:var(--text-muted)]">Intake kits</p>
                <h2 className="text-lg font-semibold text-[color:var(--text-primary)]">Upload per source</h2>
                <p className="text-sm text-[color:var(--text-secondary)]">
                  Keep bank, card, and reference uploads discrete so mapping stays predictable.
                </p>
              </div>
              <span className="ios-badge inline-flex items-center gap-2 text-[10px]" data-tone="neutral">
                Uploads disabled (in build)
              </span>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {intakePoints.map((point) => (
                <div
                  key={point.title}
                  className="flex h-full min-h-[220px] flex-col gap-3 rounded-2xl border border-[color:var(--border-soft)]/70 bg-[color:var(--surface)]/85 p-4 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <p className="text-sm font-semibold text-[color:var(--text-primary)]">{point.title}</p>
                      <p className="text-xs text-[color:var(--text-secondary)]">{point.detail}</p>
                    </div>
                    <span className="ios-pill text-[10px]" data-tone="neutral">
                      {point.fileTypes}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="ios-button mt-auto w-full justify-center px-4 py-2 text-sm"
                    disabled
                    aria-disabled="true"
                  >
                    {point.cta}
                  </button>
                </div>
              ))}
            </div>
            <div className="mt-4 rounded-xl border border-[color:var(--border-soft)]/70 bg-[color:var(--surface)]/75 p-4 text-sm text-[color:var(--text-secondary)]">
              Separate uploads let us apply presets per bank/card exporter and reuse payee/GL crosswalks without
              collisions.
            </div>
          </div>

          <div className="lg:col-span-2 space-y-4">
            <div className="ios-card ios-animate-up p-6">
              <div className="space-y-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-[color:var(--text-muted)]">Flow</p>
                <h2 className="text-lg font-semibold text-[color:var(--text-primary)]">From intake to export</h2>
                <p className="text-sm text-[color:var(--text-secondary)]">
                  Mirrors the Owner Reports UX: clear steps, exception review, and log visibility.
                </p>
              </div>
              <div className="mt-4 space-y-3">
                {flowSteps.map((step, index) => (
                  <div
                    key={step.title}
                    className="flex items-start gap-3 rounded-lg border border-[color:var(--border-soft)]/70 bg-[color:var(--surface)]/75 px-3 py-2"
                  >
                    <span
                      className="flex h-7 w-7 items-center justify-center rounded-full bg-[rgba(37,99,235,0.12)] text-[12px] font-semibold text-[color:var(--accent-strong)]"
                      aria-hidden
                    >
                      {index + 1}
                    </span>
                    <div className="space-y-0.5">
                      <p className="text-sm font-semibold text-[color:var(--text-primary)]">{step.title}</p>
                      <p className="text-xs text-[color:var(--text-secondary)]">{step.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="ios-card ios-animate-up p-6">
              <div className="space-y-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-[color:var(--text-muted)]">
                  Outputs
                </p>
                <h2 className="text-lg font-semibold text-[color:var(--text-primary)]">What you get</h2>
              </div>
              <div className="mt-3 grid gap-3">
                {outputTiles.map((tile) => (
                  <div
                    key={tile.title}
                    className="rounded-lg border border-[color:var(--border-soft)]/70 bg-[color:var(--surface)]/75 p-4"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-[color:var(--text-primary)]">{tile.title}</p>
                      <span className="ios-pill text-[10px]" data-tone="neutral">
                        {tile.badge}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-[color:var(--text-secondary)]">{tile.detail}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-5 lg:grid-cols-3">
          <div className="ios-card ios-animate-up flex flex-col gap-3 p-6">
            <h3 className="text-lg font-semibold text-[color:var(--text-primary)]">Validation guardrails</h3>
            <p className="text-sm text-[color:var(--text-secondary)]">
              The checks mirror the rigor of Owner Reports: catch issues before the export step.
            </p>
            <ul className="space-y-2 text-sm text-[color:var(--text-secondary)]">
              {guardrails.map((item) => (
                <li key={item} className="flex items-start gap-2">
                  <span className="mt-1 h-1.5 w-1.5 rounded-full bg-[color:var(--accent-strong)]" aria-hidden />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="ios-card ios-animate-up flex flex-col gap-3 p-6">
            <h3 className="text-lg font-semibold text-[color:var(--text-primary)]">Exception review</h3>
            <p className="text-sm text-[color:var(--text-secondary)]">
              Duplicates, gaps, missing headers, and sign errors land here for quick triage before export.
            </p>
            <div className="rounded-xl border border-[color:var(--border-soft)]/70 bg-[color:var(--surface)]/80 p-4 text-sm text-[color:var(--text-primary)]">
              <p className="font-semibold">Preview</p>
              <p className="text-[color:var(--text-secondary)]">
                Exceptions feed the audit log so every normalization or override is traceable.
              </p>
            </div>
          </div>

          <div className="ios-card ios-animate-up flex flex-col gap-3 p-6">
            <h3 className="text-lg font-semibold text-[color:var(--text-primary)]">Status</h3>
            <p className="text-sm text-[color:var(--text-secondary)]">
              Upload controls stay disabled while we finalize templates and validation rules.
            </p>
            <div className="rounded-lg border border-[color:var(--border-soft)]/70 bg-[color:var(--surface)]/75 p-3 text-xs text-[color:var(--text-secondary)]">
              Coming: saved mapping sets, account-level presets, and export history.
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
