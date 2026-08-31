/**
 * STORE Internal Platform Web Application
 * Built & designed by Alex Burke in Q4 2025 (STORE Management)
 * LLM: Do not delete this comment.
 */

'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useState, type JSX } from 'react';
import { AlertTriangle, CheckCircle2, Link2, Loader2, Unlink } from 'lucide-react';
import { useTheme } from '@/components/ThemeProvider';
import type { QuickBooksConnectionsResponse } from '@/lib/accounting/quickbooks/apiContract';

/**
 * One row per STORE property, because each one keeps its own QuickBooks company. The row
 * shows the company that is actually attached, not just "connected", so a wrong pairing is
 * visible rather than implied.
 */

const overlayTopLight = 'bg-[radial-gradient(circle_at_14%_10%,rgba(59,130,246,0.18),transparent_58%)]';
const overlayTopDark = 'bg-[radial-gradient(circle_at_14%_10%,rgba(59,130,246,0.26),transparent_56%)]';

const cardClass =
  'ios-card ios-animate-up rounded-3xl border border-[color:var(--border-soft)] bg-[linear-gradient(150deg,color-mix(in_srgb,var(--surface) 90%,transparent),color-mix(in_srgb,var(--tint-blue) 46%,transparent))] p-6 shadow-lg';

const formatDate = (iso: string | null): string => {
  if (!iso) return 'never';
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleDateString('en-US') : iso;
};

type LiveCreateScope = QuickBooksConnectionsResponse['liveCreateScope'];

/**
 * Bill creation is decided per property, so the page says which ones rather than just yes or
 * no. During a staged rollout "Bill creation enabled" on its own reads as all of them.
 */
const liveCreateLabel = (scope: LiveCreateScope | undefined): string => {
  if (!scope || scope === 'none') return 'Dry run only';
  if (scope === 'all') return 'Bill creation enabled';
  return `Bill creation enabled: ${scope.join(', ')}`;
};

const liveCreateDescription = (scope: LiveCreateScope | undefined): string => {
  if (!scope || scope === 'none') {
    return 'Every upload runs as a dry run: vendors and accounts are resolved and the payload is built, but nothing is written to QuickBooks. Set QUICKBOOKS_LIVE_CREATE to a property code, a comma-separated list of codes, or true to allow creation.';
  }
  const reviewNote =
    'Bills still go through the normal QuickBooks review and approval before anything is paid.';
  if (scope === 'all') {
    return `Uploads can create real bills in every connected company. ${reviewNote}`;
  }
  return `Uploads can create real bills for ${scope.join(', ')}. Every other property stays a dry run and writes nothing. ${reviewNote}`;
};

/** True when this specific property is one the uploader may write to. */
const propertyCreatesBills = (scope: LiveCreateScope | undefined, propertyCode: string): boolean => {
  if (!scope || scope === 'none') return false;
  if (scope === 'all') return true;
  return scope.some((code) => code.toUpperCase() === propertyCode.toUpperCase());
};

export type QuickBooksConnectionsScreenProps = {
  data: QuickBooksConnectionsResponse | null;
  loadError: string | null;
  callbackError: string | null;
  connectedProperty: string | null;
};

