/**
 * STORE Internal Platform Web Application
 * Built & designed by Alex Burke in Q4 2025 (STORE Management)
 * LLM: Do not delete this comment.
 */

'use client';

import Link from 'next/link';
import { useCallback, useState, type JSX } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, Inbox, Loader2, RefreshCw, Upload } from 'lucide-react';
import type {
  FaciliqExportUploadStatus,
  FaciliqIntakeRecord,
  FaciliqIntakeStatus,
} from '@/lib/accounting/faciliqInvoiceIntake/records';
import type {
  FaciliqIntakeListResponse,
  FaciliqIntakeRunResponse,
} from '@/lib/accounting/faciliqInvoiceIntake/apiContract';
import type { FaciliqBillRecord } from '@/lib/accounting/quickbooks/billRecords';
import type {
  QuickBooksBillsResponse,
  QuickBooksUploadResponse,
} from '@/lib/accounting/quickbooks/apiContract';
import { formatIsoDateForDisplay } from '@/lib/accounting/faciliqInvoiceImport/values';
import { ExportBillsList } from './ExportBillsList';

/**
 * What the scheduled billing@ intake has done, and what has since been sent to QuickBooks.
 *
 * Records arrive as a prop from the server component and are replaced by whatever a run
 * returns, so the panel never polls and never needs an effect. Bills are fetched per export
 * only when a row is opened, because most rows are never opened.
 */

const INTAKE_ENDPOINT = '/api/accounting/faciliq-invoice-intake';
const UPLOAD_ENDPOINT = '/api/accounting/quickbooks/upload';

const cardClass =
  'ios-card ios-animate-up rounded-3xl border border-[color:var(--border-soft)] bg-[linear-gradient(150deg,color-mix(in_srgb,var(--surface) 90%,transparent),color-mix(in_srgb,var(--tint-blue) 46%,transparent))] p-6 shadow-lg';

const money = (value: number): string =>
  value.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

const STATUS_TONE: Record<FaciliqIntakeStatus, string> = {
  parsed: 'success',
  duplicate: 'neutral',
  claimed: 'amber',
  rejected: 'amber',
  failed: 'warning',
};

const STATUS_LABEL: Record<FaciliqIntakeStatus, string> = {
  parsed: 'Imported',
  duplicate: 'Already imported',
  claimed: 'Interrupted mid-run',
  rejected: 'Not an export',
  failed: 'Failed',
};

const UPLOAD_TONE: Record<FaciliqExportUploadStatus, string> = {
  not_started: 'neutral',
  uploading: 'amber',
  uploaded: 'success',
  nothing_to_upload: 'neutral',
  partial: 'amber',
  needs_mapping: 'amber',
  upload_failed: 'warning',
};

const UPLOAD_LABEL: Record<FaciliqExportUploadStatus, string> = {
  not_started: 'Not sent to QuickBooks',
  uploading: 'Upload in flight',
  uploaded: 'All bills in QuickBooks',
  nothing_to_upload: 'No bills to send',
  partial: 'Some bills in QuickBooks',
  needs_mapping: 'Needs mapping',
  upload_failed: 'Upload failed',
};

const isRetryable = (status: FaciliqIntakeStatus): boolean =>
  status === 'failed' || status === 'claimed';

const receivedLabel = (record: FaciliqIntakeRecord): string =>
  record.receivedDateMst || record.receivedAt.slice(0, 10) || 'unknown date';

const periodLabel = (record: FaciliqIntakeRecord): string => {
  if (!record.periodStartIso || !record.periodEndIso) return 'No period in the filename';
  return `${formatIsoDateForDisplay(record.periodStartIso)} - ${formatIsoDateForDisplay(record.periodEndIso)}`;
};

const readError = (payload: unknown, fallback: string): string =>
  typeof payload === 'object' && payload !== null && 'error' in payload
    ? String((payload as { error: unknown }).error)
    : fallback;

