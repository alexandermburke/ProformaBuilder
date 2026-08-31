/**
 * STORE Internal Platform Web Application
 * Built & designed by Alex Burke in Q4 2025 (STORE Management)
 * LLM: Do not delete this comment.
 */

/**
 * An authorized QuickBooks Accounting API client bound to ONE property's company, plus the
 * token path every QuickBooks caller shares.
 *
 * The realmId is read from that property's stored connection and baked into the client, so
 * a caller cannot accidentally aim a request at another company: there is no parameter to
 * get wrong.
 *
 * Access tokens last an hour. A refresh token can be spent exactly ONCE, so refreshing is
 * serialized twice over: one in-flight promise per property inside this process, and a
 * short Firestore lease (`claimTokenRefresh`) across processes. The lease read is a
 * transaction, and THAT is the guarantee that matters -- it means the refresh token being
 * spent is the one Firestore holds right now, never one off a caller's snapshot. Spending a
 * superseded refresh token is what Intuit answers with "Incorrect or invalid refresh
 * token", and it is how this integration used to lose a connection a second after a
 * refresh that worked. A caller that loses the lease waits and re-reads rather than racing.
 */

import type { QuickBooksPropertyCode } from '@/lib/accounting/faciliqInvoiceImport/properties';
import { apiBaseUrl, getQuickBooksCredentials, type QuickBooksEnvironment } from './config';
import {
  claimTokenRefresh,
  getConnection,
  markConnectionNeedsReauth,
  readConnectionTokens,
  releaseTokenRefresh,
  TOKEN_REFRESH_LEASE_MS,
  updateConnectionTokens,
  type StoredQuickBooksConnection,
} from './connections';
import { QuickBooksTokenError, refreshAccessToken } from './oauth';

const LOG = '[quickbooks]';
/** Refresh this far ahead of expiry so a slow request cannot land after the token dies. */
const REFRESH_MARGIN_MS = 120_000;
/**
 * Attempts at getting a live token when another actor holds the refresh lease. Each attempt
 * waits out the rest of that lease, so two are normally enough and the rest is slack.
 */
const REFRESH_ATTEMPTS = 4;
/** Grace added to a lease wait, and the fallback when a lease carries no readable expiry. */
const REFRESH_POLL_MS = 750;

export type QuickBooksFaultError = {
  Message?: string;
  Detail?: string;
  code?: string;
  element?: string;
};

export class QuickBooksApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly detail: string | null;
  readonly element: string | null;

  constructor(
    message: string,
    params: { status: number; code?: string | null; detail?: string | null; element?: string | null },
  ) {
    super(message);
    this.name = 'QuickBooksApiError';
    this.status = params.status;
    this.code = params.code ?? null;
    this.detail = params.detail ?? null;
    this.element = params.element ?? null;
  }

  /** Throttling and 5xx are worth another attempt; a validation fault is not. */
  get isRetryable(): boolean {
    return this.status === 429 || this.status >= 500;
  }
}

const parseFault = (status: number, text: string): QuickBooksApiError => {
  try {
    const json = JSON.parse(text) as { Fault?: { Error?: QuickBooksFaultError[] } };
    const first = json.Fault?.Error?.[0];
    if (first) {
      return new QuickBooksApiError(first.Message ?? `QuickBooks request failed (${status}).`, {
        status,
        code: first.code ?? null,
        detail: first.Detail ?? null,
        element: first.element ?? null,
      });
    }
  } catch {
    // Fall through to the raw-text form below.
  }
  return new QuickBooksApiError(`QuickBooks request failed (${status}): ${text.slice(0, 300)}`, {
    status,
  });
};

export type QuickBooksClient = {
  propertyCode: QuickBooksPropertyCode;
  realmId: string;
  environment: QuickBooksEnvironment;
  companyName: string;
  /** Runs a QuickBooks SQL-like query and returns the rows for `entity`. */
  query<T>(entity: string, statement: string): Promise<T[]>;
  /**
   * POSTs a new entity and returns the created object.
   *
   * `requestId` is QuickBooks' idempotency key. It must be DETERMINISTIC for a given
   * logical write and persisted before the first attempt: replaying the same id returns
   * the original result instead of creating a second entity. A fresh random id per attempt
   * gives no protection at all.
   */
  create<T>(entity: string, payload: unknown, options: { requestId: string }): Promise<T>;
};

