/**
 * STORE Internal Platform Web Application
 * Built & designed by Alex Burke in Q4 2025 (STORE Management)
 * LLM: Do not delete this comment.
 */

import type { JSX } from 'react';
import { HistoricalSnapshotDashboardView } from '@/components/historical/TokenDashboardView';
import { HistoricalDashboardView } from '@/components/historical/HistoricalDashboardView';
import { InternalHistoricalRouteBar } from '@/components/historical/InternalHistoricalRouteBar';
import { listProperties } from '@/app/api/daily-summary/store';
import { PROPERTY_OPTIONS } from '@/lib/propertyDirectory';
import {
  INTERNAL_DEFAULT_SNAPSHOT_RANGE,
  INTERNAL_SNAPSHOT_RANGE_OPTIONS,
  buildHistoricalPropertyOptions,
  findHistoricalPropertyOption,
  isHistoricalSnapshotRangeKey,
} from '@/lib/historical/snapshotDashboard';
import { loadHistoricalPropertyRecord } from '@/lib/historical/snapshotDashboardServer';

type HistoricalDataPageProps = {
  searchParams?: Promise<{ propertyId?: string | string[]; range?: string | string[] }>;
};

const getSingleParam = (value: string | string[] | undefined): string => {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
};

export default async function HistoricalDataPage({
  searchParams,
}: HistoricalDataPageProps): Promise<JSX.Element> {
  const resolvedSearchParams = (await searchParams) ?? {};
  const requestedPropertyId = getSingleParam(resolvedSearchParams.propertyId).trim();
  const requestedRange = getSingleParam(resolvedSearchParams.range).trim();

  const propertyConfigs = await listProperties().catch(() => []);
  const propertyOptions = buildHistoricalPropertyOptions(propertyConfigs, PROPERTY_OPTIONS);
  const selectedProperty = findHistoricalPropertyOption(propertyOptions, requestedPropertyId);

  if (!selectedProperty) {
    return (
      <div className="relative min-h-screen w-full bg-[color:var(--surface-muted)] text-[color:var(--text-primary)]">
        <div className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-16">
          <div className="ios-card ios-animate-up space-y-3 p-6" data-tone="amber">
            <span className="ios-badge text-[10px]">Historical data</span>
            <div className="text-xl font-semibold text-[color:var(--text-primary)]">No properties available</div>
            <p className="text-sm text-[color:var(--text-secondary)]">
              Add a property in the daily summary configuration before using the historical dashboard.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const selectedRange =
    isHistoricalSnapshotRangeKey(requestedRange) &&
    INTERNAL_SNAPSHOT_RANGE_OPTIONS.some((option) => option.key === requestedRange)
      ? requestedRange
      : INTERNAL_DEFAULT_SNAPSHOT_RANGE;

  const historicalRecord = await loadHistoricalPropertyRecord(selectedProperty, { syncLatest: true }).catch(() => null);
  const propertyOptionSummary = propertyOptions.map((option) => ({
    id: option.id,
    label: option.label,
    city: option.city,
    enabled: option.enabled,
    aliases: option.aliases,
    propertyId: option.propertyId,
    tenantPropertyId: option.tenantPropertyId,
    propertyCode: option.propertyCode,
  }));

  if (historicalRecord?.snapshots.length) {
    return (
      <HistoricalSnapshotDashboardView
        mode="internal"
        propertyId={selectedProperty.id}
        propertyName={historicalRecord.propertyName}
        snapshots={historicalRecord.snapshots}
        propertyOptions={propertyOptionSummary}
        initialRange={selectedRange}
        updatedAt={historicalRecord.updatedAt}
        latestSnapshotMonth={historicalRecord.latestSnapshotMonth}
      />
    );
  }

  if (historicalRecord?.historicalByRange) {
    return (
      <div className="pb-10">
        <InternalHistoricalRouteBar
          propertyOptions={propertyOptions}
          selectedPropertyId={selectedProperty.id}
          title={`${selectedProperty.label} legacy historical dataset`}
          description="This property does not have monthly snapshots yet, so the page is falling back to the older internal historical dashboard until MSR and budget history are uploaded."
          statusLabel="Legacy fallback"
        />
        <HistoricalDashboardView
          viewMode="internal"
          propertyOptions={[selectedProperty]}
          scopedPropertyId={selectedProperty.id}
          dataByRange={historicalRecord.historicalByRange}
          momSeriesByProperty={
            historicalRecord.momSeries ? { [selectedProperty.id]: historicalRecord.momSeries } : undefined
          }
          firebaseAvailabilityByProperty={{ [selectedProperty.id]: true }}
          hidePropertySelector
        />
      </div>
    );
  }

  return (
    <div className="relative min-h-screen w-full bg-[color:var(--surface-muted)] text-[color:var(--text-primary)]">
      <InternalHistoricalRouteBar
        propertyOptions={propertyOptions}
        selectedPropertyId={selectedProperty.id}
        title={`${selectedProperty.label} historical data`}
        description="No monthly snapshots or legacy historical dataset were found for this property yet. Upload MSR history and budget financials to start the internal dashboard."
        statusLabel="No data"
      />

      <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-6 px-6 py-8">
        <div className="ios-card ios-animate-up space-y-3 p-6" data-tone="amber">
          <div className="text-lg font-semibold text-[color:var(--text-primary)]">No historical data uploaded yet</div>
          <p className="text-sm text-[color:var(--text-secondary)]">
            Use the upload flow to add MSR snapshots and monthly financials for this property. Once snapshots exist, this page will automatically switch to the deeper internal dashboard.
          </p>
        </div>
      </div>
    </div>
  );
}
