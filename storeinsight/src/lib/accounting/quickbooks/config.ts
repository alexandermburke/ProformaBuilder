/**
 * STORE Internal Platform Web Application
 * Built & designed by Alex Burke in Q4 2025 (STORE Management)
 * LLM: Do not delete this comment.
 */

/**
 * Environment and endpoints for the QuickBooks Online connection.
 *
 * Two safety defaults are deliberate and must stay that way:
 *   - the environment defaults to `sandbox`, so a missing variable can never point a run
 *     at a real company file; and
 *   - bill creation defaults to OFF, so every code path is a dry run until someone sets
 *     QUICKBOOKS_LIVE_CREATE=true on purpose.
 * Both have to be turned on explicitly, not inherited.
 */

export type QuickBooksEnvironment = 'sandbox' | 'production';

export type QuickBooksCredentials = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  environment: QuickBooksEnvironment;
  /** Accounting API minor version. Pinned so a QuickBooks default change cannot alter payload behaviour. */
  minorVersion: string;
};

/** Intuit's authorization screen. Same host for sandbox and production. */
export const QBO_AUTHORIZE_URL = 'https://appcenter.intuit.com/connect/oauth2';
export const QBO_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
export const QBO_REVOKE_URL = 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke';

/** Accounting scope only. This integration never needs payroll, payments, or OpenID profile data. */
export const QBO_SCOPE = 'com.intuit.quickbooks.accounting';

const API_BASE: Record<QuickBooksEnvironment, string> = {
  sandbox: 'https://sandbox-quickbooks.api.intuit.com',
  production: 'https://quickbooks.api.intuit.com',
};

const DEFAULT_MINOR_VERSION = '75';

export const resolveEnvironment = (): QuickBooksEnvironment =>
  process.env.QUICKBOOKS_ENVIRONMENT?.trim().toLowerCase() === 'production' ? 'production' : 'sandbox';

/**
 * True only when someone has explicitly allowed writes. Everything else in the uploader
 * runs identically either way, so a dry run exercises resolution and payload building.
 */
export const isLiveCreateEnabled = (): boolean =>
  process.env.QUICKBOOKS_LIVE_CREATE?.trim().toLowerCase() === 'true';

export const apiBaseUrl = (environment: QuickBooksEnvironment): string => API_BASE[environment];

/**
 * Throws rather than returning a partial config: a half-configured OAuth client fails in
 * confusing ways at Intuit's end instead of ours.
 */
export function getQuickBooksCredentials(): QuickBooksCredentials {
  const clientId = process.env.QUICKBOOKS_CLIENT_ID?.trim();
  const clientSecret = process.env.QUICKBOOKS_CLIENT_SECRET?.trim();
  const redirectUri = process.env.QUICKBOOKS_REDIRECT_URI?.trim();

  const missing = [
    !clientId && 'QUICKBOOKS_CLIENT_ID',
    !clientSecret && 'QUICKBOOKS_CLIENT_SECRET',
    !redirectUri && 'QUICKBOOKS_REDIRECT_URI',
  ].filter((value): value is string => typeof value === 'string');

  if (missing.length > 0 || !clientId || !clientSecret || !redirectUri) {
    throw new Error(`Missing QuickBooks configuration: ${missing.join(', ')}.`);
  }

  return {
    clientId,
    clientSecret,
    redirectUri,
    environment: resolveEnvironment(),
    minorVersion: process.env.QUICKBOOKS_MINOR_VERSION?.trim() || DEFAULT_MINOR_VERSION,
  };
}

export const hasQuickBooksCredentials = (): boolean =>
  Boolean(
    process.env.QUICKBOOKS_CLIENT_ID?.trim() &&
      process.env.QUICKBOOKS_CLIENT_SECRET?.trim() &&
      process.env.QUICKBOOKS_REDIRECT_URI?.trim(),
  );
