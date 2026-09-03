'use client';

import Link from 'next/link';
import BackLink from '@/components/BackLink';
import { use, useEffect, useState, type JSX } from 'react';
import { useTheme } from '@/components/ThemeProvider';
import { AnalysisDisplay, VerdictPill, type Analysis } from '../ui/AnalysisDisplay';

type HumanOverride = {
  recommendation: Analysis['recommendation'];
  confidence: Analysis['confidence'];
  note: string;
  overriddenAt: string;
};

type StoredRun = {
  runId: string;
  dealNumber: string;
  facilityName: string;
  dealType: string;
  createdAt: string;
  modelUsed: string;
  inputs: { hasTrackerEntry: boolean; workbookFilename: string | null; notes: string };
  analysis: Analysis;
  humanOverride?: HumanOverride;
};

type ApiResponse = {
  dealNumber: string;
  runs: StoredRun[];
  latest: StoredRun | null;
};

const overlayTopLight = 'bg-[radial-gradient(circle_at_18%_12%,rgba(245,158,11,0.18),transparent_60%)]';
const overlayTopDark = 'bg-[radial-gradient(circle_at_12%_10%,rgba(245,158,11,0.26),transparent_58%)]';

export default function DealAnalysisDetailPage({
  params,
}: {
  params: Promise<{ dealNumber: string }>;
}): JSX.Element {
  const { dealNumber } = use(params);
  const { theme } = useTheme();
  const overlayTop = theme === 'dark' ? overlayTopDark : overlayTopLight;
  const [state, setState] = useState<
    { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; data: ApiResponse }
  >({ kind: 'loading' });
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [editingRunId, setEditingRunId] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<{ kind: 'ok' | 'warn'; message: string } | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ kind: 'loading' });
    fetch(`/api/deal-analysis/${encodeURIComponent(dealNumber)}`)
      .then(async (resp) => {
        const data = (await resp.json()) as Partial<ApiResponse> & { error?: string };
        if (cancelled) return;
        if (!resp.ok || !data.runs) {
          setState({ kind: 'error', message: data.error ?? 'Failed to load analyses.' });
          return;
        }
        setState({ kind: 'ready', data: data as ApiResponse });
        const ready = data as ApiResponse;
        setSelectedRunId((prev) => prev ?? ready.latest?.runId ?? null);
      })
      .catch((err: unknown) => {
        if (!cancelled) setState({ kind: 'error', message: (err as Error).message });
      });
    return () => {
      cancelled = true;
    };
  }, [dealNumber, reload]);

  async function handleDelete(run: StoredRun): Promise<void> {
    if (!confirm(`Delete this analysis run from ${new Date(run.createdAt).toLocaleString()}?`)) {
      return;
    }
    setActionMsg(null);
    const resp = await fetch(
      `/api/deal-analysis/${encodeURIComponent(dealNumber)}/runs/${encodeURIComponent(run.runId)}`,
      { method: 'DELETE' },
    );
    const data = (await resp.json()) as { error?: string; writeBackError?: string | null };
    if (!resp.ok) {
      setActionMsg({ kind: 'warn', message: data.error ?? 'Delete failed.' });
      return;
    }
    if (data.writeBackError) {
      setActionMsg({
        kind: 'warn',
        message: `Run deleted, but SharePoint write-back failed: ${data.writeBackError}`,
      });
    } else {
      setActionMsg({ kind: 'ok', message: 'Run deleted.' });
    }
    setEditingRunId(null);
    setReload((n) => n + 1);
  }

  async function handleOverrideSubmit(
    run: StoredRun,
    override: { recommendation: Analysis['recommendation']; confidence: Analysis['confidence']; note: string },
  ): Promise<void> {
    setActionMsg(null);
    const resp = await fetch(
      `/api/deal-analysis/${encodeURIComponent(dealNumber)}/runs/${encodeURIComponent(run.runId)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(override),
      },
    );
    const data = (await resp.json()) as { error?: string; writeBackError?: string | null };
    if (!resp.ok) {
      setActionMsg({ kind: 'warn', message: data.error ?? 'Override failed.' });
      return;
    }
    if (data.writeBackError) {
      setActionMsg({
        kind: 'warn',
        message: `Override saved, but SharePoint write-back failed: ${data.writeBackError}`,
      });
    } else {
      setActionMsg({ kind: 'ok', message: 'Override saved.' });
    }
    setEditingRunId(null);
    setReload((n) => n + 1);
  }

  const selectedRun =
    state.kind === 'ready'
      ? state.data.runs.find((r) => r.runId === selectedRunId) ?? state.data.latest
      : null;

  return (
    <div className="relative min-h-screen overflow-hidden text-[color:var(--text-primary)]">
      <div className={`pointer-events-none absolute inset-0 -z-20 ${overlayTop}`} />
      <div className="relative mx-auto flex min-h-screen max-w-5xl flex-col gap-12 px-6 py-12 lg:gap-16 lg:px-10 lg:py-16">
        <header className="ios-card ios-animate-up flex flex-col gap-6 p-10">
          <span className="ios-badge text-[10px]">Deal analysis history</span>
          <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-3 sm:flex-1">
              <h1 className="text-3xl font-semibold leading-tight text-[color:var(--text-primary)] sm:text-4xl">
                {state.kind === 'ready' && state.data.latest
                  ? `#${state.data.latest.dealNumber} — ${state.data.latest.facilityName}`
                  : `Deal #${dealNumber}`}
              </h1>
              {state.kind === 'ready' && state.data.latest ? (
                <div className="flex flex-wrap items-center gap-3 text-sm text-[color:var(--text-secondary)]">
                  <VerdictPill
                    recommendation={
                      state.data.latest.humanOverride?.recommendation ??
                      state.data.latest.analysis.recommendation
                    }
                  />
                  <span>
                    Confidence:{' '}
                    {state.data.latest.humanOverride?.confidence ??
                      state.data.latest.analysis.confidence}
                  </span>
                  {state.data.latest.dealType ? <span>· {state.data.latest.dealType}</span> : null}
                  <span>· {new Date(state.data.latest.createdAt).toLocaleString()}</span>
                </div>
              ) : null}
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <Link href="/deal-analysis/saved" className="ios-button px-4 py-2 text-sm" data-variant="ghost">
                All saved
              </Link>
              <BackLink href="/deal-analysis" label="Back to analyzer" />
            </div>
          </div>
        </header>

        {actionMsg ? (
          <div
            className={`rounded-2xl border p-3 text-sm ${
              actionMsg.kind === 'ok'
                ? 'border-emerald-300 bg-emerald-100 text-emerald-900 dark:border-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-100'
                : 'border-amber-300 bg-amber-100 text-amber-900 dark:border-amber-700 dark:bg-amber-900/50 dark:text-amber-100'
            }`}
          >
            {actionMsg.message}
          </div>
        ) : null}

        {state.kind === 'loading' ? (
          <div className="ios-card p-8 text-sm text-[color:var(--text-secondary)]">
            Loading analyses for deal #{dealNumber}…
          </div>
        ) : state.kind === 'error' ? (
          <div className="ios-card p-8 text-sm text-rose-700 dark:text-rose-300">
            Error: {state.message}
          </div>
        ) : state.data.runs.length === 0 ? (
          <div className="ios-card p-8 text-sm text-[color:var(--text-secondary)]">
            No analyses for deal #{dealNumber}. Run one from the{' '}
            <Link href="/deal-analysis" className="underline">
              analyzer
            </Link>
            .
          </div>
        ) : (
          <>
            <RunHistory
              runs={state.data.runs}
              selectedRunId={selectedRun?.runId ?? null}
              editingRunId={editingRunId}
              onSelect={setSelectedRunId}
              onStartEdit={(id) => setEditingRunId(id)}
              onCancelEdit={() => setEditingRunId(null)}
              onSubmitOverride={handleOverrideSubmit}
              onDelete={handleDelete}
            />

            {selectedRun ? (
              <>
                {selectedRun.humanOverride ? (
                  <div className="rounded-2xl border border-sky-500/40 bg-sky-100 p-4 text-sm text-sky-900 dark:bg-sky-900/40 dark:text-sky-100">
                    <div className="font-semibold">
                      Human override · {new Date(selectedRun.humanOverride.overriddenAt).toLocaleString()}
                    </div>
                    <div className="mt-1">
                      Verdict set to <strong>{selectedRun.humanOverride.recommendation}</strong> ·
                      confidence <strong>{selectedRun.humanOverride.confidence}</strong>
                    </div>
                    {selectedRun.humanOverride.note ? (
                      <p className="mt-2 whitespace-pre-line">{selectedRun.humanOverride.note}</p>
                    ) : null}
                  </div>
                ) : null}
                <AnalysisDisplay
                  analysis={selectedRun.analysis}
                  trackerHeader={{
                    dealNumber: selectedRun.dealNumber,
                    facilityName: selectedRun.facilityName,
                    dealType: selectedRun.dealType,
                  }}
                />
              </>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

function RunHistory(props: {
  runs: StoredRun[];
  selectedRunId: string | null;
  editingRunId: string | null;
  onSelect: (id: string) => void;
  onStartEdit: (id: string) => void;
  onCancelEdit: () => void;
  onSubmitOverride: (
    run: StoredRun,
    override: { recommendation: Analysis['recommendation']; confidence: Analysis['confidence']; note: string },
  ) => Promise<void>;
  onDelete: (run: StoredRun) => Promise<void>;
}): JSX.Element {
  const {
    runs,
    selectedRunId,
    editingRunId,
    onSelect,
    onStartEdit,
    onCancelEdit,
    onSubmitOverride,
    onDelete,
  } = props;
  return (
    <section className="ios-card flex flex-col gap-3 p-6">
      <h2 className="text-sm font-semibold text-[color:var(--text-primary)]">
        Run history ({runs.length})
      </h2>
      <ul className="flex flex-col divide-y divide-[color:var(--border-soft)]">
        {runs.map((run) => {
          const isSelected = run.runId === selectedRunId;
          const isEditing = run.runId === editingRunId;
          const effectiveRec = run.humanOverride?.recommendation ?? run.analysis.recommendation;
          const effectiveConf = run.humanOverride?.confidence ?? run.analysis.confidence;
          return (
            <li key={run.runId} className="flex flex-col gap-3 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => onSelect(run.runId)}
                  className={`flex flex-1 flex-wrap items-center gap-3 text-left text-sm ${
                    isSelected ? 'font-semibold text-[color:var(--text-primary)]' : 'text-[color:var(--text-secondary)]'
                  }`}
                >
                  <VerdictPill recommendation={effectiveRec} />
                  <span>{new Date(run.createdAt).toLocaleString()}</span>
                  <span className="text-xs uppercase tracking-wide">Conf: {effectiveConf}</span>
                  {run.humanOverride ? (
                    <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-800 dark:text-sky-200">
                      Overridden
                    </span>
                  ) : null}
                  <span className="text-xs text-[color:var(--text-secondary)]">
                    · {run.inputs.workbookFilename ? 'tracker + workbook' : 'tracker only'} ·{' '}
                    {run.modelUsed}
                  </span>
                </button>
                <div className="flex items-center gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => (isEditing ? onCancelEdit() : onStartEdit(run.runId))}
                    className="rounded-full border border-[color:var(--border-soft)] px-3 py-1 hover:bg-[color:var(--surface)]"
                  >
                    {isEditing ? 'Cancel' : run.humanOverride ? 'Edit override' : 'Override'}
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(run)}
                    className="rounded-full border border-rose-500/40 px-3 py-1 text-rose-700 hover:bg-rose-500/10 dark:text-rose-300"
                  >
                    Delete
                  </button>
                </div>
              </div>
              {isEditing ? (
                <OverrideForm run={run} onSubmit={(o) => onSubmitOverride(run, o)} />
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function OverrideForm({
  run,
  onSubmit,
}: {
  run: StoredRun;
  onSubmit: (override: {
    recommendation: Analysis['recommendation'];
    confidence: Analysis['confidence'];
    note: string;
  }) => Promise<void>;
}): JSX.Element {
  const initial = run.humanOverride;
  const [recommendation, setRecommendation] = useState<Analysis['recommendation']>(
    initial?.recommendation ?? run.analysis.recommendation,
  );
  const [confidence, setConfidence] = useState<Analysis['confidence']>(
    initial?.confidence ?? run.analysis.confidence,
  );
  const [note, setNote] = useState<string>(initial?.note ?? '');
  const [submitting, setSubmitting] = useState(false);

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setSubmitting(true);
        try {
          await onSubmit({ recommendation, confidence, note: note.trim() });
        } finally {
          setSubmitting(false);
        }
      }}
      className="flex flex-col gap-3 rounded-2xl border border-[color:var(--border-soft)] bg-[color:var(--surface)] p-4 text-sm"
    >
      <p className="text-xs text-[color:var(--text-secondary)]">
        Override the LLM verdict with a human call. The override is what shows in the picker badge
        and writes back to SharePoint. The LLM&rsquo;s original analysis is preserved underneath.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wide text-[color:var(--text-secondary)]">
            Verdict
          </span>
          <select
            value={recommendation}
            onChange={(e) => setRecommendation(e.target.value as Analysis['recommendation'])}
            className="rounded-2xl border border-[color:var(--border-soft)] bg-[color:var(--surface)] px-3 py-2 outline-none"
          >
            <option value="pursue">Pursue</option>
            <option value="pass">Pass</option>
            <option value="investigate">Investigate</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wide text-[color:var(--text-secondary)]">
            Confidence
          </span>
          <select
            value={confidence}
            onChange={(e) => setConfidence(e.target.value as Analysis['confidence'])}
            className="rounded-2xl border border-[color:var(--border-soft)] bg-[color:var(--surface)] px-3 py-2 outline-none"
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </label>
      </div>
      <label className="flex flex-col gap-1">
        <span className="text-xs uppercase tracking-wide text-[color:var(--text-secondary)]">
          Reasoning (optional)
        </span>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          placeholder="Why are you overriding the LLM call?"
          className="rounded-2xl border border-[color:var(--border-soft)] bg-[color:var(--surface)] px-3 py-2 outline-none"
        />
      </label>
      <div className="flex justify-end">
        <button
          type="submit"
          disabled={submitting}
          className="ios-button px-5 py-2 text-sm disabled:opacity-50"
        >
          {submitting ? 'Saving…' : 'Save override'}
        </button>
      </div>
    </form>
  );
}
