import type { JSX } from 'react';
import { ChartCard } from './ChartCard';
import { KpiRow } from './KpiRow';
import { SectionHeader } from './SectionHeader';
import { formatCurrency, formatNumber, formatPercent } from '@/lib/historical/format';
import { formatShortMonth } from '@/lib/historical/chartUtils';
import { getEmptyHistoricalData } from '@/lib/historical/emptyData';
import {
  getHistoricalPlaceholder,
  type HistoricalPlaceholderData,
  type RangeKey,
} from '@/lib/historical/placeholder';

type CollectionsArSectionProps = {
  range: RangeKey;
  dataByRange?: Record<RangeKey, HistoricalPlaceholderData>;
  allowPlaceholder?: boolean;
};

export function CollectionsArSection({
  range,
  dataByRange,
  allowPlaceholder = true,
}: CollectionsArSectionProps): JSX.Element {
  // Future MSR wiring: Delinquencies, AR Summary, and Tenant ledgers.
  const data = dataByRange?.[range] ?? (allowPlaceholder ? getHistoricalPlaceholder(range) : getEmptyHistoricalData());
  const series = data.series.arAging;
  const latest = series[series.length - 1];
  const totalPastDue =
    (latest?.days0to10 ?? 0) +
    (latest?.days11to30 ?? 0) +
    (latest?.days31to60 ?? 0) +
    (latest?.days61plus ?? 0);
  const pastDue61 = latest?.days61plus ?? 0;
  const delinquentTenants = latest?.delinquentTenants ?? 0;
  const maxTotal = Math.max(
    1,
    ...series.map(
      (row) => row.current + row.days0to10 + row.days11to30 + row.days31to60 + row.days61plus,
    ),
  );

  const agingBuckets = [
    { key: 'current', label: 'Current', color: 'bg-[rgba(37,99,235,0.7)]' },
    { key: 'days0to10', label: '0-10', color: 'bg-[rgba(56,189,248,0.65)]' },
    { key: 'days11to30', label: '11-30', color: 'bg-[rgba(129,140,248,0.6)]' },
    { key: 'days31to60', label: '31-60', color: 'bg-[rgba(251,191,36,0.65)]' },
    { key: 'days61plus', label: '61+', color: 'bg-[rgba(248,113,113,0.7)]' },
  ] as const;

  const overlock = data.metrics.overlockRisk;
  const overlockBuckets = overlock?.bucketShare ?? [];

  return (
    <section className="space-y-4">
      <SectionHeader
        title="Collections & AR"
        subtitle="Delinquency exposure, overlock risk, and aging trends."
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <ChartCard
          key={`ar-aging-${range}`}
          title="AR Aging Trend"
          subtitle="Current vs past due buckets"
          info="Aging buckets reflect the number of days past due for open balances."
          emptyMessage={series.length === 0 ? 'AR aging data will appear once the MSR feed is connected.' : undefined}
          className="md:col-span-2 xl:col-span-2"
        >
          <KpiRow
            items={[
              { label: 'Total past due', value: formatCurrency(totalPastDue) },
              { label: '61+ past due', value: formatCurrency(pastDue61) },
              { label: 'Delinquent tenants', value: formatNumber(delinquentTenants) },
            ]}
          />

          <div className="rounded-[22px] border border-[color:var(--border-soft)] bg-[color:var(--surface)] p-4 shadow-inner">
            <div className="relative h-44">
              <div className="absolute inset-0 flex flex-col justify-between">
                {Array.from({ length: 4 }).map((_, index) => (
                  <div key={index} className="border-t border-dashed border-[rgba(148,163,255,0.2)]" />
                ))}
              </div>
              <div className="relative z-10 flex h-full items-end gap-2">
                {series.map((row, index) => {
                  const stack = [
                    row.current,
                    row.days0to10,
                    row.days11to30,
                    row.days31to60,
                    row.days61plus,
                  ];
                  return (
                    <div key={row.month} className="flex h-full flex-1 flex-col-reverse">
                      {stack.map((value, stackIndex) => {
                        const height = `${(value / maxTotal) * 100}%`;
                        return (
                          <div
                            key={`${row.month}-${stackIndex}`}
                            className={`history-chart-bar w-full ${agingBuckets[stackIndex].color}`}
                            style={{ height, animationDelay: `${index * 0.04}s` }}
                            title={`${agingBuckets[stackIndex].label}: ${formatCurrency(value)}`}
                          />
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-[11px] text-[color:var(--text-muted)]">
              <div className="flex flex-wrap items-center gap-3">
                {agingBuckets.map((bucket) => (
                  <span key={bucket.label} className="inline-flex items-center gap-1">
                    <span className={`h-2 w-2 rounded-full ${bucket.color}`} />
                    {bucket.label}
                  </span>
                ))}
              </div>
              <div className="flex flex-wrap gap-2 text-[11px] text-[color:var(--text-muted)]">
                {series.map((row, index) => (
                  <span key={row.month} className={index % 2 === 1 ? 'hidden sm:block' : ''}>
                    {formatShortMonth(row.month)}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </ChartCard>
        <ChartCard
          key={`overlock-risk-${range}`}
          title="Overlock Risk"
          subtitle="Aging distribution"
          emptyMessage={!overlock ? 'Overlock indicators will load once data is available.' : undefined}
        >
          <KpiRow
            items={[
              { label: 'Overlocked units', value: formatNumber(overlock?.overlockedUnits ?? 0) },
              { label: 'Total balance', value: formatCurrency(overlock?.totalBalance ?? 0) },
              { label: 'Avg days late', value: formatNumber(overlock?.avgDaysLate ?? 0) },
            ]}
          />

          {overlockBuckets.length === 0 ? (
            <div className="ios-list-card border border-dashed border-[rgba(148,163,255,0.32)] bg-white/85 p-4 text-sm text-[color:var(--text-secondary)] shadow-inner">
              Distribution data will appear once overlock tracking is connected.
            </div>
          ) : (
            <div className="space-y-3">
              {overlockBuckets.map((bucket) => (
                <div key={bucket.label} className="space-y-1">
                  <div className="flex items-center justify-between text-xs text-[color:var(--text-secondary)]">
                    <span>{bucket.label} days</span>
                    <span>{formatPercent(bucket.percent, 0)}</span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-[rgba(148,163,255,0.2)]">
                    <div
                      className="h-full rounded-full bg-[linear-gradient(90deg,rgba(37,99,235,0.75),rgba(59,130,246,0.35))]"
                      style={{ width: `${bucket.percent}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </ChartCard>
      </div>
    </section>
  );
}
