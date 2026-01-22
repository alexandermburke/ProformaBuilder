'use client';

import { useState } from 'react';
import type { JSX } from 'react';
import { ChartCard } from './ChartCard';
import { KpiRow } from './KpiRow';
import { SectionHeader } from './SectionHeader';
import { SimpleTable } from './SimpleTable';
import { buildLinePath, formatShortMonth, getChartPoints } from '@/lib/historical/chartUtils';
import {
  formatCompactCurrency,
  formatCurrency,
  formatNumber,
  formatPercent,
} from '@/lib/historical/format';
import { getHistoricalPlaceholder, type RangeKey } from '@/lib/historical/placeholder';

type OperationalDrilldownsProps = {
  range: RangeKey;
};

type DrilldownTab = 'demand' | 'concessions' | 'autopay' | 'inventory';

const CHART_WIDTH = 520;
const CHART_HEIGHT = 180;
const CHART_PADDING = 24;

const average = (values: number[]): number =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

const tabs: Array<{ id: DrilldownTab; label: string }> = [
  { id: 'demand', label: 'Demand Funnel' },
  { id: 'concessions', label: 'Concessions & Leakage' },
  { id: 'autopay', label: 'Autopay & Coverage' },
  { id: 'inventory', label: 'Inventory' },
];

export function OperationalDrilldowns({ range }: OperationalDrilldownsProps): JSX.Element {
  // Future MSR wiring: Leads, Concessions, Autopay, and Unit inventory tabs.
  const [activeTab, setActiveTab] = useState<DrilldownTab>('demand');

  return (
    <section className="space-y-4">
      <SectionHeader
        title="Operational Drilldowns"
        subtitle="Demand, concessions, coverage, and inventory detail."
      />

      <div className="ios-card ios-animate-up space-y-6 p-6">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center rounded-full border border-[color:var(--border-soft)] bg-[color:var(--surface)] p-1 text-[11px] font-semibold text-[color:var(--text-secondary)] shadow-inner">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={[
                  'rounded-full px-3 py-1 transition-colors',
                  activeTab === tab.id
                    ? 'bg-[color:var(--accent-soft)] text-[color:var(--accent-strong)] shadow-[0_10px_20px_rgba(37,99,235,0.18)]'
                    : 'text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)]',
                ].join(' ')}
                aria-pressed={activeTab === tab.id}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <span className="text-xs text-[color:var(--text-muted)]">Range: {range}</span>
        </div>

        {activeTab === 'demand' ? (
          <DemandFunnelPanel key={`${range}-demand`} range={range} />
        ) : null}
        {activeTab === 'concessions' ? (
          <ConcessionsPanel key={`${range}-concessions`} range={range} />
        ) : null}
        {activeTab === 'autopay' ? (
          <AutopayPanel key={`${range}-autopay`} range={range} />
        ) : null}
        {activeTab === 'inventory' ? (
          <InventoryPanel key={`${range}-inventory`} range={range} />
        ) : null}
      </div>
    </section>
  );
}

