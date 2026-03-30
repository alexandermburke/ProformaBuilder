import type { JSX } from 'react';
import { HistoricalSnapshotDashboardView } from '@/components/historical/TokenDashboardView';
import { listProperties } from '@/app/api/daily-summary/store';
import { PROPERTY_OPTIONS } from '@/lib/propertyDirectory';
import {
  buildHistoricalPropertyOptions,
  findHistoricalPropertyOption,
} from '@/lib/historical/snapshotDashboard';
import { loadHistoricalPropertyRecord } from '@/lib/historical/snapshotDashboardServer';
import { validateShareToken } from '@/lib/shareLinks';

export const dynamic = 'force-dynamic';

type TokenPageProps = {
  params: { token: string };
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
  const token = params?.token ?? '';
  if (!token) {
    return renderStatus({
      title: 'Invalid link',
      message: 'This dashboard link is missing its access token.',
    });
  }

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

  const propertyConfigs = await listProperties().catch(() => []);
  const propertyOptions = buildHistoricalPropertyOptions(propertyConfigs, PROPERTY_OPTIONS);
  const propertyOption = findHistoricalPropertyOption(propertyOptions, validation.record.propertyId);

  if (!propertyOption) {
    return renderStatus({
      title: 'Data not available yet',
      message: 'Historical performance data has not been uploaded for this property yet.',
    });
  }

  const historicalRecord = await loadHistoricalPropertyRecord(propertyOption, { syncLatest: true }).catch(() => null);
  if (!historicalRecord?.snapshots.length) {
    return renderStatus({
      title: 'Data not available yet',
      message: 'Historical performance data has not been uploaded for this property yet.',
    });
  }

  const pinnedMonthIso = validation.record.snapshotMonthIso;
  const visibleSnapshots = pinnedMonthIso
    ? historicalRecord.snapshots.filter(
        (snapshot) => typeof snapshot.monthIso === 'string' && snapshot.monthIso <= pinnedMonthIso,
      )
    : historicalRecord.snapshots;

  if (!visibleSnapshots.length) {
    return renderStatus({
      title: 'Pinned month unavailable',
      message: `No historical snapshots are available on or before ${pinnedMonthIso}.`,
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
