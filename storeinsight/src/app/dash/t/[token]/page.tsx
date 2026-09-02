import type { JSX } from 'react';
import { HistoricalSnapshotDashboardView } from '@/components/historical/TokenDashboardView';
import { listProperties } from '@/app/api/daily-summary/store';
import { PROPERTY_OPTIONS } from '@/lib/propertyDirectory';
import {
  buildHistoricalPropertyOptions,
  filterSnapshotsByPinnedMonth,
  findHistoricalPropertyOption,
  resolvePinnedMonthIso,
} from '@/lib/historical/snapshotDashboard';
import { loadHistoricalPropertyRecord } from '@/lib/historical/snapshotDashboardServer';
import { formatSnapshotMonthLabel } from '@/lib/historical/snapshotDates';
import { validateShareToken } from '@/lib/shareLinks';

export const dynamic = 'force-dynamic';

type TokenPageProps = {
  params: Promise<{ token: string }>;
};

type StatusMessage = {
  title: string;
  message: string;
};

const renderStatus = ({ title, message }: StatusMessage): JSX.Element => (
  <div className="relative min-h-screen w-full bg-[color:var(--surface-muted)] text-[color:var(--text-primary)]">
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-16">
      <div className="ios-card ios-animate-up space-y-3 p-6" data-tone="amber">
        <span className="ios-badge text-[10px]">Investor dashboard</span>
        <div className="text-xl font-semibold text-[color:var(--text-primary)]">{title}</div>
        <p className="text-sm text-[color:var(--text-secondary)]">{message}</p>
      </div>
    </div>
  </div>
);

export default async function TokenDashboardPage({ params }: TokenPageProps): Promise<JSX.Element> {
  const resolvedParams = await params;
  const token = resolvedParams?.token ?? '';
  if (!token) {
    return renderStatus({
      title: 'Invalid link',
      message: 'This dashboard link is missing its access token.',
    });
  }

  // Kick off the property directory read before token validation; the two are independent
  // round trips and this lets them overlap. The catch is attached at creation so an early
  // return from a validation guard can never leave an unhandled rejection.
  const propertiesPromise = listProperties().catch(() => []);

  let validation;
  try {
    validation = await validateShareToken(token, { markUsed: true });
  } catch {
    return renderStatus({
      title: 'Access unavailable',
      message: 'We could not validate this link. Please request a new link.',
    });
  }

  if (validation.status === 'NOT_FOUND') {
    return renderStatus({
      title: 'Invalid link',
      message: 'This dashboard link is not recognized. Please request a new link.',
    });
  }

  if (validation.status === 'REVOKED') {
    return renderStatus({
      title: 'Link revoked',
      message: 'This dashboard link has been revoked. Please request a new link.',
    });
  }

  if (validation.status === 'EXPIRED') {
    return renderStatus({
      title: 'Link expired',
      message: 'This dashboard link has expired. Please request a new link.',
    });
  }

  if (validation.status !== 'VALID' || !validation.record?.propertyId) {
    return renderStatus({
      title: 'Access unavailable',
      message: 'We could not validate this link. Please request a new link.',
    });
  }

  const propertyConfigs = await propertiesPromise;
  const propertyOptions = buildHistoricalPropertyOptions(propertyConfigs, PROPERTY_OPTIONS);
  const propertyOption = findHistoricalPropertyOption(propertyOptions, validation.record.propertyId);

  if (!propertyOption) {
    return renderStatus({
      title: 'Data not available yet',
      message: 'Historical performance data has not been uploaded for this property yet.',
    });
  }

  const historicalRecord = await loadHistoricalPropertyRecord(propertyOption, {
    syncLatest: true,
    canonicalAlias: validation.record.propertyId,
  }).catch(() => null);
  if (!historicalRecord?.snapshots.length) {
    return renderStatus({
      title: 'Data not available yet',
      message: 'Historical performance data has not been uploaded for this property yet.',
    });
  }

  // Pins resolve at month granularity. The store holds one snapshot per month, so a link pinned
  // to any day in August shows August's snapshot; older links that stored a day reduce to its month.
  const pinnedMonthIso = resolvePinnedMonthIso(validation.record.snapshotMonthIso, validation.record.snapshotDateIso);
  const visibleSnapshots = filterSnapshotsByPinnedMonth(historicalRecord.snapshots, pinnedMonthIso);

  if (!visibleSnapshots.length) {
    const pinnedLabel = formatSnapshotMonthLabel(pinnedMonthIso) ?? 'the pinned month';
    return renderStatus({
      title: 'Pinned period unavailable',
      message: `No historical snapshots are available for ${pinnedLabel} or earlier.`,
    });
  }

  return (
    <HistoricalSnapshotDashboardView
      mode="token"
      propertyId={propertyOption.id}
      propertyName={historicalRecord.propertyName}
      snapshots={visibleSnapshots}
      shareToken={token}
      initialOverviewWidgets={validation.record.overviewWidgets}
      updatedAt={historicalRecord.updatedAt}
      latestSnapshotMonth={historicalRecord.latestSnapshotMonth}
    />
  );
}
