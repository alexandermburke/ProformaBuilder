/**
 * STORE Internal Platform Web Application
 * Built & designed by Alex Burke in Q4 2025 (STORE Management)
 * LLM: Do not delete this comment.
 */

'use client';

import BackLink from '@/components/BackLink';
import { useCallback, useMemo, useRef, useState, type DragEvent, type JSX } from 'react';
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Loader2 } from 'lucide-react';
import { useTheme } from '@/components/ThemeProvider';
import type { SplitFile } from '@/lib/accounting/faciliqInvoiceImport/buildSplitFiles';
import {
  clientFlaggedRows,
  type ClientInvoiceRow,
  type FaciliqInvoiceResponse,
} from '@/lib/accounting/faciliqInvoiceImport/clientReport';
import type { FlagSeverity } from '@/lib/accounting/faciliqInvoiceImport/reviewInvoices';
import { formatIsoDateForDisplay } from '@/lib/accounting/faciliqInvoiceImport/values';
import type { FaciliqIntakeRecord } from '@/lib/accounting/faciliqInvoiceIntake/records';
import { AutomatedIntakePanel } from './AutomatedIntakePanel';

const overlayTopLight = 'bg-[radial-gradient(circle_at_14%_10%,rgba(59,130,246,0.18),transparent_58%)]';
const overlayTopDark = 'bg-[radial-gradient(circle_at_14%_10%,rgba(59,130,246,0.26),transparent_56%)]';
const overlayBottomLight = 'bg-[radial-gradient(circle_at_86%_88%,rgba(14,165,233,0.14),transparent_62%)]';
const overlayBottomDark = 'bg-[radial-gradient(circle_at_86%_88%,rgba(14,165,233,0.2),transparent_60%)]';

const cardClass =
  'ios-card ios-animate-up rounded-3xl border border-[color:var(--border-soft)] bg-[linear-gradient(150deg,color-mix(in_srgb,var(--surface) 90%,transparent),color-mix(in_srgb,var(--tint-blue) 46%,transparent))] p-6 shadow-lg';

const CHECKS: readonly string[] = [
  'Invoice number, vendor, amount, invoice date, property, and GL code present on every row',
  'Amounts readable, non-zero, and equal to quantity x rate',
  'Dates real, inside the export window, and in a sensible order',
  'Property resolves to L001, P006, W002, or W003',
  'One invoice number never split across two QuickBooks companies',
  'Repeated lines and GL codes that disagree within a property',
];

const money = (value: number): string =>
  value.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

const severityTone: Record<FlagSeverity, string> = {
  error: 'warning',
  warning: 'amber',
  info: 'neutral',
};

type Status = 'idle' | 'checking' | 'done' | 'error';

export type FaciliqInvoiceImportScreenProps = {
  intakeRecords: FaciliqIntakeRecord[];
  intakeLoadError: string | null;
  mailboxLabel: string;
  liveCreateEnabled: boolean;
};

