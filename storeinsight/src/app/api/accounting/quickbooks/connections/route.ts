/**
 * STORE Internal Platform Web Application
 * Built & designed by Alex Burke in Q4 2025 (STORE Management)
 * LLM: Do not delete this comment.
 */

/**
 * Reads and removes QuickBooks connections. Session-protected by middleware.ts.
 *
 * The response only ever carries connection summaries, which by construction contain no
 * access or refresh token.
 */

import { NextResponse, type NextRequest } from 'next/server';
import {
  QUICKBOOKS_PROPERTIES,
  QUICKBOOKS_PROPERTY_CODES,
  type QuickBooksPropertyCode,
} from '@/lib/accounting/faciliqInvoiceImport/properties';
import type { QuickBooksConnectionsResponse } from '@/lib/accounting/quickbooks/apiContract';
import { forgetConnection } from '@/lib/accounting/quickbooks/client';
import {
  hasQuickBooksCredentials,
  isLiveCreateEnabled,
  resolveEnvironment,
} from '@/lib/accounting/quickbooks/config';
import {
  deleteConnection,
  getConnection,
  listConnections,
  readConnectionTokens,
  toConnectionSummary,
} from '@/lib/accounting/quickbooks/connections';
import { revokeToken } from '@/lib/accounting/quickbooks/oauth';

export const runtime = 'nodejs';

const isPropertyCode = (value: string | null): value is QuickBooksPropertyCode =>
  value !== null && (QUICKBOOKS_PROPERTY_CODES as readonly string[]).includes(value);

export async function GET(): Promise<NextResponse> {
  try {
    const stored = await listConnections();
    const byCode = new Map(stored.map((connection) => [connection.propertyCode, connection]));

    return NextResponse.json({
      environment: resolveEnvironment(),
      liveCreateEnabled: isLiveCreateEnabled(),
      credentialsConfigured: hasQuickBooksCredentials(),
      connections: QUICKBOOKS_PROPERTIES.map((property) =>
        toConnectionSummary(property.code, byCode.get(property.code) ?? null),
      ),
    } satisfies QuickBooksConnectionsResponse);
  } catch (err) {
    console.error('[quickbooks/connections] list failed', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unable to read QuickBooks connections.' },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const property = new URL(request.url).searchParams.get('property');
  if (!isPropertyCode(property)) {
    return NextResponse.json(
      { error: `Expected ?property= one of ${QUICKBOOKS_PROPERTY_CODES.join(', ')}.` },
      { status: 400 },
    );
  }

  try {
    const connection = await getConnection(property);
    if (connection) {
      // Revoke at Intuit first so a leaked copy of the stored token is useless, then drop
      // the record. A revoke failure must not strand the connection in the UI.
      try {
        const { refreshToken } = readConnectionTokens(connection);
        await revokeToken(refreshToken);
      } catch (err) {
        console.warn('[quickbooks/connections] revoke failed, removing the record anyway', { property }, err);
      }
      await deleteConnection(property);
      // A warm serverless process caches the last connection it saw per property. Without
      // this it could still hand out a live access token for a property just disconnected.
      forgetConnection(property);
      console.info('[quickbooks/connections] disconnected', { property, realmId: connection.realmId });
    }
    return NextResponse.json({ disconnected: property });
  } catch (err) {
    console.error('[quickbooks/connections] disconnect failed', { property }, err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unable to disconnect that property.' },
      { status: 500 },
    );
  }
}