/** QuickBooks caps `requestid` at 50 characters and scopes uniqueness to the realm. */
export const QBO_REQUEST_ID_MAX = 50;

/** Returned when a `requestid` has already been used for a different payload. */
export const QBO_DUPLICATE_REQUEST_ID_CODE = '600';

export class QuickBooksNotConnectedError extends Error {
  readonly propertyCode: QuickBooksPropertyCode;

  constructor(propertyCode: QuickBooksPropertyCode, message: string) {
    super(message);
    this.name = 'QuickBooksNotConnectedError';
    this.propertyCode = propertyCode;
  }
}

/** In-flight refreshes, one per property: the in-process half of the serialization. */
const refreshesInFlight = new Map<QuickBooksPropertyCode, Promise<string>>();

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The freshest connection this process has seen, per property.
 *
 * Never authoritative, and deliberately not consulted when a refresh token is about to be
 * spent: `claimTokenRefresh` re-reads the document in a transaction for that. This map only
 * saves a Firestore round trip when several requests, or several exports, share a property
 * inside one invocation.
 */
const latestConnection = new Map<QuickBooksPropertyCode, StoredQuickBooksConnection>();

/**
 * Keyed by the property the caller asked about, NOT by `connection.propertyCode`, so a
 * document whose field ever disagreed with its id could not be filed under a neighbour's key.
 */
const remember = (
  propertyCode: QuickBooksPropertyCode,
  connection: StoredQuickBooksConnection,
): StoredQuickBooksConnection => {
  latestConnection.set(propertyCode, connection);
  return connection;
};

/** Called when a connection is disconnected or replaced, so a warm process forgets its token. */
export const forgetConnection = (propertyCode: QuickBooksPropertyCode): void => {
  latestConnection.delete(propertyCode);
};

/** Whether a stored access token is usable, with the safety margin applied. */
export const isAccessTokenFresh = (
  connection: StoredQuickBooksConnection,
  nowMs: number = Date.now(),
): boolean => {
  const expiresAt = Date.parse(connection.accessTokenExpiresAt);
  return Number.isFinite(expiresAt) && expiresAt - REFRESH_MARGIN_MS > nowMs;
};

/**
 * The access token on `connection`, if it is fresh and is not one we have been told to
 * avoid. `notThisToken` is how the reactive 401 path says "anything but the token that
 * just failed", which a plain freshness check would happily hand back.
 */
const acceptableToken = (
  connection: StoredQuickBooksConnection | undefined,
  notThisToken?: string,
): string | null => {
  if (!connection || !isAccessTokenFresh(connection)) return null;
  const token = readConnectionTokens(connection).accessToken;
  return token === notThisToken ? null : token;
};

/** The "a person has to reconnect this" error, worded in one place for three call sites. */
const needsReauth = (
  propertyCode: QuickBooksPropertyCode,
  lastError: string | null,
): QuickBooksNotConnectedError =>
  new QuickBooksNotConnectedError(
    propertyCode,
    `${propertyCode} needs to be reconnected to QuickBooks${lastError ? `: ${lastError}` : '.'}`,
  );

/**
 * How long to wait for whoever holds the lease.
 *
 * Waiting out the remaining lease rather than a fixed tick, because a fixed poll shorter
 * than the lease guarantees giving up while the lease is still running.
 */
const leaseWaitMs = (heldUntil: string | null): number => {
  const heldUntilMs = heldUntil ? Date.parse(heldUntil) : Number.NaN;
  if (!Number.isFinite(heldUntilMs)) return REFRESH_POLL_MS;
  return Math.min(Math.max(heldUntilMs - Date.now(), 0) + REFRESH_POLL_MS, TOKEN_REFRESH_LEASE_MS);
};

/**
 * A live access token for a property, refreshing and persisting one first when the stored
 * one is at or near expiry. The only way to get a token.
 */
