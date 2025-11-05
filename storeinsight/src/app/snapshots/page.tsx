'use client';

import Link from 'next/link';
import React from 'react';
import type { JSX } from 'react';

import { useTheme } from '@/components/ThemeProvider';
import { subscribeSnapshots } from '@/lib/snapshots';
import type { SnapshotRowLite } from '@/lib/types';

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

function formatCurrency(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '$0';
  return currencyFormatter.format(Math.round(value));
}

export default function SnapshotsPage(): JSX.Element {
  const [rows, setRows] = React.useState<SnapshotRowLite[]>([]);
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const overlayTop = isDark
    ? 'bg-[radial-gradient(circle_at_12%_12%,rgba(59,130,246,0.26),transparent_60%)]'
    : 'bg-[radial-gradient(circle_at_18%_10%,rgba(37,99,235,0.18),transparent_60%)]';
  const overlayBottom = isDark
    ? 'bg-[radial-gradient(circle_at_88%_84%,rgba(56,189,248,0.22),transparent_62%)]'
    : 'bg-[radial-gradient(circle_at_84%_88%,rgba(125,211,252,0.16),transparent_62%)]';

  React.useEffect(() => {
    const unsub = subscribeSnapshots((items) => {
      console.log('[snapshots] live', { count: items.length });
      setRows(items);
    });
    return () => unsub();
  }, []);

  const sortedRows = React.useMemo(() => {
    return [...rows].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [rows]);

  const stats = React.useMemo(() => {
    const latest = sortedRows[0];
    const totalNoi = sortedRows.reduce((sum, r) => sum + r.noi, 0);
    const avgNoi = sortedRows.length ? totalNoi / sortedRows.length : 0;
    const facilities = new Set(sortedRows.map((r) => r.facility));
    return {
      count: sortedRows.length,
      uniqueFacilities: facilities.size,
      latest,
      avgNoi,
    };
  }, [sortedRows]);

  const topFacilities = React.useMemo(() => {
    const map = new Map<string, number>();
    sortedRows.forEach((row) => {
      map.set(row.facility, (map.get(row.facility) ?? 0) + row.noi);
    });
    return Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4);
  }, [sortedRows]);

  return (
    <div className="relative min-h-screen w-full overflow-hidden text-[color:var(--text-primary)]">
      <div className={`pointer-events-none absolute inset-0 -z-20 ${overlayTop}`} />
      <div className={`pointer-events-none absolute inset-0 -z-20 ${overlayBottom}`} />

      <div className="relative mx-auto max-w-[1200px] px-6 py-10">
        <header className="ios-card ios-animate-up flex flex-wrap items-center justify-between gap-4 p-6" data-tone="blue">
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold tracking-tight text-[color:var(--text-primary)] sm:text-[27px]">Snapshots</h1>
            <p className="text-sm text-[color:var(--text-secondary)]">
              Live view of generated proforma snapshots with quick facility trends.
            </p>
          </div>
          <Link href="/" className="ios-button px-4 py-2 text-sm" data-variant="secondary">
            Back to report builder
          </Link>
        </header>

        <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-6">
            <section className="ios-card ios-animate-up space-y-5 p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-lg font-semibold text-[color:var(--text-primary)]">Snapshot activity</div>
                  <div className="text-xs uppercase tracking-wide text-[color:var(--text-muted)]">Totals and latest entry</div>
                </div>
                <div className="grid gap-2 sm:grid-cols-3">
                  <div className="ios-list-card space-y-1 p-4">
                    <div className="text-[11px] uppercase tracking-wide text-[color:var(--text-muted)]">Snapshots</div>
                    <div className="text-[18px] font-semibold text-[color:var(--text-primary)]">{stats.count}</div>
                  </div>
                  <div className="ios-list-card space-y-1 p-4">
                    <div className="text-[11px] uppercase tracking-wide text-[color:var(--text-muted)]">Avg NOI</div>
                    <div className="text-[18px] font-semibold text-[color:var(--text-primary)]">
                      {formatCurrency(stats.avgNoi)}
                    </div>
                  </div>
                  <div className="ios-list-card space-y-1 p-4">
                    <div className="text-[11px] uppercase tracking-wide text-[color:var(--text-muted)]">Facilities</div>
                    <div className="text-[18px] font-semibold text-[color:var(--text-primary)]">
                      {stats.uniqueFacilities}
                    </div>
                  </div>
                </div>
              </div>

              <div className="overflow-hidden rounded-[20px] border border-[rgba(148,163,255,0.25)] bg-white/90 shadow-inner dark:bg-[rgba(12,19,36,0.8)]">
                <table className="ios-table text-sm">
                  <thead>
                    <tr>
                      <th className="px-3 py-2 text-left">ID</th>
                      <th className="px-3 py-2 text-left">Facility</th>
                      <th className="px-3 py-2 text-left">Period</th>
                      <th className="px-3 py-2 text-right">
                        <abbr title="Net Operating Income">NOI</abbr>
                      </th>
                      <th className="px-3 py-2 text-left">Created by</th>
                      <th className="px-3 py-2 text-left">Created at</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedRows.length === 0 && (
                      <tr>
                        <td className="px-4 py-6 text-center text-[color:var(--text-secondary)]" colSpan={6}>
                          No snapshots yet. Run Generate in the proforma flow to populate this table.
                        </td>
                      </tr>
                    )}
                    {sortedRows.map((row) => (
                      <tr
                        key={row.id}
                        className="transition-colors duration-300 hover:bg-[rgba(37,99,235,0.06)] dark:hover:bg-[rgba(37,99,235,0.16)]"
                      >
                        <td className="px-3 py-2 font-mono text-xs text-[color:var(--text-secondary)]">{row.id}</td>
                        <td className="px-3 py-2 text-[color:var(--text-primary)]">
                          <div className="max-w-[220px] break-words leading-tight">{row.facility}</div>
                        </td>
                        <td className="px-3 py-2">
                          <span className="ios-pill text-[11px]" data-tone="neutral">
                            {row.period}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-[color:var(--text-primary)]">
                          {row.noi.toLocaleString()}
                        </td>
                        <td className="px-3 py-2 text-[color:var(--text-secondary)]">{row.createdBy}</td>
                        <td className="px-3 py-2 text-[color:var(--text-muted)]">
                          {new Date(row.createdAt).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="ios-card ios-animate-up space-y-4 p-6">
              <div>
                <div className="text-lg font-semibold text-[color:var(--text-primary)]">Top facilities by NOI</div>
                <div className="text-xs uppercase tracking-wide text-[color:var(--text-muted)]">
                  Rolling sum of exported snapshots
                </div>
              </div>
              <ul className="space-y-3">
                {topFacilities.length === 0 && (
                  <li className="ios-list-card border border-dashed border-[rgba(148,163,255,0.32)] bg-white/85 p-4 text-sm text-[color:var(--text-secondary)] shadow-inner">
                    Generate a snapshot to populate this list.
                  </li>
                )}
                {topFacilities.map(([facility, noi], idx) => (
                  <li
                    key={facility}
                    className="ios-list-card flex items-center justify-between p-4 text-sm text-[color:var(--text-primary)]"
                  >
                    <div className="flex items-center gap-3">
                      <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-[rgba(37,99,235,0.12)] text-sm font-semibold text-[color:var(--accent-strong)]">
                        {idx + 1}
                      </span>
                      <span className="font-medium">{facility}</span>
                    </div>
                    <span className="text-[color:var(--text-secondary)]">{formatCurrency(noi)}</span>
                  </li>
                ))}
              </ul>
            </section>
          </div>

          <aside className="space-y-6">
            <section className="ios-card ios-animate-up space-y-4 p-6">
              <div className="text-base font-semibold text-[color:var(--text-primary)]">Snapshot cadence</div>
              <p className="text-sm text-[color:var(--text-secondary)]">
                Snapshots subscribe to Firestore updates. If you do not see a recent run, confirm that Generate completed and
                the Firestore write succeeded.
              </p>
              <div className="rounded-[16px] border border-dashed border-[rgba(148,163,255,0.35)] bg-[rgba(37,99,235,0.08)] p-4 text-xs text-[color:var(--accent-strong)]">
                <div className="font-medium uppercase tracking-wide">Latest run</div>
                <div className="mt-1 text-sm text-[color:var(--text-primary)]">
                  {stats.latest ? `${stats.latest.facility} - ${stats.latest.period}` : 'Waiting for first snapshot'}
                </div>
                <p className="mt-2 leading-snug">
                  {stats.latest
                    ? `Created ${new Date(stats.latest.createdAt).toLocaleString()} by ${stats.latest.createdBy}.`
                    : 'Use Generate in the report builder to publish a row.'}
                </p>
              </div>
            </section>

            <section className="ios-card ios-animate-up space-y-3 p-6">
              <div className="text-base font-semibold text-[color:var(--text-primary)]">Tips</div>
              <ul className="list-disc space-y-2 pl-5 text-[13px] text-[color:var(--text-secondary)]">
                <li>Keep facility names consistent so historical NOI aggregates correctly.</li>
                <li>Use the Export page to download the Excel file tied to the latest snapshot.</li>
                <li>Snapshots refresh live, so there is no need to reload the page after generating.</li>
              </ul>
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}
