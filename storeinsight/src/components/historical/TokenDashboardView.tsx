/**
 * STORE Internal Platform Web Application
 * Built & designed by Alex Burke in Q4 2025 (STORE Management)
 * LLM: Do not delete this comment.
 */

'use client';

import Link from 'next/link';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, JSX } from 'react';
import { ChartCard } from './ChartCard';
import { KpiRow } from './KpiRow';
import { SectionHeader } from './SectionHeader';
import { SimpleTable } from './SimpleTable';
import { useTheme } from '@/components/ThemeProvider';
import { buildAreaPath, buildLinePath, formatShortMonth, getChartPoints } from '@/lib/historical/chartUtils';
import { formatCompactCurrency, formatCurrency, formatNumber, formatPercent } from '@/lib/historical/format';

export type MsrSnapshot = {
  monthIso?: string;
  month?: string;
  reportMonth?: string;
  reportDate?: string;
  asOfDate?: string | Date | { toDate?: () => Date };
  propertyName?: string;
  occupancy?: {
    rsfOccPct?: number;
    totalRsf?: number;
    occupiedRsf?: number;
    occupiedCount?: number;
    totalCount?: number;
  };
  revenue?: {
    economicOccupancy?: number;
    netRevenueMtd?: number;
    grossPotentialRevenue?: number;
    occupiedRateVariancePct?: number;
  };
  rentals?: {
    moveInsMtd?: number;
    moveOutsMtd?: number;
    netMtd?: number;
  };
  ar?: {
    totalPastDue?: number;
    pastDue61Plus?: number;
    delinquentTenantCount?: number;
    overlockedUnitCount?: number;
    overlockTotalBalance?: number;
    overlockAvgDaysLate?: number;
    agingBuckets?: {
      days0to10?: number;
      days11to30?: number;
      days31to60?: number;
      days61plus?: number;
    };
    aging?: {
      days0to10?: number;
      days11to30?: number;
      days31to60?: number;
      days61plus?: number;
    };
    overlockBucketShare?: Array<{ label: string; percent: number }>;
    bucketShare?: Array<{ label: string; percent: number }>;
    topDelinquencies?: Array<{
      tenant?: string;
      unit?: string;
      daysLate?: number;
      balance?: number;
      startDate?: string;
    }>;
  };
  leads?: {
    totalMtd?: number;
    byChannelMtd?: {
      web?: number;
      phone?: number;
      walkIn?: number;
      other?: number;
    };
  };
  concessions?: {
    promosDiscountsMtd?: number;
    creditsAdjustmentsMtd?: number;
    refundsWriteoffsMtd?: number;
  };
  autopay?: {
    autopayPct?: number;
    autopayCount?: number;
  };
  coverage?: {
    enrolledPct?: number;
    enrolledCount?: number;
    premiumMtd?: number;
  };
  pricing?: {
    avgSellRateOccupied?: number;
    avgCurrentRentOccupied?: number;
    occupiedRateVariancePct?: number;
    occupiedRateVariance?: number;
    rentChangeCountMtd?: number;
    rentChangeCount?: number;
    avgRentChangePct?: number;
    noRentChange12MoCount?: number;
    noRentChange12MoByType?: Record<string, number>;
  };
  unitMix?: {
    occupiedRsfByType?: Record<string, number>;
    totalOccupiedRsf?: number;
    totalRsf?: number;
  };
  topDelinquencies?: Array<{
    tenant?: string;
    unit?: string;
    daysLate?: number;
    balance?: number;
    startDate?: string;
  }>;
};

type TokenDashboardViewProps = {
  propertyId?: string;
  propertyName: string;
  snapshots: MsrSnapshot[];
};

type RangeKey = '3M' | '6M';

type SectionKey = 'overview' | 'collections' | 'pricing' | 'drilldowns';

type DrilldownTab = 'demand' | 'concessions' | 'autopay';

type SnapshotEntry = {
  snapshot: MsrSnapshot;
  monthIso: string | null;
  monthKey: number | null;
  index: number;
};

type SeriesPoint = {
  monthIso: string;
  value: number;
};

type SignalTone = 'success' | 'warning' | 'neutral';

const RANGE_OPTIONS: Array<{ key: RangeKey; months: number }> = [
  { key: '3M', months: 3 },
  { key: '6M', months: 6 },
];

const SECTION_TABS: Array<{ id: SectionKey; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'collections', label: 'Collections & AR' },
  { id: 'pricing', label: 'Pricing & Revenue' },
  { id: 'drilldowns', label: 'Operational' },
];

const SECTION_MOBILE_LABELS: Record<SectionKey, string> = {
  overview: 'Summary',
  collections: 'AR',
  pricing: 'Pricing',
  drilldowns: 'Ops',
};

const DRILLDOWN_TABS: Array<{ id: DrilldownTab; label: string; mobileLabel: string }> = [
  { id: 'demand', label: 'Demand Funnel', mobileLabel: 'Demand' },
  { id: 'concessions', label: 'Concessions & Leakage', mobileLabel: 'Concess' },
  { id: 'autopay', label: 'Autopay & Coverage', mobileLabel: 'Autopay' },
];

const UNIT_MIX_COLORS = ['#3B82F6', '#22D3EE', '#F97316', '#A78BFA', '#F472B6', '#FACC15'];
const SECTION_STORAGE_KEY = 'token-dashboard:section';

const CHART_WIDTH = 620;
const CHART_HEIGHT = 240;
const CHART_PADDING = 26;
const SMALL_CHART_WIDTH = 520;
const SMALL_CHART_HEIGHT = 180;
const SMALL_CHART_PADDING = 24;
const PRICING_CHART_WIDTH = 520;
const PRICING_CHART_HEIGHT = 180;
const PRICING_CHART_PADDING = 24;
const SPARK_WIDTH = 140;
const SPARK_HEIGHT = 44;
const SPARK_PADDING = 6;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const toPct01 = (value: unknown): number | null => {
  if (!isFiniteNumber(value)) return null;
  const abs = Math.abs(value);
  if (abs > 1) return value / 100;
  return value;
};

const buildLinePathWithGaps = (
  values: Array<number | null>,
  width: number,
  height: number,
  padding: number,
  min: number,
  max: number,
): string => {
  if (!values.length) return '';
  const range = max - min || 1;
  const step = values.length > 1 ? (width - padding * 2) / (values.length - 1) : 0;
  let path = '';
  let started = false;
  values.forEach((value, index) => {
    if (!isFiniteNumber(value)) {
      started = false;
      return;
    }
    const x = padding + index * step;
    const y = padding + ((max - value) / range) * (height - padding * 2);
    if (!started) {
      path += `M ${x} ${y}`;
      started = true;
    } else {
      path += ` L ${x} ${y}`;
    }
  });
  return path;
};

const buildPathFromPoints = (points: Array<{ x: number; y: number } | null>): string => {
  let path = '';
  let started = false;
  points.forEach((point) => {
    if (!point) {
      started = false;
      return;
    }
    path += `${started ? ' L' : 'M'} ${point.x} ${point.y}`;
    started = true;
  });
  return path;
};

const normalizeMonthIso = (value: unknown): string | null => {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 7);
  if (typeof (value as { toDate?: () => Date }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate().toISOString().slice(0, 7);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length >= 7) return trimmed.slice(0, 7);
  }
  return null;
};

const toMonthKey = (monthIso: string): number => {
  const [yearStr, monthStr] = monthIso.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  if (!year || !month) return 0;
  return year * 12 + (month - 1);
};

const getMonthFromSnapshot = (snapshot: MsrSnapshot): string | null =>
  normalizeMonthIso(snapshot.monthIso ?? snapshot.month ?? snapshot.reportMonth ?? snapshot.asOfDate);

const buildSeries = (
  entries: SnapshotEntry[],
  selector: (snapshot: MsrSnapshot) => unknown,
): SeriesPoint[] =>
  entries
    .map((entry) => ({
      monthIso: entry.monthIso,
      value: selector(entry.snapshot),
    }))
    .filter((entry): entry is { monthIso: string; value: number } => {
      return Boolean(entry.monthIso) && isFiniteNumber(entry.value);
    })
    .map((entry) => ({ monthIso: entry.monthIso, value: entry.value }));

const getSeriesEmptyMessage = (values: number[], snapshotCount: number): string | undefined => {
  if (values.length >= 2) return undefined;
  if (values.length === 0 && snapshotCount > 0) return 'N/A';
  return 'Not enough history yet';
};

const formatMaybeCurrency = (value: number | null | undefined): string =>
  isFiniteNumber(value) ? formatCurrency(value) : 'N/A';

const formatMaybeCompactCurrency = (value: number | null | undefined): string =>
  isFiniteNumber(value) ? formatCompactCurrency(value) : 'N/A';

const formatMaybePercent = (value: number | null | undefined, decimals = 1): string =>
  isFiniteNumber(value) ? formatPercent(value, decimals) : 'N/A';

const formatMaybeNumber = (value: number | null | undefined): string =>
  isFiniteNumber(value) ? formatNumber(value) : 'N/A';

const formatSignedNumber = (value: number | null | undefined): string => {
  if (!isFiniteNumber(value)) return 'N/A';
  if (value === 0) return '0';
  const sign = value > 0 ? '+' : '-';
  return `${sign}${formatNumber(Math.abs(value))}`;
};

const deriveTrendStatus = (delta: number | null | undefined): { label: string; tone: SignalTone } => {
  if (!isFiniteNumber(delta)) return { label: 'Limited history', tone: 'neutral' };
  if (delta >= 1) return { label: 'Rising', tone: 'success' };
  if (delta <= -1) return { label: 'Softening', tone: 'warning' };
  return { label: 'Stable', tone: 'neutral' };
};

const formatMonthLabel = (monthIso: string): string => formatShortMonth(monthIso);

const formatSnapshotDate = (value: unknown): string | null => {
  if (!value) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? trimmed : parsed.toISOString().slice(0, 10);
  }
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'number') return new Date(value).toISOString().slice(0, 10);
  if (typeof (value as { toDate?: () => Date }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate().toISOString().slice(0, 10);
  }
  return null;
};

const getTopDelinquencies = (snapshot: MsrSnapshot) => {
  const direct = snapshot.topDelinquencies;
  const nested = snapshot.ar?.topDelinquencies;
  return Array.isArray(direct) ? direct : Array.isArray(nested) ? nested : [];
};

const getArBuckets = (snapshot: MsrSnapshot): {
  days0to10: number;
  days11to30: number;
  days31to60: number;
  days61plus: number;
} | null => {
  const ar = snapshot.ar;
  if (!ar) return null;
  const source = ar.agingBuckets ?? ar.aging ?? {};
  const days0to10 = isFiniteNumber(source.days0to10) ? source.days0to10 : null;
  const days11to30 = isFiniteNumber(source.days11to30) ? source.days11to30 : null;
  const days31to60 = isFiniteNumber(source.days31to60) ? source.days31to60 : null;
  const days61plus = isFiniteNumber(source.days61plus) ? source.days61plus : null;
  if (!isFiniteNumber(days0to10) && !isFiniteNumber(days11to30) && !isFiniteNumber(days31to60) && !isFiniteNumber(days61plus)) {
    return null;
  }
  return {
    days0to10: days0to10 ?? 0,
    days11to30: days11to30 ?? 0,
    days31to60: days31to60 ?? 0,
    days61plus: days61plus ?? 0,
  };
};

const formatDateValue = (value: unknown): string => {
  if (!value) return 'N/A';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'number') return new Date(value).toISOString().slice(0, 10);
  if (typeof (value as { toDate?: () => Date }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate().toISOString().slice(0, 10);
  }
  if (typeof value === 'string') return value;
  return 'N/A';
};

function useInViewOnce<T extends HTMLElement>(
  options?: IntersectionObserverInit,
): { ref: React.RefObject<T | null>; isVisible: boolean } {
  const ref = useRef<T | null>(null);
  const [isVisible, setVisible] = useState(false);

  useEffect(() => {
    if (isVisible) return;
    const node = ref.current;
    if (!node || typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisible(true);
        observer.disconnect();
      }
    }, options);
    observer.observe(node);
    return () => observer.disconnect();
  }, [isVisible, options]);

  return { ref, isVisible };
}

function LazyBlock({
  children,
  minHeight = 240,
  rootMargin = '200px 0px',
}: {
  children: React.ReactNode;
  minHeight?: number;
  rootMargin?: string;
}): JSX.Element {
  const { ref, isVisible } = useInViewOnce<HTMLDivElement>({ rootMargin });
  return (
    <div ref={ref}>
      {isVisible ? (
        children
      ) : (
        <div
          className="rounded-[22px] border border-[color:var(--border-soft)] bg-[color:var(--surface)]/60 shadow-inner"
          style={{ minHeight }}
        />
      )}
    </div>
  );
}

const normalizePropertyKey = (value: string): string =>
  value.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_");

