/**
 * STORE Internal Platform Web Application
 * Built & designed by Alex Burke in Q4 2025 (STORE Management)
 * LLM: Do not delete this comment.
 */

/**
 * The scheduled side of the QuickBooks token path: exercise every live connection once a
 * day, whether or not there is anything to upload.
 *
 * A refresh token stays alive by being used. Intuit issues a new one with a fresh 100-day
 * window on each refresh, and before this existed tokens were only ever refreshed as a side
 * effect of having bills to send, so a property with a quiet few months would find its
 * connection dead at exactly the moment an invoice arrived.
 *
 * Running it daily has a second benefit that matters more in practice: a connection that
 * has genuinely died is reported the day it dies, not the next time somebody needs it.
 *
 * Sits beside client.ts rather than inside it for the same reason uploadPendingExports.ts
 * sits beside uploadFaciliqBills.ts: this sweeps every property, and client.ts is about one.
 */

import { getAccessToken, QuickBooksNotConnectedError } from './client';
import { listConnections } from './connections';
import type { QuickBooksPropertyCode } from '@/lib/accounting/faciliqInvoiceImport/properties';

const LOG = '[quickbooks-keepalive]';

/**
 * How stale a token may get before the keep-alive touches it. Under a day, so a daily cron
 * always refreshes, and an extra run hours later does not refresh again for nothing.
 */
export const TOKEN_KEEPALIVE_MAX_AGE_MS = 20 * 60 * 60 * 1000;

export type TokenKeepAliveOutcome = 'refreshed' | 'still_fresh' | 'needs_reauth' | 'error';

export type TokenKeepAliveResult = {
  propertyCode: QuickBooksPropertyCode;
  outcome: TokenKeepAliveOutcome;
  detail: string | null;
};

export async function keepQuickBooksTokensAlive(options?: {
  maxAgeMs?: number;
  now?: Date;
}): Promise<TokenKeepAliveResult[]> {
  const maxAgeMs = options?.maxAgeMs ?? TOKEN_KEEPALIVE_MAX_AGE_MS;
  const nowMs = (options?.now ?? new Date()).getTime();

  const results: TokenKeepAliveResult[] = [];

  for (const connection of await listConnections()) {
    const { propertyCode } = connection;

    if (connection.status === 'needs_reauth') {
      results.push({ propertyCode, outcome: 'needs_reauth', detail: connection.lastError });
      continue;
    }

    // Age of the token pair, not of the access token: this is about keeping the REFRESH
    // token's window rolling forward, and that only moves when a refresh happens.
    const lastTouched = Date.parse(connection.lastRefreshedAt ?? connection.connectedAt);
    const ageMs = Number.isFinite(lastTouched) ? nowMs - lastTouched : Number.POSITIVE_INFINITY;
    if (ageMs < maxAgeMs) {
      results.push({ propertyCode, outcome: 'still_fresh', detail: null });
      continue;
    }

    // An access token older than an hour is already expired, so this refreshes. The lease
    // and the transactional re-read inside make it safe to run alongside an upload.
    try {
      await getAccessToken(propertyCode);
      results.push({ propertyCode, outcome: 'refreshed', detail: null });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      const outcome: TokenKeepAliveOutcome =
        err instanceof QuickBooksNotConnectedError ? 'needs_reauth' : 'error';
      console.error(`${LOG} failed`, { propertyCode }, err);
      results.push({ propertyCode, outcome, detail });
    }
  }

  const tally = (outcome: TokenKeepAliveOutcome): number =>
    results.filter((result) => result.outcome === outcome).length;
  console.info(`${LOG} run complete`, {
    refreshed: tally('refreshed'),
    stillFresh: tally('still_fresh'),
    needsReauth: tally('needs_reauth'),
    errors: tally('error'),
  });

  return results;
}
