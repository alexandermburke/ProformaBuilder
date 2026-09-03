'use client';

import Link from 'next/link';
import BackLink from '@/components/BackLink';
import { useEffect, useMemo, useState, type JSX } from 'react';
import { useTheme } from '@/components/ThemeProvider';
import { VerdictPill, type Analysis } from '../ui/AnalysisDisplay';

type SavedDeal = {
  dealNumber: string;
  facilityName: string;
  dealType: string;
  latestRunId: string;
  latestVerdict: Analysis['recommendation'];
  latestConfidence: Analysis['confidence'];
  latestRunAt: string;
  runCount: number;
};

type ApiResponse = { deals: SavedDeal[] };

const overlayTopLight = 'bg-[radial-gradient(circle_at_18%_12%,rgba(245,158,11,0.18),transparent_60%)]';
const overlayTopDark = 'bg-[radial-gradient(circle_at_12%_10%,rgba(245,158,11,0.26),transparent_58%)]';

type VerdictFilter = 'all' | Analysis['recommendation'];

export default function SavedAnalysesPage(): JSX.Element {
  const { theme } = useTheme();
  const overlayTop = theme === 'dark' ? overlayTopDark : overlayTopLight;
  const [state, setState] = useState<
    { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; data: ApiResponse }
  >({ kind: 'loading' });
  const [verdictFilter, setVerdictFilter] = useState<VerdictFilter>('all');
  const [search, setSearch] = useState('');
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ kind: 'loading' });
    fetch('/api/deal-analysis/saved')
      .then(async (resp) => {
        const data = (await resp.json()) as Partial<ApiResponse> & { error?: string };
        if (cancelled) return;
        if (!resp.ok || !data.deals) {
          setState({ kind: 'error', message: data.error ?? 'Failed to load saved analyses.' });
          return;
        }
        setState({ kind: 'ready', data: data as ApiResponse });
      })
      .catch((err: unknown) => {
        if (!cancelled) setState({ kind: 'error', message: (err as Error).message });
      });
    return () => {
      cancelled = true;
    };
  }, [reload]);

  const filtered = useMemo(() => {
    if (state.kind !== 'ready') return [];
    const q = search.trim().toLowerCase();
    return state.data.deals.filter((d) => {
      if (verdictFilter !== 'all' && d.latestVerdict !== verdictFilter) return false;
      if (!q) return true;
      return (
        d.dealNumber.toLowerCase().includes(q) ||
        d.facilityName.toLowerCase().includes(q) ||
        d.dealType.toLowerCase().includes(q)
      );
    });
  }, [state, verdictFilter, search]);

  return (
    <div className="relative min-h-screen overflow-hidden text-[color:var(--text-primary)]">
      <div className={`pointer-events-none absolute inset-0 -z-20 ${overlayTop}`} />
      <div className="relative mx-auto flex min-h-screen max-w-5xl flex-col gap-12 px-6 py-12 lg:gap-16 lg:px-10 lg:py-16">
        <header className="ios-card ios-animate-up flex flex-col gap-6 p-10">
          <span className="ios-badge text-[10px]">Saved analyses</span>
          <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-3 sm:flex-1">
              <h1 className="text-3xl font-semibold leading-tight text-[color:var(--text-primary)] sm:text-4xl">
                Saved deal analyses
              </h1>
              <p className="max-w-3xl text-sm text-[color:var(--text-secondary)] sm:text-base">
                Browse every property that&rsquo;s been analyzed. Click into a deal to see history,
                override the verdict, or delete a run.
              </p>
            </div>
            <BackLink href="/deal-analysis" label="Back to analyzer" />
          </div>
        </header>

        <section className="ios-card flex flex-col gap-4 p-6">
          <div className="flex flex-wrap items-center gap-3">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by deal #, facility, or type"
              className="flex-1 rounded-2xl border border-[color:var(--border-soft)] bg-[color:var(--surface)] px-3 py-2 text-sm outline-none focus:border-[color:var(--accent-strong)]"
            />
            <select
              value={verdictFilter}
              onChange={(e) => setVerdictFilter(e.target.value as VerdictFilter)}
              className="rounded-2xl border border-[color:var(--border-soft)] bg-[color:var(--surface)] px-3 py-2 text-sm outline-none focus:border-[color:var(--accent-strong)]"
            >
              <option value="all">All verdicts</option>
              <option value="pursue">Pursue</option>
              <option value="pass">Pass</option>
              <option value="investigate">Investigate</option>
            </select>
            <button
              type="button"
              onClick={() => setReload((n) => n + 1)}
              className="rounded-full border border-[color:var(--border-soft)] px-3 py-1.5 text-xs hover:bg-[color:var(--surface)]"
            >
              Refresh
            </button>
          </div>

          {state.kind === 'loading' ? (
            <p className="text-sm text-[color:var(--text-secondary)]">Loading saved analyses…</p>
          ) : state.kind === 'error' ? (
            <p className="text-sm text-rose-700 dark:text-rose-300">Error: {state.message}</p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-[color:var(--text-secondary)]">
              {state.data.deals.length === 0
                ? 'No analyses saved yet. Run one from the analyzer.'
                : 'No matches for the current filters.'}
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-[color:var(--border-soft)]">
              {filtered.map((d) => (
                <li key={d.dealNumber}>
                  <Link
                    href={`/deal-analysis/${encodeURIComponent(d.dealNumber)}`}
                    className="flex flex-col gap-2 py-3 text-sm hover:bg-[color:var(--surface)] sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="flex flex-col gap-1">
                      <span className="font-semibold text-[color:var(--text-primary)]">
                        #{d.dealNumber} — {d.facilityName}
                      </span>
                      <span className="text-xs text-[color:var(--text-secondary)]">
                        {d.dealType ? `${d.dealType} · ` : ''}
                        {d.runCount} run{d.runCount === 1 ? '' : 's'} · last{' '}
                        {new Date(d.latestRunAt).toLocaleString()}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <VerdictPill recommendation={d.latestVerdict} />
                      <span className="uppercase tracking-wide text-[color:var(--text-secondary)]">
                        Conf: {d.latestConfidence}
                      </span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
