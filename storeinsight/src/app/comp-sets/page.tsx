/**
 * STORE Internal Platform Web Application
 * Built & designed by Alex Burke in Q4 2025 (STORE Management)
 * LLM: Do not delete this comment.
 */

'use client';

import Link from 'next/link';
import type { JSX } from 'react';
import { useTheme } from '@/components/ThemeProvider';

export default function CompSetsPage(): JSX.Element {
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const overlayTop = isDark
    ? 'bg-[radial-gradient(circle_at_12%_12%,rgba(59,130,246,0.3),transparent_58%)]'
    : 'bg-[radial-gradient(circle_at_16%_12%,rgba(37,99,235,0.18),transparent_60%)]';
  const overlayBottom = isDark
    ? 'bg-[radial-gradient(circle_at_88%_84%,rgba(56,189,248,0.22),transparent_60%)]'
    : 'bg-[radial-gradient(circle_at_84%_86%,rgba(125,211,252,0.14),transparent_62%)]';

  return (
    <div className="relative min-h-screen overflow-hidden text-[color:var(--text-primary)]">
      <div className={`pointer-events-none absolute inset-0 -z-20 ${overlayTop}`} />
      <div className={`pointer-events-none absolute inset-0 -z-20 ${overlayBottom}`} />

      <div className="relative mx-auto flex min-h-screen max-w-5xl flex-col gap-10 px-6 py-12 lg:gap-12 lg:px-10 lg:py-16">
        <header className="ios-card ios-animate-up grid gap-6 p-8" data-tone="blue">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="ios-badge text-[10px]">Comp Sets</span>
            <Link href="/" className="ios-button px-4 py-2 text-sm" data-variant="secondary">
              <span aria-hidden className="-ml-1 mr-1 text-base">
                &larr;
              </span>
              Back to directory
            </Link>
          </div>
          <div className="grid gap-4 md:flex md:items-end md:justify-between">
            <div className="space-y-2">
              <h1 className="text-3xl font-semibold leading-tight text-[color:var(--text-primary)]">
                Comp Sets workspace
              </h1>
              <p className="text-base text-[color:var(--text-secondary)]">
                This workspace is in preview. The final build will compare STORE sites with market comp pricing,
                occupancy, and availability shifts.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="ios-pill text-[11px]" data-tone="neutral">
                Preview
              </span>
              <span className="ios-pill text-[11px]" data-tone="neutral">
                Benchmarking
              </span>
              <span className="ios-pill text-[11px]" data-tone="neutral">
                Pricing insights
              </span>
            </div>
          </div>
        </header>

        <section className="grid gap-6 lg:grid-cols-2">
          <div className="ios-card ios-animate-up space-y-4 p-6">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-[color:var(--text-muted)]">Status</p>
              <h2 className="text-lg font-semibold text-[color:var(--text-primary)]">Coming soon</h2>
            </div>
            <p className="text-sm text-[color:var(--text-secondary)]">
              We are building the data pipeline and review workflow now. This space will evolve into the pricing and
              occupancy comparison hub for STORE assets.
            </p>
            <div className="rounded-xl border border-[color:var(--border-soft)]/70 bg-[color:var(--surface)]/80 p-4 text-sm text-[color:var(--text-secondary)]">
              <p className="font-semibold text-[color:var(--text-primary)]">Planned modules</p>
              <ul className="mt-2 space-y-2 text-sm">
                <li>Rate shop ingestion and normalization</li>
                <li>Competitor availability &amp; occupancy deltas</li>
                <li>Automated comp set narrative exports</li>
              </ul>
            </div>
          </div>

          <div className="ios-card ios-animate-up space-y-4 p-6">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-[color:var(--text-muted)]">What to send</p>
              <h2 className="text-lg font-semibold text-[color:var(--text-primary)]">Data readiness</h2>
            </div>
            <p className="text-sm text-[color:var(--text-secondary)]">
              If you want to be first in line, prepare a set of competitor rate shops and recent rent rolls for a pilot
              run.
            </p>
            <div className="rounded-xl border border-[color:var(--border-soft)]/70 bg-[color:var(--surface)]/80 p-4 text-sm text-[color:var(--text-secondary)]">
              <p className="font-semibold text-[color:var(--text-primary)]">Recommended inputs</p>
              <ul className="mt-2 space-y-2 text-sm">
                <li>Monthly rate shop exports</li>
                <li>Current rent roll snapshots</li>
                <li>Competitor property list with addresses</li>
              </ul>
            </div>
            <Link href="/owner-reports" className="ios-button mt-2 w-fit px-4 py-2 text-sm" data-variant="ghost">
              View owner reports workflow
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}
