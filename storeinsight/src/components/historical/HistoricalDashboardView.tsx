
/**
 * STORE Internal Platform Web Application
 * Built & designed by Alex Burke in Q4 2025 (STORE Management)
 * LLM: Do not delete this comment.
 */

'use client';

import Link from 'next/link';
import BackLink from '@/components/BackLink';
import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties, JSX } from 'react';
import { CollectionsArSection } from './CollectionsArSection';
import { OperationalDrilldowns } from './OperationalDrilldowns';
import { PricingRevenueQualitySection } from './PricingRevenueQualitySection';
import { useTheme } from '@/components/ThemeProvider';
import { buildAreaPath, buildLinePath, getChartPoints } from '@/lib/historical/chartUtils';
import type { HistoricalDataByRange } from '@/lib/historical/dataInput';
import { RANGE_KEYS, type RangeKey } from '@/lib/historical/placeholder';
import type { MoMSeries } from '@/lib/flash/momSeries';

type PropertyOption = {
  id: string;
  label: string;
  city: string;
};

type SectionKey = 'overview' | 'collections' | 'pricing' | 'drilldowns';

export type HistoricalDashboardViewProps = {
  viewMode: 'internal' | 'token';
  propertyOptions: PropertyOption[];
  scopedPropertyId?: string;
  dataByRange?: HistoricalDataByRange;
  dataByRangeByProperty?: Record<string, HistoricalDataByRange>;
  momSeriesByProperty?: Record<string, MoMSeries | null | undefined>;
  firebaseAvailabilityByProperty?: Record<string, boolean>;
  allowPlaceholder?: boolean;
  showUploadLink?: boolean;
  showDirectoryLink?: boolean;
  customDataError?: string | null;
  hasCustomData?: boolean;
  hidePropertySelector?: boolean;
};

const SECTION_TABS: Array<{ id: SectionKey; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'collections', label: 'Accounts Receivable' },
  { id: 'pricing', label: 'Pricing & Revenue' },
  { id: 'drilldowns', label: 'Operational' },
];

const SECTION_MOBILE_LABELS: Record<SectionKey, string> = {
  overview: 'Summary',
  collections: 'AR',
  pricing: 'Pricing',
  drilldowns: 'Ops',
};

const UNIT_MIX = [
  { label: 'Climate', value: 46, color: '#3B82F6' },
  { label: 'Drive-up', value: 28, color: '#22D3EE' },
  { label: 'Parking', value: 16, color: '#F97316' },
  { label: 'Flex', value: 10, color: '#A78BFA' },
];

type FacilityTone = 'success' | 'warning' | 'neutral';

type FacilitySnapshot = {
  name: string;
  city: string;
  occupancy: number;
  rate: number;
  yoy: number;
  status: string;
  tone: FacilityTone;
  trend: number[];
};

const CHART_WIDTH = 620;
const CHART_HEIGHT = 240;
const CHART_PADDING = 26;
const SPARK_WIDTH = 140;
const SPARK_HEIGHT = 44;
const SPARK_PADDING = 6;

const monthFormatter = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' });

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

const compactFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  maximumFractionDigits: 0,
});

function formatMonthLabel(yyyyMm: string): string {
  const [yStr, mStr] = yyyyMm.split('-');
  const year = Number(yStr);
  const month = Number(mStr);
  if (!year || !month) return yyyyMm;
  const date = new Date(Date.UTC(year, month - 1, 1));
  return monthFormatter.format(date);
}

