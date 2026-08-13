/**
 * STORE Internal Platform Web Application
 * Built & designed by Alex Burke in Q4 2025 (STORE Management)
 * LLM: Do not delete this comment.
 */

/**
 * The QuickBooks OAuth redirect target. Must stay at this exact path: it is registered on
 * the Intuit app as QUICKBOOKS_REDIRECT_URI, and Intuit matches it exactly.
 *
 * Reached in the operator's browser, so middleware.ts has already required a session. The
 * signed `state` says which STORE property was being connected; nothing here infers it.
 *
 * Before a connection is saved, two separate checks stop a property from being wired to
 * the wrong books:
 *   1. the realmId must not already belong to another property; and
 *   2. the QuickBooks company's own name, if it resolves to a STORE property at all, must
 *      resolve to THIS one.
 * A company name that resolves to nothing is allowed through but recorded as unverified,
 * because the real companies include names like "Hibernia Camelback LLC" that carry no
 * property code.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE_NAME } from '@/lib/authConstants';
import { verifySessionTokenNode } from '@/lib/internalAuth';
import {
  getQuickBooksProperty,
  resolveQuickBooksPropertyCode,
} from '@/lib/accounting/faciliqInvoiceImport/properties';
import { resolveEnvironment } from '@/lib/accounting/quickbooks/config';
import { fetchCompanyInfoWithToken } from '@/lib/accounting/quickbooks/client';
import {
  consumeOAuthState,
  findConnectionByRealmId,
  saveConnection,
} from '@/lib/accounting/quickbooks/connections';
import {
  exchangeAuthorizationCode,
  revokeToken,
  verifyOAuthState,
} from '@/lib/accounting/quickbooks/oauth';

export const runtime = 'nodejs';

const CONNECTIONS_PAGE = '/accounting/quickbooks';

const back = (request: NextRequest, params: Record<string, string>): NextResponse => {
  const url = new URL(CONNECTIONS_PAGE, request.nextUrl.origin);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return NextResponse.redirect(url);
};

export async function GET(request: NextRequest): Promise<NextResponse> {
  const url = new URL(request.url);
  const oauthError = url.searchParams.get('error');
  if (oauthError) {
    const description = url.searchParams.get('error_description') || oauthError;
    console.warn('[quickbooks/callback] Intuit returned an error', { oauthError, description });
    return back(request, { error: `QuickBooks did not complete the connection: ${description}` });
  }

  const state = verifyOAuthState(url.searchParams.get('state'));
  if (!state.ok) {
    console.warn('[quickbooks/callback] state rejected', { reason: state.reason });
    return back(request, { error: state.reason });
  }
  const { propertyCode } = state;

  const code = url.searchParams.get('code');
  const realmId = url.searchParams.get('realmId');
  if (!code || !realmId) {
    return back(request, { error: 'QuickBooks did not return an authorization code and realmId.' });
  }

  const sessionEmail =
    verifySessionTokenNode(request.cookies.get(SESSION_COOKIE_NAME)?.value ?? '') ?? 'unknown';

  try {
    // Claimed before the exchange: Intuit invalidates tokens if one authorization code is
    // exchanged twice, and a browser refresh on this URL would do exactly that.
    const stateValue = url.searchParams.get('state') ?? '';
    const firstUse = await consumeOAuthState(stateValue);
    if (!firstUse) {
      return back(request, {
        error: 'That connection link was already used. Start the connection again from this page.',
      });
    }

    const existing = await findConnectionByRealmId({ realmId, excludePropertyCode: propertyCode });
    if (existing) {
      return back(request, {
        error: `That QuickBooks company (realm ${realmId}) is already connected to ${existing.propertyCode}. Disconnect it there first.`,
      });
    }

    const tokens = await exchangeAuthorizationCode(code);
    const environment = resolveEnvironment();

    const company = await fetchCompanyInfoWithToken({
      realmId,
      accessToken: tokens.accessToken,
      environment,
    });
    const companyName = company.CompanyName ?? '';
    const companyLegalName = company.LegalName ?? '';

    const resolvedFromName =
      resolveQuickBooksPropertyCode(companyName) ?? resolveQuickBooksPropertyCode(companyLegalName);

    if (resolvedFromName && resolvedFromName !== propertyCode) {
      // Hand the tokens back rather than keeping a credential for books we just refused.
      await revokeToken(tokens.refreshToken).catch(() => {});
      const intended = getQuickBooksProperty(propertyCode);
      return back(request, {
        error: `That QuickBooks company reads as ${resolvedFromName} ("${companyName || companyLegalName}"), but you were connecting ${propertyCode} ${intended.name}. Nothing was saved.`,
      });
    }

    await saveConnection({
      propertyCode,
      realmId,
      environment,
      companyName,
      companyLegalName,
      companyNameVerified: resolvedFromName === propertyCode,
      accessToken: tokens.accessToken,
      accessTokenExpiresAt: tokens.accessTokenExpiresAt,
      refreshToken: tokens.refreshToken,
      refreshTokenExpiresAt: tokens.refreshTokenExpiresAt,
      connectedBy: sessionEmail,
      nowIso: new Date().toISOString(),
    });

    console.info('[quickbooks/callback] connected', {
      propertyCode,
      realmId,
      environment,
      companyName,
      verified: resolvedFromName === propertyCode,
      connectedBy: sessionEmail,
    });

    return back(request, { connected: propertyCode });
  } catch (err) {
    console.error('[quickbooks/callback] failed', { propertyCode, realmId }, err);
    return back(request, {
      error: err instanceof Error ? err.message : 'The QuickBooks connection could not be completed.',
    });
  }
}
