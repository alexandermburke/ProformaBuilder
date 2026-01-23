import type { JSX } from 'react';
import { ChartCard } from './ChartCard';
import { KpiRow } from './KpiRow';
import { SectionHeader } from './SectionHeader';
import { formatCurrency, formatNumber, formatPercent } from '@/lib/historical/format';
import { buildLinePath, formatShortMonth, getChartPoints } from '@/lib/historical/chartUtils';
import { getEmptyHistoricalData } from '@/lib/historical/emptyData';
import {
  getHistoricalPlaceholder,
  type HistoricalPlaceholderData,
  type RangeKey,
} from '@/lib/historical/placeholder';

type PricingRevenueQualitySectionProps = {
  range: RangeKey;
  dataByRange?: Record<RangeKey, HistoricalPlaceholderData>;
  allowPlaceholder?: boolean;
};

const CHART_WIDTH = 520;
const CHART_HEIGHT = 180;
const CHART_PADDING = 24;

const average = (values: number[]): number =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

export function PricingRevenueQualitySection({
  range,
  dataByRange,
  allowPlaceholder = true,
}: PricingRevenueQualitySectionProps): JSX.Element {
  // Future MSR wiring: Rental Rate, Rent Changes, and Occupancy detail tabs.
  const data = dataByRange?.[range] ?? (allowPlaceholder ? getHistoricalPlaceholder(range) : getEmptyHistoricalData());
  const series = data.series.pricing;
  const latest = series[series.length - 1];

  const setRates = series.map((row) => row.setRate);
  const sellRates = series.map((row) => row.sellRate);
  const combinedRates = [...setRates, ...sellRates];
  const rateMin = combinedRates.length ? Math.min(...combinedRates) : 0;
  const rateMax = combinedRates.length ? Math.max(...combinedRates) : 1;
  const setPoints = getChartPoints(setRates, CHART_WIDTH, CHART_HEIGHT, CHART_PADDING, rateMin, rateMax);
  const sellPoints = getChartPoints(sellRates, CHART_WIDTH, CHART_HEIGHT, CHART_PADDING, rateMin, rateMax);

  const varianceSeries = series.map((row) => (Number.isFinite(row.variancePct) ? row.variancePct : 0));
  const varianceSlice = varianceSeries.slice(-12);
  const avgVariance = average(varianceSlice);
  const maxVariance = Math.max(1, ...varianceSeries.map((value) => Math.abs(value)));

  const rentCounts = series.map((row) => row.rentChangeCount);
  const rentChangeMax = Math.max(1, ...rentCounts);
  const increaseSeries = series.map((row) => row.avgIncreasePct);
  const increaseMin = increaseSeries.length ? Math.min(...increaseSeries) : 0;
  const increaseMax = increaseSeries.length ? Math.max(...increaseSeries) : 1;
  const increasePoints = getChartPoints(
    increaseSeries,
    CHART_WIDTH,
    CHART_HEIGHT,
    CHART_PADDING,
    increaseMin,
    increaseMax,
  );
  const step = increasePoints.length > 1 ? increasePoints[1].x - increasePoints[0].x : 0;
  const barWidth = step ? step * 0.55 : 12;

  const spreadPct =
    latest?.setRate && latest?.sellRate
      ? ((latest.setRate - latest.sellRate) / latest.setRate) * 100
      : 0;
  const staleTotal = Math.max(1, data.metrics.staleRentCount);

  return (
    <section className="space-y-4">
      <SectionHeader
        title="Pricing & Revenue Quality"
        subtitle="Rate positioning, variance, and pricing cadence."
      />

      <div className="grid gap-4 md:grid-cols-2">
        <ChartCard
          key={`set-vs-sell-${range}`}
          title="Set vs Sell Rate"
          subtitle="Rate positioning by month"
          info="Set rate reflects posted pricing. Sell rate reflects actual achieved rent."
          emptyMessage={series.length === 0 ? 'Set vs sell data will appear once MSR pricing is wired.' : undefined}
        >
          <KpiRow
            items={[
              { label: 'Latest set', value: formatCurrency(latest?.setRate ?? 0) },
              { label: 'Latest sell', value: formatCurrency(latest?.sellRate ?? 0) },
              { label: 'Spread', value: formatPercent(spreadPct, 1) },
            ]}
          />

          <div className="rounded-[22px] border border-[color:var(--border-soft)] bg-[color:var(--surface)] p-4 shadow-inner">
            <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} className="h-44 w-full" role="img">
              <defs>
                <linearGradient id="set-rate-line" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="rgba(37,99,235,0.9)" />
                  <stop offset="100%" stopColor="rgba(59,130,246,0.7)" />
                </linearGradient>
                <linearGradient id="sell-rate-line" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="rgba(14,165,233,0.9)" />
                  <stop offset="100%" stopColor="rgba(56,189,248,0.7)" />
                </linearGradient>
              </defs>

              {Array.from({ length: 4 }).map((_, index) => {
                const y = CHART_PADDING + ((CHART_HEIGHT - CHART_PADDING * 2) / 4) * index;
                return (
                  <line
                    key={index}
                    x1={CHART_PADDING}
                    x2={CHART_WIDTH - CHART_PADDING}
                    y1={y}
                    y2={y}
                    stroke="rgba(148,163,255,0.2)"
                    strokeDasharray="6 8"
                  />
                );
              })}

              <path
                d={buildLinePath(setPoints)}
                fill="none"
                stroke="url(#set-rate-line)"
                strokeWidth={3}
                strokeLinecap="round"
                strokeLinejoin="round"
                pathLength={1}
                className="history-chart-line"
              />
              <path
                d={buildLinePath(sellPoints)}
                fill="none"
                stroke="url(#sell-rate-line)"
                strokeWidth={2.6}
                strokeLinecap="round"
                strokeLinejoin="round"
                pathLength={1}
                className="history-chart-line"
                style={{ animationDelay: '0.15s' }}
              />
            </svg>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-[11px] text-[color:var(--text-muted)]">
              <div className="flex items-center gap-3">
                <span className="inline-flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-[rgba(37,99,235,0.8)]" />
                  Set rate
                </span>
                <span className="inline-flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-[rgba(14,165,233,0.8)]" />
                  Sell rate
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
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
          key={`occupied-variance-${range}`}
          title="Occupied Rate Variance"
          subtitle="Variance vs target occupancy rate"
          emptyMessage={series.length === 0 ? 'Variance data will appear once MSR occupancy is wired.' : undefined}
        >
          <KpiRow
            items={[
              { label: 'Trailing 12M avg', value: formatPercent(avgVariance, 1) },
              { label: 'Highest month', value: formatPercent(Math.max(...varianceSeries, 0), 1) },
              { label: 'Lowest month', value: formatPercent(Math.min(...varianceSeries, 0), 1) },
            ]}
          />

          <div className="rounded-[22px] border border-[color:var(--border-soft)] bg-[color:var(--surface)] p-4 shadow-inner">
            <div className="relative h-40">
              <div className="absolute left-0 right-0 top-1/2 h-px bg-[rgba(148,163,255,0.3)]" />
              <div className="relative z-10 flex h-full items-center gap-2">
                {varianceSeries.map((value, index) => {
                  const height = `${(Math.abs(value) / maxVariance) * 45}%`;
                  const isPositive = value >= 0;
                  return (
                    <div key={`${series[index]?.month ?? index}`} className="relative flex h-full flex-1">
                      <div
                        className={`history-chart-bar absolute left-0 right-0 rounded-[10px] ${
                          isPositive
                            ? 'bg-[linear-gradient(180deg,rgba(34,197,94,0.7),rgba(34,197,94,0.2))]'
                            : 'bg-[linear-gradient(180deg,rgba(248,113,113,0.7),rgba(248,113,113,0.2))]'
                        }`}
                        style={
                          isPositive
                            ? { bottom: '50%', height, animationDelay: `${index * 0.05}s` }
                            : { top: '50%', height, animationDelay: `${index * 0.05}s` }
                        }
                        title={`${value.toFixed(1)}%`}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-[color:var(--text-muted)]">
              {series.map((row, index) => (
                <span key={row.month} className={index % 2 === 1 ? 'hidden sm:block' : ''}>
                  {formatShortMonth(row.month)}
                </span>
              ))}
            </div>
          </div>
        </ChartCard>

        <ChartCard
          key={`rent-cadence-${range}`}
          title="Rent Change Cadence"
          subtitle="Monthly rent changes and average increase"
          emptyMessage={series.length === 0 ? 'Rent cadence data will appear once MSR changes are wired.' : undefined}
        >
          <KpiRow
            items={[
              { label: 'Changes last month', value: formatNumber(latest?.rentChangeCount ?? 0) },
              { label: 'Avg increase', value: formatPercent(latest?.avgIncreasePct ?? 0, 1) },
              { label: 'Peak month', value: formatNumber(Math.max(...rentCounts, 0)) },
            ]}
          />

          <div className="rounded-[22px] border border-[color:var(--border-soft)] bg-[color:var(--surface)] p-4 shadow-inner">
            <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} className="h-44 w-full">
              {rentCounts.map((value, index) => {
                const height = ((value / rentChangeMax) * (CHART_HEIGHT - CHART_PADDING * 2)) || 0;
                const x = increasePoints[index]?.x ?? CHART_PADDING;
                const y = CHART_HEIGHT - CHART_PADDING - height;
                return (
                  <rect
                    key={`${series[index]?.month ?? index}`}
                    x={x - barWidth / 2}
                    y={y}
                    width={barWidth}
                    height={height}
                    rx={8}
                    className="history-chart-bar"
                    fill="rgba(37,99,235,0.35)"
                  />
                );
              })}
              <path
                d={buildLinePath(increasePoints)}
                fill="none"
                stroke="rgba(14,165,233,0.9)"
                strokeWidth={2.6}
                strokeLinecap="round"
                strokeLinejoin="round"
                pathLength={1}
                className="history-chart-line"
              />
            </svg>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-[11px] text-[color:var(--text-muted)]">
              <div className="flex items-center gap-3">
                <span className="inline-flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-[rgba(37,99,235,0.6)]" />
                  Change count
                </span>
                <span className="inline-flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-[rgba(14,165,233,0.8)]" />
                  Avg increase
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
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
          key={`stale-rent-${range}`}
          title="Stale Rent Exposure"
          subtitle="Tenants with no rent change in 12 months"
          emptyMessage={
            data.tables.staleRentExposure.length === 0
              ? 'Stale rent exposure will appear once unit history is connected.'
              : undefined
          }
        >
          <div className="ios-list-card space-y-1 p-4">
            <div className="text-[11px] uppercase tracking-wide text-[color:var(--text-muted)]">Total exposure</div>
            <div className="text-2xl font-semibold text-[color:var(--text-primary)]">
              {formatNumber(data.metrics.staleRentCount)}
            </div>
            <div className="text-xs text-[color:var(--text-secondary)]">Across active tenants</div>
          </div>

          <div className="space-y-2">
            {data.tables.staleRentExposure.map((row) => (
              <div key={row.unitType} className="ios-list-card flex items-center justify-between px-4 py-2 text-sm">
                <div className="text-[color:var(--text-primary)]">{row.unitType}</div>
                <div className="flex items-center gap-3">
                  <div className="h-2 w-28 rounded-full bg-[rgba(148,163,255,0.2)]">
                    <div
                      className="h-full rounded-full bg-[linear-gradient(90deg,rgba(37,99,235,0.75),rgba(59,130,246,0.35))]"
                      style={{ width: `${(row.count / staleTotal) * 100}%` }}
                    />
                  </div>
                  <span className="tabular-nums text-[color:var(--text-secondary)]">{formatNumber(row.count)}</span>
                </div>
              </div>
            ))}
          </div>
        </ChartCard>
      </div>
    </section>
  );
}
