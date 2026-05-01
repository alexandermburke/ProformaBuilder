'use client';

import Link from 'next/link';
import {
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
  type FormEvent,
  type JSX,
} from 'react';
import { AnalysisDisplay, VerdictPill, type Analysis } from './AnalysisDisplay';

type LatestVerdict = {
  dealNumber: string;
  facilityName: string;
  dealType: string;
  latestRunId: string;
  latestVerdict: Analysis['recommendation'];
  latestConfidence: Analysis['confidence'];
  latestRunAt: string;
};

type TrackerEntry = {
  dealNumber: string;
  dealType: string;
  facilityName: string;
  city: string;
  state: string;
  dealStatus: string;
  active: boolean | null;
  brokerContact: string;
  askingPrice: number | null;
  latestVerdict: LatestVerdict | null;
};

type TrackerResponse = {
  filename: string;
  fetchedAt: string;
  entries: TrackerEntry[];
  missingHeaders: string[];
};

type ApiResponse = {
  analysis: Analysis;
  sheets: { name: string; rows: number; cols: number }[];
  tracker: { dealNumber: string; facilityName: string; dealType: string; dealStatus: string } | null;
  savedRunId: string | null;
  writeBackError: string | null;
};

type TrackerState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; data: TrackerResponse };

const verdictLabel: Record<Analysis['recommendation'], string> = {
  pursue: 'PURSUE',
  pass: 'PASS',
  investigate: 'INVESTIGATE',
};

