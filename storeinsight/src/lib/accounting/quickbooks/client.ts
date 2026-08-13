/**
 * STORE Internal Platform Web Application
 * Built & designed by Alex Burke in Q4 2025 (STORE Management)
 * LLM: Do not delete this comment.
 */

/**
 * An authorized QuickBooks Accounting API client bound to ONE property's company.
 *
 * The realmId is read from that property's stored connection and baked into the client, so
 * a caller cannot accidentally aim a request at another company: there is no parameter to
 * get wrong.
 *
 * Access tokens last an hour. The client refreshes proactively before a request and once
 * reactively on a 401, persisting the rotated refresh token each time.
 */

import type { QuickBooksPropertyCode } from '@/lib/accounting/faciliqInvoiceImport/properties';
import { apiBaseUrl, getQuickBooksCredentials, type QuickBooksEnvironment } from './config';
import {
  getConnection,
  markConnectionNeedsReauth,
  readConnectionTokens,
  updateConnectionTokens,
  type StoredQuickBooksConnection,
} from './connections';
import { QuickBooksTokenError, refreshAccessToken } from './oauth';

const LOG = '[quickbooks]';
/** Refresh this far ahead of expiry so a slow request cannot land after the token dies. */
const REFRESH_MARGIN_MS = 120_000;

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

/**
 * In-flight refreshes, one per property.
 *
 * Intuit invalidates a refresh token if two refreshes race on it: the first succeeds and
 * the second gets invalid_grant, which can revoke the pair entirely. Sharing one promise
 * per property means concurrent callers in this process wait on a single refresh instead
 * of starting their own. Uploads are operator-triggered and single-instance today; if this
 * ever runs on more than one instance at once, this needs a Firestore lock as well.
 */
const refreshesInFlight = new Map<QuickBooksPropertyCode, Promise<string>>();

/**
 * Returns a live access token for a property, refreshing and persisting first when the
 * stored one is at or near expiry.
 */
async function ensureAccessToken(connection: StoredQuickBooksConnection, force = false): Promise<string> {
  const { accessToken, refreshToken } = readConnectionTokens(connection);
  const expiresAt = Date.parse(connection.accessTokenExpiresAt);
  const stillValid = Number.isFinite(expiresAt) && expiresAt - REFRESH_MARGIN_MS > Date.now();

  if (!force && stillValid) return accessToken;

  const pending = refreshesInFlight.get(connection.propertyCode);
  if (pending) return pending;

  const refreshRun = performRefresh(connection, refreshToken).finally(() => {
    refreshesInFlight.delete(connection.propertyCode);
  });
  refreshesInFlight.set(connection.propertyCode, refreshRun);
  return refreshRun;
}

async function performRefresh(
  connection: StoredQuickBooksConnection,
  refreshToken: string,
): Promise<string> {
  try {
    const refreshed = await refreshAccessToken(refreshToken);
    await updateConnectionTokens({
      propertyCode: connection.propertyCode,
      accessToken: refreshed.accessToken,
      accessTokenExpiresAt: refreshed.accessTokenExpiresAt,
      refreshToken: refreshed.refreshToken,
      refreshTokenExpiresAt: refreshed.refreshTokenExpiresAt,
      nowIso: new Date().toISOString(),
    });
    console.info(`${LOG} refreshed access token`, { propertyCode: connection.propertyCode });
    return refreshed.accessToken;
  } catch (err) {
    if (err instanceof QuickBooksTokenError && err.needsReauth) {
      await markConnectionNeedsReauth(connection.propertyCode, err.message).catch(() => {});
      throw new QuickBooksNotConnectedError(
        connection.propertyCode,
        `${connection.propertyCode} needs to be reconnected to QuickBooks: ${err.message}`,
      );
    }
    throw err;
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
    throw new QuickBooksNotConnectedError(
      propertyCode,
      `${propertyCode} needs to be reconnected to QuickBooks${connection.lastError ? `: ${connection.lastError}` : '.'}`,
    );
  }

  const { minorVersion } = getQuickBooksCredentials();
  const base = `${apiBaseUrl(connection.environment)}/v3/company/${encodeURIComponent(connection.realmId)}`;

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

    let token = await ensureAccessToken(connection);
    let res = await send(token);

    // One reactive refresh: the token can expire between our check and QuickBooks' clock.
    if (res.status === 401) {
      token = await ensureAccessToken(connection, true);
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
    realmId: connection.realmId,
    environment: connection.environment,
    companyName: connection.companyName,

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