export async function getAccessToken(
  propertyCode: QuickBooksPropertyCode,
  options?: { notThisToken?: string },
): Promise<string> {
  const cached = acceptableToken(latestConnection.get(propertyCode), options?.notThisToken);
  if (cached) return cached;

  const pending = refreshesInFlight.get(propertyCode);
  if (pending) {
    const token = await pending;
    if (token !== options?.notThisToken) return token;
  }

  const refreshRun: Promise<string> = refreshUnderLease(propertyCode, options?.notThisToken).finally(
    () => {
      // Only clear our own entry: a later caller may already have replaced it.
      if (refreshesInFlight.get(propertyCode) === refreshRun) refreshesInFlight.delete(propertyCode);
    },
  );
  refreshesInFlight.set(propertyCode, refreshRun);
  return refreshRun;
}

/**
 * Gets a live access token by refreshing under the Firestore lease, or by waiting for
 * whoever holds it. Never spends a refresh token read from a stale snapshot.
 */
async function refreshUnderLease(
  propertyCode: QuickBooksPropertyCode,
  notThisToken?: string,
): Promise<string> {
  for (let attempt = 1; attempt <= REFRESH_ATTEMPTS; attempt += 1) {
    const lease = await claimTokenRefresh({ propertyCode, nowMs: Date.now() });
    const release = () => releaseTokenRefresh(propertyCode).catch(() => {});

    if (!lease.connection) {
      latestConnection.delete(propertyCode);
      throw new QuickBooksNotConnectedError(
        propertyCode,
        `${propertyCode} is no longer connected to a QuickBooks company.`,
      );
    }

    // A transaction read, so this is what Firestore holds right now. Everything below works
    // from it, which is what keeps a superseded refresh token from being spent.
    const connection = remember(propertyCode, lease.connection);

    if (connection.status === 'needs_reauth') {
      if (lease.granted) await release();
      throw needsReauth(propertyCode, connection.lastError);
    }

    // Someone else may already have done the work while we waited.
    const ready = acceptableToken(connection, notThisToken);
    if (ready) {
      if (lease.granted) await release();
      return ready;
    }

    if (!lease.granted) {
      const waitMs = leaseWaitMs(lease.heldUntil);
      console.info(`${LOG} waiting on another refresh`, { propertyCode, attempt, waitMs });
      await delay(waitMs);
      continue;
    }

    let refreshed: string | null;
    try {
      refreshed = await performRefresh(connection);
    } catch (err) {
      await release();
      throw err;
    }
    // A refresh that stored a token cleared the lease in the same write, so there is
    // nothing left to release on the way out.
    if (refreshed) return refreshed;

    // null: another run had already rotated the token, so nothing was written and the
    // lease is still ours. Give it up and read the token they left behind.
    await release();
  }

  throw new QuickBooksApiError(
    `Could not get a live QuickBooks token for ${propertyCode}: another refresh held the lease for longer than expected.`,
    { status: 503 },
  );
}

/**
 * Spends the refresh token on `connection`, which must have come from the lease
 * transaction. Returns null when that token had already been rotated by another run, which
 * is a retry rather than a failure.
 */
async function performRefresh(connection: StoredQuickBooksConnection): Promise<string | null> {
  const { propertyCode } = connection;
  const spent = readConnectionTokens(connection).refreshToken;

  try {
    const refreshed = await refreshAccessToken(spent);
    const written = await updateConnectionTokens({
      propertyCode,
      ...refreshed,
      nowIso: new Date().toISOString(),
    });
    remember(propertyCode, { ...connection, ...written });
    console.info(`${LOG} refreshed access token`, { propertyCode });
    return refreshed.accessToken;
  } catch (err) {
    if (!(err instanceof QuickBooksTokenError) || !err.needsReauth) throw err;

    // A 400 here means the token we spent is not the current one. That is only fatal if it
    // is still the token Firestore holds; if another run rotated it while we were in
    // flight, the connection is alive and theirs is the token to use.
    const latest = await getConnection(propertyCode).catch(() => null);
    if (
      latest &&
      latest.status !== 'needs_reauth' &&
      readConnectionTokens(latest).refreshToken !== spent
    ) {
      console.warn(`${LOG} refresh token was rotated by another run; retrying`, { propertyCode });
      return null;
    }

    await markConnectionNeedsReauth(propertyCode, err.message).catch(() => {});
    latestConnection.delete(propertyCode);
    throw needsReauth(propertyCode, err.message);
  }
}

