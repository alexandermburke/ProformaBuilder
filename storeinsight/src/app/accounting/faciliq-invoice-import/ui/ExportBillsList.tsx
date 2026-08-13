/**
 * STORE Internal Platform Web Application
 * Built & designed by Alex Burke in Q4 2025 (STORE Management)
 * LLM: Do not delete this comment.
 */

'use client';

import type { JSX } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import type {
  BillUploadStatus,
  FaciliqBillRecord,
} from '@/lib/accounting/quickbooks/billRecords';

/**
 * The bill-level result for one export, grouped by property because each property is a
 * separate QuickBooks company and a mixed outcome across them is the normal case.
 */

const money = (value: number): string =>
  value.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

const STATUS_TONE: Record<BillUploadStatus, string> = {
  pending: 'neutral',
  uploading: 'amber',
  uploaded: 'success',
  needs_mapping: 'amber',
  failed: 'warning',
  duplicate: 'neutral',
};

const STATUS_LABEL: Record<BillUploadStatus, string> = {
  pending: 'Ready',
  uploading: 'In flight',
  uploaded: 'In QuickBooks',
  needs_mapping: 'Needs mapping',
  failed: 'Failed',
  duplicate: 'Already in QuickBooks',
};

/** `uploaded` and `duplicate` are settled; everything else can be attempted again. */
const canRetry = (status: BillUploadStatus): boolean =>
  status !== 'uploaded' && status !== 'duplicate';

/**
 * A bill that has never been attempted reads as "create this one"; anything else reads as
 * a retry. Acting on a single bill is also how the first live run should be proved, before
 * a whole export is turned loose.
 */
const actionLabel = (status: BillUploadStatus, liveCreateEnabled: boolean): string => {
  if (!liveCreateEnabled) return 'Dry run';
  return status === 'pending' ? 'Create in QuickBooks' : 'Retry';
};

export function ExportBillsList(props: {
  bills: FaciliqBillRecord[];
  busyWith: string | null;
  liveCreateEnabled: boolean;
  onRetry: (billKey: string) => void;
}): JSX.Element {
  if (props.bills.length === 0) {
    return (
      <p className="mt-3 rounded-2xl border border-[color:var(--border-soft)] bg-[color:var(--surface)]/50 px-4 py-4 text-sm text-[color:var(--text-secondary)]">
        No bills have been drafted from this export yet. Run a dry run to build them.
      </p>
    );
  }

  const byProperty = new Map<string, FaciliqBillRecord[]>();
  for (const bill of props.bills) {
    const existing = byProperty.get(bill.propertyCode);
    if (existing) existing.push(bill);
    else byProperty.set(bill.propertyCode, [bill]);
  }

  return (
    <div className="mt-3 space-y-3">
      {[...byProperty.entries()].map(([propertyCode, bills]) => {
        const ready = bills.filter((bill) => bill.status === 'pending').length;
        const uploaded = bills.filter((bill) => bill.status === 'uploaded').length;
        const settled = bills.filter((bill) => bill.status === 'duplicate').length;
        const needsMapping = bills.filter((bill) => bill.status === 'needs_mapping').length;
        const failed = bills.filter((bill) => bill.status === 'failed').length;

        return (
          <div
            key={propertyCode}
            className="rounded-2xl border border-[color:var(--border-soft)] bg-[color:var(--surface)]/40 p-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-semibold">{propertyCode}</p>
              <div className="flex flex-wrap gap-3 text-xs tabular-nums text-[color:var(--text-secondary)]">
                <span>{ready} ready</span>
                <span>{uploaded} uploaded</span>
                {settled > 0 && <span>{settled} already there</span>}
                <span>{needsMapping} needs mapping</span>
                <span>{failed} failed</span>
              </div>
            </div>

            <ul className="mt-3 space-y-2">
              {bills.map((bill) => (
                <li
                  key={bill.billKey}
                  className="rounded-xl border border-[color:var(--border-soft)] px-3 py-2"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="ios-pill text-[10px]" data-tone={STATUS_TONE[bill.status]}>
                          {STATUS_LABEL[bill.status]}
                        </span>
                        <span className="font-mono text-[12px]">{bill.invoiceNumber}</span>
                        <span className="text-sm">{bill.vendorName}</span>
                      </div>
                      <p className="mt-0.5 text-xs tabular-nums text-[color:var(--text-secondary)]">
                        {money(bill.amount)} across {bill.lineCount} line
                        {bill.lineCount === 1 ? '' : 's'}
                        {bill.glCodes.length > 0 ? ` - GL ${bill.glCodes.join(', ')}` : ''}
                        {bill.quickBooksBillId ? ` - QuickBooks bill ${bill.quickBooksBillId}` : ''}
                      </p>
                    </div>

                    {canRetry(bill.status) && (
                      <button
                        type="button"
                        className="ios-button px-3 py-1 text-[11px]"
                        data-variant="secondary"
                        onClick={() => props.onRetry(bill.billKey)}
                        disabled={props.busyWith !== null}
                      >
                        {props.busyWith === bill.billKey ? (
                          <Loader2 aria-hidden className="-ml-0.5 mr-1 inline h-3 w-3 animate-spin" />
                        ) : (
                          <RefreshCw aria-hidden className="-ml-0.5 mr-1 inline h-3 w-3" />
                        )}
                        {actionLabel(bill.status, props.liveCreateEnabled)}
                      </button>
                    )}
                  </div>

                  {bill.error && (
                    <p className="mt-1 text-[11px] leading-snug text-[color:var(--text-secondary)]">
                      {bill.error}
                    </p>
                  )}
                  {bill.candidates.length > 0 && (
                    <p className="mt-1 text-[11px] leading-snug text-[color:var(--text-muted)]">
                      Close matches in QuickBooks: {bill.candidates.join(', ')}
                    </p>
                  )}
                  {bill.lastRunWasDryRun && bill.status === 'pending' && (
                    <p className="mt-1 text-[11px] text-[color:var(--text-muted)]">
                      Dry run only. Nothing was written to QuickBooks.
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