function isPositiveNumber(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function average(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function buildRateIndex(values: number[]): number[] {
  const baseline = values.find((value) => value > 0) ?? 1;
  let lastValue = baseline;
  return values.map((value) => {
    const current = value > 0 ? value : lastValue;
    lastValue = current;
    return Math.round((current / baseline) * 100);
  });
}

function deriveStatus(yoy: number): { status: string; tone: FacilityTone } {
  if (yoy >= 5) return { status: 'Growing', tone: 'success' };
  if (yoy >= 0) return { status: 'Stable', tone: 'neutral' };
  return { status: 'Watch', tone: 'warning' };
}

function buildFacilitySnapshot(series: MoMSeries | null, meta: { name: string; city: string }): FacilitySnapshot | null {
  if (!series) return null;
  const occupancyRecent = series.occupiedPct.slice(0, 7).map((value) => (isPositiveNumber(value) ? value : 0));
  const revenueRecent = series.grossAccruedRent.slice(0, 7).map((value) => (isPositiveNumber(value) ? value : 0));
  if (!occupancyRecent.length || !revenueRecent.length) return null;

  const latestOccupancy = occupancyRecent[0] ?? 0;
  const latestRevenue = revenueRecent[0] ?? 0;
  const oldestRevenue = revenueRecent[revenueRecent.length - 1] ?? 0;
  const yoy = oldestRevenue > 0 ? ((latestRevenue - oldestRevenue) / oldestRevenue) * 100 : 0;
  const { status, tone } = deriveStatus(yoy);

  return {
    name: meta.name,
    city: meta.city,
    occupancy: round1(latestOccupancy),
    rate: Math.round(latestRevenue),
    yoy: round1(yoy),
    status,
    tone,
    trend: occupancyRecent.slice().reverse().map(round1),
  };
}

function formatCurrency(value: number): string {
  if (!Number.isFinite(value)) return '$0';
  return currencyFormatter.format(Math.round(value));
}

function formatCompactCurrency(value: number): string {
  if (!Number.isFinite(value)) return '$0';
  return compactFormatter.format(Math.round(value));
}
export function HistoricalDashboardView({
  viewMode,
  propertyOptions,
  scopedPropertyId,
  dataByRange,
  dataByRangeByProperty,
  momSeriesByProperty,
  firebaseAvailabilityByProperty,
  allowPlaceholder,
  showUploadLink,
  showDirectoryLink,
  customDataError,
  hasCustomData,
  hidePropertySelector,
}: HistoricalDashboardViewProps): JSX.Element {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const [range, setRange] = useState<RangeKey>('1Y');
  const [section, setSection] = useState<SectionKey>('overview');
  const [selectedProperty, setSelectedProperty] = useState<string>(
    scopedPropertyId ?? propertyOptions[0]?.id ?? '',
  );

  useEffect(() => {
    if (viewMode === 'token' && scopedPropertyId && selectedProperty !== scopedPropertyId) {
      setSelectedProperty(scopedPropertyId);
    }
  }, [viewMode, scopedPropertyId, selectedProperty]);

  const allowPlaceholderData = allowPlaceholder ?? viewMode === 'internal';
  const activeProperty =
    propertyOptions.find((option) => option.id === selectedProperty) ??
    propertyOptions[0] ?? {
      id: selectedProperty || scopedPropertyId || 'property',
      label: selectedProperty || scopedPropertyId || 'Property',
      city: '',
    };
  const activeDataByRange = dataByRangeByProperty?.[activeProperty.id] ?? dataByRange;
  const hasFirebaseData = firebaseAvailabilityByProperty
    ? Boolean(firebaseAvailabilityByProperty[activeProperty.id])
    : Boolean(hasCustomData);
  const activeSeries = momSeriesByProperty?.[activeProperty.id] ?? null;
  const hasOverviewSeries = Boolean(activeSeries?.months?.length);

  const baseMonths = activeSeries?.months ?? [];
  const occupancyDesc = baseMonths.map((_, index) => {
    const value = activeSeries?.occupiedPct[index];
    return isPositiveNumber(value) ? value : 0;
  });
  const revenueDesc = baseMonths.map((_, index) => {
    const value = activeSeries?.grossAccruedRent[index];
    return isPositiveNumber(value) ? value : 0;
  });

  const MONTHS = baseMonths.slice().reverse().map(formatMonthLabel);
  const OCCUPANCY_SERIES = occupancyDesc.slice().reverse().map(round1);
  const RATE_INDEX_SERIES = buildRateIndex(revenueDesc).reverse();
  const REVENUE_SERIES = revenueDesc.slice().reverse();
  const avgOccupancyValues = occupancyDesc.filter((value) => value > 0);
  const AVG_OCCUPANCY = avgOccupancyValues.length ? Math.round(average(avgOccupancyValues)) : 0;
  const TOTAL_REVENUE = revenueDesc.reduce((sum, value) => sum + value, 0);
  const LATEST_REVENUE = revenueDesc.find((value) => value > 0) ?? 0;
  const facilitySnapshot = buildFacilitySnapshot(activeSeries, {
    name: activeProperty.label,
    city: activeProperty.city,
  });
  const FACILITY_SNAPSHOTS = facilitySnapshot ? [facilitySnapshot] : [];

  const overlayTop = isDark
    ? 'bg-[radial-gradient(circle_at_18%_10%,rgba(59,130,246,0.28),transparent_60%)]'
    : 'bg-[radial-gradient(circle_at_20%_10%,rgba(37,99,235,0.18),transparent_60%)]';
  const overlayBottom = isDark
    ? 'bg-[radial-gradient(circle_at_85%_85%,rgba(56,189,248,0.22),transparent_65%)]'
    : 'bg-[radial-gradient(circle_at_82%_88%,rgba(125,211,252,0.16),transparent_62%)]';

  const {
    occupancyLine,
    occupancyArea,
    rateLine,
    occupancyPoint,
    ratePoint,
    gridLines,
  } = useMemo(() => {
    const combined = [...OCCUPANCY_SERIES, ...RATE_INDEX_SERIES];
    const min = combined.length ? Math.min(...combined) : 0;
    const max = combined.length ? Math.max(...combined) : 1;
    const occupancyPoints = getChartPoints(OCCUPANCY_SERIES, CHART_WIDTH, CHART_HEIGHT, CHART_PADDING, min, max);
    const ratePoints = getChartPoints(RATE_INDEX_SERIES, CHART_WIDTH, CHART_HEIGHT, CHART_PADDING, min, max);
    return {
      occupancyLine: buildLinePath(occupancyPoints),
      occupancyArea: buildAreaPath(occupancyPoints, CHART_HEIGHT, CHART_PADDING),
      rateLine: buildLinePath(ratePoints),
      occupancyPoint: occupancyPoints[occupancyPoints.length - 1],
      ratePoint: ratePoints[ratePoints.length - 1],
      gridLines: Array.from({ length: 4 }, (_, index) => {
        const t = (index + 1) / 4;
        return CHART_PADDING + (1 - t) * (CHART_HEIGHT - CHART_PADDING * 2);
      }),
    };
  }, [OCCUPANCY_SERIES, RATE_INDEX_SERIES]);

  const revenueMax = Math.max(1, ...REVENUE_SERIES);

  const unitMixSegments = useMemo(() => {
    let offset = 0;
    return UNIT_MIX.map((segment, index) => {
      const start = 25 - offset;
      offset += segment.value;
      return {
        ...segment,
        offset: start,
        delay: `${index * 0.12}s`,
      };
    });
  }, []);

  const sectionLabel = SECTION_TABS.find((sectionOption) => sectionOption.id === section)?.label ?? 'Overview';
  const statusLabel =
    viewMode === 'internal'
      ? customDataError
        ? 'Data invalid'
        : hasFirebaseData
          ? 'Production Database'
          : 'Placeholder data'
      : 'Investor view';
  const statusTone =
    viewMode === 'internal'
      ? customDataError
        ? 'warning'
        : hasFirebaseData
          ? 'success'
          : 'neutral'
      : 'neutral';

  const latestOccupancy = OCCUPANCY_SERIES.length ? OCCUPANCY_SERIES[OCCUPANCY_SERIES.length - 1] : 0;
  const latestRateIndex = RATE_INDEX_SERIES.length ? RATE_INDEX_SERIES[RATE_INDEX_SERIES.length - 1] : 0;

  return (
    <div className="relative min-h-screen w-full overflow-hidden text-[color:var(--text-primary)]">
      <div className={`pointer-events-none absolute inset-0 -z-20 ${overlayTop}`} />
      <div className={`pointer-events-none absolute inset-0 -z-20 ${overlayBottom}`} />

      <div className="relative mx-auto flex max-w-[1200px] flex-col gap-8 px-6 py-10">
        <header className="ios-card ios-animate-up space-y-6 p-6 md:p-8" data-tone="blue">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="ios-badge text-[10px]">
                  {viewMode === 'internal' ? 'Historical data' : 'Investor dashboard'}
                </span>
                <span className="ios-pill text-[10px]" data-tone={statusTone}>
                  {statusLabel}
                </span>
              </div>
              <div className="space-y-2">
                <h1 className="text-2xl font-semibold tracking-tight text-[color:var(--text-primary)] sm:text-3xl">
                  STORE per facility history
                </h1>
                <p className="max-w-2xl text-sm text-[color:var(--text-secondary)]">
                  {viewMode === 'internal'
                    ? 'Facility performance trends across occupancy, revenue, and unit mix. Data shown is placeholder until the historical pipeline is wired in.'
                    : 'Facility performance trends across occupancy, revenue, and operational KPIs.'}
                </p>
              </div>
            </div>
            <div className="flex flex-1 flex-wrap items-center gap-3">
              {showUploadLink ? (
                <Link href="/historical-data-upload" className="ios-button ml-auto px-4 py-2 text-sm" data-variant="ghost">
                  Upload data
                </Link>
              ) : null}
              {showDirectoryLink ? (
                <BackLink href="/other" label="Back to historical data" />
              ) : null}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="ios-list-card space-y-1 p-4">
              <div className="text-[11px] uppercase tracking-wide text-[color:var(--text-muted)]">Avg occupancy</div>
              <div className="text-xl font-semibold text-[color:var(--text-primary)]">{AVG_OCCUPANCY}%</div>
              <div className="text-xs text-[color:var(--text-secondary)]">Trailing 12 months</div>
            </div>
            <div className="ios-list-card space-y-1 p-4">
              <div className="text-[11px] uppercase tracking-wide text-[color:var(--text-muted)]">Gross accrued rent</div>
              <div className="text-xl font-semibold text-[color:var(--text-primary)]">
                {formatCompactCurrency(LATEST_REVENUE)}
              </div>
              <div className="text-xs text-[color:var(--text-secondary)]">Most recent month</div>
            </div>
            <div className="ios-list-card space-y-1 p-4">
              <div className="text-[11px] uppercase tracking-wide text-[color:var(--text-muted)]">Net move-ins</div>
              <div className="text-xl font-semibold text-[color:var(--text-primary)]">+128</div>
              <div className="text-xs text-[color:var(--text-secondary)]">Last 12 months</div>
            </div>
            <div className="ios-list-card space-y-1 p-4">
              <div className="text-[11px] uppercase tracking-wide text-[color:var(--text-muted)]">Revenue run rate</div>
              <div className="text-xl font-semibold text-[color:var(--text-primary)]">
                {formatCompactCurrency(TOTAL_REVENUE)}
              </div>
              <div className="text-xs text-[color:var(--text-secondary)]">Trailing 12 months</div>
            </div>
          </div>

          <div className="ios-list-card flex flex-wrap items-center justify-between gap-4 px-4 py-3 text-xs">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--text-muted)]">
                Section
              </span>
              <div className="flex items-center rounded-full border border-[color:var(--border-soft)] bg-[color:var(--surface)] p-1 text-[11px] font-semibold text-[color:var(--text-secondary)] shadow-inner">
                {SECTION_TABS.map((sectionOption) => (
                  <button
                    key={sectionOption.id}
                    type="button"
                    aria-pressed={section === sectionOption.id}
                    onClick={() => setSection(sectionOption.id)}
                    className={[
                      'rounded-full px-3 py-1 transition-colors',
                      section === sectionOption.id
                        ? 'bg-[color:var(--accent-soft)] text-[color:var(--accent-strong)] shadow-[0_10px_20px_rgba(37,99,235,0.18)]'
                        : 'text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)]',
                    ].join(' ')}
                  >
                    <span className="text-[10px] sm:hidden">{SECTION_MOBILE_LABELS[sectionOption.id]}</span>
                    <span className="hidden sm:inline">{sectionOption.label}</span>
                  </button>
                ))}
              </div>
              {viewMode === 'internal' && !hidePropertySelector ? (
                <div className="flex items-center gap-2 rounded-full border border-[color:var(--border-soft)] bg-[color:var(--surface)] px-3 py-1 shadow-inner">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--text-muted)]">
                    Property
                  </span>
                  <select
                    className="bg-transparent text-[11px] font-semibold text-[color:var(--text-primary)] focus:outline-none"
                    value={selectedProperty}
                    onChange={(event) => setSelectedProperty(event.target.value)}
                  >
                    {propertyOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="flex items-center gap-2 rounded-full border border-[color:var(--border-soft)] bg-[color:var(--surface)] px-3 py-1 shadow-inner">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--text-muted)]">
                    Property
                  </span>
                  <span className="text-[11px] font-semibold text-[color:var(--text-primary)]">{activeProperty.label}</span>
                </div>
              )}
            </div>
            {viewMode === 'internal' ? (
              <div className="flex items-center gap-3">
                <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--text-muted)]">
                  Range
                </span>
                <div className="flex items-center rounded-full border border-[color:var(--border-soft)] bg-[color:var(--surface)] p-1 text-[11px] font-semibold text-[color:var(--text-secondary)] shadow-inner">
                  {RANGE_KEYS.map((rangeOption) => (
                    <button
                      key={rangeOption}
                      type="button"
                      aria-pressed={range === rangeOption}
                      onClick={() => setRange(rangeOption)}
                      className={[
                        'rounded-full px-3 py-1 transition-colors',
                        range === rangeOption
                          ? 'bg-[color:var(--accent-soft)] text-[color:var(--accent-strong)] shadow-[0_10px_20px_rgba(37,99,235,0.18)]'
                          : 'text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)]',
                      ].join(' ')}
                    >
                      {rangeOption}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </header>
        {section === 'overview' ? (
          hasOverviewSeries ? (
            <>
              <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
                <div className="ios-card ios-animate-up space-y-6 p-6">
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <div className="text-lg font-semibold text-[color:var(--text-primary)]">Occupancy and rate trend</div>
                      <div className="text-xs uppercase tracking-wide text-[color:var(--text-muted)]">
                        {activeProperty.label} - last 12 months
                      </div>
                    </div>
                    <div className="flex items-center gap-4 text-xs text-[color:var(--text-secondary)]">
                      <span className="inline-flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full bg-[rgba(37,99,235,0.8)]" />
                        Occupancy
                      </span>
                      <span className="inline-flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full bg-[rgba(14,165,233,0.8)]" />
                        Rate index
                      </span>
                    </div>
                  </div>

                  <div
                    key={`overview-trend-${range}`}
                    className="rounded-[22px] border border-[color:var(--border-soft)] bg-[color:var(--surface)] p-4 shadow-inner"
                  >
                    <svg
                      viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
                      className="h-56 w-full"
                      role="img"
                      aria-label="Occupancy and rate trend line chart"
                    >
                      <defs>
                        <linearGradient id="history-occupancy-area" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="rgba(37,99,235,0.35)" />
                          <stop offset="100%" stopColor="rgba(37,99,235,0.02)" />
                        </linearGradient>
                        <linearGradient id="history-rate-glow" x1="0" y1="0" x2="1" y2="0">
                          <stop offset="0%" stopColor="rgba(14,165,233,0.85)" />
                          <stop offset="100%" stopColor="rgba(56,189,248,0.95)" />
                        </linearGradient>
                      </defs>

                      {gridLines.map((y) => (
                        <line
                          key={y}
                          x1={CHART_PADDING}
                          x2={CHART_WIDTH - CHART_PADDING}
                          y1={y}
                          y2={y}
                          stroke="rgba(148,163,255,0.24)"
                          strokeDasharray="6 8"
                        />
                      ))}

                      <path d={occupancyArea} fill="url(#history-occupancy-area)" className="history-chart-area" />
                      <path
                        d={occupancyLine}
                        fill="none"
                        stroke="rgba(37,99,235,0.9)"
                        strokeWidth={3}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        pathLength={1}
                        className="history-chart-line"
                        style={{ animationDelay: '0.1s' }}
                      />
                      <path
                        d={rateLine}
                        fill="none"
                        stroke="url(#history-rate-glow)"
                        strokeWidth={2.6}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        pathLength={1}
                        className="history-chart-line"
                        style={{ animationDelay: '0.25s' }}
                      />

                      {occupancyPoint ? (
                        <circle
                          cx={occupancyPoint.x}
                          cy={occupancyPoint.y}
                          r={5}
                          fill="#ffffff"
                          stroke="rgba(37,99,235,0.9)"
                          strokeWidth={2}
                        />
                      ) : null}
                      {ratePoint ? (
                        <circle
                          cx={ratePoint.x}
                          cy={ratePoint.y}
                          r={4.5}
                          fill="#ffffff"
                          stroke="rgba(14,165,233,0.9)"
                          strokeWidth={2}
                        />
                      ) : null}
                    </svg>

                    <div className="mt-3 grid grid-cols-6 gap-2 text-[11px] text-[color:var(--text-muted)] sm:grid-cols-12">
                      {MONTHS.map((month, index) => (
                        <span key={month} className={index % 2 === 1 ? 'hidden sm:block' : ''}>
                          {month}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-4 text-sm text-[color:var(--text-secondary)]">
                    <div className="ios-list-card flex items-center gap-3 px-4 py-2">
                      <div>
                        <div className="text-[11px] uppercase tracking-wide text-[color:var(--text-muted)]">
                          Latest occupancy
                        </div>
                        <div className="text-lg font-semibold text-[color:var(--text-primary)]">
                          {latestOccupancy}%
                        </div>
                      </div>
                    </div>
                    <div className="ios-list-card flex items-center gap-3 px-4 py-2">
                      <div>
                        <div className="text-[11px] uppercase tracking-wide text-[color:var(--text-muted)]">Rate index</div>
                        <div className="text-lg font-semibold text-[color:var(--text-primary)]">{latestRateIndex}</div>
                      </div>
                    </div>
                    <div className="ios-list-card flex items-center gap-3 px-4 py-2">
                      <div>
                        <div className="text-[11px] uppercase tracking-wide text-[color:var(--text-muted)]">YoY change</div>
                        <div className="text-lg font-semibold text-[color:var(--text-primary)]">+4.8%</div>
                      </div>
                    </div>
                  </div>
                </div>

                <aside className="ios-card ios-animate-up space-y-6 p-6" data-tone="purple">
                  <div>
                    <div className="text-base font-semibold text-[color:var(--text-primary)]">Unit mix</div>
                    <div className="text-xs uppercase tracking-wide text-[color:var(--text-muted)]">
                      Distribution by occupied area
                    </div>
                  </div>

                  <div className="flex items-center justify-center">
                    <div className="relative flex h-40 w-40 items-center justify-center">
                      <svg
                        key={`unit-mix-${range}`}
                        viewBox="0 0 120 120"
                        className="h-full w-full"
                        role="img"
                        aria-label="Unit mix donut chart"
                      >
                        <circle cx="60" cy="60" r="46" fill="none" stroke="rgba(148,163,255,0.2)" strokeWidth="12" />
                        {unitMixSegments.map((segment) => (
                          <circle
                            key={segment.label}
                            cx="60"
                            cy="60"
                            r="46"
                            fill="none"
                            stroke={segment.color}
                            strokeWidth="12"
                            strokeLinecap="round"
                            pathLength={100}
                            strokeDashoffset={segment.offset}
                            className="history-donut-ring"
                            style={
                              {
                                '--dash': `${segment.value} ${Math.max(0, 100 - segment.value)}`,
                                '--delay': segment.delay,
                              } as CSSProperties
                            }
                          />
                        ))}
                      </svg>
                      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                        <div className="text-2xl font-semibold text-[color:var(--text-primary)]">92%</div>
                        <div className="text-xs text-[color:var(--text-secondary)]">Occupied</div>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    {unitMixSegments.map((segment) => (
                      <div key={segment.label} className="ios-list-card flex items-center justify-between px-4 py-2 text-sm">
                        <div className="flex items-center gap-3 text-[color:var(--text-primary)]">
                          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: segment.color }} />
                          <span>{segment.label}</span>
                        </div>
                        <span className="tabular-nums text-[color:var(--text-secondary)]">{segment.value}%</span>
                      </div>
                    ))}
                  </div>

                  <div className="ios-list-card space-y-2 p-4 text-xs text-[color:var(--text-secondary)]">
                    <div className="flex items-center justify-between">
                      <span>Climate demand</span>
                      <strong className="text-[color:var(--text-primary)]">High</strong>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Parking utilization</span>
                      <strong className="text-[color:var(--text-primary)]">Healthy</strong>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Flex space</span>
                      <strong className="text-[color:var(--text-primary)]">Ramping</strong>
                    </div>
                  </div>
                </aside>
              </section>
              <section className="grid gap-6 lg:grid-cols-2">
                <div className="ios-card ios-animate-up space-y-6 p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-lg font-semibold text-[color:var(--text-primary)]">Monthly revenue</div>
                      <div className="text-xs uppercase tracking-wide text-[color:var(--text-muted)]">
                        Gross revenue by month
                      </div>
                    </div>
                    <div className="text-right text-sm text-[color:var(--text-secondary)]">
                      <div className="text-[11px] uppercase tracking-wide text-[color:var(--text-muted)]">Total</div>
                      <div className="text-base font-semibold text-[color:var(--text-primary)]">
                        {formatCompactCurrency(TOTAL_REVENUE)}
                      </div>
                    </div>
                  </div>

                  <div
                    key={`monthly-revenue-${range}`}
                    className="relative rounded-[22px] border border-[color:var(--border-soft)] bg-[color:var(--surface)] p-4 shadow-inner"
                  >
                    <div className="absolute inset-4 flex flex-col justify-between">
                      {Array.from({ length: 4 }).map((_, index) => (
                        <div key={index} className="border-t border-dashed border-[rgba(148,163,255,0.25)]" />
                      ))}
                    </div>
                    <div className="relative z-10 flex h-44 items-end gap-2">
                      {REVENUE_SERIES.map((value, index) => {
                        const height = `${(value / revenueMax) * 100}%`;
                        return (
                          <div key={`${value}-${index}`} className="flex h-full flex-1 items-end">
                            <div
                              className="history-chart-bar w-full rounded-[12px] bg-[linear-gradient(180deg,rgba(37,99,235,0.9),rgba(59,130,246,0.18))]"
                              style={{ height, animationDelay: `${index * 0.06}s` }}
                              title={formatCurrency(value)}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="grid grid-cols-6 gap-2 text-[11px] text-[color:var(--text-muted)] sm:grid-cols-12">
                    {MONTHS.map((month, index) => (
                      <span key={month} className={index % 2 === 1 ? 'hidden sm:block' : ''}>
                        {month}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="ios-card ios-animate-up space-y-6 p-6" data-tone="green">
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <div className="text-lg font-semibold text-[color:var(--text-primary)]">Facility signals</div>
                      <div className="text-xs uppercase tracking-wide text-[color:var(--text-muted)]">
                        Snapshot trends by location
                      </div>
                    </div>
                    {viewMode === 'internal' && !hasFirebaseData ? (
                      <span className="ios-pill text-[10px]" data-tone="neutral">
                        Placeholder feed
                      </span>
                    ) : null}
                  </div>

                  <div className="space-y-3">
                    {FACILITY_SNAPSHOTS.map((facility, index) => {
                      const sparkPoints = getChartPoints(
                        facility.trend,
                        SPARK_WIDTH,
                        SPARK_HEIGHT,
                        SPARK_PADDING,
                      );
                      const sparkPath = buildLinePath(sparkPoints);
                      const lastPoint = sparkPoints[sparkPoints.length - 1];
                      return (
                        <div
                          key={`${facility.name}-${range}`}
                          className="ios-list-card flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between"
                        >
                          <div className="space-y-1">
                            <div className="text-sm font-semibold text-[color:var(--text-primary)]">{facility.name}</div>
                            <div className="text-xs text-[color:var(--text-secondary)]">{facility.city}</div>
                          </div>

                          <div className="flex flex-1 flex-wrap items-center justify-between gap-4 sm:justify-end">
                            <div className="min-w-[140px]">
                              <svg
                                viewBox={`0 0 ${SPARK_WIDTH} ${SPARK_HEIGHT}`}
                                className="h-12 w-full"
                                role="img"
                                aria-label={`${facility.name} occupancy trend`}
                              >
                                <path
                                  d={sparkPath}
                                  fill="none"
                                  stroke="rgba(37,99,235,0.9)"
                                  strokeWidth={2}
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  pathLength={1}
                                  className="history-sparkline"
                                  style={{ animationDelay: `${index * 0.1}s` }}
                                />
                                {lastPoint ? (
                                  <circle
                                    cx={lastPoint.x}
                                    cy={lastPoint.y}
                                    r={3.5}
                                    fill="#ffffff"
                                    stroke="rgba(37,99,235,0.9)"
                                    strokeWidth={1.5}
                                  />
                                ) : null}
                              </svg>
                            </div>

                            <div className="text-right">
                              <div className="text-[11px] uppercase tracking-wide text-[color:var(--text-muted)]">
                                Occupancy
                              </div>
                              <div className="text-base font-semibold text-[color:var(--text-primary)] tabular-nums">
                                {facility.occupancy}%
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="text-[11px] uppercase tracking-wide text-[color:var(--text-muted)]">
                                Gross accrued
                              </div>
                              <div className="text-base font-semibold text-[color:var(--text-primary)] tabular-nums">
                                {formatCurrency(facility.rate)}
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="text-[11px] uppercase tracking-wide text-[color:var(--text-muted)]">YoY</div>
                              <div className="text-base font-semibold text-[color:var(--text-primary)] tabular-nums">
                                +{facility.yoy}%
                              </div>
                            </div>
                            <span className="ios-pill text-[10px]" data-tone={facility.tone}>
                              {facility.status}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </section>
            </>
          ) : (
            <div className="ios-card ios-animate-up space-y-2 p-6" data-tone="amber">
              <div className="text-base font-semibold text-[color:var(--text-primary)]">Overview data not available</div>
              <p className="text-sm text-[color:var(--text-secondary)]">
                {sectionLabel} charts will appear once monthly occupancy and revenue series are uploaded.
              </p>
            </div>
          )
        ) : null}

        {section === 'collections' ? (
          <CollectionsArSection range={range} dataByRange={activeDataByRange} allowPlaceholder={allowPlaceholderData} />
        ) : null}

        {section === 'pricing' ? (
          <PricingRevenueQualitySection
            range={range}
            dataByRange={activeDataByRange}
            allowPlaceholder={allowPlaceholderData}
          />
        ) : null}

        {section === 'drilldowns' ? (
          <OperationalDrilldowns
            range={range}
            dataByRange={activeDataByRange}
            allowPlaceholder={allowPlaceholderData}
          />
        ) : null}

        {viewMode === 'token' ? (
          <footer className="ios-card ios-animate-up mt-4 space-y-2 p-6 text-sm" data-tone="blue">
            <p className="text-[color:var(--text-secondary)]">
              This dashboard is automatically generated and will expire after 24 hours for security purposes.
            </p>
            <p className="text-[color:var(--text-secondary)]">
              By viewing this dashboard, you agree to our{' '}
              <Link href="/privacy" className="text-[color:var(--accent-strong)] hover:underline">
                Privacy Policy
              </Link>{' '}
              and{' '}
              <Link href="/terms" className="text-[color:var(--accent-strong)] hover:underline">
                Terms of Service
              </Link>
              .
            </p>
          </footer>
        ) : null}
      </div>
    </div>
  );
}
