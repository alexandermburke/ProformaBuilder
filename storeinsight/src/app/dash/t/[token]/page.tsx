import type { JSX } from 'react';
import { HistoricalDashboardView } from '@/components/historical/HistoricalDashboardView';
import { getPropertyHistoricalFromFirebase } from '@/lib/historical/firebaseStore';
import { getPropertyOption } from '@/lib/propertyDirectory';
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
      message: 'This dashboard link has expired. Please request a fresh link.',
    });
  }

  if (validation.status !== 'VALID' || !validation.record?.propertyId) {
    return renderStatus({
      title: 'Access unavailable',
      message: 'We could not validate this link. Please request a new link.',
    });
  }

  const propertyId = validation.record.propertyId;
  const firebaseData = await getPropertyHistoricalFromFirebase(propertyId);

  if (!firebaseData.data) {
    return renderStatus({
      title: 'Data not available yet',
      message: 'Historical performance data has not been uploaded for this property yet.',
    });
  }

  const propertyOptions = [getPropertyOption(propertyId)];

  return (
    <HistoricalDashboardView
      viewMode="token"
      propertyOptions={propertyOptions}
      scopedPropertyId={propertyId}
      dataByRange={firebaseData.data.historicalByRange}
      momSeriesByProperty={firebaseData.data.momSeries ? { [propertyId]: firebaseData.data.momSeries } : {}}
      allowPlaceholder={false}
      showUploadLink={false}
      showDirectoryLink={false}
    />
  );
}