export function AutomatedIntakePanel(props: {
  initialRecords: FaciliqIntakeRecord[];
  /** Set when the ledger could not be read at all, e.g. Firebase is not configured. */
  loadError: string | null;
  mailboxLabel: string;
  liveCreateEnabled: boolean;
}): JSX.Element {
  const [records, setRecords] = useState<FaciliqIntakeRecord[]>(props.initialRecords);
  const [billsByExport, setBillsByExport] = useState<Record<string, FaciliqBillRecord[]>>({});
  const [openExport, setOpenExport] = useState<string | null>(null);
  const [busyWith, setBusyWith] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [runNote, setRunNote] = useState<string | null>(null);

  const refreshRecords = useCallback(async (): Promise<void> => {
    const response = await fetch(INTAKE_ENDPOINT);
    if (!response.ok) return;
    const payload = (await response.json()) as FaciliqIntakeListResponse;
    setRecords(payload.records);
  }, []);

  const runIntake = useCallback(
    async (body: { retryMessageId?: string }, busyKey: string): Promise<void> => {
      setBusyWith(busyKey);
      setRunError(null);
      setRunNote(null);
      try {
        const response = await fetch(INTAKE_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const payload: unknown = await response.json();
        if (!response.ok) {
          setRunError(readError(payload, `The run failed (${response.status}).`));
          return;
        }
        const { summary, records: refreshed } = payload as FaciliqIntakeRunResponse;
        setRecords(refreshed);
        setRunNote(
          `Read ${summary.messagesScanned} message(s) in ${summary.mailbox}: ` +
            `${summary.parsed} imported, ${summary.duplicates} already imported, ` +
            `${summary.rejected} not an export, ${summary.failed} failed, ` +
            `${summary.alreadyRecorded} seen before.`,
        );
      } catch (error) {
        setRunError(error instanceof Error ? error.message : 'The run could not be started.');
      } finally {
        setBusyWith(null);
      }
    },
    [],
  );

  const loadBills = useCallback(async (messageId: string): Promise<void> => {
    const response = await fetch(`${UPLOAD_ENDPOINT}?messageId=${encodeURIComponent(messageId)}`);
    if (!response.ok) return;
    const payload = (await response.json()) as QuickBooksBillsResponse;
    setBillsByExport((current) => ({ ...current, [messageId]: payload.bills }));
  }, []);

  const toggleExport = useCallback(
    (messageId: string): void => {
      setOpenExport((current) => (current === messageId ? null : messageId));
      if (!billsByExport[messageId]) void loadBills(messageId);
    },
    [billsByExport, loadBills],
  );

  const runUpload = useCallback(
    async (
      messageId: string,
      body: { dryRun: boolean; billKey?: string },
      busyKey: string,
    ): Promise<void> => {
      setBusyWith(busyKey);
      setRunError(null);
      setRunNote(null);
      try {
        const response = await fetch(UPLOAD_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messageId, ...body }),
        });
        const payload: unknown = await response.json();
        if (!response.ok) {
          setRunError(readError(payload, `The upload failed (${response.status}).`));
          return;
        }
        const { summary, bills } = payload as QuickBooksUploadResponse;
        setBillsByExport((current) => ({ ...current, [messageId]: bills }));
        setOpenExport(messageId);
        setRunNote(
          `${summary.dryRun ? 'Dry run' : 'Upload'} over ${summary.billsConsidered} bill(s) in ` +
            `${summary.environment}: ${summary.uploaded} created, ${summary.duplicates} already in QuickBooks, ` +
            `${summary.needsMapping} need mapping, ${summary.failed} failed, ` +
            `${summary.skippedAlreadyUploaded} skipped as already uploaded.` +
            (summary.liveCreateSuppressed
              ? ' Live creation is turned off, so this ran as a dry run.'
              : ''),
        );
        await refreshRecords();
      } catch (error) {
        setRunError(error instanceof Error ? error.message : 'The upload could not be started.');
      } finally {
        setBusyWith(null);
      }
    },
    [refreshRecords],
  );

  const busy = busyWith !== null;

  return (
    <section className={cardClass}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">Automated intake from {props.mailboxLabel}</h2>
          <p className="max-w-2xl text-sm text-[color:var(--text-secondary)]">
            FacilIQ&rsquo;s weekly export email is picked up on a schedule, checked with the same
            rules as the drop zone above, and archived. An export is never imported twice, and a
            failure is kept here so it can be re-run once the cause is fixed. Clean rows can then
            be sent to each property&rsquo;s QuickBooks company as bills for accounting to review.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/accounting/quickbooks" className="ios-button px-4 py-2 text-sm" data-variant="secondary">
            QuickBooks connections
          </Link>
          <button
            type="button"
            className="ios-button px-4 py-2 text-sm"
            data-variant="secondary"
            onClick={() => void runIntake({}, 'run-all')}
            disabled={busy}
          >
            {busyWith === 'run-all' ? (
              <Loader2 aria-hidden className="-ml-0.5 mr-1.5 inline h-4 w-4 animate-spin" />
            ) : (
              <Inbox aria-hidden className="-ml-0.5 mr-1.5 inline h-4 w-4" />
            )}
            Check the mailbox now
          </button>
        </div>
      </div>

      {!props.liveCreateEnabled && (
        <p className="mt-4 rounded-2xl border border-[color:var(--border-soft)] bg-[color:var(--surface)]/50 px-4 py-3 text-sm text-[color:var(--text-secondary)]">
          Bill creation is turned off, so uploads run as dry runs: vendors and accounts are
          resolved and the payload is built, but nothing is written to QuickBooks.
        </p>
      )}

      {props.loadError && (
        <div className="mt-4 flex items-start gap-3 rounded-2xl border border-[rgba(239,68,68,0.35)] px-4 py-3">
          <AlertTriangle aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-[rgb(220,38,38)]" />
          <p className="text-sm text-[color:var(--text-secondary)]">
            The intake history could not be read: {props.loadError}
          </p>
        </div>
      )}

      {runError && (
        <div className="mt-4 flex items-start gap-3 rounded-2xl border border-[rgba(239,68,68,0.35)] px-4 py-3">
          <AlertTriangle aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-[rgb(220,38,38)]" />
          <p className="text-sm text-[color:var(--text-secondary)]">{runError}</p>
        </div>
      )}

      {runNote && (
        <p className="mt-4 rounded-2xl border border-[color:var(--border-soft)] bg-[color:var(--surface)]/50 px-4 py-3 text-sm text-[color:var(--text-secondary)]">
          {runNote}
        </p>
      )}

      {records.length === 0 ? (
        <p className="mt-4 rounded-2xl border border-[color:var(--border-soft)] bg-[color:var(--surface)]/50 px-4 py-6 text-sm text-[color:var(--text-secondary)]">
          No FacilIQ export emails have been picked up yet.
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {records.map((record) => {
            const isOpen = openExport === record.messageId;
            const counts = record.uploadCounts;
            return (
              <li
                key={record.messageId}
                className="rounded-2xl border border-[color:var(--border-soft)] bg-[color:var(--surface)]/50 p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="ios-pill text-[10px]" data-tone={STATUS_TONE[record.status]}>
                        {STATUS_LABEL[record.status]}
                      </span>
                      {record.status === 'parsed' && (
                        <span
                          className="ios-pill text-[10px]"
                          data-tone={UPLOAD_TONE[record.uploadStatus]}
                        >
                          {UPLOAD_LABEL[record.uploadStatus]}
                        </span>
                      )}
                      <span className="text-sm font-semibold">{periodLabel(record)}</span>
                    </div>
                    <p className="truncate font-mono text-[11px] text-[color:var(--text-muted)]">
                      {record.attachmentName ?? 'no CSV attachment'}
                    </p>
                    <p className="text-xs text-[color:var(--text-secondary)]">
                      Received {receivedLabel(record)} from {record.from || 'unknown sender'}
                      {record.attempts > 1 ? ` - ${record.attempts} attempts` : ''}
                    </p>
                  </div>

                  {record.status === 'parsed' && record.totals ? (
                    <div className="text-right">
                      <p className="text-sm font-semibold tabular-nums">
                        {record.totals.readyRows} ready
                      </p>
                      <p className="text-xs tabular-nums text-[color:var(--text-secondary)]">
                        {money(record.totals.readyAmount)}
                      </p>
                      {record.totals.flaggedRows > 0 && (
                        <p className="text-xs tabular-nums text-[color:var(--text-muted)]">
                          {record.totals.flaggedRows} held for review
                        </p>
                      )}
                    </div>
                  ) : (
                    isRetryable(record.status) && (
                      <button
                        type="button"
                        className="ios-button px-3 py-1.5 text-xs"
                        data-variant="secondary"
                        onClick={() => void runIntake({ retryMessageId: record.messageId }, record.messageId)}
                        disabled={busy}
                      >
                        {busyWith === record.messageId ? (
                          <Loader2 aria-hidden className="-ml-0.5 mr-1 inline h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <RefreshCw aria-hidden className="-ml-0.5 mr-1 inline h-3.5 w-3.5" />
                        )}
                        Retry
                      </button>
                    )
                  )}
                </div>

                {record.status === 'parsed' && (
                  <>
                    {counts && (
                      <div className="mt-3 flex flex-wrap gap-3 text-xs tabular-nums text-[color:var(--text-secondary)]">
                        <span>{counts.pending} bills ready</span>
                        <span>{counts.uploaded} uploaded</span>
                        {counts.duplicate > 0 && <span>{counts.duplicate} already in QuickBooks</span>}
                        <span>{counts.needs_mapping} needs mapping</span>
                        <span>{counts.failed} failed</span>
                      </div>
                    )}

                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        className="ios-button px-3 py-1.5 text-xs"
                        data-variant="secondary"
                        onClick={() =>
                          void runUpload(record.messageId, { dryRun: true }, `dry-${record.messageId}`)
                        }
                        disabled={busy}
                      >
                        {busyWith === `dry-${record.messageId}` ? (
                          <Loader2 aria-hidden className="-ml-0.5 mr-1 inline h-3.5 w-3.5 animate-spin" />
                        ) : null}
                        Dry run
                      </button>

                      {props.liveCreateEnabled && (
                        <button
                          type="button"
                          className="ios-button px-3 py-1.5 text-xs"
                          data-variant="primary"
                          onClick={() =>
                            void runUpload(record.messageId, { dryRun: false }, `live-${record.messageId}`)
                          }
                          disabled={busy}
                        >
                          {busyWith === `live-${record.messageId}` ? (
                            <Loader2 aria-hidden className="-ml-0.5 mr-1 inline h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Upload aria-hidden className="-ml-0.5 mr-1 inline h-3.5 w-3.5" />
                          )}
                          Create bills in QuickBooks
                        </button>
                      )}

                      <button
                        type="button"
                        className="ios-button px-3 py-1.5 text-xs"
                        data-variant="secondary"
                        onClick={() => toggleExport(record.messageId)}
                        disabled={busy}
                      >
                        {isOpen ? (
                          <ChevronDown aria-hidden className="-ml-0.5 mr-1 inline h-3.5 w-3.5" />
                        ) : (
                          <ChevronRight aria-hidden className="-ml-0.5 mr-1 inline h-3.5 w-3.5" />
                        )}
                        Bills
                      </button>
                    </div>

                    {record.lastUploadWasDryRun && record.lastUploadAt && (
                      <p className="mt-2 text-[11px] text-[color:var(--text-muted)]">
                        Last upload attempt was a dry run. Nothing was written to QuickBooks.
                      </p>
                    )}
                    {record.lastUploadError && (
                      <p className="mt-2 text-[11px] leading-snug text-[rgb(220,38,38)]">
                        {record.lastUploadError}
                      </p>
                    )}

                    {isOpen && (
                      <ExportBillsList
                        bills={billsByExport[record.messageId] ?? []}
                        busyWith={busyWith}
                        liveCreateEnabled={props.liveCreateEnabled}
                        onRetry={(billKey) =>
                          void runUpload(
                            record.messageId,
                            { dryRun: !props.liveCreateEnabled, billKey },
                            billKey,
                          )
                        }
                      />
                    )}
                  </>
                )}

                {record.headerError && (
                  <p className="mt-3 text-xs leading-snug text-[rgb(220,38,38)]">{record.headerError}</p>
                )}

                {record.error && !record.headerError && (
                  <p className="mt-3 text-xs leading-snug text-[color:var(--text-secondary)]">
                    {record.error}
                  </p>
                )}

                {record.notes.map((note) => (
                  <p key={note} className="mt-2 text-[11px] leading-snug text-[color:var(--text-muted)]">
                    {note}
                  </p>
                ))}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