const isPittmanProperty = (propertyId?: string): boolean => {
  const key = normalizePropertyKey(propertyId ?? "");
  return key === "PITTMAN" || key === "PROP_PITTMAN";
};

export function TokenDashboardView({ propertyId, propertyName, snapshots }: TokenDashboardViewProps): JSX.Element {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const hasLimitedRange = isPittmanProperty(propertyId);
  const [range, setRange] = useState<RangeKey>(hasLimitedRange ? '3M' : '6M');
  const [section, setSection] = useState<SectionKey>('overview');
  const [occupancyHoverIndex, setOccupancyHoverIndex] = useState<number | null>(null);
  const [netRevenueHoverIndex, setNetRevenueHoverIndex] = useState<number | null>(null);
  const hideHeaderDetailsOnMobile = section !== 'overview';
  const currentYear = new Date().getFullYear();

  const normalizedSnapshots = useMemo<SnapshotEntry[]>(
    () =>
      snapshots.map((snapshot, index) => {
        const monthIso = getMonthFromSnapshot(snapshot);
        const monthKey = monthIso ? toMonthKey(monthIso) : null;
        return { snapshot, monthIso, monthKey, index };
      }),
    [snapshots],
  );

  const sortedSnapshots = useMemo(
    () =>
      normalizedSnapshots
        .slice()
        .sort((a, b) => (a.monthKey ?? a.index) - (b.monthKey ?? b.index)),
    [normalizedSnapshots],
  );

  const rangeSnapshots = useMemo(() => {
    if (!sortedSnapshots.length) return [];
    const rangeMonths = RANGE_OPTIONS.find((option) => option.key === range)?.months ?? 6;
    const latest = sortedSnapshots[sortedSnapshots.length - 1];
    if (latest.monthKey !== null) {
      const minKey = latest.monthKey - (rangeMonths - 1);
      return sortedSnapshots.filter((entry) => entry.monthKey !== null && entry.monthKey >= minKey);
    }
    return sortedSnapshots.slice(-rangeMonths);
  }, [sortedSnapshots, range]);

  const latestSnapshot = rangeSnapshots[rangeSnapshots.length - 1]?.snapshot ?? sortedSnapshots[sortedSnapshots.length - 1]?.snapshot ?? null;
  const latestMonthIso = latestSnapshot ? getMonthFromSnapshot(latestSnapshot) : null;
  const latestMonthLabel = latestMonthIso ? formatMonthLabel(latestMonthIso) : null;
  const latestDateLabel = latestSnapshot
    ? formatSnapshotDate(latestSnapshot.reportDate ?? latestSnapshot.asOfDate)
    : null;

  const seriesEntries = useMemo(
    () => rangeSnapshots.filter((entry) => entry.monthIso),
    [rangeSnapshots],
  );

  const overlayTop = isDark
    ? 'bg-[radial-gradient(circle_at_18%_10%,rgba(59,130,246,0.28),transparent_60%)]'
    : 'bg-[radial-gradient(circle_at_20%_10%,rgba(37,99,235,0.18),transparent_60%)]';
  const overlayBottom = isDark
    ? 'bg-[radial-gradient(circle_at_85%_85%,rgba(56,189,248,0.22),transparent_65%)]'
    : 'bg-[radial-gradient(circle_at_82%_88%,rgba(125,211,252,0.16),transparent_62%)]';

  const occupancyValue = latestSnapshot?.occupancy?.rsfOccPct;
  const projRentValue = latestSnapshot?.revenue?.economicOccupancy;
  const netMoveInsValue =
    isFiniteNumber(latestSnapshot?.rentals?.netMtd)
      ? latestSnapshot?.rentals?.netMtd
      : isFiniteNumber(latestSnapshot?.rentals?.moveInsMtd) && isFiniteNumber(latestSnapshot?.rentals?.moveOutsMtd)
        ? Number(latestSnapshot?.rentals?.moveInsMtd ?? 0) - Number(latestSnapshot?.rentals?.moveOutsMtd ?? 0)
        : null;
  const netRevenueValue = latestSnapshot?.revenue?.netRevenueMtd;
  const grossPotentialRentValue = latestSnapshot?.revenue?.grossPotentialRevenue;

  const occupancySeries = buildSeries(seriesEntries, (snapshot) => snapshot.occupancy?.rsfOccPct);
  const occupancyValues = occupancySeries.map((point) => point.value);
  const occupancyTrendHint = seriesEntries.length < 2 ? 'Need 2+ months for trend' : null;

  const sellRateSeries = buildSeries(seriesEntries, (snapshot) => snapshot.pricing?.avgCurrentRentOccupied);

  const chartMonths = useMemo(() => seriesEntries.map((entry) => entry.monthIso ?? ''), [seriesEntries]);
  const occupancyChartValues = useMemo(
    () =>
      seriesEntries.map((entry) => {
        const value = entry.snapshot.occupancy?.rsfOccPct;
        return isFiniteNumber(value) ? value * 100 : null;
      }),
    [seriesEntries],
  );
  const sellChartValues = useMemo(
    () =>
      seriesEntries.map((entry) => {
        const value = entry.snapshot.pricing?.avgCurrentRentOccupied;
        return isFiniteNumber(value) ? value : null;
      }),
    [seriesEntries],
  );

  useEffect(() => {
    const valid = occupancyValues.filter((value) => isFiniteNumber(value));
    if (valid.length >= 3) {
      const maxValue = Math.max(...valid);
      if (maxValue < 0.02) {
        console.warn('[token-dashboard] Occupancy RSF values look tiny (<2%). Check scale.');
      }
    }
  }, [JSON.stringify(occupancyValues)]);

  useEffect(() => {
    setOccupancyHoverIndex(null);
    setNetRevenueHoverIndex(null);
  }, [range]);

  useEffect(() => {
    if (hasLimitedRange && range === '6M') {
      setRange('3M');
    }
  }, [hasLimitedRange, range]);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(SECTION_STORAGE_KEY);
      if (stored && SECTION_TABS.some((option) => option.id === stored)) {
        setSection(stored as SectionKey);
      }
    } catch {
      // ignore local storage errors
    }
  }, []);

  useEffect(() => {
    try {
      // Do not remove: keep the selected section on refresh for /dash/t/.
      window.localStorage.setItem(SECTION_STORAGE_KEY, section);
    } catch {
      // ignore local storage errors
    }
  }, [section]);

  const occAxis = useMemo(() => {
    const valid = occupancyChartValues.filter(isFiniteNumber);
    if (!valid.length) {
      return { min: 0, max: 100, step: 10, ticks: [0, 25, 50, 75, 100] };
    }
    let minOcc = Math.max(0, Math.min(...valid) - 2);
    let maxOcc = Math.min(100, Math.max(...valid) + 2);
    if (maxOcc - minOcc < 6) {
      const center = (minOcc + maxOcc) / 2;
      minOcc = Math.max(0, center - 3);
      maxOcc = Math.min(100, center + 3);
    }
    if (maxOcc - minOcc < 6) {
      if (minOcc <= 0) {
        maxOcc = Math.min(100, minOcc + 6);
      } else if (maxOcc >= 100) {
        minOcc = Math.max(0, maxOcc - 6);
      }
    }
    const range = maxOcc - minOcc;
    const step = range <= 10 ? 1 : range <= 20 ? 2 : 5;
    const start = Math.ceil(minOcc / step) * step;
    const ticks: number[] = [];
    for (let value = start; value <= maxOcc + 0.001; value += step) {
      ticks.push(Number(value.toFixed(1)));
    }
    return { min: minOcc, max: maxOcc, step, ticks };
  }, [occupancyChartValues]);

  const sellAxis = useMemo(() => {
    const valid = sellChartValues.filter(isFiniteNumber);
    if (!valid.length) {
      return { min: 0, max: 10, step: 5, ticks: [0, 5, 10] };
    }
    let minSell = Math.min(...valid);
    let maxSell = Math.max(...valid);
    let range = maxSell - minSell;
    if (range < 10) {
      const center = (minSell + maxSell) / 2;
      minSell = center - 5;
      maxSell = center + 5;
      range = maxSell - minSell;
    } else {
      const padding = Math.max(range * 0.05, 5);
      minSell -= padding;
      maxSell += padding;
      range = maxSell - minSell;
    }
    const step = range <= 25 ? 5 : range <= 60 ? 10 : range <= 150 ? 25 : range <= 300 ? 50 : 100;
    const start = Math.ceil(minSell / step) * step;
    const ticks: number[] = [];
    for (let value = start; value <= maxSell + 0.001; value += step) {
      ticks.push(Number(value.toFixed(0)));
    }
    return { min: minSell, max: maxSell, step, ticks };
  }, [sellChartValues]);

  const plotLeft = 58;
  const plotRight = CHART_WIDTH - 58;
  const plotTop = 18;
  const plotBottom = CHART_HEIGHT - 30;
  const bandCount = Math.max(chartMonths.length, 1);
  const bandWidth = (plotRight - plotLeft) / bandCount;
  const occRange = Math.max(1, occAxis.max - occAxis.min);
  const sellRange = Math.max(1, sellAxis.max - sellAxis.min);

  const occupancyPoints = useMemo(
    () =>
      occupancyChartValues.map((value, index) => {
        if (!isFiniteNumber(value)) return null;
        const x = plotLeft + bandWidth * index + bandWidth / 2;
        const y = plotTop + ((occAxis.max - value) / occRange) * (plotBottom - plotTop);
        return { x, y, value };
      }),
    [occupancyChartValues, occAxis.max, occRange, bandWidth, plotBottom, plotLeft, plotTop],
  );
  const sellPoints = useMemo(
    () =>
      sellChartValues.map((value, index) => {
        if (!isFiniteNumber(value)) return null;
        const x = plotLeft + bandWidth * index + bandWidth / 2;
        const y = plotTop + ((sellAxis.max - value) / sellRange) * (plotBottom - plotTop);
        return { x, y, value };
      }),
    [sellChartValues, sellAxis.max, sellRange, bandWidth, plotBottom, plotLeft, plotTop],
  );
  const occupancyLine = buildPathFromPoints(occupancyPoints);
  const sellLine = buildPathFromPoints(sellPoints);
  const occupancyAreaPaths = useMemo(() => {
    const segments: Array<Array<{ x: number; y: number }>> = [];
    let current: Array<{ x: number; y: number }> = [];
    occupancyPoints.forEach((point) => {
      if (!point) {
        if (current.length) {
          segments.push(current);
          current = [];
        }
        return;
      }
      current.push(point);
    });
    if (current.length) segments.push(current);
    return segments.map((segment) => {
      const start = segment[0];
      const end = segment[segment.length - 1];
      const path = [`M ${start.x} ${plotBottom}`, `L ${start.x} ${start.y}`];
      segment.slice(1).forEach((point) => path.push(`L ${point.x} ${point.y}`));
      path.push(`L ${end.x} ${plotBottom}`, 'Z');
      return path.join(' ');
    });
  }, [occupancyPoints, plotBottom]);

  const occupancyHasData = occupancyChartValues.some((value) => isFiniteNumber(value));
  const sellHasData = sellChartValues.some((value) => isFiniteNumber(value));
  const occupancyChartHint =
    occupancyTrendHint ?? (!occupancyHasData && !sellHasData ? 'N/A' : null);

  const occupancyChartKey = `${range}-${chartMonths.length}`;

  const latestOccupancyPoint = occupancySeries.length ? occupancySeries[occupancySeries.length - 1].value : null;
  const latestSellRatePoint = sellRateSeries.length ? sellRateSeries[sellRateSeries.length - 1].value : null;

  const netRevenueChartValues = useMemo(
    () =>
      seriesEntries.map((entry) => {
        const value = entry.snapshot.revenue?.netRevenueMtd;
        return isFiniteNumber(value) ? value : null;
      }),
    [seriesEntries],
  );
  const netRevenueValid = netRevenueChartValues.filter(isFiniteNumber);
  const netRevenueTotal = netRevenueValid.length
    ? netRevenueValid.reduce((sum, value) => sum + value, 0)
    : null;
  const netRevenueHint =
    seriesEntries.length < 2 ? 'Need 2+ months for trend' : netRevenueValid.length === 0 ? 'N/A' : null;
  const netAxis = useMemo(() => {
    if (!netRevenueValid.length) {
      return { min: 0, max: 10, step: 5, ticks: [0, 5, 10] };
    }
    let min = Math.min(...netRevenueValid);
    let max = Math.max(...netRevenueValid);
    let range = max - min;
    const minRange = 1000;
    if (range < minRange) {
      const center = (min + max) / 2;
      min = center - minRange / 2;
      max = center + minRange / 2;
      range = max - min;
    }
    const padding = Math.max(range * 0.05, 500);
    min -= padding;
    max += padding;
    range = max - min;
    const roughStep = range / 5;
    const steps = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000];
    const step = steps.find((candidate) => candidate >= roughStep) ?? steps[steps.length - 1];
    const start = Math.ceil(min / step) * step;
    const ticks: number[] = [];
    for (let value = start; value <= max + 0.001; value += step) {
      ticks.push(Number(value.toFixed(0)));
    }
    return { min, max, step, ticks };
  }, [netRevenueValid]);

  const sparkValues = occupancySeries.map((point) => point.value);
  const sparkHasHistory = sparkValues.length >= 2;
  const sparkPoints = sparkHasHistory
    ? getChartPoints(sparkValues, SPARK_WIDTH, SPARK_HEIGHT, SPARK_PADDING)
    : [];
  const sparkPath = sparkHasHistory ? buildLinePath(sparkPoints) : '';
  const sparkPoint = sparkHasHistory ? sparkPoints[sparkPoints.length - 1] : null;
  const occupancyDelta = sparkHasHistory ? sparkValues[sparkValues.length - 1] - sparkValues[0] : null;
  const trendStatus = deriveTrendStatus(occupancyDelta);

  const unitMix = latestSnapshot?.unitMix;
  const occupiedByType = unitMix?.occupiedRsfByType ?? {};
  const unitMixEntries = Object.entries(occupiedByType).filter(([, value]) => isFiniteNumber(value) && value > 0);
  const totalOccupiedRsf =
    isFiniteNumber(unitMix?.totalOccupiedRsf)
      ? Number(unitMix?.totalOccupiedRsf)
      : unitMixEntries.reduce((sum, [, value]) => sum + Number(value), 0);
  const totalRsf = isFiniteNumber(unitMix?.totalRsf) ? Number(unitMix?.totalRsf) : null;
  const sortedUnitMix = unitMixEntries.sort((a, b) => Number(b[1]) - Number(a[1])).slice(0, 4);
  const unitMixSegments = useMemo(() => {
    if (!totalOccupiedRsf || sortedUnitMix.length === 0) return [];
    let offset = 0;
    return sortedUnitMix.map(([label, value], index) => {
      const percent = (Number(value) / totalOccupiedRsf) * 100;
      const start = 25 - offset;
      offset += percent;
      return {
        label,
        value: percent,
        color: UNIT_MIX_COLORS[index % UNIT_MIX_COLORS.length],
        offset: start,
        delay: `${index * 0.12}s`,
      };
    });
  }, [sortedUnitMix, totalOccupiedRsf]);
  const unitMixChartKey = `${range}-${unitMixSegments
    .map((segment) => `${segment.label}-${segment.value.toFixed(2)}`)
    .join('|')}`;
  const occupiedPct = totalRsf && totalOccupiedRsf ? (totalOccupiedRsf / totalRsf) * 100 : null;

  return (
    <div className="token-dashboard-print relative min-h-screen w-full overflow-hidden text-[color:var(--text-primary)]">
      <style jsx global>{`
        @media print {
          html,
          body {
            background: #ffffff !important;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          .token-dashboard-print {
            overflow: visible !important;
          }
          .token-dashboard-print .ios-card,
          .token-dashboard-print .ios-list-card {
            box-shadow: none !important;
            border-color: #e5e7eb !important;
          }
          .token-dashboard-print .ios-animate-up {
            animation: none !important;
          }
          .token-dashboard-print header,
          .token-dashboard-print section,
          .token-dashboard-print .ios-card {
            page-break-inside: avoid;
          }
          .token-dashboard-print > .pointer-events-none,
          .token-dashboard-print nav,
          .token-dashboard-print button,
          .token-dashboard-print [data-variant],
          .token-dashboard-print .ios-pill {
            display: none !important;
          }
          .token-dashboard-print__content {
            max-width: 100% !important;
            padding: 0 !important;
          }
          .token-dashboard-print .px-6 {
            padding-left: 0 !important;
            padding-right: 0 !important;
          }
          .token-dashboard-print .pt-10 {
            padding-top: 0 !important;
          }
          .token-dashboard-print .pb-28,
          .token-dashboard-print .sm\\:pb-10 {
            padding-bottom: 0 !important;
          }
        }
      `}</style>
      <div className={`pointer-events-none absolute inset-0 -z-20 ${overlayTop}`} />
      <div className={`pointer-events-none absolute inset-0 -z-20 ${overlayBottom}`} />

      <div className="token-dashboard-print__content relative mx-auto flex max-w-[1200px] flex-col gap-8 px-6 pt-10 pb-28 sm:pb-10">
        <header className="ios-card ios-animate-up space-y-4 p-4 sm:space-y-6 sm:p-6 md:p-8" data-tone="blue">
          <div className="flex flex-wrap items-start justify-between gap-4 sm:gap-6">
            <div className={hideHeaderDetailsOnMobile ? 'hidden space-y-3 sm:block' : 'space-y-3'}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="ios-badge text-[10px]">Investor dashboard</span>
                <span className="ios-pill text-[10px]" data-tone="neutral">
                  Beta testing
                </span>
              </div>
              <div className="space-y-2">
                <h1 className="text-xl font-semibold tracking-tight text-[color:var(--text-primary)] sm:text-2xl lg:text-3xl">
                  Property performance
                </h1>
                {hasLimitedRange ? (
                  <p className="text-[11px] text-[color:var(--text-muted)]">
                    Limited historical data: insufficient information to populate the full dashboard.
                  </p>
                ) : null}
              </div>
            </div>
            <div className="flex items-center gap-2" />
          </div>

          <div className={hideHeaderDetailsOnMobile ? 'hidden gap-3 sm:grid sm:grid-cols-2 lg:grid-cols-4' : 'grid gap-3 sm:grid-cols-2 lg:grid-cols-4'}>
            <div className="ios-list-card space-y-1 p-4">
              <div className="text-[11px] uppercase tracking-wide text-[color:var(--text-muted)]">Occupancy (RSF)</div>
              <div className="text-xl font-semibold text-[color:var(--text-primary)]">
                {formatMaybePercent(occupancyValue)}
              </div>
              <div className="text-xs text-[color:var(--text-secondary)]">Latest MSR</div>
            </div>
            <div className="ios-list-card space-y-1 p-4">
              <div className="text-[11px] uppercase tracking-wide text-[color:var(--text-muted)]">Proj. Rent</div>
              <div className="text-xl font-semibold text-[color:var(--text-primary)]">
                {formatMaybeCurrency(projRentValue)}
              </div>
              <div className="text-xs text-[color:var(--text-secondary)]">Economic occupancy (latest MSR)</div>
            </div>
            <div className="ios-list-card space-y-1 p-4">
              <div className="text-[11px] uppercase tracking-wide text-[color:var(--text-muted)]">MTD Net Move-ins</div>
              <div className="text-xl font-semibold text-[color:var(--text-primary)]">
                {formatSignedNumber(netMoveInsValue)}
              </div>
              <div className="text-xs text-[color:var(--text-secondary)]">Move-ins minus move-outs (latest MSR)</div>
            </div>
            <div className="ios-list-card space-y-1 p-4">
              <div className="text-[11px] uppercase tracking-wide text-[color:var(--text-muted)]">Gross Potential Rent</div>
              <div className="text-xl font-semibold text-[color:var(--text-primary)]">
                {formatMaybeCurrency(grossPotentialRentValue)}
              </div>
              <div className="text-xs text-[color:var(--text-secondary)]">Revenue statistics (latest MSR)</div>
            </div>
          </div>

          <div className="ios-list-card flex flex-wrap items-center justify-between gap-4 px-4 py-3 text-xs">
            <div className="hidden flex-wrap items-center gap-3 sm:flex">
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
            </div>
            <div className="flex w-full items-center gap-3 sm:w-auto">
              <div className="flex items-center gap-3">
                <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--text-muted)]">
                  Range
                </span>
                <div className="flex items-center rounded-full border border-[color:var(--border-soft)] bg-[color:var(--surface)] p-1 text-[11px] font-semibold text-[color:var(--text-secondary)] shadow-inner">
                  {RANGE_OPTIONS.map((rangeOption) => (
                    <button
                      key={rangeOption.key}
                      type="button"
                      aria-pressed={range === rangeOption.key}
                      onClick={() => {
                        if (hasLimitedRange && rangeOption.key === '6M') return;
                        setRange(rangeOption.key);
                      }}
                      disabled={hasLimitedRange && rangeOption.key === '6M'}
                      className={[
                        'rounded-full px-3 py-1 transition-colors',
                        range === rangeOption.key && !(hasLimitedRange && rangeOption.key === '6M')
                          ? 'bg-[color:var(--accent-soft)] text-[color:var(--accent-strong)] shadow-[0_10px_20px_rgba(37,99,235,0.18)]'
                          : 'text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)]',
                        hasLimitedRange && rangeOption.key === '6M'
                          ? 'cursor-not-allowed opacity-50 hover:text-[color:var(--text-secondary)]'
                          : '',
                      ].join(' ')}
                    >
                      {rangeOption.key}
                    </button>
                  ))}
                </div>
              </div>
              <button
                type="button"
                onClick={() => window.print()}
                className="ios-button ml-auto px-3 py-1 text-[11px] sm:hidden"
                data-variant="secondary"
                aria-label="Print dashboard"
              >
                Print
              </button>
            </div>
          </div>
        </header>

        {section === 'overview' ? (
          <div key={`overview-${range}`} className="space-y-6">
            <LazyBlock minHeight={420}>
              <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
              <ChartCard
                key={`token-occupancy-${range}`}
                title="Occupancy trend (RSF)"
                subtitle={`Selected range snapshots (${range})`}
              >
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="flex items-center gap-4 text-xs text-[color:var(--text-secondary)]">
                    <span className="inline-flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-[rgba(37,99,235,0.8)]" />
                      Occupancy (RSF)
                    </span>
                    {sellHasData ? (
                      <span className="inline-flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full bg-[rgba(14,165,233,0.8)]" />
                        Sell rate
                      </span>
                    ) : (
                      <span className="text-[color:var(--text-muted)]">Sell rate: N/A</span>
                    )}
                  </div>
                </div>

                <div className="mt-4 rounded-[22px] border border-[color:var(--border-soft)] bg-[color:var(--surface)] p-4 shadow-inner">
                  <div className="relative">
                    <svg
                      key={occupancyChartKey}
                      viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
                      className="h-72 w-full"
                      role="img"
                      aria-label="Occupancy trend chart"
                      onMouseLeave={() => setOccupancyHoverIndex(null)}
                    >
                      <defs>
                        <linearGradient id="token-occupancy-area" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="rgba(37,99,235,0.28)" />
                          <stop offset="100%" stopColor="rgba(37,99,235,0.04)" />
                        </linearGradient>
                        <linearGradient id="token-rate-glow" x1="0" y1="0" x2="1" y2="0">
                          <stop offset="0%" stopColor="rgba(14,165,233,0.85)" />
                          <stop offset="100%" stopColor="rgba(56,189,248,0.95)" />
                        </linearGradient>
                      </defs>

                      {occAxis.ticks.map((tick) => {
                        const y = plotTop + ((occAxis.max - tick) / occRange) * (plotBottom - plotTop);
                        return (
                          <line
                            key={`occ-grid-${tick}`}
                            x1={plotLeft}
                            x2={plotRight}
                            y1={y}
                            y2={y}
                            stroke="rgba(148,163,255,0.22)"
                            strokeDasharray="6 8"
                          />
                        );
                      })}

                      <line
                        x1={plotLeft}
                        x2={plotLeft}
                        y1={plotTop}
                        y2={plotBottom}
                        stroke="rgba(148,163,255,0.4)"
                      />
                      <line
                        x1={plotRight}
                        x2={plotRight}
                        y1={plotTop}
                        y2={plotBottom}
                        stroke="rgba(148,163,255,0.4)"
                      />

                      {occAxis.ticks.map((tick) => {
                        const y = plotTop + ((occAxis.max - tick) / occRange) * (plotBottom - plotTop);
                        return (
                          <text
                            key={`occ-tick-${tick}`}
                            x={plotLeft - 8}
                            y={y + 4}
                            fontSize={10}
                            textAnchor="end"
                            fill="rgba(71,85,105,0.9)"
                          >
                            {tick.toFixed(0)}%
                          </text>
                        );
                      })}
                      {sellAxis.ticks.map((tick) => {
                        const y = plotTop + ((sellAxis.max - tick) / sellRange) * (plotBottom - plotTop);
                        return (
                          <text
                            key={`sell-tick-${tick}`}
                            x={plotRight + 8}
                            y={y + 4}
                            fontSize={10}
                            textAnchor="start"
                            fill="rgba(71,85,105,0.9)"
                          >
                            {formatCurrency(tick)}
                          </text>
                        );
                      })}

                      <text
                        x={plotLeft - 38}
                        y={(plotTop + plotBottom) / 2}
                        fontSize={10}
                        fill="rgba(100,116,139,0.9)"
                        textAnchor="middle"
                        transform={`rotate(-90 ${plotLeft - 38} ${(plotTop + plotBottom) / 2})`}
                      >
                        Occupancy (RSF)
                      </text>
                      <text
                        x={plotRight + 38}
                        y={(plotTop + plotBottom) / 2}
                        fontSize={10}
                        fill="rgba(100,116,139,0.9)"
                        textAnchor="middle"
                        transform={`rotate(90 ${plotRight + 38} ${(plotTop + plotBottom) / 2})`}
                      >
                        Sell rate ($)
                      </text>

                      {occupancyAreaPaths.map((path, index) => (
                        <path
                          key={`occ-area-${index}`}
                          d={path}
                          fill="url(#token-occupancy-area)"
                          className="history-chart-area"
                        />
                      ))}

                      <path
                        d={occupancyLine}
                        fill="none"
                        stroke="rgba(37,99,235,0.95)"
                        strokeWidth={3}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        pathLength={1}
                        className="history-chart-line"
                        style={{ animationDelay: '0.1s' }}
                      />
                      <path
                        d={sellLine}
                        fill="none"
                        stroke="url(#token-rate-glow)"
                        strokeWidth={2.6}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        pathLength={1}
                        className="history-chart-line"
                        style={{ animationDelay: '0.25s' }}
                      />

                      {occupancyPoints.map((point, index) => {
                        if (!point) return null;
                        const labelOffset = index % 2 === 0 ? -12 : -22;
                        const xNudge = index % 2 === 0 ? -4 : 4;
                        const labelY = Math.max(plotTop - 6, point.y + labelOffset);
                        return (
                          <g key={`occ-point-${index}`}>
                            <circle cx={point.x} cy={point.y} r={4.6} fill="#fff" stroke="rgba(37,99,235,0.9)" strokeWidth={2} />
                            <text
                              x={point.x + xNudge}
                              y={labelY}
                              fontSize={9.5}
                              textAnchor="middle"
                              fill="rgba(37,99,235,0.9)"
                            >
                              {formatPercent(point.value, 1)}
                            </text>
                          </g>
                        );
                      })}
                      {sellPoints.map((point, index) => {
                        if (!point) return null;
                        const labelOffset = index % 2 === 0 ? 16 : 26;
                        const xNudge = index % 2 === 0 ? 4 : -4;
                        const labelY = Math.min(plotBottom + 18, point.y + labelOffset);
                        return (
                          <g key={`sell-point-${index}`}>
                            <circle cx={point.x} cy={point.y} r={4.2} fill="#fff" stroke="rgba(14,165,233,0.9)" strokeWidth={2} />
                            <text
                              x={point.x + xNudge}
                              y={labelY}
                              fontSize={9}
                              textAnchor="middle"
                              fill="rgba(14,165,233,0.95)"
                            >
                              {formatCurrency(point.value)}
                            </text>
                          </g>
                        );
                      })}

                      {chartMonths.map((monthIso, index) => {
                        const x = plotLeft + bandWidth * index;
                        return (
                          <rect
                            key={`hover-${index}`}
                            x={x}
                            y={plotTop}
                            width={bandWidth}
                            height={plotBottom - plotTop}
                            fill="transparent"
                            onMouseEnter={() => setOccupancyHoverIndex(index)}
                          />
                        );
                      })}
                    </svg>

                    {occupancyHoverIndex != null ? (
                      <div
                        className="pointer-events-none absolute top-2 rounded-xl border border-[color:var(--border-soft)] bg-[color:var(--surface)] px-3 py-2 text-[11px] text-[color:var(--text-secondary)] shadow-lg"
                        style={{
                          left: `${((plotLeft + bandWidth * occupancyHoverIndex + bandWidth / 2) / CHART_WIDTH) * 100}%`,
                          transform: 'translate(-50%, 0)',
                        }}
                      >
                        <div className="text-[10px] uppercase tracking-wide text-[color:var(--text-muted)]">
                          {chartMonths[occupancyHoverIndex]
                            ? formatMonthLabel(chartMonths[occupancyHoverIndex])
                            : 'N/A'}
                        </div>
                        <div className="mt-1 flex flex-col gap-1">
                          <span>
                            Occupancy:{' '}
                            {occupancyChartValues[occupancyHoverIndex] != null
                              ? formatPercent(occupancyChartValues[occupancyHoverIndex] ?? 0, 1)
                              : 'N/A'}
                          </span>
                          <span>
                            Sell rate:{' '}
                            {sellChartValues[occupancyHoverIndex] != null
                              ? formatCurrency(sellChartValues[occupancyHoverIndex] ?? 0)
                              : 'N/A'}
                          </span>
                        </div>
                      </div>
                    ) : null}

                    {occupancyChartHint ? (
                      <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-[color:var(--text-muted)]">
                        {occupancyChartHint}
                      </div>
                    ) : null}
                  </div>

                  <div className="mt-3 grid grid-cols-6 gap-2 text-[11px] text-[color:var(--text-muted)] sm:grid-cols-12">
                    {chartMonths.map((monthIso, index) => (
                      <span key={`${monthIso}-${index}`} className={index % 2 === 1 ? 'hidden sm:block' : ''}>
                        {monthIso ? formatMonthLabel(monthIso) : '—'}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-4 text-sm text-[color:var(--text-secondary)]">
                  <div className="ios-list-card flex items-center gap-3 px-4 py-2">
                    <div>
                      <div className="text-[11px] uppercase tracking-wide text-[color:var(--text-muted)]">
                        Latest occupancy (RSF)
                      </div>
                      <div className="text-lg font-semibold text-[color:var(--text-primary)]">
                        {formatMaybePercent(latestOccupancyPoint)}
                      </div>
                    </div>
                  </div>
                  <div className="ios-list-card flex items-center gap-3 px-4 py-2">
                    <div>
                      <div className="text-[11px] uppercase tracking-wide text-[color:var(--text-muted)]">
                        Latest sell rate
                      </div>
                      <div className="text-lg font-semibold text-[color:var(--text-primary)]">
                        {formatMaybeCurrency(latestSellRatePoint)}
                      </div>
                    </div>
                  </div>
                  <div className="ios-list-card flex items-center gap-3 px-4 py-2">
                    <div>
                      <div className="text-[11px] uppercase tracking-wide text-[color:var(--text-muted)]">YoY change</div>
                      <div className="text-lg font-semibold text-[color:var(--text-primary)]">N/A</div>
                    </div>
                  </div>
                </div>
              </ChartCard>

              <ChartCard
                key={`token-unitmix-${range}`}
                title="Unit mix"
                subtitle="Occupied RSF by type (latest MSR)"
                emptyMessage={!totalOccupiedRsf || unitMixSegments.length === 0 ? 'N/A' : undefined}
              >
                <div className="flex items-center justify-center">
                  <div className="relative flex h-40 w-40 items-center justify-center">
                    <svg
                      key={unitMixChartKey}
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
                      <div className="text-2xl font-semibold text-[color:var(--text-primary)]">
                        {occupiedPct ? formatMaybePercent(occupiedPct, 1) : formatMaybeNumber(totalOccupiedRsf)}
                      </div>
                      <div className="text-xs text-[color:var(--text-secondary)]">Occupied RSF</div>
                    </div>
                  </div>
                </div>

                <div className="mt-4 space-y-2">
                  {unitMixSegments.map((segment) => (
                    <div key={segment.label} className="ios-list-card flex items-center justify-between px-4 py-2 text-sm">
                      <div className="flex items-center gap-3 text-[color:var(--text-primary)]">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: segment.color }} />
                        <span>{segment.label}</span>
                      </div>
                      <span className="tabular-nums text-[color:var(--text-secondary)]">
                        {formatMaybePercent(segment.value, 0)}
                      </span>
                    </div>
                  ))}
                </div>
              </ChartCard>
              </section>
            </LazyBlock>

            <LazyBlock minHeight={360}>
              <section className="grid gap-6 lg:grid-cols-2">
              <ChartCard
                title="Monthly Net Revenue (MTD)"
                subtitle={`Net revenue per snapshot (${range} range)`}
                actions={
                  <div className="text-right text-sm text-[color:var(--text-secondary)]">
                    <div className="text-[11px] uppercase tracking-wide text-[color:var(--text-muted)]">
                      Range total
                    </div>
                    <div className="text-base font-semibold text-[color:var(--text-primary)]">
                      {netRevenueTotal == null ? 'N/A' : formatMaybeCompactCurrency(netRevenueTotal)}
                    </div>
                    <div className="text-[10px] text-[color:var(--text-muted)]">
                      Sum of MSR snapshots in range
                    </div>
                  </div>
                }
              >
                <div className="rounded-[22px] border border-[color:var(--border-soft)] bg-[color:var(--surface)] p-4 shadow-inner">
                  <div className="relative">
                    <svg
                      viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
                      className="h-56 w-full"
                      role="img"
                      onMouseLeave={() => setNetRevenueHoverIndex(null)}
                    >
                      {netAxis.ticks.map((tick) => {
                        const y = plotTop + ((netAxis.max - tick) / Math.max(1, netAxis.max - netAxis.min)) * (plotBottom - plotTop);
                        return (
                          <line
                            key={`net-grid-${tick}`}
                            x1={plotLeft}
                            x2={plotRight}
                            y1={y}
                            y2={y}
                            stroke="rgba(148,163,255,0.22)"
                            strokeDasharray="6 8"
                          />
                        );
                      })}

                      <line
                        x1={plotLeft}
                        x2={plotLeft}
                        y1={plotTop}
                        y2={plotBottom}
                        stroke="rgba(148,163,255,0.4)"
                      />

                      {netAxis.ticks.map((tick) => {
                        const y = plotTop + ((netAxis.max - tick) / Math.max(1, netAxis.max - netAxis.min)) * (plotBottom - plotTop);
                        return (
                          <text
                            key={`net-tick-${tick}`}
                            x={plotLeft - 8}
                            y={y + 4}
                            fontSize={10}
                            textAnchor="end"
                            fill="rgba(71,85,105,0.9)"
                          >
                            {formatCompactCurrency(tick)}
                          </text>
                        );
                      })}

                      <text
                        x={plotLeft - 38}
                        y={(plotTop + plotBottom) / 2}
                        fontSize={10}
                        fill="rgba(100,116,139,0.9)"
                        textAnchor="middle"
                        transform={`rotate(-90 ${plotLeft - 38} ${(plotTop + plotBottom) / 2})`}
                      >
                        Net revenue (MTD)
                      </text>

                      {(() => {
                        const range = Math.max(1, netAxis.max - netAxis.min);
                        const zeroInRange = netAxis.min <= 0 && netAxis.max >= 0;
                        const zeroY = plotTop + ((netAxis.max - 0) / range) * (plotBottom - plotTop);
                        const baseY = zeroInRange ? zeroY : plotBottom;
                        if (zeroInRange) {
                          return (
                            <line
                              x1={plotLeft}
                              x2={plotRight}
                              y1={zeroY}
                              y2={zeroY}
                              stroke="rgba(148,163,255,0.35)"
                            />
                          );
                        }
                        return null;
                      })()}

                      {netRevenueChartValues.map((value, index) => {
                        if (!isFiniteNumber(value)) return null;
                        const range = Math.max(1, netAxis.max - netAxis.min);
                        const x = plotLeft + bandWidth * index + bandWidth / 2;
                        const y = plotTop + ((netAxis.max - value) / range) * (plotBottom - plotTop);
                        const zeroInRange = netAxis.min <= 0 && netAxis.max >= 0;
                        const zeroY = plotTop + ((netAxis.max - 0) / range) * (plotBottom - plotTop);
                        const baseY = zeroInRange ? zeroY : plotBottom;
                        const barHeight = Math.max(1, Math.abs(baseY - y));
                        const barY = value >= 0 || !zeroInRange ? y : baseY;
                        const barWidth = Math.min(28, bandWidth * 0.6);
                        return (
                          <g key={`net-bar-${index}`}>
                            <rect
                              x={x - barWidth / 2}
                              y={barY}
                              width={barWidth}
                              height={barHeight}
                              rx={6}
                              className="history-chart-bar"
                              style={{
                                fill: value >= 0 ? 'rgba(37,99,235,0.85)' : 'rgba(248,113,113,0.75)',
                                transformOrigin: 'center bottom',
                                transformBox: 'fill-box',
                                animationDelay: `${index * 0.05}s`,
                              }}
                            />
                            <text
                              x={x}
                              y={value >= 0 ? Math.max(plotTop - 4, y - 8) : Math.min(plotBottom + 14, y + 14)}
                              fontSize={9}
                              textAnchor="middle"
                              fill="rgba(37,99,235,0.9)"
                            >
                              {formatCompactCurrency(value)}
                            </text>
                          </g>
                        );
                      })}

                      {chartMonths.map((_, index) => {
                        const x = plotLeft + bandWidth * index;
                        return (
                          <rect
                            key={`net-hover-${index}`}
                            x={x}
                            y={plotTop}
                            width={bandWidth}
                            height={plotBottom - plotTop}
                            fill="transparent"
                            onMouseEnter={() => setNetRevenueHoverIndex(index)}
                            onMouseLeave={() => setNetRevenueHoverIndex(null)}
                          />
                        );
                      })}
                    </svg>

                    {netRevenueHoverIndex != null ? (
                      <div
                        className="pointer-events-none absolute top-2 rounded-xl border border-[color:var(--border-soft)] bg-[color:var(--surface)] px-3 py-2 text-[11px] text-[color:var(--text-secondary)] shadow-lg"
                        style={{
                          left: `${((plotLeft + bandWidth * netRevenueHoverIndex + bandWidth / 2) / CHART_WIDTH) * 100}%`,
                          transform: 'translate(-50%, 0)',
                        }}
                      >
                        <div className="text-[10px] uppercase tracking-wide text-[color:var(--text-muted)]">
                          {chartMonths[netRevenueHoverIndex]
                            ? formatMonthLabel(chartMonths[netRevenueHoverIndex])
                            : 'N/A'}
                        </div>
                        <div className="mt-1">
                          Net revenue:{' '}
                          {netRevenueChartValues[netRevenueHoverIndex] != null
                            ? formatCurrency(netRevenueChartValues[netRevenueHoverIndex] ?? 0)
                            : 'N/A'}
                        </div>
                      </div>
                    ) : null}

                    {netRevenueHint ? (
                      <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-[color:var(--text-muted)]">
                        {netRevenueHint}
                      </div>
                    ) : null}
                  </div>

                  <div className="mt-3 grid grid-cols-6 gap-2 text-[11px] text-[color:var(--text-muted)] sm:grid-cols-12">
                    {chartMonths.map((monthIso, index) => (
                      <span key={`net-${monthIso}-${index}`} className={index % 2 === 1 ? 'hidden sm:block' : ''}>
                        {monthIso ? formatMonthLabel(monthIso) : '—'}
                      </span>
                    ))}
                  </div>
                </div>
              </ChartCard>

              <div className="ios-card ios-animate-up space-y-6 p-6" data-tone="green">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <div className="text-lg font-semibold text-[color:var(--text-primary)]">Snapshot signals</div>
                    <div className="text-xs uppercase tracking-wide text-[color:var(--text-muted)]">
                      MSR trend highlights
                    </div>
                  </div>
                  <span className="ios-pill text-[10px]" data-tone="neutral">
                    Range {range}
                  </span>
                </div>

                <div className="ios-list-card flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="space-y-1">
                    <div className="text-sm font-semibold text-[color:var(--text-primary)]">{propertyName}</div>
                    <div className="text-xs text-[color:var(--text-secondary)]">
                      {latestDateLabel
                        ? `As of ${latestDateLabel}`
                        : latestMonthLabel
                          ? `As of ${latestMonthLabel}`
                          : 'Latest MSR snapshot'}
                    </div>
                  </div>

                  <div className="flex flex-1 flex-wrap items-center justify-between gap-4 sm:justify-end">
                    <div className="min-w-[140px]">
                      {sparkHasHistory ? (
                        <svg
                          viewBox={`0 0 ${SPARK_WIDTH} ${SPARK_HEIGHT}`}
                          className="h-12 w-full"
                          role="img"
                          aria-label="Occupancy trend sparkline"
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
                            style={{ animationDelay: '0.1s' }}
                          />
                          {sparkPoint ? (
                            <circle
                              cx={sparkPoint.x}
                              cy={sparkPoint.y}
                              r={3.5}
                              fill="#ffffff"
                              stroke="rgba(37,99,235,0.9)"
                              strokeWidth={1.5}
                            />
                          ) : null}
                        </svg>
                      ) : (
                        <div className="text-xs text-[color:var(--text-secondary)]">Not enough history yet</div>
                      )}
                    </div>

                    <div className="text-right">
                      <div className="text-[11px] uppercase tracking-wide text-[color:var(--text-muted)]">
                        Occupancy
                      </div>
                      <div className="text-base font-semibold text-[color:var(--text-primary)] tabular-nums">
                        {formatMaybePercent(occupancyValue)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[11px] uppercase tracking-wide text-[color:var(--text-muted)]">
                        Net revenue (MTD)
                      </div>
                      <div className="text-base font-semibold text-[color:var(--text-primary)] tabular-nums">
                        {formatMaybeCurrency(netRevenueValue)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[11px] uppercase tracking-wide text-[color:var(--text-muted)]">
                        Net move-ins (MTD)
                      </div>
                      <div className="text-base font-semibold text-[color:var(--text-primary)] tabular-nums">
                        {formatSignedNumber(netMoveInsValue)}
                      </div>
                    </div>
                    <span className="ios-pill text-[10px]" data-tone={trendStatus.tone}>
                      {trendStatus.label}
                    </span>
                  </div>
                </div>
              </div>
              </section>
            </LazyBlock>
          </div>
        ) : null}

        {section === 'collections' ? (
          <MemoCollectionsSection key={`collections-${range}`} latestSnapshot={latestSnapshot} seriesEntries={seriesEntries} />
        ) : null}

        {section === 'pricing' ? (
          <MemoPricingSection
            key={`pricing-${range}`}
            latestSnapshot={latestSnapshot}
            seriesEntries={seriesEntries}
            isDark={isDark}
          />
        ) : null}

        {section === 'drilldowns' ? (
          <MemoOperationalSection
            latestSnapshot={latestSnapshot}
            seriesEntries={seriesEntries}
            rangeKey={range}
            isDark={isDark}
          />
        ) : null}

        <footer className="ios-card ios-animate-up mt-4 space-y-2 p-6 text-sm" data-tone="blue">
          
          <p className="text-[color:var(--text-secondary)]">Copyright © {currentYear} STORE Management LLC</p>
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
          <p className="text-[color:var(--text-secondary)]">
            This dashboard is automatically generated and will expire after 24 hours for security purposes.
          </p>
        </footer>
      </div>

      <nav className="fixed bottom-0 left-0 right-0 z-40 sm:hidden">
        <div
          className="mx-auto w-full max-w-[520px] px-4"
          style={{ paddingBottom: 'calc(12px + env(safe-area-inset-bottom))' }}
        >
          <div className="flex items-center justify-between gap-2 rounded-2xl border border-[color:var(--border-soft)] bg-[color:var(--surface)]/95 p-2 shadow-[0_-10px_24px_rgba(15,23,42,0.18)] backdrop-blur">
            {SECTION_TABS.map((sectionOption) => (
              <button
                key={`mobile-${sectionOption.id}`}
                type="button"
                aria-pressed={section === sectionOption.id}
                aria-label={sectionOption.label}
                onClick={() => setSection(sectionOption.id)}
                className={[
                  'flex-1 rounded-xl px-2 py-2 text-[11px] font-semibold transition-colors',
                  section === sectionOption.id
                    ? 'bg-[color:var(--accent-soft)] text-[color:var(--accent-strong)] shadow-[0_10px_20px_rgba(37,99,235,0.18)]'
                    : 'text-[color:var(--text-secondary)]',
                ].join(' ')}
              >
                {SECTION_MOBILE_LABELS[sectionOption.id]}
              </button>
            ))}
          </div>
        </div>
      </nav>
    </div>
  );
}

function CollectionsSection({
  latestSnapshot,
  seriesEntries,
}: {
  latestSnapshot: MsrSnapshot | null;
  seriesEntries: SnapshotEntry[];
}): JSX.Element {
  const latestAr = latestSnapshot?.ar;
  const agingSeries = seriesEntries
    .map((entry) => ({ monthIso: entry.monthIso, buckets: getArBuckets(entry.snapshot) }))
    .filter((entry): entry is { monthIso: string; buckets: NonNullable<ReturnType<typeof getArBuckets>> } => {
      return Boolean(entry.monthIso) && Boolean(entry.buckets);
    });
  const agingTotals = agingSeries.map((entry) => {
    return (
      entry.buckets.days0to10 +
      entry.buckets.days11to30 +
      entry.buckets.days31to60 +
      entry.buckets.days61plus
    );
  });
  const agingEmptyMessage = getSeriesEmptyMessage(agingTotals, seriesEntries.length);
  const agingMax = Math.max(1, ...agingTotals);
  const agingBuckets = [
    { key: 'days0to10', label: '0-10', color: 'bg-[rgba(56,189,248,0.65)]' },
    { key: 'days11to30', label: '11-30', color: 'bg-[rgba(129,140,248,0.6)]' },
    { key: 'days31to60', label: '31-60', color: 'bg-[rgba(251,191,36,0.65)]' },
    { key: 'days61plus', label: '61+', color: 'bg-[rgba(248,113,113,0.7)]' },
  ] as const;

  const overlockBuckets = latestAr?.overlockBucketShare ?? latestAr?.bucketShare ?? [];
  const overlockDistribution = Array.isArray(overlockBuckets)
    ? overlockBuckets.filter((bucket) => isFiniteNumber(bucket.percent))
    : [];

  const topDelinquencies = getTopDelinquencies(latestSnapshot ?? {});

  return (
    <LazyBlock minHeight={520}>
      <section className="space-y-6">
        <SectionHeader title="Collections & AR" subtitle="Delinquency exposure and AR aging from MSR snapshots." />

        <KpiRow
          items={[
            { label: 'Total past due', value: formatMaybeCurrency(latestAr?.totalPastDue) },
            { label: '61+ past due', value: formatMaybeCurrency(latestAr?.pastDue61Plus) },
            { label: 'Delinquent tenants', value: formatMaybeNumber(latestAr?.delinquentTenantCount) },
          ]}
          columns={3}
        />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <ChartCard
          title="AR Aging Trend"
          subtitle="Past due buckets"
          emptyMessage={agingEmptyMessage}
          className="md:col-span-2 xl:col-span-2"
        >
          <div className="rounded-[22px] border border-[color:var(--border-soft)] bg-[color:var(--surface)] p-4 shadow-inner">
            <div className="relative h-44">
              <div className="absolute inset-0 flex flex-col justify-between">
                {Array.from({ length: 4 }).map((_, index) => (
                  <div key={index} className="border-t border-dashed border-[rgba(148,163,255,0.2)]" />
                ))}
              </div>
              <div className="relative z-10 flex h-full items-end gap-2">
                {agingSeries.map((row, index) => {
                  const stack = [
                    row.buckets.days0to10,
                    row.buckets.days11to30,
                    row.buckets.days31to60,
                    row.buckets.days61plus,
                  ];
                  return (
                    <div key={row.monthIso} className="flex h-full flex-1 flex-col-reverse">
                      {stack.map((value, stackIndex) => {
                        const height = `${(value / agingMax) * 100}%`;
                        return (
                          <div
                            key={`${row.monthIso}-${stackIndex}`}
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
                {agingSeries.map((row, index) => (
                  <span key={row.monthIso} className={index % 2 === 1 ? 'hidden sm:block' : ''}>
                    {formatMonthLabel(row.monthIso)}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </ChartCard>

        <ChartCard title="Overlock Risk" subtitle="Overlocked spaces">
          <KpiRow
            items={[
              { label: 'Overlocked units', value: formatMaybeNumber(latestAr?.overlockedUnitCount) },
              { label: 'Total balance', value: formatMaybeCurrency(latestAr?.overlockTotalBalance) },
              { label: 'Avg days late', value: formatMaybeNumber(latestAr?.overlockAvgDaysLate) },
            ]}
            columns={3}
          />

          {overlockDistribution.length === 0 ? (
            <div className="ios-list-card border border-dashed border-[rgba(148,163,255,0.32)] bg-[color:var(--surface)] p-4 text-sm text-[color:var(--text-secondary)] shadow-inner">
              N/A
            </div>
          ) : (
            <div className="space-y-3">
              {overlockDistribution.map((bucket) => (
                <div key={bucket.label} className="space-y-1">
                  <div className="flex items-center justify-between text-xs text-[color:var(--text-secondary)]">
                    <span>{bucket.label} days</span>
                    <span>{formatMaybePercent(bucket.percent, 0)}</span>
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

        <ChartCard
          title="Top Delinquencies"
          subtitle="Latest snapshot"
          emptyMessage={
            topDelinquencies.length === 0
              ? 'N/A (not available in MSR snapshot storage yet)'
              : undefined
          }
        >
          <SimpleTable
            rows={topDelinquencies}
            columns={[
              { header: 'Tenant', accessor: (row) => row.tenant ?? 'N/A' },
              { header: 'Unit', accessor: (row) => row.unit ?? 'N/A' },
              { header: 'Days late', accessor: (row) => formatMaybeNumber(row.daysLate) },
              { header: 'Balance', accessor: (row) => formatMaybeCurrency(row.balance), align: 'right' },
              { header: 'Start date', accessor: (row) => formatDateValue(row.startDate) },
            ]}
            rowKey={(row, index) => `${row.tenant ?? 'tenant'}-${row.unit ?? 'unit'}-${index}`}
          />
        </ChartCard>
      </section>
    </LazyBlock>
  );
}

function PricingSection({
  latestSnapshot,
  seriesEntries,
  isDark,
}: {
  latestSnapshot: MsrSnapshot | null;
  seriesEntries: SnapshotEntry[];
  isDark: boolean;
}): JSX.Element {
  const trendSnapshotCount = seriesEntries.length;
  const needsTrendHint = trendSnapshotCount < 2;

  const pricing = latestSnapshot?.pricing;
  const currentRent = pricing?.avgCurrentRentOccupied;
  const sellRate = pricing?.avgSellRateOccupied;
  const spreadPct =
    isFiniteNumber(currentRent) && isFiniteNumber(sellRate) && sellRate !== 0
      ? ((currentRent - sellRate) / sellRate) * 100
      : null;
  const occupiedVariancePct = pricing?.occupiedRateVariancePct;
  const occupiedVariance = pricing?.occupiedRateVariance;
  const rentChangeCount = pricing?.rentChangeCountMtd ?? pricing?.rentChangeCount;
  const avgRentChangePct = pricing?.avgRentChangePct;
  const staleRentCount = pricing?.noRentChange12MoCount;
  const staleRentByType = pricing?.noRentChange12MoByType ?? null;
  const staleRentEntries = useMemo(
    () => (staleRentByType ? Object.entries(staleRentByType) : []),
    [staleRentByType],
  );
  const staleRentTotal = useMemo(
    () => staleRentEntries.reduce((sum, [, value]) => sum + (isFiniteNumber(value) ? value : 0), 0),
    [staleRentEntries],
  );
  const staleRentSegments = useMemo(() => {
    if (!staleRentEntries.length || staleRentTotal <= 0) return [];
    const sorted = staleRentEntries
      .map(([label, value]) => ({ label, value: isFiniteNumber(value) ? value : 0 }))
      .filter((entry) => entry.value > 0)
      .sort((a, b) => b.value - a.value);
    const top = sorted.slice(0, 4);
    const otherValue = sorted.slice(4).reduce((sum, entry) => sum + entry.value, 0);
    const final = otherValue > 0 ? [...top, { label: 'Other', value: otherValue }] : top;
    let offset = 0;
    return final.map((entry, index) => {
      const percent = (entry.value / staleRentTotal) * 100;
      const start = 25 - offset;
      offset += percent;
      return {
        label: entry.label,
        value: entry.value,
        percent,
        offset: start,
        color: UNIT_MIX_COLORS[index % UNIT_MIX_COLORS.length],
        delay: `${index * 0.12}s`,
      };
    });
  }, [staleRentEntries, staleRentTotal]);
  const staleUnits =
    isFiniteNumber(staleRentCount) && staleRentCount >= 0
      ? staleRentCount
      : staleRentTotal > 0
        ? staleRentTotal
        : null;
  const totalUnits =
    isFiniteNumber(latestSnapshot?.occupancy?.occupiedCount)
      ? latestSnapshot?.occupancy?.occupiedCount
      : isFiniteNumber(latestSnapshot?.occupancy?.totalCount)
        ? latestSnapshot?.occupancy?.totalCount
        : null;
  const stalePct =
    isFiniteNumber(staleUnits) && isFiniteNumber(totalUnits) && totalUnits > 0
      ? (staleUnits / totalUnits) * 100
      : null;
  const hasPartialBreakdown =
    isFiniteNumber(staleUnits) && staleRentEntries.length > 0 && Math.abs(staleRentTotal - staleUnits) > 0.5;

  const varianceSeries = useMemo(
    () =>
      seriesEntries.map((entry) => {
        const raw =
          entry.snapshot.revenue?.occupiedRateVariancePct ?? entry.snapshot.pricing?.occupiedRateVariancePct ?? null;
        const pct01 = toPct01(raw);
        return {
          monthIso: entry.monthIso,
          value: isFiniteNumber(pct01) ? pct01 * 100 : null,
        };
      }),
    [seriesEntries],
  );
  const varianceValues = varianceSeries.map((point) => point.value);
  const varianceNumbers = varianceValues.filter(isFiniteNumber);
  const varianceHasData = varianceNumbers.length > 0;
  const varianceMin = varianceHasData ? Math.min(0, ...varianceNumbers) : 0;
  const varianceMax = varianceHasData ? Math.max(0, ...varianceNumbers) : 1;
  const varianceRange = varianceMax - varianceMin || 1;
  const varianceStatus = needsTrendHint ? 'Need 2+ months for trend' : varianceHasData ? null : 'N/A';

  const rentChangeSeries = useMemo(
    () =>
      seriesEntries.map((entry) => {
        const pricingEntry = entry.snapshot.pricing;
        const count =
          isFiniteNumber(pricingEntry?.rentChangeCount) ? pricingEntry?.rentChangeCount : pricingEntry?.rentChangeCountMtd;
        const pct01 = toPct01(pricingEntry?.avgRentChangePct);
        return {
          monthIso: entry.monthIso,
          count: isFiniteNumber(count) ? count : null,
          pct: isFiniteNumber(pct01) ? pct01 * 100 : null,
        };
      }),
    [seriesEntries],
  );
  const rentCountValues = rentChangeSeries.map((point) => point.count);
  const rentPctValues = rentChangeSeries.map((point) => point.pct);
  const rentCountNumbers = rentCountValues.filter(isFiniteNumber);
  const rentPctNumbers = rentPctValues.filter(isFiniteNumber);
  const rentHasCounts = rentCountNumbers.length > 0;
  const rentHasPct = rentPctNumbers.length > 0;
  const rentCountMax = rentHasCounts ? Math.max(1, ...rentCountNumbers) : 1;
  const rentPctMin = rentHasPct ? Math.min(0, ...rentPctNumbers) : 0;
  const rentPctMax = rentHasPct ? Math.max(1, ...rentPctNumbers) : 1;
  const rentLinePath = rentHasPct
    ? buildLinePathWithGaps(rentPctValues, SMALL_CHART_WIDTH, 150, SMALL_CHART_PADDING, rentPctMin, rentPctMax)
    : '';
  const rentChangeStatus = needsTrendHint ? 'Need 2+ months for trend' : !rentHasCounts && !rentHasPct ? 'N/A' : null;

  const rateSeries = seriesEntries
    .map((entry) => ({
      monthIso: entry.monthIso,
      current: entry.snapshot.pricing?.avgCurrentRentOccupied,
      sell: entry.snapshot.pricing?.avgSellRateOccupied,
    }))
    .filter((entry): entry is { monthIso: string; current: number; sell: number } => {
      return Boolean(entry.monthIso) && isFiniteNumber(entry.current) && isFiniteNumber(entry.sell);
    });
  const currentRates = rateSeries.map((entry) => entry.current);
  const sellRates = rateSeries.map((entry) => entry.sell);
  const combinedRates = [...currentRates, ...sellRates];
  const rateMin = combinedRates.length ? Math.min(...combinedRates) : 0;
  const rateMax = combinedRates.length ? Math.max(...combinedRates) : 1;
  const currentPoints = getChartPoints(
    currentRates,
    PRICING_CHART_WIDTH,
    PRICING_CHART_HEIGHT,
    PRICING_CHART_PADDING,
    rateMin,
    rateMax,
  );
  const sellPoints = getChartPoints(
    sellRates,
    PRICING_CHART_WIDTH,
    PRICING_CHART_HEIGHT,
    PRICING_CHART_PADDING,
    rateMin,
    rateMax,
  );
  const rateEmptyMessage = getSeriesEmptyMessage(currentRates, seriesEntries.length);

  return (
    <LazyBlock minHeight={520}>
      <section className="space-y-6">
        <SectionHeader title="Pricing & Revenue Quality" subtitle="Rates and pricing cadence from MSR snapshots." />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <ChartCard title="Set Rate vs Sell Rate (Occupied)" subtitle="Target vs actual rates">
          <KpiRow
            items={[
              { label: 'Sell rate (actual avg)', value: formatMaybeCurrency(currentRent) },
              { label: 'Set rate (target avg)', value: formatMaybeCurrency(sellRate) },
              { label: 'Sell vs set spread', value: formatMaybePercent(spreadPct, 1) },
            ]}
            columns={3}
          />
          {rateEmptyMessage ? (
            <div className="ios-list-card border border-dashed border-[color:var(--border-soft)] bg-[color:var(--surface)] p-4 text-sm text-[color:var(--text-secondary)] shadow-inner">
              {rateEmptyMessage}
            </div>
          ) : (
            <div className="rounded-[22px] border border-[color:var(--border-soft)] bg-[color:var(--surface)] p-4 shadow-inner">
              <svg viewBox={`0 0 ${PRICING_CHART_WIDTH} ${PRICING_CHART_HEIGHT}`} className="h-44 w-full" role="img">
                <defs>
                  <linearGradient id="token-current-rate-line" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="rgba(37,99,235,0.9)" />
                    <stop offset="100%" stopColor="rgba(59,130,246,0.7)" />
                  </linearGradient>
                  <linearGradient id="token-sell-rate-line" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="rgba(14,165,233,0.9)" />
                    <stop offset="100%" stopColor="rgba(56,189,248,0.7)" />
                  </linearGradient>
                </defs>

                {Array.from({ length: 4 }).map((_, index) => {
                  const y = PRICING_CHART_PADDING + ((PRICING_CHART_HEIGHT - PRICING_CHART_PADDING * 2) / 4) * index;
                  return (
                    <line
                      key={index}
                      x1={PRICING_CHART_PADDING}
                      x2={PRICING_CHART_WIDTH - PRICING_CHART_PADDING}
                      y1={y}
                      y2={y}
                      stroke="rgba(148,163,255,0.2)"
                      strokeDasharray="6 8"
                    />
                  );
                })}

                <path
                  d={buildLinePath(currentPoints)}
                  fill="none"
                  stroke="url(#token-current-rate-line)"
                  strokeWidth={3}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  pathLength={1}
                  className="history-chart-line"
                />
                <path
                  d={buildLinePath(sellPoints)}
                  fill="none"
                  stroke="url(#token-sell-rate-line)"
                  strokeWidth={2.6}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  pathLength={1}
                  className="history-chart-line"
                  style={{ animationDelay: '0.15s' }}
                />
                {currentPoints.map((point, index) => {
                  const value = currentRates[index];
                  if (!isFiniteNumber(value)) return null;
                  const labelY = Math.max(PRICING_CHART_PADDING + 10, point.y - 10);
                  return (
                    <g key={`current-rate-${rateSeries[index]?.monthIso ?? index}`}>
                      <circle
                        cx={point.x}
                        cy={point.y}
                        r={4}
                        fill="rgba(37,99,235,0.85)"
                        stroke="#ffffff"
                        strokeWidth={1.4}
                      />
                      <text
                        x={point.x}
                        y={labelY}
                        fontSize={12}
                        textAnchor="middle"
                        fill={isDark ? 'rgba(255,255,255,0.92)' : 'rgba(71,85,105,0.9)'}
                      >
                        {formatMaybeCurrency(value)}
                      </text>
                    </g>
                  );
                })}
                {sellPoints.map((point, index) => {
                  const value = sellRates[index];
                  if (!isFiniteNumber(value)) return null;
                  const labelY = Math.min(PRICING_CHART_HEIGHT - PRICING_CHART_PADDING + 12, point.y + 14);
                  return (
                    <g key={`sell-rate-${rateSeries[index]?.monthIso ?? index}`}>
                      <circle
                        cx={point.x}
                        cy={point.y}
                        r={3.5}
                        fill="rgba(14,165,233,0.85)"
                        stroke="#ffffff"
                        strokeWidth={1.2}
                      />
                      <text
                        x={point.x}
                        y={labelY}
                        fontSize={12}
                        textAnchor="middle"
                        fill={isDark ? 'rgba(255,255,255,0.92)' : 'rgba(71,85,105,0.9)'}
                      >
                        {formatMaybeCurrency(value)}
                      </text>
                    </g>
                  );
                })}
              </svg>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-[11px] text-[color:var(--text-muted)]">
                <div className="flex items-center gap-3">
                  <span className="inline-flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-[rgba(37,99,235,0.8)]" />
                    Current rent
                  </span>
                  <span className="inline-flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-[rgba(14,165,233,0.8)]" />
                    Sell rate
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {rateSeries.map((row, index) => (
                    <span key={row.monthIso} className={index % 2 === 1 ? 'hidden sm:block' : ''}>
                      {formatMonthLabel(row.monthIso)}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}
        </ChartCard>

        <ChartCard title="Occupied Rate Variance" subtitle="MSR variance metric">
          <div className="ios-list-card space-y-2 p-4 text-sm">
            <div className="text-[11px] uppercase tracking-wide text-[color:var(--text-muted)]">Variance</div>
            <div className="text-lg font-semibold text-[color:var(--text-primary)]">
              {isFiniteNumber(occupiedVariancePct)
                ? formatMaybePercent(occupiedVariancePct, 1)
                : isFiniteNumber(occupiedVariance)
                  ? formatMaybeCurrency(occupiedVariance)
                  : 'N/A'}
            </div>
          </div>

          <div className="rounded-[22px] border border-[color:var(--border-soft)] bg-[color:var(--surface)] p-4 shadow-inner">
            <div className="relative">
              <svg viewBox={`0 0 ${SMALL_CHART_WIDTH} 140`} className="h-32 w-full" role="img">
                {Array.from({ length: 4 }).map((_, index) => {
                  const y = SMALL_CHART_PADDING + ((140 - SMALL_CHART_PADDING * 2) / 4) * (index + 1);
                  return (
                    <line
                      key={index}
                      x1={SMALL_CHART_PADDING}
                      x2={SMALL_CHART_WIDTH - SMALL_CHART_PADDING}
                      y1={y}
                      y2={y}
                      stroke="rgba(148,163,255,0.2)"
                      strokeDasharray="6 8"
                    />
                  );
                })}
                <line
                  x1={SMALL_CHART_PADDING}
                  x2={SMALL_CHART_WIDTH - SMALL_CHART_PADDING}
                  y1={SMALL_CHART_PADDING + ((varianceMax - 0) / varianceRange) * (140 - SMALL_CHART_PADDING * 2)}
                  y2={SMALL_CHART_PADDING + ((varianceMax - 0) / varianceRange) * (140 - SMALL_CHART_PADDING * 2)}
                  stroke="rgba(148,163,255,0.35)"
                />
                {varianceSeries.map((point, index) => {
                  if (!isFiniteNumber(point.value)) return null;
                  const barSlot = (SMALL_CHART_WIDTH - SMALL_CHART_PADDING * 2) / Math.max(varianceSeries.length, 1);
                  const barWidth = barSlot * 0.6;
                  const barX = SMALL_CHART_PADDING + index * barSlot + barSlot * 0.2;
                  const yZero =
                    SMALL_CHART_PADDING + ((varianceMax - 0) / varianceRange) * (140 - SMALL_CHART_PADDING * 2);
                  const yValue =
                    SMALL_CHART_PADDING +
                    ((varianceMax - point.value) / varianceRange) * (140 - SMALL_CHART_PADDING * 2);
                  const barY = point.value >= 0 ? yValue : yZero;
                  const barHeight = Math.max(1, Math.abs(yZero - yValue));
                  const labelY =
                    point.value >= 0
                      ? Math.max(12, barY - 6)
                      : Math.min(140 - 4, barY + barHeight + 12);
                  return (
                    <g key={`${point.monthIso ?? index}`}>
                      <rect
                        x={barX}
                        y={barY}
                        width={barWidth}
                        height={barHeight}
                        rx={4}
                        className="history-chart-bar"
                        style={{
                          fill: point.value >= 0 ? 'rgba(37,99,235,0.85)' : 'rgba(248,113,113,0.75)',
                          transformOrigin: 'center bottom',
                          transformBox: 'fill-box',
                          animationDelay: `${index * 0.05}s`,
                        }}
                      />
                      <text
                        x={barX + barWidth / 2}
                        y={labelY}
                        fontSize={12}
                        textAnchor="middle"
                        fill={isDark ? 'rgba(255,255,255,0.92)' : 'rgba(71,85,105,0.9)'}
                      >
                        {formatMaybePercent(point.value, 1)}
                      </text>
                    </g>
                  );
                })}
              </svg>
              {varianceStatus ? (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-[color:var(--text-muted)]">
                  {varianceStatus}
                </div>
              ) : null}
            </div>
            <div className="mt-3 grid grid-cols-6 gap-2 text-[11px] text-[color:var(--text-muted)] sm:grid-cols-12">
              {varianceSeries.map((point, index) => (
                <span key={point.monthIso ?? `variance-${index}`} className={index % 2 === 1 ? 'hidden sm:block' : ''}>
                  {point.monthIso ? formatMonthLabel(point.monthIso) : '—'}
                </span>
              ))}
            </div>
          </div>
        </ChartCard>

        <ChartCard title="ECRI Cadence" subtitle="Existing Customer Rate Increase (MTD)">
          <KpiRow
            items={[
              { label: 'ECRI count (MTD)', value: formatMaybeNumber(rentChangeCount) },
              { label: 'Avg ECRI %', value: formatMaybePercent(avgRentChangePct, 1) },
            ]}
            columns={2}
          />

          <div className="rounded-[22px] border border-[color:var(--border-soft)] bg-[color:var(--surface)] p-4 shadow-inner">
            <div className="relative">
              <svg viewBox={`0 0 ${SMALL_CHART_WIDTH} 150`} className="h-36 w-full" role="img">
                {Array.from({ length: 4 }).map((_, index) => {
                  const y = SMALL_CHART_PADDING + ((150 - SMALL_CHART_PADDING * 2) / 4) * (index + 1);
                  return (
                    <line
                      key={index}
                      x1={SMALL_CHART_PADDING}
                      x2={SMALL_CHART_WIDTH - SMALL_CHART_PADDING}
                      y1={y}
                      y2={y}
                      stroke="rgba(148,163,255,0.2)"
                      strokeDasharray="6 8"
                    />
                  );
                })}
                {rentChangeSeries.map((point, index) => {
                  if (!isFiniteNumber(point.count)) return null;
                  const barSlot = (SMALL_CHART_WIDTH - SMALL_CHART_PADDING * 2) / Math.max(rentChangeSeries.length, 1);
                  const barWidth = barSlot * 0.55;
                  const barX = SMALL_CHART_PADDING + index * barSlot + barSlot * 0.225;
                  const height = (point.count / rentCountMax) * (150 - SMALL_CHART_PADDING * 2);
                  const barY = 150 - SMALL_CHART_PADDING - height;
                  return (
                    <g key={`${point.monthIso ?? index}-count`}>
                      <rect
                        x={barX}
                        y={barY}
                        width={barWidth}
                        height={Math.max(1, height)}
                        rx={4}
                        className="history-chart-bar"
                        style={{
                          fill: 'rgba(37,99,235,0.35)',
                          transformOrigin: 'center bottom',
                          transformBox: 'fill-box',
                          animationDelay: `${index * 0.05}s`,
                        }}
                      />
                      <text
                        x={barX + barWidth / 2}
                        y={Math.max(12, barY - 6)}
                        fontSize={12}
                        textAnchor="middle"
                        fill={isDark ? 'rgba(255,255,255,0.92)' : 'rgba(71,85,105,0.9)'}
                      >
                        {formatMaybeNumber(point.count)}
                      </text>
                    </g>
                  );
                })}
                {rentHasPct ? (
                  <path
                    d={rentLinePath}
                    fill="none"
                    stroke="rgba(37,99,235,0.9)"
                    strokeWidth={2.6}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    pathLength={1}
                    className="history-chart-line"
                    style={{ animationDelay: '0.1s' }}
                  />
                ) : null}
                {rentHasPct
                  ? rentChangeSeries.map((point, index) => {
                      if (!isFiniteNumber(point.pct)) return null;
                      const step =
                        rentChangeSeries.length > 1
                          ? (SMALL_CHART_WIDTH - SMALL_CHART_PADDING * 2) / (rentChangeSeries.length - 1)
                          : 0;
                      const x = SMALL_CHART_PADDING + index * step;
                      const y =
                        SMALL_CHART_PADDING +
                        ((rentPctMax - point.pct) / Math.max(1, rentPctMax - rentPctMin)) *
                          (150 - SMALL_CHART_PADDING * 2);
                      const labelY = Math.max(SMALL_CHART_PADDING + 8, y - 10);
                      return (
                        <g key={`${point.monthIso ?? index}-pct`}>
                          <circle
                            cx={x}
                            cy={y}
                            r={3.5}
                            fill="rgba(37,99,235,0.9)"
                            stroke="#ffffff"
                            strokeWidth={1.2}
                          />
                          <text
                            x={x}
                            y={labelY}
                            fontSize={12}
                            textAnchor="middle"
                            fill={isDark ? 'rgba(255,255,255,0.92)' : 'rgba(71,85,105,0.9)'}
                          >
                            {formatMaybePercent(point.pct, 1)}
                          </text>
                        </g>
                      );
                    })
                  : null}
              </svg>
              {rentChangeStatus ? (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-[color:var(--text-muted)]">
                  {rentChangeStatus}
                </div>
              ) : null}
            </div>
            <div className="mt-3 grid grid-cols-6 gap-2 text-[11px] text-[color:var(--text-muted)] sm:grid-cols-12">
              {rentChangeSeries.map((point, index) => (
                <span key={point.monthIso ?? `rent-${index}`} className={index % 2 === 1 ? 'hidden sm:block' : ''}>
                  {point.monthIso ? formatMonthLabel(point.monthIso) : '—'}
                </span>
              ))}
            </div>
          </div>
        </ChartCard>
        </div>

        <ChartCard title="Stale Rent Exposure" subtitle="No ECRI in 12 months">
        <KpiRow
          items={[
            {
              label: 'Stale units',
              value: formatMaybeNumber(staleUnits),
              detail: isFiniteNumber(stalePct) ? `${formatPercent(stalePct, 1)} of total` : 'Percent stale: N/A',
            },
            { label: 'Total units', value: formatMaybeNumber(totalUnits) },
          ]}
          columns={2}
        />

        {staleRentSegments.length > 0 ? (
          <div className="mt-4 grid gap-4 md:grid-cols-[180px_minmax(0,1fr)]">
            <div className="flex items-center justify-center">
              <div className="relative flex h-36 w-36 items-center justify-center">
                <svg
                  viewBox="0 0 120 120"
                  className="h-full w-full"
                  role="img"
                  aria-label="Stale rent mix"
                >
                  <circle cx="60" cy="60" r="46" fill="none" stroke="rgba(148,163,255,0.2)" strokeWidth="12" />
                  {staleRentSegments.map((segment) => (
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
                          '--dash': `${segment.percent} ${Math.max(0, 100 - segment.percent)}`,
                          '--delay': segment.delay,
                        } as CSSProperties
                      }
                    />
                  ))}
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                  <div className="text-xl font-semibold text-[color:var(--text-primary)]">
                    {formatMaybeNumber(staleUnits)}
                  </div>
                  <div className="text-[10px] text-[color:var(--text-secondary)]">Stale units</div>
                </div>
              </div>
            </div>
            <div className="space-y-2">
              {staleRentSegments.map((segment) => (
                <div key={segment.label} className="ios-list-card flex items-center justify-between px-4 py-2 text-sm">
                  <div className="flex items-center gap-3 text-[color:var(--text-primary)]">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: segment.color }} />
                    <span>{segment.label}</span>
                  </div>
                  <span className="text-[color:var(--text-secondary)]">
                    {formatMaybeNumber(segment.value)} ({formatMaybePercent(segment.percent, 0)})
                  </span>
                </div>
              ))}
              {hasPartialBreakdown ? (
                <div className="text-[11px] text-[color:var(--text-muted)]">Partial breakdown</div>
              ) : null}
            </div>
          </div>
        ) : null}
        </ChartCard>
      </section>
    </LazyBlock>
  );
}

function OperationalSection({
  latestSnapshot,
  seriesEntries,
  rangeKey,
  isDark,
}: {
  latestSnapshot: MsrSnapshot | null;
  seriesEntries: SnapshotEntry[];
  rangeKey: RangeKey;
  isDark: boolean;
}): JSX.Element {
  const [activeTab, setActiveTab] = useState<DrilldownTab>('demand');

  const channelData = latestSnapshot?.leads?.byChannelMtd ?? {};
  const channelTotals = {
    web: isFiniteNumber(channelData.web) ? channelData.web : null,
    phone: isFiniteNumber(channelData.phone) ? channelData.phone : null,
    walkIn: isFiniteNumber(channelData.walkIn) ? channelData.walkIn : null,
    other: isFiniteNumber(channelData.other) ? channelData.other : null,
  };
  const channelValues = Object.values(channelTotals).filter((value) => isFiniteNumber(value)) as number[];
  const channelSum = channelValues.length ? channelValues.reduce((sum, value) => sum + value, 0) : null;
  const leadsTotal = isFiniteNumber(latestSnapshot?.leads?.totalMtd)
    ? latestSnapshot?.leads?.totalMtd
    : channelSum;
  const moveInsMtd = latestSnapshot?.rentals?.moveInsMtd;
  const conversionPct =
    isFiniteNumber(leadsTotal) && isFiniteNumber(moveInsMtd) && leadsTotal > 0
      ? (moveInsMtd / leadsTotal) * 100
      : null;

  const conversionSeries = seriesEntries
    .map((entry) => {
      const totalLeads = entry.snapshot.leads?.totalMtd;
      const moveIns = entry.snapshot.rentals?.moveInsMtd;
      if (!isFiniteNumber(totalLeads) || !isFiniteNumber(moveIns) || totalLeads <= 0) {
        return null;
      }
      return { monthIso: entry.monthIso, value: (moveIns / totalLeads) * 100 };
    })
    .filter((entry): entry is SeriesPoint => Boolean(entry?.monthIso) && isFiniteNumber(entry?.value));
  const conversionValues = conversionSeries.map((point) => point.value);
  const conversionEmptyMessage = getSeriesEmptyMessage(conversionValues, seriesEntries.length);
  const formatPercentPoint = (value: number) => formatPercent(value, 1);
  const formatCurrencyPoint = (value: number) => formatCompactCurrency(value);
  const formatNumberPoint = (value: number) => formatNumber(value);

  const concessionsSeries = buildSeries(seriesEntries, (snapshot) => snapshot.concessions?.promosDiscountsMtd);
  const creditsSeries = buildSeries(seriesEntries, (snapshot) => snapshot.concessions?.creditsAdjustmentsMtd);
  const refundsSeries = buildSeries(seriesEntries, (snapshot) => snapshot.concessions?.refundsWriteoffsMtd);

  const concessionsEmpty = getSeriesEmptyMessage(
    concessionsSeries.map((point) => point.value),
    seriesEntries.length,
  );
  const creditsEmpty = getSeriesEmptyMessage(creditsSeries.map((point) => point.value), seriesEntries.length);
  const refundsEmpty = getSeriesEmptyMessage(refundsSeries.map((point) => point.value), seriesEntries.length);

  const autopaySeries = buildSeries(seriesEntries, (snapshot) => snapshot.autopay?.autopayPct);
  const coverageSeries = buildSeries(seriesEntries, (snapshot) =>
    isFiniteNumber(snapshot.coverage?.enrolledPct) ? snapshot.coverage?.enrolledPct : snapshot.coverage?.enrolledCount,
  );
  const coverageIsPct = seriesEntries.some((entry) => isFiniteNumber(entry.snapshot.coverage?.enrolledPct));
  const autopayEmpty = getSeriesEmptyMessage(autopaySeries.map((point) => point.value), seriesEntries.length);
  const coverageEmpty = getSeriesEmptyMessage(coverageSeries.map((point) => point.value), seriesEntries.length);

  return (
    <LazyBlock minHeight={520}>
      <section className="space-y-6">
        <SectionHeader title="Operational Drilldowns" subtitle="Demand, concessions, and autopay performance." />

        <div className="ios-card ios-animate-up space-y-6 p-6">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center rounded-full border border-[color:var(--border-soft)] bg-[color:var(--surface)] p-1 text-[11px] font-semibold text-[color:var(--text-secondary)] shadow-inner">
            {DRILLDOWN_TABS.map((tab) => (
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
                aria-label={tab.label}
              >
                <span className="text-[10px] sm:hidden">{tab.mobileLabel}</span>
                <span className="hidden sm:inline">{tab.label}</span>
              </button>
            ))}
          </div>
          <span className="text-xs text-[color:var(--text-muted)]">Range: {rangeKey}</span>
        </div>

        {activeTab === 'demand' ? (
          <div className="space-y-6">
            <KpiRow
              items={[
                { label: 'Total leads (MTD)', value: formatMaybeNumber(leadsTotal) },
                { label: 'Move-ins (MTD)', value: formatMaybeNumber(moveInsMtd) },
                { label: 'Conversion %', value: formatMaybePercent(conversionPct, 1) },
                { label: 'Median days', value: 'N/A' },
              ]}
              columns={4}
            />

            <div className="grid gap-4 md:grid-cols-2">
              <ChartCard
                key={`demand-leads-${rangeKey}`}
                title="Leads by channel (MTD)"
                subtitle="Latest snapshot"
                emptyMessage={!channelSum ? 'N/A' : undefined}
              >
                <div className="flex flex-wrap items-center gap-4 text-xs text-[color:var(--text-secondary)]">
                  <span className="inline-flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-[rgba(37,99,235,0.7)]" />
                    Web
                  </span>
                  <span className="inline-flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-[rgba(14,165,233,0.65)]" />
                    Phone
                  </span>
                  <span className="inline-flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-[rgba(129,140,248,0.6)]" />
                    Walk-in
                  </span>
                  <span className="inline-flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-[rgba(251,191,36,0.6)]" />
                    Other
                  </span>
                </div>

                <div className="mt-4 rounded-[22px] border border-[color:var(--border-soft)] bg-[color:var(--surface)] p-4 shadow-inner">
                  <div className="relative h-44">
                    <div className="absolute inset-0 flex flex-col justify-between">
                      {Array.from({ length: 4 }).map((_, index) => (
                        <div key={index} className="border-t border-dashed border-[rgba(148,163,255,0.2)]" />
                      ))}
                    </div>
                    <div className="relative z-10 flex h-full items-end gap-2">
                      {channelSum ? (
                        <div className="flex h-full flex-1 flex-col-reverse">
                          {
                            [
                              channelTotals.web ?? 0,
                              channelTotals.phone ?? 0,
                              channelTotals.walkIn ?? 0,
                              channelTotals.other ?? 0,
                            ].map((value, index) => {
                              const height = `${(value / channelSum) * 100}%`;
                              const colors = [
                                'bg-[rgba(37,99,235,0.7)]',
                                'bg-[rgba(14,165,233,0.65)]',
                                'bg-[rgba(129,140,248,0.6)]',
                                'bg-[rgba(251,191,36,0.6)]',
                              ];
                              return (
                                <div
                                  key={`channel-${index}`}
                                  className={`history-chart-bar w-full ${colors[index]}`}
                                  style={{ height, animationDelay: `${index * 0.05}s` }}
                                />
                              );
                            })
                          }
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              </ChartCard>

              <ChartCard
                key={`demand-conversion-${rangeKey}`}
                title="Conversion rate"
                subtitle="Move-ins vs leads"
                emptyMessage={conversionEmptyMessage}
              >
                <MemoLineChartWithMonths
                  series={conversionSeries}
                  color="rgba(37,99,235,0.9)"
                  label="Conversion rate"
                  formatValue={formatPercentPoint}
                  labelColor={isDark ? 'rgba(255,255,255,0.92)' : undefined}
                />
              </ChartCard>
            </div>
          </div>
        ) : null}

        {activeTab === 'concessions' ? (
          <div className="space-y-6">
            <KpiRow
              items={[
                { label: 'Promos (MTD)', value: formatMaybeCurrency(latestSnapshot?.concessions?.promosDiscountsMtd) },
                { label: 'Credits (MTD)', value: formatMaybeCurrency(latestSnapshot?.concessions?.creditsAdjustmentsMtd) },
                {
                  label: 'Refunds + write-offs (MTD)',
                  value: formatMaybeCurrency(latestSnapshot?.concessions?.refundsWriteoffsMtd),
                },
              ]}
              columns={3}
            />

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <ChartCard
                key={`concessions-promos-${rangeKey}`}
                title="Promos and discounts"
                subtitle="Monthly trend"
                emptyMessage={concessionsEmpty}
              >
                <MemoLineChartWithMonths
                  series={concessionsSeries}
                  color="rgba(37,99,235,0.85)"
                  label="Promos + discounts"
                  formatValue={formatCurrencyPoint}
                  labelColor={isDark ? 'rgba(255,255,255,0.92)' : undefined}
                />
              </ChartCard>
              <ChartCard
                key={`concessions-credits-${rangeKey}`}
                title="Credits and adjustments"
                subtitle="Monthly trend"
                emptyMessage={creditsEmpty}
              >
                <MemoLineChartWithMonths
                  series={creditsSeries}
                  color="rgba(14,165,233,0.85)"
                  label="Credits + adjustments"
                  formatValue={formatCurrencyPoint}
                  labelColor={isDark ? 'rgba(255,255,255,0.92)' : undefined}
                />
              </ChartCard>
              <ChartCard
                key={`concessions-refunds-${rangeKey}`}
                title="Refunds + write-offs"
                subtitle="Monthly trend"
                emptyMessage={refundsEmpty}
              >
                <MemoLineChartWithMonths
                  series={refundsSeries}
                  color="rgba(248,113,113,0.8)"
                  label="Refunds + write-offs"
                  formatValue={formatCurrencyPoint}
                  labelColor={isDark ? 'rgba(255,255,255,0.92)' : undefined}
                />
              </ChartCard>
            </div>
          </div>
        ) : null}

        {activeTab === 'autopay' ? (
          <div className="space-y-6">
            <KpiRow
              items={[
                { label: 'Autopay adoption', value: formatMaybePercent(latestSnapshot?.autopay?.autopayPct, 1) },
                {
                  label: 'Coverage enrolled',
                  value: isFiniteNumber(latestSnapshot?.coverage?.enrolledCount)
                    ? formatMaybeNumber(latestSnapshot?.coverage?.enrolledCount)
                    : formatMaybePercent(latestSnapshot?.coverage?.enrolledPct, 1),
                },
                {
                  label: 'Coverage premium (MTD)',
                  value: formatMaybeCurrency(latestSnapshot?.coverage?.premiumMtd),
                },
              ]}
              columns={3}
            />

            <div className="grid gap-4 md:grid-cols-2">
              <ChartCard
                key={`autopay-adoption-${rangeKey}`}
                title="Autopay adoption"
                subtitle="Monthly trend"
                emptyMessage={autopayEmpty}
              >
                <MemoLineChartWithMonths
                  series={autopaySeries}
                  color="rgba(37,99,235,0.85)"
                  label="Autopay adoption"
                  formatValue={formatPercentPoint}
                  labelColor={isDark ? 'rgba(255,255,255,0.92)' : undefined}
                />
              </ChartCard>
              <ChartCard
                key={`autopay-coverage-${rangeKey}`}
                title="Coverage enrollment"
                subtitle="Monthly trend"
                emptyMessage={coverageEmpty}
              >
                <MemoLineChartWithMonths
                  series={coverageSeries}
                  color="rgba(14,165,233,0.85)"
                  label="Coverage enrollment"
                  formatValue={coverageIsPct ? formatPercentPoint : formatNumberPoint}
                  labelColor={isDark ? 'rgba(255,255,255,0.92)' : undefined}
                />
              </ChartCard>
            </div>
          </div>
        ) : null}
        </div>
      </section>
    </LazyBlock>
  );
}

function LineChartWithMonths({
  series,
  color,
  label,
  formatValue,
  labelColor,
}: {
  series: SeriesPoint[];
  color: string;
  label: string;
  formatValue: (value: number) => string;
  labelColor?: string;
}): JSX.Element {
  const values = series.map((point) => point.value);
  const points = getChartPoints(values, SMALL_CHART_WIDTH, SMALL_CHART_HEIGHT, SMALL_CHART_PADDING);
  const linePath = buildLinePath(points);

  return (
    <div className="rounded-[22px] border border-[color:var(--border-soft)] bg-[color:var(--surface)] p-4 shadow-inner">
      <div className="flex items-center gap-2 text-xs text-[color:var(--text-secondary)]">
        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
        <span>{label}</span>
      </div>
      <svg viewBox={`0 0 ${SMALL_CHART_WIDTH} ${SMALL_CHART_HEIGHT}`} className="mt-3 h-44 w-full">
        {Array.from({ length: 4 }).map((_, index) => {
          const y = SMALL_CHART_PADDING + ((SMALL_CHART_HEIGHT - SMALL_CHART_PADDING * 2) / 4) * index;
          return (
            <line
              key={index}
              x1={SMALL_CHART_PADDING}
              x2={SMALL_CHART_WIDTH - SMALL_CHART_PADDING}
              y1={y}
              y2={y}
              stroke="rgba(148,163,255,0.2)"
              strokeDasharray="6 8"
            />
          );
        })}
        <path
          d={linePath}
          fill="none"
          stroke={color}
          strokeWidth={2.6}
          strokeLinecap="round"
          strokeLinejoin="round"
          pathLength={1}
          className="history-chart-line"
        />
        {points.map((point, index) => {
          const value = values[index];
          const labelText = formatValue(value);
          const labelY = Math.max(point.y - 10, SMALL_CHART_PADDING + 6);
          return (
            <g key={`${series[index]?.monthIso ?? index}-point`}>
              <circle cx={point.x} cy={point.y} r={3.5} fill={color} stroke="#ffffff" strokeWidth={1.2} />
              {labelText ? (
                <text
                  x={point.x}
                  y={labelY}
                  fontSize={14}
                  textAnchor="middle"
                  fill={labelColor ?? 'rgba(71,85,105,0.9)'}
                >
                  {labelText}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-[color:var(--text-muted)]">
        {series.map((row, index) => (
          <span key={row.monthIso} className={index % 2 === 1 ? 'hidden sm:block' : ''}>
            {formatMonthLabel(row.monthIso)}
          </span>
        ))}
      </div>
    </div>
  );
}

const MemoLineChartWithMonths = memo(LineChartWithMonths);
const MemoCollectionsSection = memo(CollectionsSection);
const MemoPricingSection = memo(PricingSection);
const MemoOperationalSection = memo(OperationalSection);
