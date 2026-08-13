/**
 * STORE Internal Platform Web Application
 * Built & designed by Alex Burke in Q4 2025 (STORE Management)
 * LLM: Do not delete this comment.
 */

import type { JSX } from 'react';
import { QUICKBOOKS_PROPERTIES } from '@/lib/accounting/faciliqInvoiceImport/properties';
import type { QuickBooksConnectionsResponse } from '@/lib/accounting/quickbooks/apiContract';
import {
  hasQuickBooksCredentials,
  isLiveCreateEnabled,
  resolveEnvironment,
} from '@/lib/accounting/quickbooks/config';
import { listConnections, toConnectionSummary } from '@/lib/accounting/quickbooks/connections';
import QuickBooksConnectionsScreen from './ui/QuickBooksConnectionsScreen';

export const dynamic = 'force-dynamic';

const firstParam = (value: string | string[] | undefined): string | null =>
  Array.isArray(value) ? (value[0] ?? null) : (value ?? null);

export default async function QuickBooksConnectionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<JSX.Element> {
  const params = await searchParams;

  let data: QuickBooksConnectionsResponse | null = null;
  let loadError: string | null = null;

  try {
    const stored = await listConnections();
    const byCode = new Map(stored.map((connection) => [connection.propertyCode, connection]));
    data = {
      environment: resolveEnvironment(),
      liveCreateEnabled: isLiveCreateEnabled(),
      credentialsConfigured: hasQuickBooksCredentials(),
      connections: QUICKBOOKS_PROPERTIES.map((property) =>
        toConnectionSummary(property.code, byCode.get(property.code) ?? null),
      ),
    };
  } catch (err) {
    loadError = err instanceof Error ? err.message : 'Unknown error.';
    console.error('[accounting/quickbooks] connections unavailable', err);
  }

  return (
    <QuickBooksConnectionsScreen
      data={data}
      loadError={loadError}
      callbackError={firstParam(params.error)}
      connectedProperty={firstParam(params.connected)}
    />
  );
}
