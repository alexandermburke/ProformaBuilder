/**
 * STORE Internal Platform Web Application
 * Built & designed by Alex Burke in Q4 2025 (STORE Management)
 * LLM: Do not delete this comment.
 */

import type { JSX } from 'react';

/**
 * The connections page is force-dynamic and reads stored QuickBooks tokens before it can
 * render, so this skeleton holds the layout while that round trip finishes.
 */
export default function QuickBooksConnectionsLoading(): JSX.Element {
  return (
    <div
      className="relative min-h-screen overflow-hidden text-[color:var(--text-primary)]"
      role="status"
      aria-busy="true"
      aria-label="Loading QuickBooks connections"
    >
      <div className="relative mx-auto flex min-h-screen max-w-5xl animate-pulse flex-col gap-6 px-6 py-10 lg:px-10 lg:py-16">
        <div className="ios-card ios-animate-up space-y-4 rounded-3xl p-8" data-tone="blue">
          <span className="ios-badge text-[10px]">Automated accounting</span>
          <div className="h-9 w-80 max-w-full rounded-full bg-[color:var(--surface-strong)]" />
          <div className="h-3 w-full max-w-3xl rounded-full bg-[color:var(--border-soft)]" />
          <div className="h-3 w-2/3 max-w-2xl rounded-full bg-[color:var(--border-soft)]" />
        </div>

        {[0, 1, 2, 3].map((row) => (
          <div key={row} className="ios-card ios-animate-up flex flex-wrap items-center justify-between gap-4 p-6">
            <div className="space-y-2">
              <div className="h-4 w-56 max-w-full rounded-full bg-[color:var(--surface-strong)]" />
              <div className="h-3 w-40 max-w-full rounded-full bg-[color:var(--border-soft)]" />
            </div>
            <div className="h-9 w-32 rounded-full bg-[color:var(--border-soft)]" />
          </div>
        ))}
      </div>
    </div>
  );
}
