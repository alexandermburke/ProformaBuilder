'use client';

import BackLink from '@/components/BackLink';
import { useMemo, useState } from 'react';
import { useTheme } from '@/components/ThemeProvider';

type ProformaInputValueType = 'text' | 'number' | 'currency' | 'percent' | 'date';
type ProformaRunStatus = 'draft' | 'reviewed' | 'ready_for_excel';
type SupportedProformaWorkbookFamily = 'extra-space' | 'cubesmart' | 'public';

type ProformaPropertyInputRecord = {
  key: string;
  label: string;
  valueType: ProformaInputValueType;
  cellRef: string;
  required: boolean;
  source: 'extracted' | 'manual';
  displayValue: string;
};

type ProformaFactRow = {
  entity: string;
  operatorAccount: string;
  standardizedCoaName: string | null;
  month: number;
  year: number;
  periodDate: string;
  amount: number;
  sourceSheet: string;
};

type ProformaRunResponse = {
  runId: string;
  createdAt: string;
  status: ProformaRunStatus;
  operatorType: SupportedProformaWorkbookFamily;
  originalFileName: string;
  workbookTitle: string | null;
  propertyName: string | null;
  propertyAddress: string | null;
  reportMonth: string | null;
  totalFactRows: number;
  previewFactRows: ProformaFactRow[];
  unresolvedAccounts: string[];
  missingRequiredInputs: string[];
  propertyInputs: ProformaPropertyInputRecord[];
  warnings: Array<{ code: string; message: string; severity: 'warning' | 'error' }>;
  coaOptions: string[];
  guideUrl: string;
  sheetNames: string[];
};

const operatorOptions = [
  { id: 'auto', label: 'Auto detect' },
  { id: 'extra-space', label: 'Extra Space' },
  { id: 'cubesmart', label: 'CubeSmart' },
  { id: 'public', label: 'Public' },
];

function formatAmount(value: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);
}

function statusTone(status: ProformaRunStatus): { tone: 'blue' | 'green' | 'amber'; label: string } {
  switch (status) {
    case 'reviewed':
      return { tone: 'green', label: 'Reviewed' };
    case 'ready_for_excel':
      return { tone: 'blue', label: 'Ready for Excel' };
    default:
      return { tone: 'amber', label: 'Draft' };
  }
}