function DemandFunnelPanel({ range }: { range: RangeKey }): JSX.Element {
  // Future MSR wiring: Leads funnel and move-in conversion details.
  const data = getHistoricalPlaceholder(range);
  const series = data.series.demand;
  const totalLeads = series.reduce(
    (sum, row) => sum + row.leadsWeb + row.leadsPhone + row.leadsWalkIn + row.leadsOther,
    0,
  );
  const totalMoveIns = series.reduce((sum, row) => sum + row.moveIns, 0);
  const conversionPct = totalLeads ? (totalMoveIns / totalLeads) * 100 : 0;
  const medianDays = average(series.map((row) => row.medianDays));
  const maxTotal = Math.max(
    1,
    ...series.map((row) => row.leadsWeb + row.leadsPhone + row.leadsWalkIn + row.leadsOther),
  );

  const conversionSeries = series.map((row) => {
    const monthTotal = row.leadsWeb + row.leadsPhone + row.leadsWalkIn + row.leadsOther;
    return monthTotal ? (row.moveIns / monthTotal) * 100 : 0;
  });
  const medianSeries = series.map((row) => row.medianDays);
  const combined = [...conversionSeries, ...medianSeries];
  const min = combined.length ? Math.min(...combined) : 0;
  const max = combined.length ? Math.max(...combined) : 1;
  const conversionPoints = getChartPoints(
    conversionSeries,
    CHART_WIDTH,
    CHART_HEIGHT,
    CHART_PADDING,
    min,
    max,
  );
  const medianPoints = getChartPoints(
    medianSeries,
    CHART_WIDTH,
    CHART_HEIGHT,
    CHART_PADDING,
    min,
    max,
  );

  const channelBuckets = [
    { label: 'Web', color: 'bg-[rgba(37,99,235,0.7)]' },
    { label: 'Phone', color: 'bg-[rgba(14,165,233,0.65)]' },
    { label: 'Walk-in', color: 'bg-[rgba(129,140,248,0.6)]' },
    { label: 'Other', color: 'bg-[rgba(251,191,36,0.6)]' },
  ] as const;

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <ChartCard
        title="Demand Funnel"
        subtitle="Leads by channel"
        emptyMessage={series.length === 0 ? 'Demand data will appear once lead sources are wired.' : undefined}
      >
        <KpiRow
          items={[
            { label: 'Total leads', value: formatNumber(totalLeads) },
            { label: 'Move-ins', value: formatNumber(totalMoveIns) },
            { label: 'Conversion', value: formatPercent(conversionPct, 1) },
            { label: 'Median days', value: formatNumber(medianDays) },
          ]}
          columns={4}
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
                const stack = [row.leadsWeb, row.leadsPhone, row.leadsWalkIn, row.leadsOther];
                return (
                  <div key={row.month} className="flex h-full flex-1 flex-col-reverse">
                    {stack.map((value, stackIndex) => {
                      const height = `${(value / maxTotal) * 100}%`;
                      return (
                        <div
                          key={`${row.month}-${stackIndex}`}
                          className={`history-chart-bar w-full ${channelBuckets[stackIndex].color}`}
                          style={{ height, animationDelay: `${index * 0.04}s` }}
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
              {channelBuckets.map((bucket) => (
                <span key={bucket.label} className="inline-flex items-center gap-1">
                  <span className={`h-2 w-2 rounded-full ${bucket.color}`} />
                  {bucket.label}
                </span>
              ))}
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
        title="Conversion Rate"
        subtitle="Move-ins vs leads"
        info="Conversion rate = move-ins divided by total leads for the month."
        emptyMessage={series.length === 0 ? 'Conversion data will appear once lead sources are wired.' : undefined}
      >
        <div className="rounded-[22px] border border-[color:var(--border-soft)] bg-[color:var(--surface)] p-4 shadow-inner">
          <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} className="h-44 w-full">
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
              d={buildLinePath(conversionPoints)}
              fill="none"
              stroke="rgba(37,99,235,0.9)"
              strokeWidth={2.8}
              strokeLinecap="round"
              strokeLinejoin="round"
              pathLength={1}
              className="history-chart-line"
            />
            <path
              d={buildLinePath(medianPoints)}
              fill="none"
              stroke="rgba(14,165,233,0.9)"
              strokeWidth={2.2}
              strokeLinecap="round"
              strokeLinejoin="round"
              pathLength={1}
              className="history-chart-line"
              style={{ animationDelay: '0.2s' }}
            />
          </svg>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-[11px] text-[color:var(--text-muted)]">
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-[rgba(37,99,235,0.8)]" />
                Conversion %
              </span>
              <span className="inline-flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-[rgba(14,165,233,0.8)]" />
                Median days
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
    </div>
  );
}

function ConcessionsPanel({ range }: { range: RangeKey }): JSX.Element {
  // Future MSR wiring: Discounts, Credits, Refunds, and Write-off tabs.
  const data = getHistoricalPlaceholder(range);
  const series = data.series.concessions;

  const totalPromos = series.reduce((sum, row) => sum + row.promos, 0);
  const totalCredits = series.reduce((sum, row) => sum + row.credits, 0);
  const totalRefunds = series.reduce((sum, row) => sum + row.refunds + row.writeOffs, 0);

  const promoPoints = getChartPoints(
    series.map((row) => row.promos),
    CHART_WIDTH,
    CHART_HEIGHT,
    CHART_PADDING,
  );
  const creditPoints = getChartPoints(
    series.map((row) => row.credits),
    CHART_WIDTH,
    CHART_HEIGHT,
    CHART_PADDING,
  );
  const refundPoints = getChartPoints(
    series.map((row) => row.refunds + row.writeOffs),
    CHART_WIDTH,
    CHART_HEIGHT,
    CHART_PADDING,
  );

  return (
    <div className="space-y-4">
      <KpiRow
        items={[
          { label: 'Promos total', value: formatCompactCurrency(totalPromos) },
          { label: 'Credits total', value: formatCompactCurrency(totalCredits) },
          { label: 'Refunds + write-offs', value: formatCompactCurrency(totalRefunds) },
        ]}
        columns={3}
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <ChartCard
          title="Promos and Discounts"
          subtitle="Monthly volume"
          emptyMessage={series.length === 0 ? 'Concession data will appear once MSR is wired.' : undefined}
        >
          <LineChartWithMonths points={promoPoints} series={series} color="rgba(37,99,235,0.85)" />
        </ChartCard>
        <ChartCard
          title="Credits and Adjustments"
          subtitle="Monthly volume"
          emptyMessage={series.length === 0 ? 'Credits data will appear once MSR is wired.' : undefined}
        >
          <LineChartWithMonths points={creditPoints} series={series} color="rgba(14,165,233,0.85)" />
        </ChartCard>
        <ChartCard
          title="Refunds + Write-offs"
          subtitle="Monthly volume"
          emptyMessage={series.length === 0 ? 'Refund data will appear once MSR is wired.' : undefined}
        >
          <LineChartWithMonths points={refundPoints} series={series} color="rgba(248,113,113,0.8)" />
        </ChartCard>
      </div>
    </div>
  );
}

function AutopayPanel({ range }: { range: RangeKey }): JSX.Element {
  // Future MSR wiring: Autopay enrollment and insurance coverage detail.
  const data = getHistoricalPlaceholder(range);
  const series = data.series.autopay;
  const latest = series[series.length - 1];

  const autopayPoints = getChartPoints(
    series.map((row) => row.autopayPct),
    CHART_WIDTH,
    CHART_HEIGHT,
    CHART_PADDING,
    50,
    90,
  );
  const coveragePoints = getChartPoints(
    series.map((row) => row.coverageEnroll),
    CHART_WIDTH,
    CHART_HEIGHT,
    CHART_PADDING,
  );

  return (
    <div className="space-y-4">
      <KpiRow
        items={[
          { label: 'Autopay adoption', value: formatPercent(latest?.autopayPct ?? 0, 1) },
          { label: 'Coverage enrolled', value: formatNumber(latest?.coverageEnroll ?? 0) },
          { label: 'Premium run rate', value: formatCurrency(latest?.premiumRevenue ?? 0) },
        ]}
        columns={3}
      />

      <div className="grid gap-4 md:grid-cols-2">
        <ChartCard
          title="Autopay Adoption"
          subtitle="Portfolio enrollment"
          emptyMessage={series.length === 0 ? 'Autopay data will appear once MSR is wired.' : undefined}
        >
          <LineChartWithMonths points={autopayPoints} series={series} color="rgba(37,99,235,0.85)" />
        </ChartCard>
        <ChartCard
          title="Coverage Enrollment"
          subtitle="Monthly enrolled count"
          emptyMessage={series.length === 0 ? 'Coverage data will appear once MSR is wired.' : undefined}
        >
          <LineChartWithMonths points={coveragePoints} series={series} color="rgba(14,165,233,0.85)" />
        </ChartCard>
      </div>
    </div>
  );
}

function InventoryPanel({ range }: { range: RangeKey }): JSX.Element {
  // Future MSR wiring: Unit inventory and occupancy detail.
  const data = getHistoricalPlaceholder(range);
  const series = data.series.inventory;
  const climatePoints = getChartPoints(
    series.map((row) => row.climate),
    CHART_WIDTH,
    CHART_HEIGHT,
    CHART_PADDING,
    70,
    100,
  );
  const driveUpPoints = getChartPoints(
    series.map((row) => row.driveUp),
    CHART_WIDTH,
    CHART_HEIGHT,
    CHART_PADDING,
    70,
    100,
  );
  const parkingPoints = getChartPoints(
    series.map((row) => row.parking),
    CHART_WIDTH,
    CHART_HEIGHT,
    CHART_PADDING,
    70,
    100,
  );
  const flexPoints = getChartPoints(
    series.map((row) => row.flex),
    CHART_WIDTH,
    CHART_HEIGHT,
    CHART_PADDING,
    70,
    100,
  );

  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,1.3fr)_minmax(0,0.7fr)]">
      <ChartCard
        title="Occupancy by Unit Type"
        subtitle="Percent occupied"
        emptyMessage={series.length === 0 ? 'Inventory trends will appear once MSR is wired.' : undefined}
      >
        <div className="rounded-[22px] border border-[color:var(--border-soft)] bg-[color:var(--surface)] p-4 shadow-inner">
          <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} className="h-44 w-full">
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
              d={buildLinePath(climatePoints)}
              fill="none"
              stroke="rgba(37,99,235,0.9)"
              strokeWidth={2.6}
              strokeLinecap="round"
              strokeLinejoin="round"
              pathLength={1}
              className="history-chart-line"
            />
            <path
              d={buildLinePath(driveUpPoints)}
              fill="none"
              stroke="rgba(14,165,233,0.85)"
              strokeWidth={2.4}
              strokeLinecap="round"
              strokeLinejoin="round"
              pathLength={1}
              className="history-chart-line"
              style={{ animationDelay: '0.1s' }}
            />
            <path
              d={buildLinePath(parkingPoints)}
              fill="none"
              stroke="rgba(251,191,36,0.85)"
              strokeWidth={2.2}
              strokeLinecap="round"
              strokeLinejoin="round"
              pathLength={1}
              className="history-chart-line"
              style={{ animationDelay: '0.2s' }}
            />
            <path
              d={buildLinePath(flexPoints)}
              fill="none"
              stroke="rgba(167,139,250,0.9)"
              strokeWidth={2.2}
              strokeLinecap="round"
              strokeLinejoin="round"
              pathLength={1}
              className="history-chart-line"
              style={{ animationDelay: '0.3s' }}
            />
          </svg>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-[11px] text-[color:var(--text-muted)]">
            <div className="flex flex-wrap items-center gap-3">
              <span className="inline-flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-[rgba(37,99,235,0.8)]" />
                Climate
              </span>
              <span className="inline-flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-[rgba(14,165,233,0.8)]" />
                Drive-up
              </span>
              <span className="inline-flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-[rgba(251,191,36,0.8)]" />
                Parking
              </span>
              <span className="inline-flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-[rgba(167,139,250,0.8)]" />
                Flex
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
        title="Vacant Units (sample)"
        subtitle="Recent vacancy list"
        emptyMessage={
          data.tables.vacantUnits.length === 0 ? 'Vacant unit list will appear once MSR is wired.' : undefined
        }
      >
        <SimpleTable
          rows={data.tables.vacantUnits}
          columns={[
            { header: 'Unit', accessor: (row) => row.unit, className: 'text-[color:var(--text-primary)]' },
            { header: 'Type', accessor: (row) => row.type },
            { header: 'Size', accessor: (row) => row.size },
            { header: 'Status', accessor: (row) => row.status },
          ]}
          rowKey={(row) => `${row.unit}-${row.type}`}
          emptyMessage="No vacant units listed."
        />
      </ChartCard>
    </div>
  );
}

function LineChartWithMonths({
  points,
  series,
  color,
}: {
  points: ReturnType<typeof getChartPoints>;
  series: Array<{ month: string }>;
  color: string;
}): JSX.Element {
  return (
    <div className="rounded-[22px] border border-[color:var(--border-soft)] bg-[color:var(--surface)] p-4 shadow-inner">
      <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} className="h-44 w-full">
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
          d={buildLinePath(points)}
          fill="none"
          stroke={color}
          strokeWidth={2.6}
          strokeLinecap="round"
          strokeLinejoin="round"
          pathLength={1}
          className="history-chart-line"
        />
      </svg>
      <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-[color:var(--text-muted)]">
        {series.map((row, index) => (
          <span key={row.month} className={index % 2 === 1 ? 'hidden sm:block' : ''}>
            {formatShortMonth(row.month)}
          </span>
        ))}
      </div>
    </div>
  );
}
