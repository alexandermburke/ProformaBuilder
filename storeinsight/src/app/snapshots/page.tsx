'use client';

import Link from 'next/link';
import React from 'react';
import type { JSX } from 'react';

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
    <div className="min-h-screen w-full bg-white text-[#111827]">
      <div className="mx-auto max-w-[1200px] p-6">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="text-[26px] font-semibold tracking-tight">Snapshots</div>
            <div className="mt-1 text-sm text-[#6B7280]">
              Live view of generated proforma snapshots with quick facility trends.
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
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-[17px] font-semibold">Snapshot activity</div>
                  <div className="text-xs uppercase tracking-wide text-[#9CA3AF]">Totals &amp; latest entry</div>
                </div>
                <div className="grid gap-2 sm:grid-cols-3">
                  <div className="rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2 text-xs text-[#4B5563]">
                    <div className="uppercase tracking-wide text-[11px] text-[#9CA3AF]">Snapshots</div>
                    <div className="mt-1 text-[18px] font-semibold text-[#111827]">
                      {stats.count}
                    </div>
                  </div>
                  <div className="rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2 text-xs text-[#4B5563]">
                    <div className="uppercase tracking-wide text-[11px] text-[#9CA3AF]">Avg NOI</div>
                    <div className="mt-1 text-[18px] font-semibold text-[#111827]">
                      {formatCurrency(stats.avgNoi)}
                    </div>
                  </div>
                  <div className="rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2 text-xs text-[#4B5563]">
                    <div className="uppercase tracking-wide text-[11px] text-[#9CA3AF]">Facilities</div>
                    <div className="mt-1 text-[18px] font-semibold text-[#111827]">
                      {stats.uniqueFacilities}
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-[#E5E7EB] overflow-hidden">
                <table className="w-full text-left text-sm">
                  <thead className="bg-[#F9FAFB] text-[#6B7280]">
                    <tr>
                      <th className="px-3 py-2">ID</th>
                      <th className="px-3 py-2">Facility</th>
                      <th className="px-3 py-2">Period</th>
                      <th className="px-3 py-2 text-right">
                        <abbr title="Net Operating Income">NOI</abbr>
                      </th>
                      <th className="px-3 py-2">Created By</th>
                      <th className="px-3 py-2">Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedRows.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-3 py-6 text-center text-[#6B7280]">
                          No snapshots yet.{' '}
                          <Link className="text-[#2563EB] underline-offset-2 hover:underline" href="/">
                            Create one
                          </Link>
                          .
                        </td>
                      </tr>
                    )}
                    {sortedRows.map((row) => (
                      <tr key={row.id} className="border-t border-[#E5E7EB] hover:bg-[#FAFAFB]">
                        <td className="px-3 py-2 font-mono text-xs">{row.id}</td>
                        <td className="px-3 py-2">
                          <div className="max-w-[220px] break-words leading-tight">{row.facility}</div>
                        </td>
                        <td className="px-3 py-2">
                          <span className="rounded-full bg-[#F3F4F6] px-2 py-0.5 text-[12px] text-[#374151]">
                            {row.period}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {row.noi.toLocaleString()}
                        </td>
                        <td className="px-3 py-2">{row.createdBy}</td>
                        <td className="px-3 py-2 text-[#6B7280]">
                          {new Date(row.createdAt).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="rounded-[14px] border border-[#E5E7EB] bg-white p-5 shadow-sm">
              <div className="mb-4">
                <div className="text-[17px] font-semibold">Top facilities by NOI</div>
                <div className="text-xs uppercase tracking-wide text-[#9CA3AF]">Rolling sum of exported snapshots</div>
              </div>
              <ul className="space-y-3">
                {topFacilities.length === 0 && (
                  <li className="rounded-xl border border-dashed border-[#D1D5DB] bg-[#F9FAFB] px-4 py-3 text-sm text-[#6B7280]">
                    Generate a snapshot to populate this list.
                  </li>
                )}
                {topFacilities.map(([facility, noi], idx) => (
                  <li key={facility} className="flex items-center justify-between rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] px-4 py-3 text-sm text-[#111827]">
                    <div className="flex items-center gap-3">
                      <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-[#EEF2FF] text-sm font-semibold text-[#1D4ED8]">
                        {idx + 1}
                      </span>
                      <span className="font-medium">{facility}</span>
                    </div>
                    <span className="text-[#4B5563]">{formatCurrency(noi)}</span>
                  </li>
                ))}
              </ul>
            </section>
          </div>

          <aside className="space-y-6">
            <section className="rounded-[14px] border border-[#E5E7EB] bg-white p-5 shadow-sm">
              <div className="text-[15px] font-semibold">Snapshot cadence</div>
              <p className="mt-2 text-sm text-[#4B5563]">
                Snapshots subscribe to Firestore updates. If you do not see a recent run, confirm that the
                Generate step completed and the Firestore write succeeded.
              </p>
              <div className="mt-4 rounded-lg border border-dashed border-[#DBEAFE] bg-[#F8FBFF] p-4 text-xs text-[#1E40AF]">
                <div className="font-medium uppercase tracking-wide">Latest run</div>
                <div className="mt-1 text-sm text-[#1F2937]">
                  {stats.latest
                    ? `${stats.latest.facility} · ${stats.latest.period}`
                    : 'Waiting for first snapshot'}
                </div>
                <p className="mt-2 leading-snug text-[#1E40AF]">
                  {stats.latest
                    ? `Created ${new Date(stats.latest.createdAt).toLocaleString()} by ${stats.latest.createdBy}.`
                    : 'Use Generate in the report builder to publish a row.'}
                </p>
              </div>
            </section>

            <section className="rounded-[14px] border border-[#E5E7EB] bg-white p-5 shadow-sm">
              <div className="text-[15px] font-semibold">Tips</div>
              <ul className="mt-3 list-disc space-y-2 pl-5 text-[13px] text-[#4B5563]">
                <li>Keep facility names consistent so historical NOI aggregates correctly.</li>
                <li>Use the Export page to download the Excel file tied to the latest snapshot.</li>
                <li>Snapshots refresh live—no need to reload the page after generating.</li>
              </ul>
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}