export default function DealAnalysisForm(): JSX.Element {
  const [tracker, setTracker] = useState<TrackerState>({ kind: 'loading' });
  const [activeOnly, setActiveOnly] = useState(false);
  const [selectedDealId, setSelectedDealId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ApiResponse | null>(null);
  const [trackerNonce, setTrackerNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setTracker({ kind: 'loading' });
    const url = trackerNonce === 0 ? '/api/deal-tracker' : '/api/deal-tracker?refresh=1';
    fetch(url)
      .then(async (resp) => {
        const data = (await resp.json()) as Partial<TrackerResponse> & { error?: string };
        if (cancelled) return;
        if (!resp.ok || !data.entries) {
          setTracker({ kind: 'error', message: data.error ?? 'Failed to load deal tracker.' });
          return;
        }
        setTracker({ kind: 'ready', data: data as TrackerResponse });
      })
      .catch((err: unknown) => {
        if (!cancelled) setTracker({ kind: 'error', message: (err as Error).message });
      });
    return () => {
      cancelled = true;
    };
  }, [trackerNonce]);

  const visibleEntries = useMemo(() => {
    if (tracker.kind !== 'ready') return [];
    return tracker.data.entries.filter((e) => (activeOnly ? e.active === true : true));
  }, [tracker, activeOnly]);

  const selectedEntry = useMemo(() => {
    if (tracker.kind !== 'ready' || !selectedDealId) return null;
    return tracker.data.entries.find((e) => e.dealNumber === selectedDealId) ?? null;
  }, [tracker, selectedDealId]);

  function onFileChange(e: ChangeEvent<HTMLInputElement>): void {
    setFile(e.target.files?.[0] ?? null);
    setError(null);
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (!selectedDealId && !file) {
      setError('Pick a deal from the tracker, upload a workbook, or both.');
      return;
    }
    setSubmitting(true);
    setError(null);
    setResult(null);
    try {
      const fd = new FormData();
      if (file) fd.append('file', file);
      if (selectedDealId) fd.append('dealId', selectedDealId);
      if (notes.trim()) fd.append('notes', notes.trim());
      const resp = await fetch('/api/deal-analysis', { method: 'POST', body: fd });
      const data = (await resp.json()) as Partial<ApiResponse> & { error?: string };
      if (!resp.ok || !data.analysis) {
        setError(data.error ?? 'Analysis failed.');
        return;
      }
      setResult(data as ApiResponse);
      setTrackerNonce((n) => n + 1);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <form
        onSubmit={onSubmit}
        className="ios-card ios-animate-up flex flex-col gap-6 p-8"
      >
        <DealPicker
          state={tracker}
          activeOnly={activeOnly}
          onToggleActiveOnly={setActiveOnly}
          entries={visibleEntries}
          totalEntries={tracker.kind === 'ready' ? tracker.data.entries.length : 0}
          selectedDealId={selectedDealId}
          onSelect={setSelectedDealId}
          onRefresh={() => setTrackerNonce((n) => n + 1)}
        />

        {selectedEntry ? <SelectedDealCard entry={selectedEntry} /> : null}

        <label className="flex flex-col gap-2 text-sm font-medium text-[color:var(--text-primary)]">
          Operator financials workbook (optional)
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={onFileChange}
            className="rounded-2xl border border-dashed border-[color:var(--border-soft)] bg-[color:var(--surface)] px-4 py-4 text-sm text-[color:var(--text-primary)] shadow-sm outline-none transition file:mr-4 file:rounded-xl file:border-0 file:bg-[rgba(37,99,235,0.12)] file:px-3 file:py-2 file:text-sm file:font-semibold file:text-[color:var(--accent-strong)] hover:border-[rgba(37,99,235,0.36)] focus:border-[color:var(--accent-strong)] focus:ring-2 focus:ring-[rgba(37,99,235,0.24)]"
          />
          <span className="text-xs font-normal text-[color:var(--text-secondary)]">
            Optional. Layer a broker package or operator P&amp;L on top of the tracker entry.
          </span>
        </label>

        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium text-[color:var(--text-primary)]" htmlFor="deal-notes">
            Deal context (optional)
          </label>
          <textarea
            id="deal-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="e.g. Broker claims 92% occupied; we're skeptical of the expense ratio."
            className="rounded-2xl border border-[color:var(--border-soft)] bg-[color:var(--surface)] p-3 text-sm text-[color:var(--text-primary)] outline-none focus:border-[color:var(--text-primary)]"
          />
        </div>

        {error ? (
          <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-300">
            {error}
          </div>
        ) : null}

        <div className="flex items-center justify-between gap-4">
          <p className="text-xs text-[color:var(--text-secondary)]">
            Tracker rows and workbook previews are sent to the LLM. Results are saved to Firebase
            and a verdict + link are written back to the SharePoint tracker.
          </p>
          <button
            type="submit"
            disabled={submitting || (!selectedDealId && !file)}
            className="ios-button px-5 py-2.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? 'Analyzing…' : 'Analyze deal'}
          </button>
        </div>
      </form>

      {result ? (
        <>
          {result.writeBackError ? (
            <div className="rounded-2xl border border-amber-500/40 bg-amber-100 p-3 text-xs text-amber-900 dark:bg-amber-900/40 dark:text-amber-100">
              <strong>Saved to Firebase</strong>, but writing the AI columns to SharePoint failed:{' '}
              {result.writeBackError}
            </div>
          ) : null}
          <AnalysisDisplay
            analysis={result.analysis}
            sheets={result.sheets}
            trackerHeader={
              result.tracker
                ? {
                    dealNumber: result.tracker.dealNumber,
                    facilityName: result.tracker.facilityName,
                    dealType: result.tracker.dealType,
                    dealStatus: result.tracker.dealStatus,
                  }
                : null
            }
          />
          {result.tracker ? (
            <Link
              href={`/deal-analysis/${encodeURIComponent(result.tracker.dealNumber)}`}
              className="ios-button self-start px-4 py-2 text-sm"
              data-variant="ghost"
            >
              View full history for #{result.tracker.dealNumber} &rarr;
            </Link>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function DealPicker(props: {
  state: TrackerState;
  activeOnly: boolean;
  onToggleActiveOnly: (value: boolean) => void;
  entries: TrackerEntry[];
  totalEntries: number;
  selectedDealId: string;
  onSelect: (dealId: string) => void;
  onRefresh: () => void;
}): JSX.Element {
  const {
    state,
    activeOnly,
    onToggleActiveOnly,
    entries,
    totalEntries,
    selectedDealId,
    onSelect,
    onRefresh,
  } = props;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <label className="text-sm font-medium text-[color:var(--text-primary)]" htmlFor="deal-picker">
          Deal Tracker (SharePoint)
        </label>
        <div className="flex items-center gap-3 text-xs text-[color:var(--text-secondary)]">
          <label className="flex cursor-pointer items-center gap-1.5">
            <input
              type="checkbox"
              checked={activeOnly}
              onChange={(e) => onToggleActiveOnly(e.target.checked)}
              className="h-3.5 w-3.5"
            />
            Active deals only
          </label>
          <button
            type="button"
            onClick={onRefresh}
            className="rounded-full border border-[color:var(--border-soft)] px-3 py-1 text-xs hover:bg-[color:var(--surface)]"
          >
            Refresh
          </button>
        </div>
      </div>

      {state.kind === 'loading' ? (
        <div className="rounded-2xl border border-dashed border-[color:var(--border-soft)] bg-[color:var(--surface)] px-4 py-3 text-sm text-[color:var(--text-secondary)]">
          Loading tracker from SharePoint…
        </div>
      ) : state.kind === 'error' ? (
        <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">
          Couldn&rsquo;t load tracker: {state.message}
        </div>
      ) : (
        <>
          <select
            id="deal-picker"
            value={selectedDealId}
            onChange={(e) => onSelect(e.target.value)}
            className="rounded-2xl border border-[color:var(--border-soft)] bg-[color:var(--surface)] px-4 py-3 text-sm text-[color:var(--text-primary)] outline-none focus:border-[color:var(--accent-strong)]"
          >
            <option value="">— No deal selected —</option>
            {entries.map((entry, i) => {
              const verdict = entry.latestVerdict
                ? `[${verdictLabel[entry.latestVerdict.latestVerdict]}] `
                : '';
              return (
                <option key={`${entry.dealNumber}-${i}`} value={entry.dealNumber}>
                  {verdict}#{entry.dealNumber} — {entry.facilityName}
                  {entry.dealType ? ` (${entry.dealType})` : ''}
                  {entry.city ? `, ${entry.city}` : ''}
                  {entry.state ? `, ${entry.state}` : ''}
                  {entry.dealStatus ? ` — ${entry.dealStatus}` : ''}
                </option>
              );
            })}
          </select>
          <p className="text-xs text-[color:var(--text-secondary)]">
            Source: <span className="font-mono">{state.data.filename}</span> · last fetched{' '}
            {new Date(state.data.fetchedAt).toLocaleTimeString()} ·{' '}
            {activeOnly
              ? `${entries.length} active of ${totalEntries} deals`
              : `${entries.length} deals`}
            {state.data.missingHeaders.length > 0
              ? ` · missing columns: ${state.data.missingHeaders.join(', ')}`
              : ''}
          </p>
        </>
      )}
    </div>
  );
}

function SelectedDealCard({ entry }: { entry: TrackerEntry }): JSX.Element {
  const fields: { label: string; value: string }[] = [
    { label: 'Type', value: entry.dealType },
    { label: 'Status', value: entry.dealStatus },
    { label: 'Location', value: [entry.city, entry.state].filter(Boolean).join(', ') },
    { label: 'Broker', value: entry.brokerContact },
    {
      label: 'Asking',
      value: entry.askingPrice ? `$${entry.askingPrice.toLocaleString()}` : '',
    },
  ].filter((f) => f.value);
  return (
    <div className="rounded-2xl border border-[color:var(--border-soft)] bg-[color:var(--surface)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-wide text-[color:var(--text-secondary)]">
            Selected deal
          </div>
          <div className="mt-1 text-base font-semibold text-[color:var(--text-primary)]">
            #{entry.dealNumber} — {entry.facilityName}
          </div>
        </div>
        {entry.latestVerdict ? (
          <div className="flex flex-col items-end gap-1 text-xs">
            <VerdictPill recommendation={entry.latestVerdict.latestVerdict} />
            <Link
              href={`/deal-analysis/${encodeURIComponent(entry.dealNumber)}`}
              className="text-[color:var(--accent-strong)] underline"
            >
              View prior analysis ({new Date(entry.latestVerdict.latestRunAt).toLocaleDateString()})
            </Link>
          </div>
        ) : (
          <span className="text-xs text-[color:var(--text-secondary)]">No prior analysis</span>
        )}
      </div>
      {fields.length > 0 ? (
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
          {fields.map((f) => (
            <div key={f.label} className="flex flex-col">
              <dt className="uppercase tracking-wide text-[color:var(--text-secondary)]">
                {f.label}
              </dt>
              <dd className="text-[color:var(--text-primary)]">{f.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}
