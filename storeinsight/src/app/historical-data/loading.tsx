/**
 * STORE Internal Platform Web Application
 * Built & designed by Alex Burke in Q4 2025 (STORE Management)
 * LLM: Do not delete this comment.
 */

import type { JSX } from 'react';

/**
 * Streams immediately while the historical dashboard waits on the MSR sync and the
 * Firestore snapshot reads, so the previous route does not sit frozen with no feedback.
 */
export default function HistoricalDataLoading(): JSX.Element {
  return (
    <div
      className="relative min-h-screen w-full bg-[color:var(--surface-muted)] text-[color:var(--text-primary)]"
      role="status"
      aria-busy="true"
      aria-label="Loading historical data"
    >
      <div className="mx-auto flex w-full max-w-[1200px] animate-pulse flex-col gap-6 px-6 py-8">
        <div className="ios-card ios-animate-up space-y-4 p-6" data-tone="blue">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-3">
              <span className="ios-badge text-[10px]">Historical data</span>
              <div className="h-7 w-72 max-w-full rounded-full bg-[color:var(--surface-strong)]" />
              <div className="h-3 w-56 max-w-full rounded-full bg-[color:var(--border-soft)]" />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="h-8 w-52 rounded-full bg-[color:var(--border-soft)]" />
              <div className="h-8 w-40 rounded-full bg-[color:var(--border-soft)]" />
            </div>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((tile) => (
            <div key={tile} className="ios-card ios-animate-up space-y-3 p-5">
              <div className="h-3 w-24 rounded-full bg-[color:var(--border-soft)]" />
              <div className="h-8 w-32 rounded-full bg-[color:var(--surface-strong)]" />
              <div className="h-3 w-20 rounded-full bg-[color:var(--border-soft)]" />
            </div>
          ))}
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          {[0, 1].map((chart) => (
            <div key={chart} className="ios-card ios-animate-up space-y-4 p-6">
              <div className="h-3 w-32 rounded-full bg-[color:var(--border-soft)]" />
              <div className="h-56 w-full rounded-2xl bg-[color:var(--surface-strong)]" />
            </div>
          ))}
        </div>

        <div className="ios-card ios-animate-up space-y-3 p-6">
          <div className="h-3 w-40 rounded-full bg-[color:var(--border-soft)]" />
          {[0, 1, 2, 3, 4].map((row) => (
            <div key={row} className="h-4 w-full rounded-full bg-[color:var(--border-soft)]" />
          ))}
        </div>
      </div>
    </div>
  );
}