export default function FaciliqInvoiceImportScreen({
  intakeRecords,
  intakeLoadError,
  mailboxLabel,
  liveCreateEnabled,
}: FaciliqInvoiceImportScreenProps): JSX.Element {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const overlayTop = isDark ? overlayTopDark : overlayTopLight;
  const overlayBottom = isDark ? overlayBottomDark : overlayBottomLight;

  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [status, setStatus] = useState<Status>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [filename, setFilename] = useState<string | null>(null);
  const [result, setResult] = useState<FaciliqInvoiceResponse | null>(null);

  const runCheck = useCallback(async (file: File): Promise<void> => {
    setFilename(file.name);
    setStatus('checking');
    setErrorMessage(null);
    setResult(null);

    const body = new FormData();
    body.append('file', file);

    try {
      const response = await fetch('/api/accounting/faciliq-invoice-import', {
        method: 'POST',
        body,
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        const message =
          typeof payload === 'object' && payload !== null && 'error' in payload
            ? String((payload as { error: unknown }).error)
            : `Upload failed (${response.status}).`;
        setErrorMessage(message);
        setStatus('error');
        return;
      }
      setResult(payload as FaciliqInvoiceResponse);
      setStatus('done');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to read that file.');
      setStatus('error');
    }
  }, []);

  const onDrop = useCallback(
    (event: DragEvent<HTMLLabelElement>): void => {
      event.preventDefault();
      setIsDragging(false);
      const file = event.dataTransfer.files?.[0];
      if (file) void runCheck(file);
    },
    [runCheck],
  );

  const toggleDrag = (active: boolean) => (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setIsDragging(active);
  };

  const download = useCallback((file: SplitFile): void => {
    const blob = new Blob([file.csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = file.filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }, []);

  const report = result?.report ?? null;
  const files = useMemo(() => result?.files ?? [], [result]);

  const propertyFileByCode = useMemo(
    () => new Map(files.filter((file) => file.propertyCode).map((file) => [file.propertyCode, file])),
    [files],
  );
  const reviewFile = useMemo(() => files.find((file) => file.kind === 'review') ?? null, [files]);
  const flaggedRows = useMemo(() => (report?.ok ? clientFlaggedRows(report) : []), [report]);

  return (
    <div className="relative min-h-screen overflow-hidden text-[color:var(--text-primary)]">
      <div className={`pointer-events-none absolute inset-0 -z-20 ${overlayTop}`} />
      <div className={`pointer-events-none absolute inset-0 -z-20 ${overlayBottom}`} />

      <div className="relative mx-auto flex min-h-screen max-w-6xl flex-col gap-6 px-6 py-10 lg:px-10 lg:py-16">
        <header className="ios-card ios-animate-up rounded-3xl bg-[linear-gradient(140deg,color-mix(in_srgb,var(--surface) 88%,transparent),color-mix(in_srgb,var(--tint-blue) 58%,transparent))] p-8 shadow-lg">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-3">
              <span className="ios-badge text-[10px]">Automated accounting</span>
              <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
                FacilIQ Invoice Import Prep
              </h1>
              <p className="max-w-3xl text-sm leading-relaxed text-[color:var(--text-secondary)] sm:text-base">
                The weekly FacilIQ QuickBooks CSV is picked up from {mailboxLabel} on its own, or
                you can drop one in below. Every invoice row is read and checked, then the clean
                rows are split into one import file per property, because L001, P006, W002, and
                W003 each have their own QuickBooks company. Anything missing or questionable is
                held back for review instead of being imported.
              </p>
            </div>
            <BackLink href="/accounting" label="Back to accounting" />
          </div>
        </header>

        {/* Upload */}
        <section className="grid gap-6 lg:grid-cols-[1.15fr_1fr]">
          <label
            htmlFor="faciliq-csv-input"
            className={`ios-card ios-animate-up group relative flex cursor-pointer flex-col items-center justify-center overflow-hidden rounded-3xl p-8 text-center transition-all duration-500 ${
              isDragging ? 'ring-4 ring-[var(--accent)]/40' : ''
            }`}
            onDragEnter={toggleDrag(true)}
            onDragOver={toggleDrag(true)}
            onDragLeave={toggleDrag(false)}
            onDrop={onDrop}
          >
            <div className="flex h-14 w-14 items-center justify-center rounded-[22px] border border-white/60 bg-white/70 text-[color:var(--accent-strong)] shadow-[0_16px_36px_rgba(15,23,42,0.12)] backdrop-blur-md">
              {status === 'checking' ? (
                <Loader2 aria-hidden className="h-7 w-7 animate-spin" />
              ) : (
                <FileSpreadsheet aria-hidden className="h-7 w-7" />
              )}
            </div>

            <div className="mt-5 space-y-2">
              <p className="text-lg font-semibold">
                {status === 'checking' ? 'Reading every row...' : 'Drop the weekly FacilIQ CSV here'}
              </p>
              <p className="text-sm text-[color:var(--text-secondary)]">
                {filename ?? 'store-quickbooks-YYYY-MM-DD-to-YYYY-MM-DD.csv'}
              </p>
            </div>

            <button
              type="button"
              className="ios-button mt-6 px-6 py-2 text-xs uppercase tracking-[0.18em]"
              onClick={() => inputRef.current?.click()}
              disabled={status === 'checking'}
            >
              Browse files
            </button>

            <input
              id="faciliq-csv-input"
              ref={inputRef}
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void runCheck(file);
                event.target.value = '';
              }}
            />
          </label>

          <div className={cardClass}>
            <h2 className="text-lg font-semibold">What gets checked</h2>
            <ul className="mt-3 space-y-2 text-sm text-[color:var(--text-secondary)]">
              {CHECKS.map((check) => (
                <li key={check} className="flex gap-2">
                  <span aria-hidden className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-[color:var(--accent)]" />
                  <span>{check}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <AutomatedIntakePanel
          initialRecords={intakeRecords}
          loadError={intakeLoadError}
          mailboxLabel={mailboxLabel}
          liveCreateEnabled={liveCreateEnabled}
        />

        {errorMessage && (
          <section className="ios-card ios-animate-up rounded-3xl border border-[rgba(239,68,68,0.35)] p-5 shadow-lg">
            <div className="flex items-start gap-3">
              <AlertTriangle aria-hidden className="mt-0.5 h-5 w-5 text-[rgb(220,38,38)]" />
              <div>
                <p className="font-semibold">That file could not be checked</p>
                <p className="text-sm text-[color:var(--text-secondary)]">{errorMessage}</p>
              </div>
            </div>
          </section>
        )}

        {report && !report.ok && (
          <section className="ios-card ios-animate-up rounded-3xl border border-[rgba(239,68,68,0.35)] p-6 shadow-lg">
            <div className="flex items-start gap-3">
              <AlertTriangle aria-hidden className="mt-0.5 h-5 w-5 text-[rgb(220,38,38)]" />
              <div className="space-y-2">
                <p className="font-semibold">Stopped before reading any rows</p>
                <p className="text-sm text-[color:var(--text-secondary)]">{report.headerError}</p>
                <p className="text-xs text-[color:var(--text-muted)]">
                  Header read from the file: {report.header.join(' | ') || '(none)'}
                </p>
              </div>
            </div>
          </section>
        )}

        {report?.ok && (
          <>
            {/* Totals */}
            <section className={cardClass}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <h2 className="text-lg font-semibold">This file</h2>
                  <p className="text-sm text-[color:var(--text-secondary)]">
                    {report.sourceFilename}
                    {report.window
                      ? ` - covering ${formatIsoDateForDisplay(report.window.startIso)} to ${formatIsoDateForDisplay(report.window.endIso)}`
                      : ' - no date window in the filename'}
                  </p>
                </div>
                <span
                  className="ios-pill text-[11px]"
                  data-tone={report.totals.reconciles ? 'success' : 'warning'}
                >
                  {report.totals.reconciles
                    ? 'Splits tie back to the source total'
                    : 'Splits do not tie back - investigate'}
                </span>
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {[
                  { label: 'Invoice rows read', rows: report.totals.dataRows, amount: report.totals.sourceAmount, tone: 'neutral' },
                  { label: 'Ready to import', rows: report.totals.readyRows, amount: report.totals.readyAmount, tone: 'success' },
                  { label: 'Needs review', rows: report.totals.reviewRows, amount: report.totals.reviewAmount, tone: 'amber' },
                  { label: 'Property unresolved', rows: report.totals.unresolvedRows, amount: report.totals.unresolvedAmount, tone: 'warning' },
                ].map((tile) => (
                  <div
                    key={tile.label}
                    className="rounded-2xl border border-[color:var(--border-soft)] bg-[color:var(--surface)]/50 p-4"
                  >
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-[color:var(--text-muted)]">
                      {tile.label}
                    </p>
                    <p className="mt-1 text-2xl font-semibold tabular-nums">{tile.rows}</p>
                    <p className="text-sm text-[color:var(--text-secondary)] tabular-nums">
                      {money(tile.amount)}
                    </p>
                  </div>
                ))}
              </div>
            </section>

            {/* Column mapping: never imply where a value came from */}
            <section className={cardClass}>
              <h2 className="text-lg font-semibold">Where each field was read from</h2>
              <p className="mt-1 text-sm text-[color:var(--text-secondary)]">
                Columns are matched by name, not position, so a reordered export is caught rather
                than mis-read.
              </p>
              <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {report.columns
                  .filter((column) => column.required)
                  .map((column) => (
                    <div
                      key={column.key}
                      className="rounded-2xl border border-[color:var(--border-soft)] bg-[color:var(--surface)]/50 px-4 py-3"
                    >
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-[color:var(--text-muted)]">
                        {column.label}
                      </p>
                      <p className="font-mono text-[13px]">{column.header}</p>
                      <p className="text-[11px] text-[color:var(--text-muted)]">
                        column {column.index + 1}
                      </p>
                    </div>
                  ))}
              </div>
            </section>

            {/* Per-property splits */}
            <section className={cardClass}>
              <h2 className="text-lg font-semibold">Split by QuickBooks company</h2>
              <p className="mt-1 text-sm text-[color:var(--text-secondary)]">
                Each file keeps FacilIQ&rsquo;s original columns, so an existing QuickBooks import
                mapping still applies. Only rows that passed every check are included.
              </p>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {report.properties.map((bucket) => {
                  const file = propertyFileByCode.get(bucket.code) ?? null;
                  return (
                    <div
                      key={bucket.code}
                      className="flex flex-col gap-3 rounded-2xl border border-[color:var(--border-soft)] bg-[color:var(--surface)]/50 p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold">{bucket.code}</p>
                          <p className="text-sm text-[color:var(--text-secondary)]">{bucket.name}</p>
                        </div>
                        {bucket.reviewRows.length > 0 && (
                          <span className="ios-pill text-[10px]" data-tone="amber">
                            {bucket.reviewRows.length} held
                          </span>
                        )}
                      </div>

                      <div className="flex items-end justify-between gap-3">
                        <div>
                          <p className="text-2xl font-semibold tabular-nums">{bucket.readyRowCount}</p>
                          <p className="text-xs text-[color:var(--text-secondary)] tabular-nums">
                            {money(bucket.readyAmount)} ready
                          </p>
                        </div>
                        {file ? (
                          <button
                            type="button"
                            className="ios-button px-4 py-2 text-xs"
                            data-variant="primary"
                            onClick={() => download(file)}
                          >
                            <Download aria-hidden className="-ml-0.5 mr-1 inline h-3.5 w-3.5" />
                            Download CSV
                          </button>
                        ) : (
                          // No button when there is nothing to download. ios-button has no
                          // :disabled styling, so a disabled one still reads as clickable.
                          <p className="max-w-[58%] text-right text-xs leading-snug text-[color:var(--text-muted)]">
                            {bucket.reviewRows.length > 0
                              ? 'Nothing clean to import. Every row is held for review below.'
                              : 'No invoices for this property this week.'}
                          </p>
                        )}
                      </div>

                      {file && (
                        <p className="truncate font-mono text-[11px] text-[color:var(--text-muted)]">
                          {file.filename}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>

            {/* Flagged rows */}
            <section className={cardClass}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <h2 className="text-lg font-semibold">
                    Held for review ({report.totals.flaggedRows})
                  </h2>
                  <p className="text-sm text-[color:var(--text-secondary)]">
                    None of these were imported. Row numbers match the line in the uploaded file.
                  </p>
                </div>
                {reviewFile && (
                  <button
                    type="button"
                    className="ios-button px-4 py-2 text-sm"
                    data-variant="secondary"
                    onClick={() => download(reviewFile)}
                  >
                    <Download aria-hidden className="-ml-0.5 mr-1 inline h-4 w-4" />
                    Download review CSV
                  </button>
                )}
              </div>

              {flaggedRows.length === 0 ? (
                <div className="mt-4 flex items-center gap-2 rounded-2xl border border-[color:var(--border-soft)] bg-[color:var(--surface)]/50 px-4 py-6 text-sm">
                  <CheckCircle2 aria-hidden className="h-5 w-5 text-[rgb(22,163,74)]" />
                  Every row passed. The per-property files above are ready for QuickBooks.
                </div>
              ) : (
                <div className="mt-4 overflow-x-auto rounded-2xl border border-[color:var(--border-soft)] bg-[color:var(--surface)]/40">
                  <table className="min-w-full divide-y divide-[color:var(--border-soft)] text-sm">
                    <thead className="bg-[color:var(--surface-muted)]/60 text-[color:var(--text-secondary)]">
                      <tr>
                        <th className="px-3 py-2 text-left font-semibold">Row</th>
                        <th className="px-3 py-2 text-left font-semibold">Property</th>
                        <th className="px-3 py-2 text-left font-semibold">Invoice</th>
                        <th className="px-3 py-2 text-left font-semibold">Vendor</th>
                        <th className="px-3 py-2 text-left font-semibold">Date</th>
                        <th className="px-3 py-2 text-right font-semibold">Amount</th>
                        <th className="px-3 py-2 text-left font-semibold">GL</th>
                        <th className="px-3 py-2 text-left font-semibold">Why it was held</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[color:var(--border-soft)]">
                      {flaggedRows.map((row) => (
                        <FlaggedRow key={row.sourceLine} row={row} />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {report.notes.length > 0 && (
              <section className={cardClass}>
                <h2 className="text-lg font-semibold">Notes</h2>
                <ul className="mt-3 space-y-2 text-sm text-[color:var(--text-secondary)]">
                  {report.notes.map((note) => (
                    <li key={note} className="flex gap-2">
                      <span aria-hidden className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-[color:var(--text-muted)]" />
                      <span>{note}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function FlaggedRow({ row }: { row: ClientInvoiceRow }): JSX.Element {
  return (
    <tr className="align-top">
      <td className="px-3 py-3 tabular-nums text-[color:var(--text-secondary)]">{row.sourceLine}</td>
      <td className="px-3 py-3 font-semibold">
        {row.propertyCode ?? (
          <span className="text-[color:var(--text-muted)]">unresolved</span>
        )}
      </td>
      <td className="px-3 py-3 font-mono text-[12px]">
        {row.fields.invoiceNumber || <span className="text-[color:var(--text-muted)]">missing</span>}
      </td>
      <td className="px-3 py-3">
        {row.fields.vendor || <span className="text-[color:var(--text-muted)]">missing</span>}
      </td>
      <td className="px-3 py-3 whitespace-nowrap">
        {row.fields.invoiceDate || <span className="text-[color:var(--text-muted)]">missing</span>}
      </td>
      <td className="px-3 py-3 text-right tabular-nums">
        {row.amount === null ? (
          <span className="text-[color:var(--text-muted)]">{row.fields.amount || 'missing'}</span>
        ) : (
          money(row.amount)
        )}
      </td>
      <td className="px-3 py-3 font-mono text-[12px]">
        {row.fields.glCode || <span className="text-[color:var(--text-muted)]">missing</span>}
      </td>
      <td className="px-3 py-3">
        <div className="flex flex-col gap-2">
          {row.flags.map((flag) => (
            <div key={flag.code} className="space-y-1">
              <span className="ios-pill text-[10px]" data-tone={severityTone[flag.severity]}>
                {flag.label}
              </span>
              <p className="text-[11px] leading-snug text-[color:var(--text-secondary)]">
                {flag.detail}
              </p>
            </div>
          ))}
        </div>
      </td>
    </tr>
  );
}
