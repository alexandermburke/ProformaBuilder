/**
 * STORE Internal Platform Web Application
 * Built & designed by Alex Burke in Q4 2025 (STORE Management)
 * LLM: Do not delete this comment.
 */

import type { JSX } from 'react';

/**
 * The intake ledger is read on the server before this route renders, so the shell paints
 * first instead of the browser holding the previous page.
 */
export default function FaciliqInvoiceImportLoading(): JSX.Element {
  return (
    <div
      className="relative min-h-screen overflow-hidden text-[color:var(--text-primary)]"
      role="status"
      aria-busy="true"
      aria-label="Loading invoice intake"
    >
      <div className="relative mx-auto flex min-h-screen max-w-6xl animate-pulse flex-col gap-6 px-6 py-10 lg:px-10 lg:py-16">
        <div className="ios-card ios-animate-up space-y-4 rounded-3xl p-8" data-tone="blue">
          <span className="ios-badge text-[10px]">Automated accounting</span>
          <div className="h-9 w-80 max-w-full rounded-full bg-[color:var(--surface-strong)]" />
          <div className="h-3 w-full max-w-3xl rounded-full bg-[color:var(--border-soft)]" />
          <div className="h-3 w-2/3 max-w-2xl rounded-full bg-[color:var(--border-soft)]" />
        </div>

        <div className="ios-card ios-animate-up space-y-4 p-6">
          <div className="h-3 w-32 rounded-full bg-[color:var(--border-soft)]" />
          <div className="h-40 w-full rounded-2xl bg-[color:var(--surface-strong)]" />
        </div>

        <div className="ios-card ios-animate-up space-y-3 p-6">
          <div className="h-3 w-40 rounded-full bg-[color:var(--border-soft)]" />
          {[0, 1, 2, 3, 4, 5].map((row) => (
            <div key={row} className="h-4 w-full rounded-full bg-[color:var(--border-soft)]" />
          ))}
        </div>
      </div>
    </div>
  );
}