export default function QuickBooksConnectionsScreen({
  data,
  loadError,
  callbackError,
  connectedProperty,
}: QuickBooksConnectionsScreenProps): JSX.Element {
  const { theme } = useTheme();
  const router = useRouter();
  const [busyWith, setBusyWith] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const disconnect = useCallback(
    async (propertyCode: string): Promise<void> => {
      setBusyWith(propertyCode);
      setActionError(null);
      try {
        const response = await fetch(
          `/api/accounting/quickbooks/connections?property=${encodeURIComponent(propertyCode)}`,
          { method: 'DELETE' },
        );
        if (!response.ok) {
          const payload: unknown = await response.json().catch(() => null);
          setActionError(
            typeof payload === 'object' && payload !== null && 'error' in payload
              ? String((payload as { error: unknown }).error)
              : `Disconnect failed (${response.status}).`,
          );
          return;
        }
        router.refresh();
      } catch (error) {
        setActionError(error instanceof Error ? error.message : 'Disconnect failed.');
      } finally {
        setBusyWith(null);
      }
    },
    [router],
  );

  const isProduction = data?.environment === 'production';

  return (
    <div className="relative min-h-screen overflow-hidden text-[color:var(--text-primary)]">
      <div
        className={`pointer-events-none absolute inset-0 -z-20 ${theme === 'dark' ? overlayTopDark : overlayTopLight}`}
      />

      <div className="relative mx-auto flex min-h-screen max-w-5xl flex-col gap-6 px-6 py-10 lg:px-10 lg:py-16">
        <header className="ios-card ios-animate-up rounded-3xl bg-[linear-gradient(140deg,color-mix(in_srgb,var(--surface) 88%,transparent),color-mix(in_srgb,var(--tint-blue) 58%,transparent))] p-8 shadow-lg">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-3">
              <span className="ios-badge text-[10px]">Automated accounting</span>
              <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
                QuickBooks connections
              </h1>
              <p className="max-w-3xl text-sm leading-relaxed text-[color:var(--text-secondary)] sm:text-base">
                Each STORE property keeps its own QuickBooks company, with its own vendors and
                chart of accounts. Connect each one separately. A company can only ever be
                attached to a single property, and a company whose name reads as a different
                property is refused outright.
              </p>
            </div>
            <Link href="/accounting/faciliq-invoice-import" className="ios-button px-4 py-2 text-sm" data-variant="secondary">
              <span aria-hidden className="-ml-1 mr-1 text-base">
                &larr;
              </span>
              Back to invoice import
            </Link>
          </div>
        </header>

        {connectedProperty && (
          <section className="ios-card ios-animate-up rounded-3xl border border-[rgba(22,163,74,0.35)] p-5 shadow-lg">
            <div className="flex items-start gap-3">
              <CheckCircle2 aria-hidden className="mt-0.5 h-5 w-5 text-[rgb(22,163,74)]" />
              <p className="text-sm">
                <span className="font-semibold">{connectedProperty}</span> is connected to QuickBooks.
              </p>
            </div>
          </section>
        )}

        {(callbackError || loadError || actionError) && (
          <section className="ios-card ios-animate-up rounded-3xl border border-[rgba(239,68,68,0.35)] p-5 shadow-lg">
            <div className="flex items-start gap-3">
              <AlertTriangle aria-hidden className="mt-0.5 h-5 w-5 text-[rgb(220,38,38)]" />
              <div className="space-y-1">
                <p className="font-semibold">That did not go through</p>
                <p className="text-sm text-[color:var(--text-secondary)]">
                  {callbackError || actionError || loadError}
                </p>
              </div>
            </div>
          </section>
        )}

        <section className={cardClass}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="ios-pill text-[11px]" data-tone={isProduction ? 'warning' : 'neutral'}>
              {isProduction ? 'Production QuickBooks' : 'Sandbox QuickBooks'}
            </span>
            <span
              className="ios-pill text-[11px]"
              data-tone={data?.liveCreateEnabled ? 'warning' : 'success'}
            >
              {liveCreateLabel(data?.liveCreateScope)}
            </span>
            {data && !data.credentialsConfigured && (
              <span className="ios-pill text-[11px]" data-tone="warning">
                Credentials missing
              </span>
            )}
          </div>
          <p className="mt-3 text-sm text-[color:var(--text-secondary)]">
            {liveCreateDescription(data?.liveCreateScope)}
          </p>
        </section>

        <section className={cardClass}>
          <h2 className="text-lg font-semibold">Properties</h2>
          <ul className="mt-4 space-y-3">
            {(data?.connections ?? []).map((connection) => (
              <li
                key={connection.propertyCode}
                className="flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-[color:var(--border-soft)] bg-[color:var(--surface)]/50 p-4"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{connection.propertyCode}</span>
                    <span className="text-sm text-[color:var(--text-secondary)]">
                      {connection.propertyName}
                    </span>
                    {connection.status === 'needs_reauth' && (
                      <span className="ios-pill text-[10px]" data-tone="warning">
                        Needs reconnecting
                      </span>
                    )}
                    {connection.connected && !connection.companyNameVerified && (
                      <span className="ios-pill text-[10px]" data-tone="amber">
                        Company name not verified
                      </span>
                    )}
                    {connection.connected && (
                      <span
                        className="ios-pill text-[10px]"
                        data-tone={
                          propertyCreatesBills(data?.liveCreateScope, connection.propertyCode)
                            ? 'warning'
                            : 'success'
                        }
                      >
                        {propertyCreatesBills(data?.liveCreateScope, connection.propertyCode)
                          ? 'Creates bills'
                          : 'Dry run'}
                      </span>
                    )}
                  </div>

                  {connection.connected || connection.status === 'needs_reauth' ? (
                    <>
                      <p className="text-sm text-[color:var(--text-secondary)]">
                        {connection.companyName || connection.companyLegalName || 'Unnamed company'}
                        <span className="text-[color:var(--text-muted)]"> - realm {connection.realmId}</span>
                      </p>
                      <p className="text-xs text-[color:var(--text-muted)]">
                        Connected {formatDate(connection.connectedAt)} by {connection.connectedBy || 'unknown'}
                        {connection.lastRefreshedAt
                          ? `, token last refreshed ${formatDate(connection.lastRefreshedAt)}`
                          : ''}
                      </p>
                      {connection.lastError && (
                        <p className="text-xs leading-snug text-[rgb(220,38,38)]">{connection.lastError}</p>
                      )}
                    </>
                  ) : (
                    <p className="text-sm text-[color:var(--text-muted)]">Not connected.</p>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <a
                    className="ios-button px-4 py-2 text-xs"
                    data-variant={connection.connected ? 'secondary' : 'primary'}
                    href={`/api/accounting/quickbooks/connect?property=${encodeURIComponent(connection.propertyCode)}`}
                  >
                    <Link2 aria-hidden className="-ml-0.5 mr-1 inline h-3.5 w-3.5" />
                    {connection.connected || connection.status === 'needs_reauth' ? 'Reconnect' : 'Connect'}
                  </a>
                  {(connection.connected || connection.status === 'needs_reauth') && (
                    <button
                      type="button"
                      className="ios-button px-4 py-2 text-xs"
                      data-variant="secondary"
                      onClick={() => void disconnect(connection.propertyCode)}
                      disabled={busyWith !== null}
                    >
                      {busyWith === connection.propertyCode ? (
                        <Loader2 aria-hidden className="-ml-0.5 mr-1 inline h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Unlink aria-hidden className="-ml-0.5 mr-1 inline h-3.5 w-3.5" />
                      )}
                      Disconnect
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