export default function ProformaRunBuilder() {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const [selectedOperatorType, setSelectedOperatorType] = useState('auto');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [propertyNameOverride, setPropertyNameOverride] = useState('');
  const [reportMonth, setReportMonth] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [savingInputs, setSavingInputs] = useState(false);
  const [savingMappings, setSavingMappings] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState<ProformaRunResponse | null>(null);
  const [inputDrafts, setInputDrafts] = useState<Record<string, string>>({});
  const [mappingDrafts, setMappingDrafts] = useState<Record<string, string>>({});

  const overlayTop = isDark
    ? 'bg-[radial-gradient(circle_at_12%_12%,rgba(34,197,94,0.28),transparent_58%)]'
    : 'bg-[radial-gradient(circle_at_16%_12%,rgba(16,185,129,0.2),transparent_62%)]';
  const overlayBottom = isDark
    ? 'bg-[radial-gradient(circle_at_88%_86%,rgba(59,130,246,0.18),transparent_60%)]'
    : 'bg-[radial-gradient(circle_at_82%_88%,rgba(59,130,246,0.12),transparent_64%)]';

  const unresolvedAccounts = run?.unresolvedAccounts ?? [];
  const warningCount = run?.warnings.length ?? 0;
  const statusMeta = statusTone(run?.status ?? 'draft');

  const inputSections = useMemo(() => {
    const propertyInputs = run?.propertyInputs ?? [];
    const basics = propertyInputs.filter((input) =>
      ['PROPERTY_NAME', 'PROPERTY_TYPE', 'PROPERTY_ADDRESS', 'UNITS_AVAILABLE', 'UNITS_OCCUPIED', 'NRSF', 'ENTITY'].includes(input.key),
    );
    const analyst = propertyInputs.filter((input) => !basics.some((basic) => basic.key === input.key));
    return { basics, analyst };
  }, [run]);

  const syncDrafts = (nextRun: ProformaRunResponse) => {
    setRun(nextRun);
    setInputDrafts(
      Object.fromEntries(nextRun.propertyInputs.map((input) => [input.key, input.displayValue ?? ''])),
    );
    setMappingDrafts((current) => {
      const next = { ...current };
      nextRun.unresolvedAccounts.forEach((account) => {
        if (!(account in next)) next[account] = '';
      });
      return next;
    });
  };

  const handleCreateRun = async () => {
    if (!selectedFile) {
      setError('Choose a workbook first.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('file', selectedFile);
      form.append('operatorType', selectedOperatorType);
      form.append('propertyName', propertyNameOverride);
      form.append('reportMonth', reportMonth);

      const response = await fetch('/api/finance/proforma-runs', { method: 'POST', body: form });
      const body = (await response.json().catch(() => null)) as ProformaRunResponse & { error?: string };
      if (!response.ok) throw new Error(body?.error || 'Unable to create proforma run.');
      syncDrafts(body);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to create proforma run.');
      setRun(null);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveInputs = async () => {
    if (!run) return;
    setSavingInputs(true);
    setError(null);
    try {
      const response = await fetch(`/api/finance/proforma-runs/${run.runId}/inputs`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inputs: inputDrafts }),
      });
      const body = (await response.json().catch(() => null)) as ProformaRunResponse & { error?: string };
      if (!response.ok) throw new Error(body?.error || 'Unable to save reviewed inputs.');
      syncDrafts(body);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to save reviewed inputs.');
    } finally {
      setSavingInputs(false);
    }
  };

  const handleSaveMappings = async () => {
    if (!run) return;
    const mappings = Object.entries(mappingDrafts)
      .filter(([account, standardizedCoaName]) => unresolvedAccounts.includes(account) && standardizedCoaName.trim())
      .map(([operatorAccountName, standardizedCoaName]) => ({ operatorAccountName, standardizedCoaName }));
    if (mappings.length === 0) {
      setError('Choose at least one COA mapping before saving.');
      return;
    }

    setSavingMappings(true);
    setError(null);
    try {
      const response = await fetch(`/api/finance/proforma-runs/${run.runId}/mappings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mappings }),
      });
      const body = (await response.json().catch(() => null)) as ProformaRunResponse & { error?: string };
      if (!response.ok) throw new Error(body?.error || 'Unable to save COA mappings.');
      syncDrafts(body);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to save COA mappings.');
    } finally {
      setSavingMappings(false);
    }
  };

  const handleExport = async () => {
    if (!run) return;
    setExporting(true);
    setError(null);
    try {
      const response = await fetch(`/api/finance/proforma-runs/${run.runId}/export-workbook`, { method: 'POST' });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error || 'Unable to export workbook.');
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const disposition = response.headers.get('Content-Disposition') ?? '';
      const fileNameMatch = disposition.match(/filename=\"?([^"]+)\"?/i);
      const fileName = fileNameMatch?.[1] ?? `Public_Proforma_${run.runId}.xlsx`;
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to export workbook.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden text-[color:var(--text-primary)]">
      <div className={`pointer-events-none absolute inset-0 -z-20 ${overlayTop}`} />
      <div className={`pointer-events-none absolute inset-0 -z-20 ${overlayBottom}`} />

      <div className="relative mx-auto flex min-h-screen max-w-7xl flex-col gap-8 px-6 py-10 lg:px-10 lg:py-16">
        <header className="ios-card ios-animate-up rounded-3xl bg-[linear-gradient(145deg,color-mix(in_srgb,var(--surface)_88%,transparent),color-mix(in_srgb,var(--tint-green)_58%,transparent))] p-8 shadow-lg">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-4">
              <span className="ios-badge text-[10px]">Database-backed proforma runs</span>
              <div className="space-y-3">
                <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Public Proforma Pipeline</h1>
                <p className="max-w-3xl text-sm leading-relaxed text-[color:var(--text-secondary)] sm:text-base">
                  Upload an owner workbook, normalize it into Supabase, review inputs and COA mappings, then export the Public
                  proforma workbook with the hidden `run_id` parameter used by Excel Power Query.
                </p>
              </div>
            </div>
            <BackLink href="/finance" label="Back to finance" />
          </div>
        </header>

        <section className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
          <div className="ios-card ios-animate-up space-y-6 p-6">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[color:var(--text-secondary)]">Step 1</p>
              <h2 className="text-xl font-semibold">Create a proforma run</h2>
              <p className="text-sm text-[color:var(--text-secondary)]">
                The app will detect the workbook family, parse normalized fact rows, persist them in Supabase, and open the
                review step on the same page.
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-[color:var(--text-secondary)]">Workbook family</span>
                <select
                  value={selectedOperatorType}
                  onChange={(event) => setSelectedOperatorType(event.target.value)}
                  className="owner-field-input w-full rounded-xl border border-[color:var(--border-soft)] bg-[color:var(--surface)]/75 px-3 py-3 text-sm text-[color:var(--text-primary)] shadow-inner"
                >
                  {operatorOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-[color:var(--text-secondary)]">Report month</span>
                <input
                  type="month"
                  value={reportMonth}
                  onChange={(event) => setReportMonth(event.target.value)}
                  className="owner-field-input w-full rounded-xl border border-[color:var(--border-soft)] bg-[color:var(--surface)]/75 px-3 py-3 text-sm text-[color:var(--text-primary)] shadow-inner"
                />
              </label>

              <label className="space-y-2 md:col-span-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-[color:var(--text-secondary)]">Property label override</span>
                <input
                  type="text"
                  value={propertyNameOverride}
                  onChange={(event) => setPropertyNameOverride(event.target.value)}
                  placeholder="Optional override if the workbook title is not the final property name"
                  className="owner-field-input w-full rounded-xl border border-[color:var(--border-soft)] bg-[color:var(--surface)]/75 px-3 py-3 text-sm text-[color:var(--text-primary)] shadow-inner"
                />
              </label>

              <label className="space-y-2 md:col-span-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-[color:var(--text-secondary)]">Workbook file</span>
                <input
                  type="file"
                  accept=".xlsx,.xls,.xlsm"
                  onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
                  className="owner-field-input w-full rounded-xl border border-[color:var(--border-soft)] bg-[color:var(--surface)]/75 px-3 py-3 text-sm text-[color:var(--text-primary)] shadow-inner"
                />
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button type="button" onClick={handleCreateRun} disabled={!selectedFile || submitting} className="ios-button px-4 py-2 text-sm" data-variant="primary">
                {submitting ? 'Creating run...' : 'Create run'}
              </button>
              <span className="text-sm text-[color:var(--text-secondary)]">
                {selectedFile ? `Selected: ${selectedFile.name}` : 'Choose an owner workbook to begin.'}
              </span>
            </div>

            {error && <p className="text-sm text-[rgb(185,28,28)]">{error}</p>}
          </div>

          <div className="ios-card ios-animate-up space-y-6 p-6">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[color:var(--text-secondary)]">Step 2</p>
              <h2 className="text-xl font-semibold">Run summary</h2>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="ios-list-card space-y-1 p-4">
                <p className="text-xs uppercase tracking-wide text-[color:var(--text-secondary)]">Status</p>
                <span className="ios-pill text-[11px]" data-tone={statusMeta.tone}>
                  {statusMeta.label}
                </span>
              </div>
              <div className="ios-list-card space-y-1 p-4">
                <p className="text-xs uppercase tracking-wide text-[color:var(--text-secondary)]">Workbook family</p>
                <p className="text-sm font-semibold">{run?.operatorType ?? 'Awaiting run'}</p>
              </div>
              <div className="ios-list-card space-y-1 p-4">
                <p className="text-xs uppercase tracking-wide text-[color:var(--text-secondary)]">Fact rows</p>
                <p className="text-sm font-semibold">{run?.totalFactRows.toLocaleString() ?? '0'}</p>
              </div>
              <div className="ios-list-card space-y-1 p-4">
                <p className="text-xs uppercase tracking-wide text-[color:var(--text-secondary)]">Unresolved accounts</p>
                <p className="text-sm font-semibold">{unresolvedAccounts.length}</p>
              </div>
            </div>

            <div className="rounded-2xl border border-[color:var(--border-soft)]/80 p-4">
              <p className="text-sm font-semibold">{run?.propertyName ?? 'No run loaded yet'}</p>
              <p className="mt-1 text-sm text-[color:var(--text-secondary)]">{run?.workbookTitle ?? 'Create a run to see the parsed workbook summary.'}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <span className="ios-pill text-[11px]" data-tone="green">
                  {warningCount} warning{warningCount === 1 ? '' : 's'}
                </span>
                <span className="ios-pill text-[11px]" data-tone="blue">
                  {run?.sheetNames.length ?? 0} sheets
                </span>
              </div>
            </div>

            <a href={run?.guideUrl ?? '/finance/proforma-excel-connection.md'} target="_blank" rel="noreferrer" className="ios-button w-fit px-4 py-2 text-sm" data-variant="secondary">
              Open Excel connection guide
            </a>
          </div>
        </section>

        {run && (
          <>
            <section className="ios-card ios-animate-up space-y-6 p-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[color:var(--text-secondary)]">Step 3</p>
                  <h2 className="text-xl font-semibold">Review workbook-backed inputs</h2>
                </div>
                <button type="button" onClick={handleSaveInputs} disabled={savingInputs} className="ios-button px-4 py-2 text-sm" data-variant="primary">
                  {savingInputs ? 'Saving...' : 'Save inputs'}
                </button>
              </div>

              {run.warnings.length > 0 && (
                <div className="grid gap-3">
                  {run.warnings.map((warning) => (
                    <div key={`${warning.code}-${warning.message}`} className="rounded-2xl border border-[rgba(245,158,11,0.35)] bg-[rgba(245,158,11,0.08)] p-4 text-sm">
                      {warning.message}
                    </div>
                  ))}
                </div>
              )}

              <div className="grid gap-6 xl:grid-cols-2">
                {[
                  { title: 'Core inputs', items: inputSections.basics },
                  { title: 'Analyst-reviewed inputs', items: inputSections.analyst },
                ].map((section) => (
                  <div key={section.title} className="space-y-3">
                    <h3 className="text-sm font-semibold uppercase tracking-wide text-[color:var(--text-secondary)]">{section.title}</h3>
                    <div className="grid gap-3">
                      {section.items.map((input) => (
                        <label key={input.key} className="space-y-2 rounded-2xl border border-[color:var(--border-soft)]/80 p-4">
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-sm font-semibold">{input.label}</span>
                            <span className="ios-pill text-[11px]" data-tone={input.source === 'manual' ? 'amber' : 'blue'}>
                              {input.source === 'manual' ? 'Manual' : 'Extracted'}
                            </span>
                          </div>
                          <input
                            type="text"
                            value={inputDrafts[input.key] ?? input.displayValue ?? ''}
                            onChange={(event) => setInputDrafts((current) => ({ ...current, [input.key]: event.target.value }))}
                            className="owner-field-input w-full rounded-xl border border-[color:var(--border-soft)] bg-[color:var(--surface)]/75 px-3 py-3 text-sm text-[color:var(--text-primary)] shadow-inner"
                          />
                          <p className="text-xs text-[color:var(--text-secondary)]">
                            {input.cellRef}
                            {input.required ? ' - required before review is complete' : ''}
                          </p>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="ios-card ios-animate-up space-y-6 p-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[color:var(--text-secondary)]">COA review</p>
                  <h2 className="text-xl font-semibold">Resolve unmapped accounts</h2>
                </div>
                <button type="button" onClick={handleSaveMappings} disabled={savingMappings} className="ios-button px-4 py-2 text-sm" data-variant="primary">
                  {savingMappings ? 'Saving...' : 'Save mappings'}
                </button>
              </div>

              {unresolvedAccounts.length === 0 ? (
                <div className="ios-list-card p-5 text-sm text-[color:var(--text-secondary)]">All parsed accounts currently have COA mappings.</div>
              ) : (
                <div className="grid gap-3">
                  {unresolvedAccounts.map((account) => (
                    <div key={account} className="grid gap-3 rounded-2xl border border-[color:var(--border-soft)]/80 p-4 md:grid-cols-[1fr_300px] md:items-center">
                      <div>
                        <p className="text-sm font-semibold">{account}</p>
                        <p className="text-xs text-[color:var(--text-secondary)]">Choose the standardized STORE COA for this operator account.</p>
                      </div>
                      <select
                        value={mappingDrafts[account] ?? ''}
                        onChange={(event) => setMappingDrafts((current) => ({ ...current, [account]: event.target.value }))}
                        className="owner-field-input w-full rounded-xl border border-[color:var(--border-soft)] bg-[color:var(--surface)]/75 px-3 py-3 text-sm text-[color:var(--text-primary)] shadow-inner"
                      >
                        <option value="">Select COA</option>
                        {run.coaOptions.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
              <div className="ios-card ios-animate-up space-y-5 p-6">
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[color:var(--text-secondary)]">Preview</p>
                  <h2 className="text-xl font-semibold">Normalized fact rows</h2>
                </div>
                <div className="overflow-x-auto rounded-2xl border border-[color:var(--border-soft)]/80">
                  <table className="min-w-full border-collapse text-sm">
                    <thead className="bg-[color:var(--surface-subtle)] text-left">
                      <tr>
                        {['Period', 'Account', 'Amount', 'COA', 'Sheet'].map((label) => (
                          <th key={label} className="px-3 py-2 font-semibold">
                            {label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {run.previewFactRows.map((row) => (
                        <tr key={`${row.periodDate}-${row.operatorAccount}-${row.sourceSheet}`} className="border-t border-[color:var(--border-soft)]/70">
                          <td className="px-3 py-2">{row.periodDate}</td>
                          <td className="px-3 py-2">{row.operatorAccount}</td>
                          <td className="px-3 py-2">{formatAmount(row.amount)}</td>
                          <td className="px-3 py-2">{row.standardizedCoaName ?? 'Unmapped'}</td>
                          <td className="px-3 py-2">{row.sourceSheet}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="ios-card ios-animate-up space-y-5 p-6">
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[color:var(--text-secondary)]">Step 4</p>
                  <h2 className="text-xl font-semibold">Export workbook</h2>
                  <p className="text-sm text-[color:var(--text-secondary)]">
                    This downloads the Public proforma workbook copy with the hidden `run_id` value already stamped into the DB config
                    sheet. After download, open the file in Excel and use `Refresh All`.
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="ios-list-card space-y-1 p-4">
                    <p className="text-xs uppercase tracking-wide text-[color:var(--text-secondary)]">Missing reviewed inputs</p>
                    <p className="text-lg font-semibold">{run.missingRequiredInputs.length}</p>
                  </div>
                  <div className="ios-list-card space-y-1 p-4">
                    <p className="text-xs uppercase tracking-wide text-[color:var(--text-secondary)]">Unresolved mappings</p>
                    <p className="text-lg font-semibold">{run.unresolvedAccounts.length}</p>
                  </div>
                </div>
                <button type="button" onClick={handleExport} disabled={exporting} className="ios-button w-fit px-4 py-2 text-sm" data-variant="primary">
                  {exporting ? 'Exporting...' : 'Download workbook'}
                </button>
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