export async function getQuickBooksClient(
  propertyCode: QuickBooksPropertyCode,
): Promise<QuickBooksClient> {
  const connection = await getConnection(propertyCode);
  if (!connection) {
    throw new QuickBooksNotConnectedError(
      propertyCode,
      `${propertyCode} is not connected to a QuickBooks company yet.`,
    );
  }
  if (connection.status === 'needs_reauth') {
    throw needsReauth(propertyCode, connection.lastError);
  }

  // Only the token path may keep hold of a connection document, because it re-reads under a
  // lease before spending anything. What this client needs is fixed for the life of the
  // connection, so it is copied out here and the snapshot is not referenced again.
  const { realmId, environment, companyName } = remember(propertyCode, connection);
  const { minorVersion } = getQuickBooksCredentials();
  const base = `${apiBaseUrl(environment)}/v3/company/${encodeURIComponent(realmId)}`;

  const request = async (
    path: string,
    init: { method: 'GET' | 'POST'; body?: string },
  ): Promise<unknown> => {
    const send = async (token: string): Promise<Response> =>
      fetch(`${base}${path}`, {
        method: init.method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: init.body,
      });

    let token = await getAccessToken(propertyCode);
    let res = await send(token);

    // One reactive refresh: the token can expire between our check and QuickBooks' clock.
    if (res.status === 401) {
      token = await getAccessToken(propertyCode, { notThisToken: token });
      res = await send(token);
    }

    const text = await res.text();
    if (!res.ok) throw parseFault(res.status, text);

    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new QuickBooksApiError('QuickBooks returned a non-JSON success response.', {
        status: res.status,
      });
    }
  };

  return {
    propertyCode,
    realmId,
    environment,
    companyName,

    async query<T>(entity: string, statement: string): Promise<T[]> {
      const params = new URLSearchParams({ query: statement, minorversion: minorVersion });
      const json = (await request(`/query?${params.toString()}`, { method: 'GET' })) as {
        QueryResponse?: Record<string, unknown>;
      };
      const rows = json.QueryResponse?.[entity];
      return Array.isArray(rows) ? (rows as T[]) : [];
    },

    async create<T>(entity: string, payload: unknown, options: { requestId: string }): Promise<T> {
      const requestId = options.requestId.slice(0, QBO_REQUEST_ID_MAX);
      if (!requestId) {
        throw new Error('A QuickBooks create needs a deterministic requestId for idempotency.');
      }
      const params = new URLSearchParams({ minorversion: minorVersion, requestid: requestId });
      const json = (await request(`/${entity.toLowerCase()}?${params.toString()}`, {
        method: 'POST',
        body: JSON.stringify(payload),
      })) as Record<string, unknown>;
      const created = json[entity];
      if (!created) {
        throw new QuickBooksApiError(`QuickBooks create response did not contain a ${entity}.`, {
          status: 200,
        });
      }
      return created as T;
    },
  };
}

export type QuickBooksCompanyInfo = {
  CompanyName?: string;
  LegalName?: string;
  Id?: string;
};

/**
 * Reads CompanyInfo with a token that has not been stored yet, used during the OAuth
 * callback to confirm which company was actually authorized before the connection is saved.
 */
export async function fetchCompanyInfoWithToken(params: {
  realmId: string;
  accessToken: string;
  environment: QuickBooksEnvironment;
}): Promise<QuickBooksCompanyInfo> {
  const { minorVersion } = getQuickBooksCredentials();
  const url = `${apiBaseUrl(params.environment)}/v3/company/${encodeURIComponent(
    params.realmId,
  )}/companyinfo/${encodeURIComponent(params.realmId)}?minorversion=${minorVersion}`;

  const res = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${params.accessToken}`, Accept: 'application/json' },
  });

  const text = await res.text();
  if (!res.ok) throw parseFault(res.status, text);

  const json = JSON.parse(text) as { CompanyInfo?: QuickBooksCompanyInfo };
  if (!json.CompanyInfo) {
    throw new QuickBooksApiError('QuickBooks did not return CompanyInfo for that company.', {
      status: res.status,
    });
  }
  return json.CompanyInfo;
}
