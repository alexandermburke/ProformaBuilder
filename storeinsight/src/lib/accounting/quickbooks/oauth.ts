/**
 * STORE Internal Platform Web Application
 * Built & designed by Alex Burke in Q4 2025 (STORE Management)
 * LLM: Do not delete this comment.
 */

/**
 * The QuickBooks Online OAuth 2.0 authorization-code flow.
 *
 * The `state` parameter carries which STORE property the operator was connecting, and is
 * HMAC-signed with a short expiry. That matters for more than CSRF here: the callback has
 * no other trustworthy way to know which property a returned realmId belongs to, and
 * guessing would be exactly the mistake that posts one property's bills into another's
 * books.
 */

import crypto from 'node:crypto';
import type { QuickBooksPropertyCode } from '@/lib/accounting/faciliqInvoiceImport/properties';
import { QUICKBOOKS_PROPERTY_CODES } from '@/lib/accounting/faciliqInvoiceImport/properties';
import {
  QBO_AUTHORIZE_URL,
  QBO_REVOKE_URL,
  QBO_SCOPE,
  QBO_TOKEN_URL,
  getQuickBooksCredentials,
} from './config';

const STATE_TTL_MS = 10 * 60 * 1000;

export type QuickBooksTokenSet = {
  accessToken: string;
  /** ISO timestamp. Intuit returns a lifetime in seconds; it is resolved here once. */
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
};

type IntuitTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  x_refresh_token_expires_in?: number;
  token_type?: string;
  error?: string;
  error_description?: string;
};

const base64Url = (value: Buffer | string): string =>
  (typeof value === 'string' ? Buffer.from(value, 'utf8') : value)
    .toString('base64')
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

const fromBase64Url = (value: string): Buffer =>
  Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

const stateSecret = (): string => {
  const secret = process.env.QUICKBOOKS_TOKEN_SECRET?.trim() || process.env.AUTH_SECRET?.trim();
  if (!secret) {
    throw new Error('Missing a secret for OAuth state signing (set QUICKBOOKS_TOKEN_SECRET or AUTH_SECRET).');
  }
  return secret;
};

type StatePayload = {
  propertyCode: QuickBooksPropertyCode;
  nonce: string;
  issuedAt: number;
};

export function signOAuthState(propertyCode: QuickBooksPropertyCode, now = Date.now()): string {
  const payload: StatePayload = {
    propertyCode,
    nonce: crypto.randomBytes(12).toString('hex'),
    issuedAt: now,
  };
  const body = base64Url(JSON.stringify(payload));
  const signature = base64Url(crypto.createHmac('sha256', stateSecret()).update(body).digest());
  return `${body}.${signature}`;
}

export type StateVerification =
  | { ok: true; propertyCode: QuickBooksPropertyCode }
  | { ok: false; reason: string };

export function verifyOAuthState(state: string | null | undefined, now = Date.now()): StateVerification {
  if (!state) return { ok: false, reason: 'The callback carried no state value.' };

  const [body, signature] = state.split('.');
  if (!body || !signature) return { ok: false, reason: 'The state value is malformed.' };

  const expected = crypto.createHmac('sha256', stateSecret()).update(body).digest();
  const provided = fromBase64Url(signature);
  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
    return { ok: false, reason: 'The state signature did not verify.' };
  }

  let payload: StatePayload;
  try {
    payload = JSON.parse(fromBase64Url(body).toString('utf8')) as StatePayload;
  } catch {
    return { ok: false, reason: 'The state payload could not be read.' };
  }

  if (now - payload.issuedAt > STATE_TTL_MS) {
    return { ok: false, reason: 'The connection attempt expired. Start it again.' };
  }
  if (!(QUICKBOOKS_PROPERTY_CODES as readonly string[]).includes(payload.propertyCode)) {
    return { ok: false, reason: `"${payload.propertyCode}" is not a known STORE property code.` };
  }

  return { ok: true, propertyCode: payload.propertyCode };
}

export function buildAuthorizationUrl(propertyCode: QuickBooksPropertyCode): string {
  const { clientId, redirectUri } = getQuickBooksCredentials();
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    scope: QBO_SCOPE,
    redirect_uri: redirectUri,
    state: signOAuthState(propertyCode),
  });
  return `${QBO_AUTHORIZE_URL}?${params.toString()}`;
}

const toTokenSet = (json: IntuitTokenResponse, now: Date): QuickBooksTokenSet => {
  if (!json.access_token || !json.refresh_token) {
    throw new Error('QuickBooks token response was missing access_token or refresh_token.');
  }
  const accessSeconds = typeof json.expires_in === 'number' ? json.expires_in : 3600;
  // Documented default is 100 days; only used to warn before a connection goes stale.
  const refreshSeconds =
    typeof json.x_refresh_token_expires_in === 'number' ? json.x_refresh_token_expires_in : 8_726_400;

  return {
    accessToken: json.access_token,
    accessTokenExpiresAt: new Date(now.getTime() + accessSeconds * 1000).toISOString(),
    refreshToken: json.refresh_token,
    refreshTokenExpiresAt: new Date(now.getTime() + refreshSeconds * 1000).toISOString(),
  };
};

const postToken = async (body: URLSearchParams, now: Date): Promise<QuickBooksTokenSet> => {
  const { clientId, clientSecret } = getQuickBooksCredentials();
  const basic = Buffer.from(`${clientId}:${clientSecret}`, 'utf8').toString('base64');

  const res = await fetch(QBO_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body,
  });

  const text = await res.text();
  let json: IntuitTokenResponse;
  try {
    json = JSON.parse(text) as IntuitTokenResponse;
  } catch {
    throw new Error(`QuickBooks token endpoint returned a non-JSON response (${res.status}): ${text.slice(0, 300)}`);
  }

  if (!res.ok) {
    const detail = json.error_description || json.error || text.slice(0, 300);
    throw new QuickBooksTokenError(`QuickBooks token request failed (${res.status}): ${detail}`, {
      status: res.status,
      code: json.error ?? null,
    });
  }

  return toTokenSet(json, now);
};

export class QuickBooksTokenError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(message: string, params: { status: number; code: string | null }) {
    super(message);
    this.name = 'QuickBooksTokenError';
    this.status = params.status;
    this.code = params.code;
  }

  /**
   * True when the refresh token itself is dead, which no amount of retrying fixes -- the
   * property has to be reconnected by a person.
   */
  get needsReauth(): boolean {
    return this.status === 400 || this.status === 401;
  }
}

export async function exchangeAuthorizationCode(code: string, now = new Date()): Promise<QuickBooksTokenSet> {
  const { redirectUri } = getQuickBooksCredentials();
  return postToken(
    new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    }),
    now,
  );
}

/**
 * Intuit rotates the refresh token on refresh, so the caller must persist BOTH returned
 * tokens. Continuing to use the previous refresh token invalidates the connection.
 */
export async function refreshAccessToken(refreshToken: string, now = new Date()): Promise<QuickBooksTokenSet> {
  return postToken(
    new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
    now,
  );
}

export async function revokeToken(token: string): Promise<void> {
  const { clientId, clientSecret } = getQuickBooksCredentials();
  const basic = Buffer.from(`${clientId}:${clientSecret}`, 'utf8').toString('base64');

  const res = await fetch(QBO_REVOKE_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ token }),
  });

  // Intuit answers 200 on success. A already-invalid token is not an error worth throwing
  // on during a disconnect, so only real failures surface.
  if (!res.ok && res.status !== 400) {
    const text = await res.text().catch(() => '');
    throw new Error(`QuickBooks token revoke failed (${res.status}): ${text.slice(0, 200)}`);
  }
}
