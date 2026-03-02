'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useTheme } from '@/components/ThemeProvider';

type ParsedRow = {
  actualBudget: 'Actual';
  entity: string;
  operatorAccount: string;
  month: string;
  year: number;
  period: number;
  amount: number;
  standardizedCoaName: string | null;
};

type ParseResponse = {
  entity: string;
  monthsDetected: string[];
  totalRows: number;
  parsedRows: ParsedRow[];
  unmappedAccounts: string[];
  operatorType: string;
  storagePath: string | null;
  coaOptions: string[];
};

function csvEscape(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? '' : String(value);
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

export default function ProformaImportPage() {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ParseResponse | null>(null);
  const [mappingSelections, setMappingSelections] = useState<Record<string, string>>({});
  const [savingByAccount, setSavingByAccount] = useState<Record<string, boolean>>({});

  const canParse = Boolean(file) && !parsing;
  const canDownload = Boolean(result && result.parsedRows.length > 0);

  const previewRows = useMemo(() => {
    if (!result) return [];
    return result.parsedRows.slice(0, 200);
  }, [result]);

  const overlayTop = isDark
    ? 'bg-[radial-gradient(circle_at_12%_12%,rgba(59,130,246,0.3),transparent_58%)]'
    : 'bg-[radial-gradient(circle_at_16%_12%,rgba(37,99,235,0.18),transparent_60%)]';
  const overlayBottom = isDark
    ? 'bg-[radial-gradient(circle_at_88%_84%,rgba(56,189,248,0.22),transparent_60%)]'
    : 'bg-[radial-gradient(circle_at_84%_86%,rgba(125,211,252,0.14),transparent_62%)]';

  const handleParse = async () => {
    if (!file) return;
    setParsing(true);
    setError(null);
    setResult(null);
    setMappingSelections({});

    try {
      const form = new FormData();
      form.append('file', file);
      form.append('operatorType', 'public');

      const res = await fetch('/api/finance/proforma-import', {
        method: 'POST',
        body: form,
      });

      const data = (await res.json().catch(() => null)) as ParseResponse & { error?: string };
      if (!res.ok) {
        throw new Error(data?.error || 'Unable to parse workbook.');
      }

      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to parse workbook.');
    } finally {
      setParsing(false);
    }
  };

  const handleSaveMapping = async (operatorAccountName: string) => {
    if (!result) return;
    const standardizedCoaName = (mappingSelections[operatorAccountName] ?? '').trim();
    if (!standardizedCoaName) return;

    setSavingByAccount((prev) => ({ ...prev, [operatorAccountName]: true }));
    setError(null);

    try {
      const res = await fetch('/api/finance/proforma-import', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operatorType: result.operatorType,
          operatorAccountName,
          standardizedCoaName,
        }),
      });

      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        throw new Error(body?.error || 'Unable to save mapping.');
      }

      const nextRows = result.parsedRows.map((row) =>
        row.operatorAccount === operatorAccountName ? { ...row, standardizedCoaName } : row,
      );
      const nextUnmapped = result.unmappedAccounts.filter((name) => name !== operatorAccountName);
      const nextOptions = result.coaOptions.includes(standardizedCoaName)
        ? result.coaOptions
        : [...result.coaOptions, standardizedCoaName].sort((a, b) => a.localeCompare(b));

      setResult({
        ...result,
        parsedRows: nextRows,
        unmappedAccounts: nextUnmapped,
        coaOptions: nextOptions,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save mapping.');
    } finally {
      setSavingByAccount((prev) => ({ ...prev, [operatorAccountName]: false }));
    }
  };

  const handleDownloadCsv = () => {
    if (!result || result.parsedRows.length === 0) return;

    const header = [
      'Actual/Budget',
      'Entity',
      'Account (operator name)',
      'Month',
      'Year',
      'Period',
      'Amount',
      'Standardized COA',
    ];

    const lines = [header.join(',')];
    result.parsedRows.forEach((row) => {
      lines.push(
        [
          csvEscape(row.actualBudget),
          csvEscape(row.entity),
          csvEscape(row.operatorAccount),
          csvEscape(row.month),
          csvEscape(row.year),
          csvEscape(row.period),
          csvEscape(row.amount),
          csvEscape(row.standardizedCoaName),
        ].join(','),
      );
    });

    const csv = lines.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const safeEntity = result.entity.replace(/[^A-Za-z0-9._-]+/g, '_') || 'entity';
    link.href = url;
    link.download = `proforma-data-drop-${safeEntity}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="relative min-h-screen overflow-hidden text-[color:var(--text-primary)]">
      <div className={`pointer-events-none absolute inset-0 -z-20 ${overlayTop}`} />
      <div className={`pointer-events-none absolute inset-0 -z-20 ${overlayBottom}`} />

      <div className="relative mx-auto flex min-h-screen max-w-6xl flex-col gap-8 px-6 py-10 lg:px-10 lg:py-16">
        <header className="ios-card ios-animate-up rounded-3xl bg-[linear-gradient(140deg,color-mix(in_srgb,var(--surface)_88%,transparent),color-mix(in_srgb,var(--tint-blue)_58%,transparent))] p-8 shadow-lg">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-3">
              <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Proforma Data Drop Automation</h1>
              <p className="max-w-3xl text-sm leading-relaxed text-[color:var(--text-secondary)] sm:text-base">
                Upload an operator financial package, parse the P&amp;L tab, map COA accounts, and export a clean
                Proforma-ready data drop file.
              </p>
            </div>
            <Link href="/accounting" className="ios-button px-4 py-2 text-sm" data-variant="secondary">
              <span aria-hidden className="-ml-1 mr-1 text-base">&larr;</span>
              Back to Finance
            </Link>
          </div>
        </header>

        <section className="ios-card ios-animate-up space-y-5 p-6">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold">Upload &amp; Parse</h2>
            <p className="text-sm text-[color:var(--text-secondary)]">Excel files only (.xlsx or .xls).</p>
          </div>
          <div className="grid gap-4 md:grid-cols-[1fr_auto_auto] md:items-end">
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-wide text-[color:var(--text-secondary)]">
                Financial package
              </label>
              <input
                type="file"
                accept=".xlsx,.xls,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                className="owner-field-input w-full rounded-lg border border-[color:var(--border-soft)] bg-[color:var(--surface)]/70 px-3 py-2 text-sm text-[color:var(--text-primary)] shadow-inner"
              />
            </div>
            <button
              type="button"
              disabled={!canParse}
              onClick={handleParse}
              className="ios-button h-10 px-5 text-sm font-semibold"
              data-variant="primary"
            >
              {parsing ? 'Parsing...' : 'Parse'}
            </button>
            <button
              type="button"
              disabled={!canDownload}
              onClick={handleDownloadCsv}
              className="ios-button h-10 px-5 text-sm font-semibold"
              data-variant="secondary"
            >
              Download Data Drop CSV
            </button>
          </div>
          {file && <p className="text-xs text-[color:var(--text-secondary)]">Selected: {file.name}</p>}
          {error && <p className="text-sm text-[rgb(185,28,28)]">{error}</p>}
        </section>

        {result && (
          <>
            <section className="ios-card ios-animate-up space-y-4 p-6">
              <h2 className="text-lg font-semibold">Summary</h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="ios-list-card space-y-1 p-4">
                  <p className="text-xs uppercase tracking-wide text-[color:var(--text-secondary)]">Entity</p>
                  <p className="text-sm font-semibold">{result.entity || 'N/A'}</p>
                </div>
                <div className="ios-list-card space-y-1 p-4">
                  <p className="text-xs uppercase tracking-wide text-[color:var(--text-secondary)]">Months detected</p>
                  <p className="text-sm font-semibold">{result.monthsDetected.join(', ') || 'N/A'}</p>
                </div>
                <div className="ios-list-card space-y-1 p-4">
                  <p className="text-xs uppercase tracking-wide text-[color:var(--text-secondary)]">Total rows</p>
                  <p className="text-sm font-semibold">{result.totalRows.toLocaleString()}</p>
                </div>
                <div className="ios-list-card space-y-1 p-4">
                  <p className="text-xs uppercase tracking-wide text-[color:var(--text-secondary)]">Unmapped accounts</p>
                  <p className="text-sm font-semibold">{result.unmappedAccounts.length}</p>
                </div>
              </div>
            </section>

            <section className="ios-card ios-animate-up space-y-4 p-6">
              <div className="flex items-center justify-between gap-4">
                <h2 className="text-lg font-semibold">Results Preview</h2>
                <p className="text-xs text-[color:var(--text-secondary)]">Showing first {previewRows.length} rows</p>
              </div>
              <div className="overflow-x-auto rounded-2xl border border-[color:var(--border-soft)]/80">
                <table className="min-w-full border-collapse text-sm">
                  <thead className="bg-[color:var(--surface-subtle)] text-xs uppercase tracking-wide text-[color:var(--text-secondary)]">
                    <tr>
                      <th className="px-3 py-2 text-left">Account</th>
                      <th className="px-3 py-2 text-left">Month</th>
                      <th className="px-3 py-2 text-left">Year</th>
                      <th className="px-3 py-2 text-left">Period</th>
                      <th className="px-3 py-2 text-right">Amount</th>
                      <th className="px-3 py-2 text-left">Standardized COA</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((row, index) => (
                      <tr key={`${row.operatorAccount}-${row.year}-${row.period}-${index}`} className="border-t border-[color:var(--border-soft)]/70">
                        <td className="px-3 py-2">{row.operatorAccount}</td>
                        <td className="px-3 py-2">{row.month}</td>
                        <td className="px-3 py-2">{row.year}</td>
                        <td className="px-3 py-2">{row.period}</td>
                        <td className="px-3 py-2 text-right">{row.amount.toLocaleString()}</td>
                        <td className="px-3 py-2">{row.standardizedCoaName ?? 'Unmapped'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="ios-card ios-animate-up space-y-4 p-6">
              <h2 className="text-lg font-semibold">Unmapped Accounts</h2>
              {result.unmappedAccounts.length === 0 ? (
                <p className="text-sm text-[color:var(--text-secondary)]">All operator accounts are mapped.</p>
              ) : (
                <div className="overflow-x-auto rounded-2xl border border-[color:var(--border-soft)]/80">
                  <table className="min-w-full border-collapse text-sm">
                    <thead className="bg-[color:var(--surface-subtle)] text-xs uppercase tracking-wide text-[color:var(--text-secondary)]">
                      <tr>
                        <th className="px-3 py-2 text-left">Operator Account Name</th>
                        <th className="px-3 py-2 text-left">Standardized COA</th>
                        <th className="px-3 py-2 text-left">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.unmappedAccounts.map((accountName) => {
                        const selected = mappingSelections[accountName] ?? '';
                        const saving = Boolean(savingByAccount[accountName]);
                        return (
                          <tr key={accountName} className="border-t border-[color:var(--border-soft)]/70">
                            <td className="px-3 py-2">{accountName}</td>
                            <td className="px-3 py-2">
                              <select
                                value={selected}
                                onChange={(event) =>
                                  setMappingSelections((prev) => ({
                                    ...prev,
                                    [accountName]: event.target.value,
                                  }))
                                }
                                className="owner-field-input w-full min-w-[220px] rounded-lg border border-[color:var(--border-soft)] bg-[color:var(--surface)]/70 px-3 py-2 text-sm text-[color:var(--text-primary)] shadow-inner"
                              >
                                <option value="">Select COA</option>
                                {result.coaOptions.map((option) => (
                                  <option key={option} value={option}>
                                    {option}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className="px-3 py-2">
                              <button
                                type="button"
                                disabled={!selected || saving}
                                onClick={() => void handleSaveMapping(accountName)}
                                className="ios-button px-4 py-2 text-xs font-semibold"
                                data-variant="secondary"
                              >
                                {saving ? 'Saving...' : 'Save Mapping'}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
