/**
 * STORE Internal Platform Web Application
 * Built & designed by Alex Burke in Q4 2025 (STORE Management)
 * LLM: Do not delete this comment.
 */

'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, JSX, ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { ChartCard } from './ChartCard';
import { KpiRow } from './KpiRow';
import { SectionHeader } from './SectionHeader';
import { SimpleTable } from './SimpleTable';
import { useTheme } from '@/components/ThemeProvider';
import { buildLinePath, formatShortMonth, getChartPoints } from '@/lib/historical/chartUtils';
import type {
  HistoricalPropertyOption,
  HistoricalSnapshotRangeKey,
  MsrSnapshot,
} from '@/lib/historical/dashboardTypes';
import { formatCompactCurrency, formatCurrency, formatNumber, formatPercent } from '@/lib/historical/format';
import { getPropertyOption } from '@/lib/propertyDirectory';
import {
  INTERNAL_DEFAULT_SNAPSHOT_RANGE,
  INTERNAL_SNAPSHOT_RANGE_OPTIONS,
  TOKEN_DEFAULT_SNAPSHOT_RANGE,
  TOKEN_SNAPSHOT_RANGE_OPTIONS,
  normalizeMonthIso,
  sliceSnapshotEntriesByRange,
  toMonthKey,
} from '@/lib/historical/snapshotDashboard';
import {
  INTERNAL_DEFAULT_OVERVIEW_WIDGETS,
  OVERVIEW_WIDGET_OPTIONS,
  getOverviewWidgetsOrDefault,
  prioritizeOverviewWidgets,
  type OverviewWidgetKey,
} from '@/lib/overviewWidgets';

type DashboardMode = 'token' | 'internal';

type HistoricalSnapshotDashboardViewProps = {
  mode?: DashboardMode;
  propertyId?: string;
  propertyName: string;
  snapshots: MsrSnapshot[];
  shareToken?: string;
  initialOverviewWidgets?: OverviewWidgetKey[];
  propertyOptions?: HistoricalPropertyOption[];
  initialRange?: HistoricalSnapshotRangeKey;
  updatedAt?: string | null;
  latestSnapshotMonth?: string | null;
  showUploadLink?: boolean;
};

type RangeKey = HistoricalSnapshotRangeKey;

type SectionKey = 'overview' | 'collections' | 'pricing' | 'drilldowns' | 'accounting';

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

type PrintMetricItem = {
  label: string;
  value: string;
  detail?: string;
};

const SECTION_TABS: Array<{ id: SectionKey; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'collections', label: 'Delinquency' },
  { id: 'pricing', label: 'Revenue' },
  { id: 'drilldowns', label: 'Operations' },
  { id: 'accounting', label: 'Financials' },
];

const SECTION_MOBILE_LABELS: Record<SectionKey, string> = {
  overview: 'Summary',
  collections: 'AR',
  pricing: 'Revenue',
  drilldowns: 'Ops',
  accounting: 'Finance',
};

const UNIT_MIX_COLORS = ['#3B82F6', '#22D3EE', '#F97316', '#A78BFA', '#F472B6', '#FACC15'];
const TOKEN_SECTION_STORAGE_KEY = 'token-dashboard:section';
const INTERNAL_SECTION_STORAGE_KEY = 'historical-dashboard:section';
const INTERNAL_OVERVIEW_STORAGE_PREFIX = 'historical-dashboard:overview';

const CHART_WIDTH = 620;
const CHART_HEIGHT = 240;
const SMALL_CHART_WIDTH = 520;
const SMALL_CHART_HEIGHT = 180;
const SMALL_CHART_PADDING = 24;
const PRICING_CHART_WIDTH = 520;
const PRICING_CHART_HEIGHT = 180;
const PRICING_CHART_PADDING = 24;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const toPct01 = (value: unknown): number | null => {
  if (!isFiniteNumber(value)) return null;
  const abs = Math.abs(value);
  if (abs > 1) return value / 100;
  return value;
};

const OCCUPANCY_VALUE_PATHS = [
  ['occupancy', 'rsfOccPct'],
  ['occupancy', 'occupancyPct'],
  ['occupancy', 'occupiedPct'],
  ['occupancyPct'],
] as const;

const NET_REVENUE_VALUE_PATHS = [
  ['revenue', 'netRevenueMtd'],
  ['revenue', 'netRevenue'],
  ['financials', 'netRevenueMtd'],
  ['financials', 'netRevenue'],
  ['netRevenueMtd'],
  ['netRevenue'],
] as const;

const EXPENSES_VALUE_PATHS = [
  ['financials', 'totalOperatingExpenseMtd'],
  ['financials', 'totalOperatingExpense'],
  ['financials', 'operatingExpenseMtd'],
  ['financials', 'expensesMtd'],
  ['financials', 'expenses'],
  ['revenue', 'totalOperatingExpenseMtd'],
  ['revenue', 'totalOperatingExpense'],
  ['revenue', 'operatingExpenseMtd'],
  ['revenue', 'expensesMtd'],
  ['expenses', 'mtd'],
  ['expenses', 'totalOperating'],
  ['totalOperatingExpenseMtd'],
  ['totalOperatingExpense'],
  ['operatingExpenseMtd'],
  ['expensesMtd'],
  ['expenseMtd'],
  ['toe'],
] as const;

const NOI_VALUE_PATHS = [
  ['financials', 'noiMtd'],
  ['financials', 'noi'],
  ['financials', 'netOperatingIncomeMtd'],
  ['financials', 'netOperatingIncome'],
  ['revenue', 'noiMtd'],
  ['revenue', 'noi'],
  ['revenue', 'netOperatingIncomeMtd'],
  ['revenue', 'netOperatingIncome'],
  ['noiMtd'],
  ['noi'],
  ['netOperatingIncomeMtd'],
  ['netOperatingIncome'],
] as const;

const asFiniteNumber = (value: unknown): number | null => {
  if (isFiniteNumber(value)) return value;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const usesParens = /^\(.*\)$/.test(trimmed);
  const normalized = trimmed.replace(/[$,%\s,()]/g, '');
  if (!normalized) return null;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;
  return usesParens ? -parsed : parsed;
};

const getNestedValue = (source: unknown, path: readonly string[]): unknown => {
  let current: unknown = source;
  for (const key of path) {
    if (!current || typeof current !== 'object') return null;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
};

const getSnapshotNumber = (snapshot: MsrSnapshot, paths: ReadonlyArray<readonly string[]>): number | null => {
  for (const path of paths) {
    const value = asFiniteNumber(getNestedValue(snapshot, path));
    if (isFiniteNumber(value)) return value;
  }
  return null;
};

const hasFinancialSeriesData = (snapshot: MsrSnapshot): boolean =>
  isFiniteNumber(getSnapshotNumber(snapshot, EXPENSES_VALUE_PATHS)) ||
  isFiniteNumber(getSnapshotNumber(snapshot, NOI_VALUE_PATHS)) ||
  isFiniteNumber(getSnapshotNumber(snapshot, NET_REVENUE_VALUE_PATHS));

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

const formatMaybeCurrencyPerSqft = (value: number | null | undefined): string =>
  isFiniteNumber(value)
    ? value.toLocaleString('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    : 'N/A';

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

const formatMonthLabel = (monthIso: string): string => formatShortMonth(monthIso);

const formatMonthAsOfLabel = (monthIso: string): string => {
  const [year, month] = monthIso.split('-');
  const parsedYear = Number(year);
  const parsedMonth = Number(month);
  if (!Number.isFinite(parsedYear) || !Number.isFinite(parsedMonth)) return monthIso;
  const date = new Date(Date.UTC(parsedYear, parsedMonth - 1, 1));
  return date.toLocaleDateString('en-US', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
};

function MonthAxisLabels({
  labels,
  y,
  fontSize = 11,
  fill = 'rgba(71,85,105,0.78)',
}: {
  labels: Array<{ key: string; monthIso: string; x: number }>;
  y: number;
  fontSize?: number;
  fill?: string;
}): JSX.Element {
  return (
    <>
      {labels.map((label) => (
        <text
          key={label.key}
          x={label.x}
          y={y}
          fontSize={fontSize}
          textAnchor="middle"
          fill={fill}
        >
          {formatMonthLabel(label.monthIso)}
        </text>
      ))}
    </>
  );
}

const getLatestSeriesValue = (series: SeriesPoint[]): number | null => {
  const latestPoint = series[series.length - 1];
  return latestPoint && isFiniteNumber(latestPoint.value) ? latestPoint.value : null;
};

const normalizePrintPropertyName = (value: string | null | undefined): string | null => {
  if (!value) return null;
  let normalized = value.trim();
  if (!normalized) return null;
  normalized = normalized.replace(/^owner\s*=\s*/i, '').trim();
  normalized = normalized.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();
  return normalized || null;
};

const looksLikeOwnerLabel = (value: string | null | undefined): boolean => {
  if (!value) return false;
  return /^owner\s*=/i.test(value.trim()) || /stor ?spaces/i.test(value);
};

const toDateFromUnknown = (value: unknown): Date | null => {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof (value as { toDate?: () => Date }).toDate === 'function') {
    const parsed = (value as { toDate: () => Date }).toDate();
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
};

const formatSnapshotDisplayDate = (value: unknown): string | null => {
  if (!value) return null;
  const parsed = toDateFromUnknown(value);
  if (parsed) {
    return parsed.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || null;
  }
  return null;
};

const formatSnapshotIsoDate = (value: unknown): string | null => {
  const parsed = toDateFromUnknown(value);
  return parsed ? parsed.toISOString().slice(0, 10) : null;
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

export function HistoricalSnapshotDashboardView({
  mode = 'token',
  propertyId,
  propertyName,
  snapshots,
  shareToken,
  initialOverviewWidgets,
  propertyOptions,
  initialRange = mode === 'internal' ? INTERNAL_DEFAULT_SNAPSHOT_RANGE : TOKEN_DEFAULT_SNAPSHOT_RANGE,
  showUploadLink,
}: HistoricalSnapshotDashboardViewProps): JSX.Element {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const resolvedPathname = pathname ?? '/historical-data';
  const isInternal = mode === 'internal';
  const rangeOptions = isInternal ? INTERNAL_SNAPSHOT_RANGE_OPTIONS : TOKEN_SNAPSHOT_RANGE_OPTIONS;
  const sectionStorageKey = isInternal ? INTERNAL_SECTION_STORAGE_KEY : TOKEN_SECTION_STORAGE_KEY;
  const overviewStorageKey = isInternal
    ? `${INTERNAL_OVERVIEW_STORAGE_PREFIX}:${propertyId ?? propertyName ?? 'property'}`
    : null;
  const [selectedPropertyId, setSelectedPropertyId] = useState<string>(
    propertyId ?? propertyOptions?.[0]?.id ?? '',
  );
  const fallbackOverviewWidgets = isInternal ? INTERNAL_DEFAULT_OVERVIEW_WIDGETS : undefined;
  const initialWidgets = useMemo(
    () => getOverviewWidgetsOrDefault(initialOverviewWidgets, fallbackOverviewWidgets),
    [fallbackOverviewWidgets, initialOverviewWidgets],
  );
  const [range, setRange] = useState<RangeKey>(initialRange);
  const [section, setSection] = useState<SectionKey>('overview');
  const [overviewWidgets, setOverviewWidgets] = useState<OverviewWidgetKey[]>(initialWidgets);
  const [overviewDraftWidgets, setOverviewDraftWidgets] = useState<OverviewWidgetKey[]>(initialWidgets);
  const [isOverviewModalOpen, setIsOverviewModalOpen] = useState(false);
  const [overviewSaveError, setOverviewSaveError] = useState<string | null>(null);
  const [overviewSaveStatus, setOverviewSaveStatus] = useState<string | null>(null);
  const [overviewSaving, setOverviewSaving] = useState(false);
  const [isPrintMode, setIsPrintMode] = useState(false);
  const hideHeaderDetailsOnMobile = section !== 'overview';
  const currentYear = new Date().getFullYear();
  const overviewCustomizeButtonRef = useRef<HTMLButtonElement | null>(null);
  const overviewModalRef = useRef<HTMLDivElement | null>(null);
  const overviewModalWasOpen = useRef(false);
  const selectedPropertyOption = useMemo(
    () => propertyOptions?.find((option) => option.id === propertyId) ?? propertyOptions?.[0] ?? null,
    [propertyId, propertyOptions],
  );

  const updateInternalRoute = useCallback(
    (nextPropertyId: string, nextRange: HistoricalSnapshotRangeKey) => {
      if (!isInternal) return;

      const params = new URLSearchParams(searchParams?.toString() ?? '');
      if (nextPropertyId) {
        params.set('propertyId', nextPropertyId);
      } else {
        params.delete('propertyId');
      }
      if (nextRange === INTERNAL_DEFAULT_SNAPSHOT_RANGE) {
        params.delete('range');
      } else {
        params.set('range', nextRange);
      }

      const query = params.toString();
      router.replace(query ? `${resolvedPathname}?${query}` : resolvedPathname, { scroll: false });
    },
    [isInternal, resolvedPathname, router, searchParams],
  );

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

  const rangeSnapshots = useMemo(() => sliceSnapshotEntriesByRange(sortedSnapshots, range), [sortedSnapshots, range]);

  const latestSnapshot = rangeSnapshots[rangeSnapshots.length - 1]?.snapshot ?? sortedSnapshots[sortedSnapshots.length - 1]?.snapshot ?? null;
  const latestDateLabel = latestSnapshot
    ? formatSnapshotDisplayDate(latestSnapshot.reportDate ?? latestSnapshot.asOfDate)
    : null;
  const printDateLabel =
    (latestSnapshot ? formatSnapshotIsoDate(latestSnapshot.reportDate ?? latestSnapshot.asOfDate) : null) ??
    new Date().toISOString().slice(0, 10);
  const resolvedPrintPropertyName = useMemo(() => {
    const snapshotName = normalizePrintPropertyName(latestSnapshot?.propertyName);
    const propName = normalizePrintPropertyName(propertyName);
    const directoryName = normalizePrintPropertyName(
      selectedPropertyOption?.label ?? (propertyId ? getPropertyOption(propertyId).label : propertyName),
    );

    if (snapshotName && !looksLikeOwnerLabel(snapshotName)) return snapshotName;
    if (propName && !looksLikeOwnerLabel(propName)) return propName;
    if (directoryName) return directoryName;
    return snapshotName ?? propName ?? directoryName ?? 'Property';
  }, [latestSnapshot?.propertyName, propertyId, propertyName, selectedPropertyOption?.label]);
  const printDocumentTitle = useMemo(() => {
    const safePropertyName = resolvedPrintPropertyName.replace(/[<>:"/\\|?*]+/g, '').trim() || 'Property';
    return `${safePropertyName} Historical Data ${printDateLabel}`;
  }, [printDateLabel, resolvedPrintPropertyName]);
  const headerBadgeLabel = isInternal ? 'Historical data' : 'Investor dashboard';
  const headerTitle = resolvedPrintPropertyName
    ? isInternal
      ? `${resolvedPrintPropertyName} historical performance`
      : `${resolvedPrintPropertyName} performance`
    : isInternal
      ? 'Historical performance'
      : 'Property performance';
  const headerDescription = isInternal
    ? 'Internal STORE dashboard with extended snapshot history, delinquency trends, operations, and lagged monthly financials.'
    : 'Historical performance trends for investor-facing review.';
  const overviewSubtitle = isInternal
    ? 'Historical snapshots for the selected facility across the internal graph set.'
    : 'Historical snapshots for the selected owner-view graphs.';

  const seriesEntries = useMemo(
    () => rangeSnapshots.filter((entry) => entry.monthIso),
    [rangeSnapshots],
  );
  const financialSeriesEntries = useMemo(
    () => rangeSnapshots.filter((entry) => entry.monthIso && hasFinancialSeriesData(entry.snapshot)),
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
  const grossPotentialRentValue = latestSnapshot?.revenue?.grossPotentialRevenue;
  const formatCurrencyPoint = (value: number) => formatCompactCurrency(value);
  const formatPercentPoint = (value: number) => formatPercent(value, 1);
  const formatNumberPoint = (value: number) => formatNumber(value);
  const formatSignedPoint = (value: number) => formatSignedNumber(value);

  const coreTrendRows = useMemo(
    () =>
      seriesEntries
        .map((entry) => {
          if (!entry.monthIso) return null;
          const occupancyRaw = getSnapshotNumber(entry.snapshot, OCCUPANCY_VALUE_PATHS);
          const occupancy = toPct01(occupancyRaw);
          const netRevenue = getSnapshotNumber(entry.snapshot, NET_REVENUE_VALUE_PATHS);
          const expenses = getSnapshotNumber(entry.snapshot, EXPENSES_VALUE_PATHS);
          const directNoi = getSnapshotNumber(entry.snapshot, NOI_VALUE_PATHS);
          const noi =
            isFiniteNumber(directNoi)
              ? directNoi
              : isFiniteNumber(netRevenue) && isFiniteNumber(expenses)
                ? netRevenue - expenses
                : null;
          return {
            monthIso: entry.monthIso,
            occupancy,
            netRevenue,
            expenses,
            noi,
          };
        })
        .filter((row): row is { monthIso: string; occupancy: number | null; netRevenue: number | null; expenses: number | null; noi: number | null } => Boolean(row)),
    [seriesEntries],
  );
  const laggedFinancialTrendRows = useMemo(
    () =>
      financialSeriesEntries
        .map((entry) => {
          if (!entry.monthIso) return null;
          const netRevenue = getSnapshotNumber(entry.snapshot, NET_REVENUE_VALUE_PATHS);
          const expenses = getSnapshotNumber(entry.snapshot, EXPENSES_VALUE_PATHS);
          const directNoi = getSnapshotNumber(entry.snapshot, NOI_VALUE_PATHS);
          const noi =
            isFiniteNumber(directNoi)
              ? directNoi
              : isFiniteNumber(netRevenue) && isFiniteNumber(expenses)
                ? netRevenue - expenses
                : null;
          return {
            monthIso: entry.monthIso,
            expenses,
            noi,
          };
        })
        .filter((row): row is { monthIso: string; expenses: number | null; noi: number | null } => Boolean(row)),
    [financialSeriesEntries],
  );

  const occupancyCoreSeries = useMemo(
    () =>
      coreTrendRows.flatMap((row) =>
        isFiniteNumber(row.occupancy) ? [{ monthIso: row.monthIso, value: row.occupancy }] : [],
      ),
    [coreTrendRows],
  );
  const netRevenueCoreSeries = useMemo(
    () =>
      coreTrendRows.flatMap((row) =>
        isFiniteNumber(row.netRevenue) ? [{ monthIso: row.monthIso, value: row.netRevenue }] : [],
      ),
    [coreTrendRows],
  );
  const expensesCoreSeries = useMemo(
    () =>
      laggedFinancialTrendRows.flatMap((row) =>
        isFiniteNumber(row.expenses) ? [{ monthIso: row.monthIso, value: row.expenses }] : [],
      ),
    [laggedFinancialTrendRows],
  );
  const noiCoreSeries = useMemo(
    () =>
      laggedFinancialTrendRows.flatMap((row) =>
        isFiniteNumber(row.noi) ? [{ monthIso: row.monthIso, value: row.noi }] : [],
      ),
    [laggedFinancialTrendRows],
  );
  const occupancyCoreEmpty = getSeriesEmptyMessage(
    occupancyCoreSeries.map((point) => point.value),
    seriesEntries.length,
  );
  const netRevenueCoreEmpty = getSeriesEmptyMessage(
    netRevenueCoreSeries.map((point) => point.value),
    seriesEntries.length,
  );
  const expensesCoreEmpty = getSeriesEmptyMessage(
    expensesCoreSeries.map((point) => point.value),
    financialSeriesEntries.length,
  );
  const noiCoreEmpty = getSeriesEmptyMessage(
    noiCoreSeries.map((point) => point.value),
    financialSeriesEntries.length,
  );
  const totalPastDueSeries = buildSeries(seriesEntries, (snapshot) => snapshot.ar?.totalPastDue);
  const totalPastDueEmpty = getSeriesEmptyMessage(
    totalPastDueSeries.map((point) => point.value),
    seriesEntries.length,
  );
  const rateVarianceSeries = useMemo(
    () =>
      seriesEntries
        .map((entry) => {
          const raw =
            entry.snapshot.revenue?.occupiedRateVariancePct ?? entry.snapshot.pricing?.occupiedRateVariancePct ?? null;
          const pct01 = toPct01(raw);
          return {
            monthIso: entry.monthIso,
            value: isFiniteNumber(pct01) ? pct01 * 100 : null,
          };
        })
        .filter((entry): entry is SeriesPoint => Boolean(entry.monthIso) && isFiniteNumber(entry.value)),
    [seriesEntries],
  );
  const rateVarianceEmpty = getSeriesEmptyMessage(
    rateVarianceSeries.map((point) => point.value),
    seriesEntries.length,
  );
  const conversionSeries = useMemo(
    () =>
      seriesEntries
        .map((entry) => {
          const channelData = entry.snapshot.leads?.byChannelMtd ?? {};
          const channelValues = [channelData.web, channelData.phone, channelData.walkIn, channelData.other].filter(
            isFiniteNumber,
          ) as number[];
          const totalLeads = isFiniteNumber(entry.snapshot.leads?.totalMtd)
            ? entry.snapshot.leads?.totalMtd
            : channelValues.length
              ? channelValues.reduce((sum, value) => sum + value, 0)
              : null;
          const moveIns = entry.snapshot.rentals?.moveInsMtd;
          if (!entry.monthIso || !isFiniteNumber(totalLeads) || !isFiniteNumber(moveIns) || totalLeads <= 0) {
            return null;
          }
          return { monthIso: entry.monthIso, value: (moveIns / totalLeads) * 100 };
        })
        .filter((entry): entry is SeriesPoint => Boolean(entry?.monthIso) && isFiniteNumber(entry?.value)),
    [seriesEntries],
  );
  const conversionEmpty = getSeriesEmptyMessage(
    conversionSeries.map((point) => point.value),
    seriesEntries.length,
  );
  const leadsSeries = useMemo(
    () =>
      seriesEntries
        .map((entry) => {
          const channelData = entry.snapshot.leads?.byChannelMtd ?? {};
          const channelValues = [channelData.web, channelData.phone, channelData.walkIn, channelData.other].filter(
            isFiniteNumber,
          ) as number[];
          const totalLeads = isFiniteNumber(entry.snapshot.leads?.totalMtd)
            ? entry.snapshot.leads?.totalMtd
            : channelValues.length
              ? channelValues.reduce((sum, value) => sum + value, 0)
              : null;
          return entry.monthIso && isFiniteNumber(totalLeads)
            ? { monthIso: entry.monthIso, value: totalLeads }
            : null;
        })
        .filter((entry): entry is SeriesPoint => Boolean(entry?.monthIso) && isFiniteNumber(entry?.value)),
    [seriesEntries],
  );
  const leadsEmpty = getSeriesEmptyMessage(leadsSeries.map((point) => point.value), seriesEntries.length);
  const promosDiscountsSeries = buildSeries(seriesEntries, (snapshot) => snapshot.concessions?.promosDiscountsMtd);
  const promosDiscountsEmpty = getSeriesEmptyMessage(
    promosDiscountsSeries.map((point) => point.value),
    seriesEntries.length,
  );
  const autopaySeries = buildSeries(seriesEntries, (snapshot) => snapshot.autopay?.autopayPct);
  const autopayEmpty = getSeriesEmptyMessage(autopaySeries.map((point) => point.value), seriesEntries.length);
  const tppEnrollmentSeries = buildSeries(seriesEntries, (snapshot) =>
    isFiniteNumber(snapshot.coverage?.enrolledPct) ? snapshot.coverage?.enrolledPct : snapshot.coverage?.enrolledCount,
  );
  const tppEnrollmentUsesPct = seriesEntries.some((entry) => isFiniteNumber(entry.snapshot.coverage?.enrolledPct));
  const tppEnrollmentEmpty = getSeriesEmptyMessage(
    tppEnrollmentSeries.map((point) => point.value),
    seriesEntries.length,
  );
  const moveInsSeries = buildSeries(seriesEntries, (snapshot) => snapshot.rentals?.moveInsMtd);
  const moveInsEmpty = getSeriesEmptyMessage(moveInsSeries.map((point) => point.value), seriesEntries.length);
  const moveOutsSeries = buildSeries(seriesEntries, (snapshot) => snapshot.rentals?.moveOutsMtd);
  const moveOutsEmpty = getSeriesEmptyMessage(moveOutsSeries.map((point) => point.value), seriesEntries.length);
  const netRentalsSeries = useMemo(
    () =>
      seriesEntries
        .map((entry) => {
          const rentals = entry.snapshot.rentals;
          const netValue =
            isFiniteNumber(rentals?.netMtd)
              ? rentals.netMtd
              : isFiniteNumber(rentals?.moveInsMtd) && isFiniteNumber(rentals?.moveOutsMtd)
                ? Number(rentals.moveInsMtd ?? 0) - Number(rentals.moveOutsMtd ?? 0)
                : null;
          return entry.monthIso && isFiniteNumber(netValue)
            ? { monthIso: entry.monthIso, value: netValue }
            : null;
        })
        .filter((entry): entry is SeriesPoint => Boolean(entry?.monthIso) && isFiniteNumber(entry?.value)),
    [seriesEntries],
  );
  const netRentalsEmpty = getSeriesEmptyMessage(
    netRentalsSeries.map((point) => point.value),
    seriesEntries.length,
  );
  const staleRentSeries = buildSeries(seriesEntries, (snapshot) => snapshot.pricing?.noRentChange12MoCount);
  const staleRentEmpty = getSeriesEmptyMessage(staleRentSeries.map((point) => point.value), seriesEntries.length);

  const occupancySeries = buildSeries(seriesEntries, (snapshot) => snapshot.occupancy?.rsfOccPct);
  const occupancyValues = useMemo(() => occupancySeries.map((point) => point.value), [occupancySeries]);

  useEffect(() => {
    const valid = occupancyValues.filter((value) => isFiniteNumber(value));
    if (valid.length >= 3) {
      const maxValue = Math.max(...valid);
      if (maxValue < 0.02) {
        console.warn('[token-dashboard] Occupancy RSF values look tiny (<2%). Check scale.');
      }
    }
  }, [occupancyValues]);

  useEffect(() => {
    setRange(initialRange);
  }, [initialRange]);

  useEffect(() => {
    setSelectedPropertyId(propertyId ?? propertyOptions?.[0]?.id ?? '');
  }, [propertyId, propertyOptions]);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(sectionStorageKey);
      if (stored && SECTION_TABS.some((option) => option.id === stored)) {
        setSection(stored as SectionKey);
      }
    } catch {
      // ignore local storage errors
    }
  }, [sectionStorageKey]);

  useEffect(() => {
    try {
      window.localStorage.setItem(sectionStorageKey, section);
    } catch {
      // ignore local storage errors
    }
  }, [section, sectionStorageKey]);

  useEffect(() => {
    if (!isInternal) {
      setOverviewWidgets(initialWidgets);
      setOverviewDraftWidgets(initialWidgets);
      return;
    }

    try {
      const stored = overviewStorageKey ? window.localStorage.getItem(overviewStorageKey) : null;
      const parsed = stored ? (JSON.parse(stored) as unknown) : null;
      const nextWidgets = getOverviewWidgetsOrDefault(parsed, INTERNAL_DEFAULT_OVERVIEW_WIDGETS);
      setOverviewWidgets(nextWidgets);
      setOverviewDraftWidgets(nextWidgets);
    } catch {
      setOverviewWidgets(initialWidgets);
      setOverviewDraftWidgets(initialWidgets);
    }
  }, [initialWidgets, isInternal, overviewStorageKey]);

  useEffect(() => {
    if (!isInternal || !overviewStorageKey) return;
    try {
      window.localStorage.setItem(overviewStorageKey, JSON.stringify(overviewWidgets));
    } catch {
      // ignore local storage errors
    }
  }, [isInternal, overviewStorageKey, overviewWidgets]);

  const toggleOverviewDraftWidget = (key: OverviewWidgetKey): void => {
    setOverviewDraftWidgets((current) => {
      const next = current.includes(key)
        ? current.filter((value) => value !== key)
        : [...current, key];
      return prioritizeOverviewWidgets(next);
    });
  };

  const moveOverviewDraftWidget = useCallback((key: OverviewWidgetKey, direction: -1 | 1): void => {
    setOverviewDraftWidgets((current) => {
      const index = current.indexOf(key);
      if (index < 0) return current;
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= current.length) return current;
      const next = [...current];
      const [item] = next.splice(index, 1);
      next.splice(nextIndex, 0, item);
      return prioritizeOverviewWidgets(next);
    });
  }, []);

  const openOverviewModal = useCallback((): void => {
    setOverviewDraftWidgets(overviewWidgets);
    setOverviewSaveError(null);
    setOverviewSaveStatus(null);
    setIsOverviewModalOpen(true);
  }, [overviewWidgets]);

  const closeOverviewModal = useCallback((): void => {
    if (overviewSaving) return;
    setOverviewDraftWidgets(overviewWidgets);
    setOverviewSaveError(null);
    setIsOverviewModalOpen(false);
  }, [overviewSaving, overviewWidgets]);

  useEffect(() => {
    if (!isOverviewModalOpen) return;
    overviewModalWasOpen.current = true;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeOverviewModal();
        return;
      }
      if (event.key !== 'Tab') return;
      const modalNode = overviewModalRef.current;
      if (!modalNode) return;
      const focusable = Array.from(
        modalNode.querySelectorAll<HTMLElement>(
          'button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((node) => !node.hasAttribute('disabled'));
      if (!focusable.length) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (event.shiftKey) {
        if (active === first || !modalNode.contains(active)) {
          event.preventDefault();
          last.focus();
        }
      } else if (active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    const frame = requestAnimationFrame(() => {
      const autoFocusTarget =
        overviewModalRef.current?.querySelector<HTMLElement>('[data-autofocus]') ??
        overviewModalRef.current?.querySelector<HTMLElement>(
          'input, button, textarea, select, [tabindex]:not([tabindex="-1"])',
        );
      autoFocusTarget?.focus();
    });

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      cancelAnimationFrame(frame);
    };
  }, [closeOverviewModal, isOverviewModalOpen]);

  useEffect(() => {
    if (!isOverviewModalOpen && overviewModalWasOpen.current) {
      overviewModalWasOpen.current = false;
      requestAnimationFrame(() => {
        overviewCustomizeButtonRef.current?.focus({ preventScroll: true });
      });
    }
  }, [isOverviewModalOpen]);

  const handleSaveOverviewWidgets = async (): Promise<void> => {
    if (!overviewDraftWidgets.length) {
      setOverviewSaveError('Select at least one graph.');
      return;
    }

    if (!shareToken) {
      const nextWidgets = prioritizeOverviewWidgets(overviewDraftWidgets);
      setOverviewWidgets(nextWidgets);
      setOverviewDraftWidgets(nextWidgets);
      setOverviewSaveStatus(isInternal ? 'Graph preferences saved on this device.' : 'Graph preferences updated.');
      setIsOverviewModalOpen(false);
      return;
    }

    setOverviewSaving(true);
    setOverviewSaveError(null);
    setOverviewSaveStatus(null);

    try {
      const res = await fetch('/api/share-links/overview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: shareToken, overviewWidgets: overviewDraftWidgets }),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok?: boolean; message?: string; overviewWidgets?: OverviewWidgetKey[] }
        | null;

      if (!res.ok || !json?.ok) {
        throw new Error(json?.message || 'Unable to save graph preferences.');
      }

      const nextWidgets = getOverviewWidgetsOrDefault(json.overviewWidgets);
      setOverviewWidgets(nextWidgets);
      setOverviewDraftWidgets(nextWidgets);
      setOverviewSaveStatus('Graph preferences saved.');
      setIsOverviewModalOpen(false);
    } catch (error) {
      setOverviewSaveError(error instanceof Error ? error.message : 'Unable to save graph preferences.');
    } finally {
      setOverviewSaving(false);
    }
  };

  const overviewWidgetOptionMap = useMemo(
    () => new Map<OverviewWidgetKey, (typeof OVERVIEW_WIDGET_OPTIONS)[number]>(OVERVIEW_WIDGET_OPTIONS.map((option) => [option.id, option])),
    [],
  );

  const visibleOverviewWidgets = useMemo(
    () =>
      overviewWidgets
        .map((widget) => overviewWidgetOptionMap.get(widget) ?? null)
        .filter((option): option is (typeof OVERVIEW_WIDGET_OPTIONS)[number] => Boolean(option)),
    [overviewWidgetOptionMap, overviewWidgets],
  );

  const orderedOverviewWidgetOptions = useMemo(() => {
    const selected = overviewDraftWidgets
      .map((widget) => overviewWidgetOptionMap.get(widget) ?? null)
      .filter((option): option is (typeof OVERVIEW_WIDGET_OPTIONS)[number] => Boolean(option));
    const selectedIds = new Set(selected.map((option) => option.id));
    const unselected = OVERVIEW_WIDGET_OPTIONS.filter((option) => !selectedIds.has(option.id));
    return [...selected, ...unselected];
  }, [overviewDraftWidgets, overviewWidgetOptionMap]);

  const renderOverviewWidgetCard = (widget: OverviewWidgetKey): JSX.Element | null => {
    switch (widget) {
      case 'occupancy':
        return (
          <ChartCard
            key={`overview-occupancy-core-${range}`}
            title="Occupancy (RSF)"
            subtitle="Monthly trend"
            info="RSF occupancy percent parsed from the Occupancy tab; falls back to the MSR Space Occupancy block when present."
            emptyMessage={occupancyCoreEmpty}
          >
            <MemoLineChartWithMonths
              series={occupancyCoreSeries}
              color="rgba(37,99,235,0.9)"
              label="Occupancy (RSF)"
              formatValue={formatPercentPoint}
              labelColor={isDark ? 'rgba(255,255,255,0.92)' : undefined}
              emphasizeTrend
            />
          </ChartCard>
        );
      case 'netRevenue':
        return (
          <ChartCard
            key={`overview-net-revenue-core-${range}`}
            title="Net Revenue"
            subtitle="Monthly trend"
            info="Parsed from the MSR 'Net Revenue' block (month-to-date) and stored per snapshot."
            emptyMessage={netRevenueCoreEmpty}
          >
            <div className="text-xs text-[color:var(--text-muted)]">
              Current month is in progress; revenue will continue to increase throughout the month.
            </div>
            <MemoLineChartWithMonths
              series={netRevenueCoreSeries}
              color="rgba(14,165,233,0.9)"
              label="Net revenue "
              formatValue={formatCurrencyPoint}
              labelColor={isDark ? 'rgba(255,255,255,0.92)' : undefined}
              emphasizeTrend
            />
          </ChartCard>
        );
      case 'expenses':
        return (
          <ChartCard
            key={`overview-expenses-core-${range}`}
            title="Expenses"
            subtitle="Data Refreshed Monthly"
            info="Expense totals are not present in the MSR; this uses stored snapshot financials when available."
            emptyMessage={expensesCoreEmpty}
          >
            <MemoLineChartWithMonths
              series={expensesCoreSeries}
              color="rgba(248,113,113,0.86)"
              label="Operating expenses"
              formatValue={formatCurrencyPoint}
              labelColor={isDark ? 'rgba(255,255,255,0.92)' : undefined}
              emphasizeTrend
            />
          </ChartCard>
        );
      case 'noi':
        return (
          <ChartCard
            key={`overview-noi-core-${range}`}
            title="NOI"
            subtitle="Data Refreshed Monthly"
            info="NOI is sourced from stored snapshot financials when available; otherwise derived as Net Revenue minus Expenses."
            emptyMessage={noiCoreEmpty}
          >
            <MemoLineChartWithMonths
              series={noiCoreSeries}
              color="rgba(16,185,129,0.9)"
              label="Net operating income"
              formatValue={formatCurrencyPoint}
              labelColor={isDark ? 'rgba(255,255,255,0.92)' : undefined}
              emphasizeTrend
            />
          </ChartCard>
        );
      case 'pastDue':
        return (
          <ChartCard
            key={`overview-past-due-${range}`}
            title="Total Past Due"
            subtitle="Monthly trend"
            info="Total AR past due trend from the delinquency snapshots."
            emptyMessage={totalPastDueEmpty}
          >
            <MemoLineChartWithMonths
              series={totalPastDueSeries}
              color="rgba(248,113,113,0.88)"
              label="Total past due"
              formatValue={formatCurrencyPoint}
              labelColor={isDark ? 'rgba(255,255,255,0.92)' : undefined}
              emphasizeTrend
            />
          </ChartCard>
        );
      case 'rateVariance':
        return (
          <ChartCard
            key={`overview-rate-variance-${range}`}
            title="Occupied Rate Variance"
            subtitle="Monthly trend"
            info="Occupied rate variance from pricing/revenue snapshot fields."
            emptyMessage={rateVarianceEmpty}
          >
            <MemoLineChartWithMonths
              series={rateVarianceSeries}
              color="rgba(129,140,248,0.9)"
              label="Occupied rate variance"
              formatValue={formatPercentPoint}
              labelColor={isDark ? 'rgba(255,255,255,0.92)' : undefined}
              emphasizeTrend
            />
          </ChartCard>
        );
      case 'conversionRate':
        return (
          <ChartCard
            key={`overview-conversion-rate-${range}`}
            title="Conversion Rate"
            subtitle="Move-ins vs leads"
            info="Computed from move-ins and total leads for each snapshot."
            emptyMessage={conversionEmpty}
          >
            <MemoLineChartWithMonths
              series={conversionSeries}
              color="rgba(37,99,235,0.9)"
              label="Conversion rate"
              formatValue={formatPercentPoint}
              labelColor={isDark ? 'rgba(255,255,255,0.92)' : undefined}
              emphasizeTrend
            />
          </ChartCard>
        );
      case 'leads':
        return (
          <ChartCard
            key={`overview-leads-${range}`}
            title="Leads"
            subtitle="Monthly trend"
            info="Total lead volume from the MSR lead snapshot values."
            emptyMessage={leadsEmpty}
          >
            <MemoLineChartWithMonths
              series={leadsSeries}
              color="rgba(14,165,233,0.9)"
              label="Leads"
              formatValue={formatNumberPoint}
              labelColor={isDark ? 'rgba(255,255,255,0.92)' : undefined}
              emphasizeTrend
            />
          </ChartCard>
        );
      case 'promosDiscounts':
        return (
          <ChartCard
            key={`overview-promos-discounts-${range}`}
            title="Promos and Discounts"
            subtitle="Monthly trend"
            info="Discounts and promotions trend from the MSR concessions data."
            emptyMessage={promosDiscountsEmpty}
          >
            <MemoLineChartWithMonths
              series={promosDiscountsSeries}
              color="rgba(245,158,11,0.88)"
              label="Promos + discounts"
              formatValue={formatCurrencyPoint}
              labelColor={isDark ? 'rgba(255,255,255,0.92)' : undefined}
              emphasizeTrend
            />
          </ChartCard>
        );
      case 'autopay':
        return (
          <ChartCard
            key={`overview-autopay-${range}`}
            title="Autopay Adoption"
            subtitle="Monthly trend"
            info="Autopay participation trend from the MSR Autopay Enrolled sheet."
            emptyMessage={autopayEmpty}
          >
            <MemoLineChartWithMonths
              series={autopaySeries}
              color="rgba(37,99,235,0.88)"
              label="Autopay adoption"
              formatValue={formatPercentPoint}
              labelColor={isDark ? 'rgba(255,255,255,0.92)' : undefined}
              emphasizeTrend
            />
          </ChartCard>
        );
      case 'tppEnrollment':
        return (
          <ChartCard
            key={`overview-tpp-enrollment-${range}`}
            title="TPP Enrollment"
            subtitle="Monthly trend"
            info="Coverage/TPP enrollment trend from the MSR coverage section."
            emptyMessage={tppEnrollmentEmpty}
          >
            <MemoLineChartWithMonths
              series={tppEnrollmentSeries}
              color="rgba(14,165,233,0.88)"
              label="TPP enrollment"
              formatValue={tppEnrollmentUsesPct ? formatPercentPoint : formatNumberPoint}
              labelColor={isDark ? 'rgba(255,255,255,0.92)' : undefined}
              emphasizeTrend
            />
          </ChartCard>
        );
      case 'moveIns':
        return (
          <ChartCard
            key={`overview-move-ins-${range}`}
            title="Move-ins"
            subtitle="Monthly trend"
            emptyMessage={moveInsEmpty}
          >
            <MemoLineChartWithMonths
              series={moveInsSeries}
              color="rgba(37,99,235,0.88)"
              label="Move-ins"
              formatValue={formatNumberPoint}
              labelColor={isDark ? 'rgba(255,255,255,0.92)' : undefined}
              emphasizeTrend
            />
          </ChartCard>
        );
      case 'moveOuts':
        return (
          <ChartCard
            key={`overview-move-outs-${range}`}
            title="Move-outs"
            subtitle="Monthly trend"
            emptyMessage={moveOutsEmpty}
          >
            <MemoLineChartWithMonths
              series={moveOutsSeries}
              color="rgba(248,113,113,0.84)"
              label="Move-outs"
              formatValue={formatNumberPoint}
              labelColor={isDark ? 'rgba(255,255,255,0.92)' : undefined}
              emphasizeTrend
            />
          </ChartCard>
        );
      case 'netRentals':
        return (
          <ChartCard
            key={`overview-net-rentals-${range}`}
            title="Net Rentals"
            subtitle="Monthly trend"
            emptyMessage={netRentalsEmpty}
          >
            <MemoLineChartWithMonths
              series={netRentalsSeries}
              color="rgba(16,185,129,0.9)"
              label="Net rentals"
              formatValue={formatSignedPoint}
              labelColor={isDark ? 'rgba(255,255,255,0.92)' : undefined}
              emphasizeTrend
            />
          </ChartCard>
        );
      case 'staleRent':
        return (
          <ChartCard
            key={`overview-stale-rent-${range}`}
            title="No Rent Change (12 Months)"
            subtitle="Monthly trend"
            info="Count of occupied units with no rent change in the last 12 months."
            emptyMessage={staleRentEmpty}
          >
            <MemoLineChartWithMonths
              series={staleRentSeries}
              color="rgba(129,140,248,0.9)"
              label="No rent change count"
              formatValue={formatNumberPoint}
              labelColor={isDark ? 'rgba(255,255,255,0.92)' : undefined}
              emphasizeTrend
            />
          </ChartCard>
        );
      default:
        return null;
    }
  };
  const printSummaryItems: PrintMetricItem[] = [
    { label: 'Occupancy (RSF)', value: formatMaybePercent(occupancyValue), detail: 'Latest snapshot' },
    { label: 'Net move-ins', value: formatSignedNumber(netMoveInsValue), detail: 'Move-ins minus move-outs' },
    { label: 'Projected rent', value: formatMaybeCurrency(projRentValue), detail: 'Economic occupancy' },
    { label: 'Gross potential rent', value: formatMaybeCurrency(grossPotentialRentValue), detail: 'Revenue statistics' },
  ];
  const renderPrintOverviewWidgetCard = (widget: OverviewWidgetKey): JSX.Element | null => {
    switch (widget) {
      case 'occupancy':
        return occupancyCoreSeries.length ? (
          <PrintTrendCard
            key={`print-overview-occupancy-${range}`}
            title="Occupancy (RSF)"
            subtitle="Monthly trend"
            series={occupancyCoreSeries}
            color="rgba(37,99,235,0.9)"
            formatValue={formatPercentPoint}
          />
        ) : null;
      case 'netRevenue':
        return netRevenueCoreSeries.length ? (
          <PrintTrendCard
            key={`print-overview-net-revenue-${range}`}
            title="Net revenue"
            subtitle="Monthly trend"
            series={netRevenueCoreSeries}
            color="rgba(14,165,233,0.9)"
            formatValue={formatCurrencyPoint}
            note="Current month is in progress; revenue may continue increasing through month-end."
          />
        ) : null;
      case 'expenses':
        return expensesCoreSeries.length ? (
          <PrintTrendCard
            key={`print-overview-expenses-${range}`}
            title="Expenses"
            subtitle="Data refreshed monthly"
            series={expensesCoreSeries}
            color="rgba(248,113,113,0.86)"
            formatValue={formatCurrencyPoint}
          />
        ) : null;
      case 'noi':
        return noiCoreSeries.length ? (
          <PrintTrendCard
            key={`print-overview-noi-${range}`}
            title="NOI"
            subtitle="Data refreshed monthly"
            series={noiCoreSeries}
            color="rgba(16,185,129,0.9)"
            formatValue={formatCurrencyPoint}
          />
        ) : null;
      case 'pastDue':
        return totalPastDueSeries.length ? (
          <PrintTrendCard
            key={`print-overview-past-due-${range}`}
            title="Total past due"
            subtitle="Monthly trend"
            series={totalPastDueSeries}
            color="rgba(248,113,113,0.88)"
            formatValue={formatCurrencyPoint}
          />
        ) : null;
      case 'rateVariance':
        return rateVarianceSeries.length ? (
          <PrintTrendCard
            key={`print-overview-rate-variance-${range}`}
            title="Occupied rate variance"
            subtitle="Monthly trend"
            series={rateVarianceSeries}
            color="rgba(129,140,248,0.9)"
            formatValue={formatPercentPoint}
          />
        ) : null;
      case 'conversionRate':
        return conversionSeries.length ? (
          <PrintTrendCard
            key={`print-overview-conversion-${range}`}
            title="Conversion rate"
            subtitle="Move-ins vs leads"
            series={conversionSeries}
            color="rgba(37,99,235,0.9)"
            formatValue={formatPercentPoint}
          />
        ) : null;
      case 'leads':
        return leadsSeries.length ? (
          <PrintTrendCard
            key={`print-overview-leads-${range}`}
            title="Leads"
            subtitle="Monthly trend"
            series={leadsSeries}
            color="rgba(14,165,233,0.9)"
            formatValue={formatNumberPoint}
          />
        ) : null;
      case 'promosDiscounts':
        return promosDiscountsSeries.length ? (
          <PrintTrendCard
            key={`print-overview-promos-${range}`}
            title="Promos and discounts"
            subtitle="Monthly trend"
            series={promosDiscountsSeries}
            color="rgba(245,158,11,0.88)"
            formatValue={formatCurrencyPoint}
          />
        ) : null;
      case 'autopay':
        return autopaySeries.length ? (
          <PrintTrendCard
            key={`print-overview-autopay-${range}`}
            title="Autopay adoption"
            subtitle="Monthly trend"
            series={autopaySeries}
            color="rgba(37,99,235,0.88)"
            formatValue={formatPercentPoint}
          />
        ) : null;
      case 'tppEnrollment':
        return tppEnrollmentSeries.length ? (
          <PrintTrendCard
            key={`print-overview-tpp-${range}`}
            title="TPP enrollment"
            subtitle="Monthly trend"
            series={tppEnrollmentSeries}
            color="rgba(14,165,233,0.88)"
            formatValue={tppEnrollmentUsesPct ? formatPercentPoint : formatNumberPoint}
          />
        ) : null;
      case 'moveIns':
        return moveInsSeries.length ? (
          <PrintTrendCard
            key={`print-overview-move-ins-${range}`}
            title="Move-ins"
            subtitle="Monthly trend"
            series={moveInsSeries}
            color="rgba(37,99,235,0.88)"
            formatValue={formatNumberPoint}
          />
        ) : null;
      case 'moveOuts':
        return moveOutsSeries.length ? (
          <PrintTrendCard
            key={`print-overview-move-outs-${range}`}
            title="Move-outs"
            subtitle="Monthly trend"
            series={moveOutsSeries}
            color="rgba(248,113,113,0.84)"
            formatValue={formatNumberPoint}
          />
        ) : null;
      case 'netRentals':
        return netRentalsSeries.length ? (
          <PrintTrendCard
            key={`print-overview-net-rentals-${range}`}
            title="Net rentals"
            subtitle="Monthly trend"
            series={netRentalsSeries}
            color="rgba(16,185,129,0.9)"
            formatValue={formatSignedPoint}
          />
        ) : null;
      case 'staleRent':
        return staleRentSeries.length ? (
          <PrintTrendCard
            key={`print-overview-stale-rent-${range}`}
            title="No rent change (12 months)"
            subtitle="Monthly trend"
            series={staleRentSeries}
            color="rgba(129,140,248,0.9)"
            formatValue={formatNumberPoint}
          />
        ) : null;
      default:
        return null;
    }
  };
  const printOverviewCards = visibleOverviewWidgets
    .map((option) => renderPrintOverviewWidgetCard(option.id))
    .filter((card): card is JSX.Element => Boolean(card));
  const handlePrint = useCallback(() => {
    const previousTitle = document.title;
    let restored = false;
    const restoreTitle = () => {
      if (restored) return;
      restored = true;
      document.title = previousTitle;
      setIsPrintMode(false);
      window.removeEventListener('afterprint', restoreTitle);
      window.removeEventListener('focus', restoreTitle);
    };

    flushSync(() => {
      setIsPrintMode(true);
    });
    document.title = printDocumentTitle;
    window.addEventListener('afterprint', restoreTitle);
    window.addEventListener('focus', restoreTitle);
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        window.print();
      });
    });
  }, [printDocumentTitle]);


  return (
    <div className="token-dashboard-print relative min-h-screen w-full overflow-visible text-[color:var(--text-primary)]">
      <style jsx global>{`
        .token-dashboard-print-only {
          display: none;
        }
        .token-dashboard-print .info-tooltip {
          display: none !important;
        }
        @media print {
          @page {
            size: landscape;
            margin: 0.45in;
          }
          html,
          body {
            background: #ffffff !important;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          .token-dashboard-print {
            overflow: visible !important;
            background: #ffffff !important;
            color: #111827 !important;
          }
          .token-dashboard-print > .pointer-events-none,
          .token-dashboard-print button,
          .token-dashboard-print [data-variant],
          .token-dashboard-print .ios-pill {
            display: none !important;
          }
          .token-dashboard-screen {
            display: none !important;
          }
          .token-dashboard-print-only {
            display: block !important;
          }
          .token-dashboard-print-report {
            display: block !important;
            width: 100% !important;
          }
          .token-dashboard-print-report,
          .token-dashboard-print-report * {
            box-sizing: border-box;
          }
          .token-dashboard-print-report .history-chart-line,
          .token-dashboard-print-report .history-chart-bar,
          .token-dashboard-print-report .history-donut-ring {
            animation: none !important;
          }
          .token-dashboard-print-report .print-report-page {
            margin-bottom: 0.22in;
          }
          .token-dashboard-print-report .print-report-section--page-break {
            break-before: page;
            page-break-before: always;
          }
          .token-dashboard-print-report .print-report-section,
          .token-dashboard-print-report .print-report-card,
          .token-dashboard-print-report .print-report-table,
          .token-dashboard-print-report .print-report-kpi-grid > *,
          .token-dashboard-print-report .print-report-grid-2 > *,
          .token-dashboard-print-report .print-report-grid-3 > * {
            break-inside: avoid;
            page-break-inside: avoid;
          }
          .token-dashboard-print-report .print-report-header {
            margin-bottom: 0.25in;
            border: 1px solid #d1d5db;
            border-radius: 16px;
            padding: 0.24in;
            background: #ffffff;
          }
          .token-dashboard-print-report .print-report-eyebrow {
            font-size: 10px;
            font-weight: 700;
            letter-spacing: 0.18em;
            text-transform: uppercase;
            color: #64748b;
          }
          .token-dashboard-print-report .print-report-title {
            margin-top: 0.08in;
            font-size: 24px;
            font-weight: 700;
            color: #111827;
          }
          .token-dashboard-print-report .print-report-subtitle {
            margin-top: 0.04in;
            font-size: 12px;
            color: #475569;
          }
          .token-dashboard-print-report .print-report-meta {
            display: flex;
            flex-wrap: wrap;
            gap: 0.12in;
            margin-top: 0.14in;
            font-size: 11px;
            color: #334155;
          }
          .token-dashboard-print-report .print-report-meta span {
            border: 1px solid #dbe3f0;
            border-radius: 9999px;
            padding: 0.04in 0.1in;
            background: #f8fafc;
          }
          .token-dashboard-print-report .print-report-kpi-grid {
            display: grid;
            grid-template-columns: repeat(4, minmax(0, 1fr));
            gap: 0.14in;
            margin-top: 0.18in;
          }
          .token-dashboard-print-report .print-report-kpi {
            border: 1px solid #dbe3f0;
            border-radius: 12px;
            padding: 0.14in;
            background: #ffffff;
          }
          .token-dashboard-print-report .print-report-kpi-label {
            font-size: 10px;
            font-weight: 700;
            letter-spacing: 0.08em;
            text-transform: uppercase;
            color: #64748b;
          }
          .token-dashboard-print-report .print-report-kpi-value {
            margin-top: 0.04in;
            font-size: 20px;
            font-weight: 700;
            color: #111827;
          }
          .token-dashboard-print-report .print-report-kpi-detail {
            margin-top: 0.04in;
            font-size: 10px;
            color: #475569;
          }
          .token-dashboard-print-report .print-report-section {
            margin-top: 0.22in;
          }
          .token-dashboard-print-report .print-report-section-header {
            margin-bottom: 0.14in;
          }
          .token-dashboard-print-report .print-report-section-title {
            font-size: 18px;
            font-weight: 700;
            color: #111827;
          }
          .token-dashboard-print-report .print-report-section-subtitle {
            margin-top: 0.03in;
            font-size: 11px;
            color: #475569;
          }
          .token-dashboard-print-report .print-report-grid-2,
          .token-dashboard-print-report .print-report-grid-3 {
            display: grid;
            gap: 0.16in;
          }
          .token-dashboard-print-report .print-report-grid-2 {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
          .token-dashboard-print-report .print-report-grid-3 {
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }
          .token-dashboard-print-report .print-report-card {
            border: 1px solid #d1d5db;
            border-radius: 14px;
            padding: 0.16in;
            background: #ffffff;
          }
          .token-dashboard-print-report .print-report-card-title {
            font-size: 14px;
            font-weight: 700;
            color: #111827;
          }
          .token-dashboard-print-report .print-report-card-subtitle {
            margin-top: 0.03in;
            font-size: 10px;
            text-transform: uppercase;
            letter-spacing: 0.08em;
            color: #64748b;
          }
          .token-dashboard-print-report .print-report-note {
            margin-top: 0.08in;
            font-size: 10px;
            color: #475569;
          }
          .token-dashboard-print-report .print-report-table table {
            width: 100%;
          }
          .token-dashboard-print-report .print-report-table thead {
            display: table-header-group;
          }
          .token-dashboard-print-report .print-report-table th {
            background: #f8fafc;
          }
          .token-dashboard-print-report .print-report-table th,
          .token-dashboard-print-report .print-report-table td {
            padding: 6px 8px;
            font-size: 10px;
            border-bottom: 1px solid #e5e7eb;
          }
        }
      `}</style>
      <div className={`pointer-events-none absolute inset-0 -z-20 ${overlayTop}`} />
      <div className={`pointer-events-none absolute inset-0 -z-20 ${overlayBottom}`} />

      {!isPrintMode ? (
      <div className="token-dashboard-screen token-dashboard-print__content relative mx-auto flex max-w-[1200px] flex-col gap-8 px-6 pt-10 pb-28 sm:pb-10">
        <header className="ios-card ios-animate-up space-y-4 p-4 sm:space-y-6 sm:p-6 md:p-8" data-tone="blue">
          <div className="flex flex-wrap items-start justify-between gap-4 sm:gap-6">
            <div className={hideHeaderDetailsOnMobile ? 'hidden space-y-3 sm:block' : 'space-y-3'}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="ios-badge text-[10px]">{headerBadgeLabel}</span>
                <span className="ios-pill text-[10px]" data-tone="neutral">
                  {isInternal ? `As of ${latestDateLabel ?? 'N/A'}` : `As of ${latestDateLabel ?? 'N/A'}`}
                </span>
              </div>
              <div className="space-y-2">
                <h1 className="text-xl font-semibold tracking-tight text-[color:var(--text-primary)] sm:text-2xl lg:text-3xl">
                  {headerTitle}
                </h1>
                <p className="max-w-3xl text-sm text-[color:var(--text-secondary)]">{headerDescription}</p>
              </div>
            </div>
            <div className="flex items-center gap-2" />
          </div>

          <div className={hideHeaderDetailsOnMobile ? 'hidden gap-3 sm:grid sm:grid-cols-2 lg:grid-cols-4' : 'grid gap-3 sm:grid-cols-2 lg:grid-cols-4'}>
            <div className="ios-list-card space-y-1 p-4">
              <div className="text-[11px] uppercase tracking-wide text-[color:var(--text-muted)]">
                Occupancy (RSF)
              </div>
              <div className="text-xl font-semibold text-[color:var(--text-primary)]">
                {formatMaybePercent(occupancyValue)}
              </div>
              <div className="text-xs text-[color:var(--text-secondary)]">
                {isInternal ? 'Latest snapshot' : 'Latest MSR'}
              </div>
            </div>
            <div className="ios-list-card space-y-1 p-4">
              <div className="text-[11px] uppercase tracking-wide text-[color:var(--text-muted)]">
                MTD Net Move-ins
              </div>
              <div className="text-xl font-semibold text-[color:var(--text-primary)]">
                {formatSignedNumber(netMoveInsValue)}
              </div>
              <div className="text-xs text-[color:var(--text-secondary)]">Move-ins minus move-outs </div>
            </div>
            <div className="ios-list-card space-y-1 p-4">
              <div className="text-[11px] uppercase tracking-wide text-[color:var(--text-muted)]">
                Projected Rent
              </div>
              <div className="text-xl font-semibold text-[color:var(--text-primary)]">
                {formatMaybeCurrency(projRentValue)}
              </div>
              <div className="text-xs text-[color:var(--text-secondary)]">Economic Occupancy</div>
            </div>
            <div className="ios-list-card space-y-1 p-4">
              <div className="text-[11px] uppercase tracking-wide text-[color:var(--text-muted)]">Gross Potential Rent</div>
              <div className="text-xl font-semibold text-[color:var(--text-primary)]">
                {formatMaybeCurrency(grossPotentialRentValue)}
              </div>
              <div className="text-xs text-[color:var(--text-secondary)]">Revenue statistics </div>
            </div>
          </div>

          <div className="ios-list-card flex flex-col gap-3 px-4 py-3 text-xs xl:flex-row xl:items-center xl:justify-between">
            <div className="hidden min-w-0 flex-wrap items-center gap-3 sm:flex xl:flex-nowrap">
              <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--text-muted)]">
                Section
              </span>
              <div className="flex min-w-0 items-center rounded-full border border-[color:var(--border-soft)] bg-[color:var(--surface)] p-1 text-[11px] font-semibold text-[color:var(--text-secondary)] shadow-inner">
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
              {isInternal && propertyOptions?.length ? (
                <label className="flex shrink-0 items-center gap-2 rounded-full border border-[color:var(--border-soft)] bg-[color:var(--surface)] px-3 py-1 shadow-inner">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--text-muted)]">
                    Property
                  </span>
                  <select
                    className="max-w-[220px] bg-transparent text-[11px] font-semibold text-[color:var(--text-primary)] focus:outline-none"
                    value={selectedPropertyId}
                    onChange={(event) => {
                      const nextPropertyId = event.target.value;
                      setSelectedPropertyId(nextPropertyId);
                      updateInternalRoute(nextPropertyId, range);
                    }}
                  >
                    {propertyOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-3 xl:flex-nowrap">
              <div className="flex shrink-0 items-center gap-3">
                <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--text-muted)]">
                  Range
                </span>
                <div className="flex items-center rounded-full border border-[color:var(--border-soft)] bg-[color:var(--surface)] p-1 text-[11px] font-semibold text-[color:var(--text-secondary)] shadow-inner">
                  {rangeOptions.map((rangeOption) => (
                    <button
                      key={rangeOption.key}
                      type="button"
                      aria-pressed={range === rangeOption.key}
                      onClick={() => {
                        setRange(rangeOption.key);
                        if (isInternal) {
                          updateInternalRoute(selectedPropertyId, rangeOption.key);
                        }
                      }}
                      className={[
                        'rounded-full px-3 py-1 transition-colors',
                        range === rangeOption.key
                          ? 'bg-[color:var(--accent-soft)] text-[color:var(--accent-strong)] shadow-[0_10px_20px_rgba(37,99,235,0.18)]'
                          : 'text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)]',
                      ].join(' ')}
                    >
                      {rangeOption.label}
                    </button>
                  ))}
                </div>
              </div>
              {isInternal && showUploadLink ? (
                <Link href="/historical-data-upload" className="ios-button px-4 py-2 text-sm" data-variant="ghost">
                  Upload data
                </Link>
              ) : null}
              <button
                type="button"
                onClick={handlePrint}
                className="ios-button px-4 py-2 text-sm xl:ml-2"
                data-variant="secondary"
                title="Print dashboard"
              >
                Print
              </button>
            </div>
          </div>
        </header>

        {section === 'overview' ? (
          <div key={`overview-${range}`} className="space-y-6">
            <LazyBlock minHeight={360}>
              <section className="space-y-4">
                <SectionHeader
                  title="Core Financial Trends"
                  subtitle={overviewSubtitle}
                  actions={
                    <button
                      ref={overviewCustomizeButtonRef}
                      type="button"
                      onClick={openOverviewModal}
                      className="ios-button px-3 py-1.5 text-[11px] font-semibold"
                      data-variant="secondary"
                    >
                      Customize graphs
                    </button>
                  }
                />

                <div className="grid gap-4 md:grid-cols-2">
                  {visibleOverviewWidgets.map((option) => renderOverviewWidgetCard(option.id))}
                </div>
                {overviewWidgets.length === 0 ? (
                  <div className="ios-list-card border border-dashed border-[color:var(--border-soft)] bg-[color:var(--surface)] p-4 text-sm text-[color:var(--text-secondary)] shadow-inner">
                    Choose at least one graph to display.
                  </div>
                ) : null}
                {overviewSaveStatus ? (
                  <div className="text-xs text-[color:var(--text-secondary)]" role="status">
                    {overviewSaveStatus}
                  </div>
                ) : null}
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

        {section === 'accounting' ? (
          <MemoFinancialsSection
            latestSnapshot={latestSnapshot}
            seriesEntries={seriesEntries}
            laggedFinancialSeriesEntries={financialSeriesEntries}
            isDark={isDark}
          />
        ) : null}

        {isInternal ? (
          <footer className="ios-card ios-animate-up mt-4 space-y-2 p-6 text-sm" data-tone="blue">
            <p className="text-[color:var(--text-secondary)]">
              Internal STORE dashboard. Snapshot metrics refresh from the historical pipeline; expenses and NOI intentionally lag the in-progress MSR by one month.
            </p>
            <p className="text-[color:var(--text-secondary)]">Copyright (c) {currentYear} STORE Management. All rights reserved.</p>
          </footer>
        ) : (
        <footer className="ios-card ios-animate-up mt-4 space-y-2 p-6 text-sm" data-tone="blue">

          <p className="text-[color:var(--text-secondary)]">Copyright © {currentYear} STORE Management. All Rights Reserved.</p>
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
        )}
      </div>
      ) : null}

      {isPrintMode ? (
      <div className="token-dashboard-print-only">
        <div className="token-dashboard-print-report mx-auto max-w-none">
          <PrintReportHeader
            propertyName={resolvedPrintPropertyName}
            asOfDate={latestDateLabel ?? 'N/A'}
            sectionLabel="Full dashboard"
            rangeLabel={range}
            items={printSummaryItems}
          />
          <PrintReportSection
            title="Overview"
            subtitle={
              isInternal
                ? 'Selected internal overview graphs reformatted for paper output.'
                : 'Selected owner-view graphs reformatted for paper output.'
            }
          >
            {printOverviewCards.length ? (
              <div className="print-report-grid-2">{printOverviewCards}</div>
            ) : (
              <PrintBlock title="Overview" subtitle="No printable chart data">
                <div className="print-report-note">No overview widgets currently have data for this range.</div>
              </PrintBlock>
            )}
          </PrintReportSection>

          <PrintCollectionsReport latestSnapshot={latestSnapshot} seriesEntries={seriesEntries} />
          <PrintPricingReport latestSnapshot={latestSnapshot} seriesEntries={seriesEntries} />
          <PrintOperationsReport latestSnapshot={latestSnapshot} seriesEntries={seriesEntries} />
          <PrintFinancialsReport
            latestSnapshot={latestSnapshot}
            seriesEntries={seriesEntries}
            laggedFinancialSeriesEntries={financialSeriesEntries}
          />
        </div>
      </div>
      ) : null}

      {isOverviewModalOpen && !isPrintMode ? (
        <div
          className="token-dashboard-screen fixed inset-0 z-50 flex items-center justify-center bg-[color:var(--overlay)]/70 px-4 py-10 backdrop-blur-sm"
          role="presentation"
          onClick={closeOverviewModal}
        >
          <div
            ref={overviewModalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="overview-graphs-title"
            aria-describedby="overview-graphs-description"
            className="ios-card ios-animate-up flex max-h-[85vh] w-full max-w-lg flex-col space-y-6 overflow-hidden p-6"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1.5">
                <h3 id="overview-graphs-title" className="text-lg font-semibold text-[color:var(--text-primary)]">
                  Customize graphs
                </h3>
                <p id="overview-graphs-description" className="text-sm text-[color:var(--text-secondary)]">
                  {isInternal
                    ? 'Choose which overview graphs appear for this property. Your selection is saved on this device.'
                    : 'Choose which overview graphs appear for this dashboard. Your selection will be saved for this shared link.'}
                </p>
              </div>
              <button
                type="button"
                onClick={closeOverviewModal}
                className="ios-icon-button text-[color:var(--text-secondary)]"
                disabled={overviewSaving}
              >
                <span className="sr-only">Close</span>
                <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4">
                  <path
                    fill="currentColor"
                    d="m7.05 7.757 4.242 4.243 4.243-4.243 1.414 1.415-4.242 4.243 4.242 4.242-1.414 1.415-4.243-4.243-4.242 4.243-1.414-1.415 4.242-4.242-4.242-4.243z"
                  />
                </svg>
              </button>
            </div>

            <div className="ios-list-card max-h-[52vh] space-y-3 overflow-y-auto p-5 pr-3">
              {orderedOverviewWidgetOptions.map((option, index) => {
                const checked = overviewDraftWidgets.includes(option.id);
                const selectedIndex = checked ? overviewDraftWidgets.indexOf(option.id) : -1;
                return (
                  <div
                    key={`overview-modal-${option.id}`}
                    className="flex items-center justify-between gap-4 rounded-[16px] border border-[color:var(--border-soft)] bg-[color:var(--surface)]/75 px-4 py-3"
                  >
                    <div className="space-y-1">
                      <div className="text-sm font-semibold text-[color:var(--text-primary)]">{option.label}</div>
                      <p className="text-xs text-[color:var(--text-secondary)]">{option.description}</p>
                      {checked ? (
                        <p className="text-[11px] font-medium text-[color:var(--accent-strong)]">
                          Position {selectedIndex + 1} of {overviewDraftWidgets.length}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-2">
                      {checked ? (
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            aria-label={`Move ${option.label} up`}
                            onClick={() => moveOverviewDraftWidget(option.id, -1)}
                            disabled={selectedIndex <= 0}
                            className="ios-icon-button h-8 w-8 text-[color:var(--text-secondary)] disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4">
                              <path fill="currentColor" d="m12 7.41 4.29 4.3 1.42-1.42L12 4.59l-5.71 5.7 1.42 1.42z" />
                            </svg>
                          </button>
                          <button
                            type="button"
                            aria-label={`Move ${option.label} down`}
                            onClick={() => moveOverviewDraftWidget(option.id, 1)}
                            disabled={selectedIndex === overviewDraftWidgets.length - 1}
                            className="ios-icon-button h-8 w-8 text-[color:var(--text-secondary)] disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4">
                              <path fill="currentColor" d="m12 16.59-4.29-4.3-1.42 1.42L12 19.41l5.71-5.7-1.42-1.42z" />
                            </svg>
                          </button>
                        </div>
                      ) : null}
                      <input
                        data-autofocus={index === 0 ? 'true' : undefined}
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleOverviewDraftWidget(option.id)}
                        className="h-4 w-4 rounded border-[color:var(--border-soft)] text-[color:var(--accent-strong)] focus:ring-[color:var(--focus-ring)]"
                      />
                    </div>
                  </div>
                );
              })}
              {!overviewDraftWidgets.length ? (
                <p className="text-xs text-red-500">Select at least one graph to save.</p>
              ) : null}
              {overviewSaveError ? (
                <p className="text-xs text-red-500" role="alert">
                  {overviewSaveError}
                </p>
              ) : null}
            </div>

            <div className="flex flex-wrap justify-end gap-3">
              <button
                type="button"
                onClick={closeOverviewModal}
                className="ios-button px-4 py-2 text-sm"
                data-variant="ghost"
                disabled={overviewSaving}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  void handleSaveOverviewWidgets();
                }}
                className="ios-button px-4 py-2 text-sm"
                disabled={overviewSaving || !overviewDraftWidgets.length}
              >
                {overviewSaving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {!isPrintMode ? (
      <nav className="token-dashboard-screen fixed bottom-0 left-0 right-0 z-40 sm:hidden">
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
      ) : null}
    </div>
  );
}

export { HistoricalSnapshotDashboardView as TokenDashboardView };

function OccupancyUnitMixSection({
  latestSnapshot,
  seriesEntries,
  rangeKey,
}: {
  latestSnapshot: MsrSnapshot | null;
  seriesEntries: SnapshotEntry[];
  rangeKey: RangeKey;
}): JSX.Element {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const occupancySeries = buildSeries(seriesEntries, (snapshot) => snapshot.occupancy?.rsfOccPct);
  const occupancyTrendHint = seriesEntries.length < 2 ? 'Need 2+ months for trend' : null;
  const sellRateSeries = buildSeries(
    seriesEntries,
    (snapshot) => snapshot.pricing?.avgCurrentRentPerSqftOccupied ?? snapshot.pricing?.avgCurrentRentOccupied,
  );

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
        const value = entry.snapshot.pricing?.avgSellRateOccupied;
        return isFiniteNumber(value) ? value : null;
      }),
    [seriesEntries],
  );
  const occupancyTrendDelta =
    occupancyChartValues.length > 1 && isFiniteNumber(occupancyChartValues[0]) && isFiniteNumber(occupancyChartValues[occupancyChartValues.length - 1])
      ? Number(occupancyChartValues[occupancyChartValues.length - 1]) - Number(occupancyChartValues[0])
      : 0;
  const occupancyTrendUp = occupancyChartValues.length > 1 ? occupancyTrendDelta >= 0 : false;

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

  const occupancyChartKey = `${rangeKey}-${chartMonths.length}`;

  const latestOccupancyPoint = occupancySeries.length ? occupancySeries[occupancySeries.length - 1].value : null;
  const latestSellRatePoint = sellRateSeries.length ? sellRateSeries[sellRateSeries.length - 1].value : null;

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
  const unitMixChartKey = `${rangeKey}-${unitMixSegments
    .map((segment) => `${segment.label}-${segment.value.toFixed(2)}`)
    .join('|')}`;
  const occupiedPct = totalRsf && totalOccupiedRsf ? (totalOccupiedRsf / totalRsf) * 100 : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <div className="text-lg font-semibold text-[color:var(--text-primary)]">Occupancy & Unit Mix</div>
          <div className="text-sm text-[color:var(--text-secondary)]">
            RSF occupancy, sell rate, and latest unit mix.
          </div>
        </div>
      </div>

      <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <ChartCard
          key={`token-occupancy-${rangeKey}`}
          title="Occupancy trend (RSF)"
          subtitle="Selected range snapshots"
          info="RSF occupancy percent parsed from the Occupancy tab; falls back to the MSR Space Occupancy block when present."
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

          <div className="relative mt-4 rounded-[22px] border border-[color:var(--border-soft)] bg-[color:var(--surface)] p-4 shadow-inner">
            <div className="pointer-events-none absolute inset-0 rounded-[22px] bg-[linear-gradient(135deg,rgba(37,99,235,0.16),transparent_55%)]" />
            {occupancyTrendUp ? (
              <div className="pointer-events-none absolute right-4 top-4 text-[10px] font-semibold text-[color:var(--text-secondary)]">
                <span className="inline-flex items-center gap-1 rounded-full bg-[color:var(--surface-subtle)] px-2 py-1 shadow-inner">
                  <svg viewBox="0 0 24 24" className="h-3 w-3" aria-hidden="true" focusable="false">
                    <path
                      d="M6 16l6-6 4 4 4-4"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  Trend
                </span>
              </div>
            ) : null}
            <div className="relative">
              <svg
                key={occupancyChartKey}
                viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
                className="h-72 w-full"
                role="img"
                aria-label="Occupancy trend chart"
                onMouseLeave={() => setHoverIndex(null)}
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
                      {formatMaybeCurrencyPerSqft(tick)}
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
                      <circle
                        cx={point.x}
                        cy={point.y}
                        r={4.6}
                        fill="#fff"
                        stroke="rgba(37,99,235,0.9)"
                        strokeWidth={2}
                      />
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
                      <circle
                        cx={point.x}
                        cy={point.y}
                        r={4.2}
                        fill="#fff"
                        stroke="rgba(14,165,233,0.9)"
                        strokeWidth={2}
                      />
                      <text
                        x={point.x + xNudge}
                        y={labelY}
                        fontSize={9}
                        textAnchor="middle"
                        fill="rgba(14,165,233,0.95)"
                      >
                        {formatMaybeCurrencyPerSqft(point.value)}
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
                      onMouseEnter={() => setHoverIndex(index)}
                    />
                  );
                })}
                <MonthAxisLabels
                  labels={chartMonths.flatMap((monthIso, index) =>
                    monthIso
                      ? [
                          {
                            key: `occupancy-rate-axis-${monthIso}-${index}`,
                            monthIso,
                            x: plotLeft + bandWidth * index + bandWidth / 2,
                          },
                        ]
                      : [],
                  )}
                  y={CHART_HEIGHT - 8}
                  fontSize={10.5}
                  fill="var(--text-primary)"
                />
              </svg>

              {hoverIndex != null ? (
                <div
                  className="pointer-events-none absolute top-2 rounded-xl border border-[color:var(--border-soft)] bg-[color:var(--surface)] px-3 py-2 text-[11px] text-[color:var(--text-secondary)] shadow-lg"
                  style={{
                    left: `${((plotLeft + bandWidth * hoverIndex + bandWidth / 2) / CHART_WIDTH) * 100}%`,
                    transform: 'translate(-50%, 0)',
                  }}
                >
                  <div className="text-[10px] uppercase tracking-wide text-[color:var(--text-muted)]">
                    {chartMonths[hoverIndex] ? formatMonthLabel(chartMonths[hoverIndex]) : 'N/A'}
                  </div>
                  <div className="mt-1 flex flex-col gap-1">
                    <span>
                      Occupancy:{' '}
                      {occupancyChartValues[hoverIndex] != null
                        ? formatPercent(occupancyChartValues[hoverIndex] ?? 0, 1)
                        : 'N/A'}
                    </span>
                    <span>
                      Sell rate:{' '}
                      {sellChartValues[hoverIndex] != null
                        ? formatMaybeCurrencyPerSqft(sellChartValues[hoverIndex] ?? 0)
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
                  {formatMaybeCurrencyPerSqft(latestSellRatePoint)}
                </div>
              </div>
            </div>
            <div className="ios-list-card flex items-center gap-3 px-4 py-2">
              <div>
                <div className="text-[11px] uppercase tracking-wide text-[color:var(--text-muted)]">
                  YoY change
                </div>
                <div className="text-lg font-semibold text-[color:var(--text-primary)]">N/A</div>
              </div>
            </div>
          </div>
        </ChartCard>

        <ChartCard
          key={`token-unitmix-${rangeKey}`}
          title="Unit mix"
          subtitle="Occupied RSF by type "
          info="Occupied RSF by unit type from the Occupancy tab; aggregated into the latest snapshot."
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
        <SectionHeader title="Delinquency" subtitle="Accounts Receivable - amount of rent currently unpaid beyond it's due date." />

        <KpiRow
          items={[
            {
              label: 'Total past due',
              value: formatMaybeCurrency(latestAr?.totalPastDue),
              detail: 'All unpaid delinquent balances',
            },
            {
              label: '61+ days past due',
              value: formatMaybeCurrency(latestAr?.pastDue61Plus),
              detail: 'Only the oldest AR bucket',
            },
            {
              label: 'Delinquent tenants',
              value: formatMaybeNumber(latestAr?.delinquentTenantCount),
              detail: 'Tenants currently past due',
            },
          ]}
          columns={3}
        />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <ChartCard
          title="AR Aging Trend"
          subtitle="Past-due dollars by aging bucket"
          info="Parsed from the MSR AR Aging buckets and trended across snapshots."
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

            <div className="mt-3 space-y-3 text-[11px] text-[color:var(--text-muted)]">
              <div className="flex flex-wrap items-center gap-3">
                {agingBuckets.map((bucket) => (
                  <span key={bucket.label} className="inline-flex items-center gap-1">
                    <span className={`h-2 w-2 rounded-full ${bucket.color}`} />
                    {bucket.label}
                  </span>
                ))}
              </div>
              <div className="flex gap-2 text-[11px] text-[color:var(--text-muted)]">
                {agingSeries.map((row) => (
                  <span key={row.monthIso} className="min-w-0 flex-1 text-center">
                    {formatMonthLabel(row.monthIso)}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </ChartCard>

        <ChartCard
          title="Overlock Risk"
          subtitle="Overlocked spaces"
          info="Parsed from the MSR Overlocked Spaces sheet and summarized in the latest snapshot."
        >
            <KpiRow
              items={[
                {
                  label: 'Overlocked units',
                  value: formatMaybeNumber(latestAr?.overlockedUnitCount),
                  detail: 'Subset already overlocked',
                },
                {
                  label: 'Total balance',
                  value: formatMaybeCurrency(latestAr?.overlockTotalBalance),
                  detail: 'Balance on overlocked units only',
                },
                {
                  label: 'Avg days late',
                  value: formatMaybeNumber(latestAr?.overlockAvgDaysLate),
                  detail: 'Average for overlocked units',
                },
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
          title="Top delinquent units"
          subtitle="Highest deliquencent units per dollar"
          info="Parsed from the MSR Delinquencies detail list when available."
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
  const revenue = latestSnapshot?.revenue;
  const setRate = pricing?.avgSellRatePerSqftOccupied ?? pricing?.avgSellRateOccupied;
  const sellRate = pricing?.avgCurrentRentPerSqftOccupied ?? pricing?.avgCurrentRentOccupied;
  const spreadPct =
    isFiniteNumber(setRate) && isFiniteNumber(sellRate) && sellRate !== 0
      ? ((setRate - sellRate) / sellRate) * 100
      : null;
  const occupiedRateVariancePct = revenue?.occupiedRateVariancePct ?? pricing?.occupiedRateVariancePct;
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
  const rentChangeSlotWidth = (SMALL_CHART_WIDTH - SMALL_CHART_PADDING * 2) / Math.max(rentChangeSeries.length, 1);
  const rentPctRange = Math.max(1, rentPctMax - rentPctMin);
  const rentPctChartPoints = rentChangeSeries.map((point, index) => {
    if (!isFiniteNumber(point.pct)) return null;
    const x = SMALL_CHART_PADDING + rentChangeSlotWidth * index + rentChangeSlotWidth / 2;
    const y = SMALL_CHART_PADDING + ((rentPctMax - point.pct) / rentPctRange) * (150 - SMALL_CHART_PADDING * 2);
    return { x, y, value: point.pct };
  });
  const rentLinePath = rentHasPct ? buildPathFromPoints(rentPctChartPoints) : '';
  const rentChangeStatus = needsTrendHint ? 'Need 2+ months for trend' : !rentHasCounts && !rentHasPct ? 'N/A' : null;

  const rateSeries = seriesEntries
    .map((entry) => ({
      monthIso: entry.monthIso,
      current: entry.snapshot.pricing?.avgSellRatePerSqftOccupied ?? entry.snapshot.pricing?.avgSellRateOccupied,
      sell: entry.snapshot.pricing?.avgCurrentRentPerSqftOccupied ?? entry.snapshot.pricing?.avgCurrentRentOccupied,
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
        <SectionHeader title="Pricing & Revenue" subtitle="Pricing, demand, and revenue leakage updated daily." />
        <section className="ios-card ios-animate-up space-y-6 p-6">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(320px,1fr)]">
        <ChartCard
          title="GPR Rate vs Sell Rate"
          subtitle="GPR and sell rates ($/sqft)"
          info="GPR rate = MSR!N27 and sell rate = MSR!K27 from the uploaded MSR; values shown as $/sqft. GPR is Gross Potential Rate."
        >
            <KpiRow
              items={[
                { label: 'GPR rate ($/sqft)', value: formatMaybeCurrencyPerSqft(setRate) },
                { label: 'Sell rate ($/sqft)', value: formatMaybeCurrencyPerSqft(sellRate) },
                { label: 'Delta percent', value: formatMaybePercent(spreadPct, 1) },
              ]}
              columns={3}
            />
          <div className="mt-3 text-[11px] text-[color:var(--text-muted)]">GPR is Gross Potential Rate.</div>
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
                  const setLabelXOffsets = [-10, 10, -14, 14, -10, 10];
                  const setLabelYOffsets = [-22, -28, -18, -28, -20, -26];
                  const labelX = point.x + setLabelXOffsets[index % setLabelXOffsets.length];
                  const labelY = Math.max(
                    PRICING_CHART_PADDING + 8,
                    point.y + setLabelYOffsets[index % setLabelYOffsets.length],
                  );
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
                        x={labelX}
                        y={labelY}
                        fontSize={15}
                        textAnchor="middle"
                        fill={isDark ? 'rgba(255,255,255,0.92)' : 'rgba(71,85,105,0.9)'}
                      >
                        {formatMaybeCurrencyPerSqft(value)}
                      </text>
                    </g>
                  );
                })}
                {sellPoints.map((point, index) => {
                  const value = sellRates[index];
                  if (!isFiniteNumber(value)) return null;
                  const labelX = point.x + (index % 2 === 0 ? 8 : -8);
                  const labelY = Math.min(PRICING_CHART_HEIGHT - 24, point.y + 24);
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
                        x={labelX}
                        y={labelY}
                        fontSize={15}
                        textAnchor="middle"
                        fill={isDark ? 'rgba(255,255,255,0.92)' : 'rgba(71,85,105,0.9)'}
                      >
                        {formatMaybeCurrencyPerSqft(value)}
                      </text>
                    </g>
                  );
                })}
                <MonthAxisLabels
                  labels={rateSeries.flatMap((row, index) => {
                    const x = currentPoints[index]?.x ?? sellPoints[index]?.x;
                    return row.monthIso && typeof x === 'number'
                      ? [{ key: `pricing-rate-axis-${row.monthIso}-${index}`, monthIso: row.monthIso, x }]
                      : [];
                  })}
                  y={PRICING_CHART_HEIGHT - 8}
                  fontSize={10.5}
                  fill={isDark ? 'rgba(255,255,255,0.82)' : undefined}
                />
              </svg>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-[11px] text-[color:var(--text-muted)]">
                <div className="flex items-center gap-3">
                  <span className="inline-flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-[rgba(37,99,235,0.8)]" />
                    GPR rate
                  </span>
                  <span className="inline-flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-[rgba(14,165,233,0.8)]" />
                    Sell rate
                  </span>
                </div>
              </div>
            </div>
          )}
        </ChartCard>

        <div className="grid gap-4">
        <ChartCard
          title="Revenue Statistics"
          subtitle="Current snapshot"
          info="Uses the MSR Revenue Statistics block terms for gross potential revenue, Projected Rent, and occupied rate variance."
        >
          <KpiRow
            items={[
              { label: 'Gross potential revenue', value: formatMaybeCurrency(revenue?.grossPotentialRevenue) },
              { label: 'Projected Rent', value: formatMaybeCurrency(revenue?.economicOccupancy) },
              { label: 'Occupied rate variance', value: formatMaybePercent(occupiedRateVariancePct, 1) },
              { label: 'Net revenue ', value: formatMaybeCurrency(revenue?.netRevenueMtd) },
            ]}
            columns={2}
          />
        </ChartCard>

        <ChartCard
          title="Rent Analysis"
          subtitle="GPR rate vs sell rate delta"
          info="Computed from the MSR Rent Analysis block: GPR rate minus sell rate. GPR is Gross Potential Rate."
        >
          <div className="ios-list-card space-y-2 p-4 text-sm">
            <div className="text-[11px] uppercase tracking-wide text-[color:var(--text-muted)]">GPR - Sell</div>
            <div className="text-lg font-semibold text-[color:var(--text-primary)]">
              {isFiniteNumber(spreadPct)
                ? formatMaybePercent(spreadPct, 1)
                : isFiniteNumber(setRate) && isFiniteNumber(sellRate)
                  ? formatMaybeCurrency(setRate - sellRate)
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
                      : Math.min(140 - 20, barY + barHeight + 12);
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
                <MonthAxisLabels
                  labels={varianceSeries.flatMap((point, index) => {
                    if (!point.monthIso) return [];
                    const barSlot = (SMALL_CHART_WIDTH - SMALL_CHART_PADDING * 2) / Math.max(varianceSeries.length, 1);
                    return [
                      {
                        key: `variance-axis-${point.monthIso}-${index}`,
                        monthIso: point.monthIso,
                        x: SMALL_CHART_PADDING + index * barSlot + barSlot / 2,
                      },
                    ];
                  })}
                  y={134}
                  fontSize={10.5}
                  fill={isDark ? 'rgba(255,255,255,0.82)' : undefined}
                />
              </svg>
              {varianceStatus ? (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-[color:var(--text-muted)]">
                  {varianceStatus}
                </div>
              ) : null}
            </div>
            <div className="hidden mt-3 grid grid-cols-6 gap-2 text-[11px] text-[color:var(--text-muted)] sm:grid-cols-12">
              {varianceSeries.map((point, index) => (
                <span key={point.monthIso ?? `variance-${index}`} className={index % 2 === 1 ? 'hidden sm:block' : ''}>
                  {point.monthIso ? formatMonthLabel(point.monthIso) : '—'}
                </span>
              ))}
            </div>
          </div>
        </ChartCard>
        </div>
          </div>
        </section>

        <div className="space-y-4">
        <ChartCard
          title="Rent Change Activity"
          subtitle="How often and how much rates moved"
          info="Parsed from the MSR Rent Change Summary (rent change counts and average change %)."
        >
          <KpiRow
            items={[
              {
                label: 'Rent changes ',
                value: formatMaybeNumber(rentChangeCount),
              },
              {
                label: 'Avg change %',
                value: formatMaybePercent(avgRentChangePct, 1),
              },
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
                  const barWidth = rentChangeSlotWidth * 0.55;
                  const centerX = SMALL_CHART_PADDING + index * rentChangeSlotWidth + rentChangeSlotWidth / 2;
                  const barX = centerX - barWidth / 2;
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
                  ? rentPctChartPoints.map((point, index) => {
                      if (!point) return null;
                      const labelY = Math.max(SMALL_CHART_PADDING + 8, point.y - 10);
                      return (
                        <g key={`${rentChangeSeries[index]?.monthIso ?? index}-pct`}>
                          <circle
                            cx={point.x}
                            cy={point.y}
                            r={3.5}
                            fill="rgba(37,99,235,0.9)"
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
                            {formatMaybePercent(point.value, 1)}
                          </text>
                        </g>
                      );
                    })
                  : null}
                <MonthAxisLabels
                  labels={rentChangeSeries.flatMap((point, index) => {
                    if (!point.monthIso) return [];
                    return [
                      {
                        key: `rent-change-axis-${point.monthIso}-${index}`,
                        monthIso: point.monthIso,
                        x: SMALL_CHART_PADDING + index * rentChangeSlotWidth + rentChangeSlotWidth / 2,
                      },
                    ];
                  })}
                  y={144}
                  fontSize={10.5}
                  fill={isDark ? 'rgba(255,255,255,0.82)' : undefined}
                />
              </svg>
              {rentChangeStatus ? (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-[color:var(--text-muted)]">
                  {rentChangeStatus}
                </div>
              ) : null}
            </div>
            <div className="hidden mt-3 grid grid-cols-6 gap-2 text-[11px] text-[color:var(--text-muted)] sm:grid-cols-12">
              {rentChangeSeries.map((point, index) => (
                <span key={point.monthIso ?? `rent-${index}`} className={index % 2 === 1 ? 'hidden sm:block' : ''}>
                  {point.monthIso ? formatMonthLabel(point.monthIso) : '—'}
                </span>
              ))}
            </div>
          </div>
        </ChartCard>
        </div>

        <ChartCard
          title="Stale Rent Exposure"
          subtitle="No ECRI in 12 months"
          info="Parsed from the MSR No Rent Change Last 12 Months sheet, grouped by unit type."
        >
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
  const formatPercentPoint = (value: number) => formatPercent(value, 1);
  const formatNumberPoint = (value: number) => formatNumber(value);
  const formatSignedPoint = (value: number) => formatSignedNumber(value);

  const autopaySeries = buildSeries(seriesEntries, (snapshot) => snapshot.autopay?.autopayPct);
  const coverageSeries = buildSeries(seriesEntries, (snapshot) =>
    isFiniteNumber(snapshot.coverage?.enrolledPct) ? snapshot.coverage?.enrolledPct : snapshot.coverage?.enrolledCount,
  );
  const coverageIsPct = seriesEntries.some((entry) => isFiniteNumber(entry.snapshot.coverage?.enrolledPct));
  const autopayEmpty = getSeriesEmptyMessage(autopaySeries.map((point) => point.value), seriesEntries.length);
  const coverageEmpty = getSeriesEmptyMessage(coverageSeries.map((point) => point.value), seriesEntries.length);
  const staleRentSeries = buildSeries(seriesEntries, (snapshot) => snapshot.pricing?.noRentChange12MoCount);
  const staleRentEmpty = getSeriesEmptyMessage(staleRentSeries.map((point) => point.value), seriesEntries.length);

  const moveInsSeries = buildSeries(seriesEntries, (snapshot) => snapshot.rentals?.moveInsMtd);
  const moveOutsSeries = buildSeries(seriesEntries, (snapshot) => snapshot.rentals?.moveOutsMtd);
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
  const netRentalsSeries = seriesEntries
    .map((entry) => {
      const rentals = entry.snapshot.rentals;
      const netValue =
        isFiniteNumber(rentals?.netMtd)
          ? rentals?.netMtd
          : isFiniteNumber(rentals?.moveInsMtd) && isFiniteNumber(rentals?.moveOutsMtd)
            ? Number(rentals?.moveInsMtd ?? 0) - Number(rentals?.moveOutsMtd ?? 0)
            : null;
      return {
        monthIso: entry.monthIso,
        value: isFiniteNumber(netValue) ? netValue : null,
      };
    })
    .filter((entry): entry is SeriesPoint => Boolean(entry.monthIso) && isFiniteNumber(entry.value));
  const moveInsEmpty = getSeriesEmptyMessage(moveInsSeries.map((point) => point.value), seriesEntries.length);
  const moveOutsEmpty = getSeriesEmptyMessage(moveOutsSeries.map((point) => point.value), seriesEntries.length);
  const netRentalsEmpty = getSeriesEmptyMessage(netRentalsSeries.map((point) => point.value), seriesEntries.length);

  const latestMoveIns = latestSnapshot?.rentals?.moveInsMtd;
  const latestMoveOuts = latestSnapshot?.rentals?.moveOutsMtd;
  const conversionPct =
    isFiniteNumber(leadsTotal) && isFiniteNumber(latestMoveIns) && leadsTotal > 0
      ? (latestMoveIns / leadsTotal) * 100
      : null;
  const latestNetRentals =
    isFiniteNumber(latestSnapshot?.rentals?.netMtd)
      ? latestSnapshot?.rentals?.netMtd
      : isFiniteNumber(latestMoveIns) && isFiniteNumber(latestMoveOuts)
        ? Number(latestMoveIns ?? 0) - Number(latestMoveOuts ?? 0)
        : null;
  const staleRentCount = latestSnapshot?.pricing?.noRentChange12MoCount;
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
  const conversionEmptyMessage = getSeriesEmptyMessage(
    conversionSeries.map((point) => point.value),
    seriesEntries.length,
  );

  return (
    <LazyBlock minHeight={520}>
      <section className="space-y-6">
        <OccupancyUnitMixSection
          latestSnapshot={latestSnapshot}
          seriesEntries={seriesEntries}
          rangeKey={rangeKey}
        />

        <div className="space-y-6">
          <section className="ios-card ios-animate-up space-y-6 p-6">
            <SectionHeader title="Performance Indicators" subtitle="Insurance/TPP and retention indicators." />
            <KpiRow
              items={[
                { label: 'Autopay adoption', value: formatMaybePercent(latestSnapshot?.autopay?.autopayPct, 1) },
                {
                  label: 'TPP enrolled (Tenant Protection Program)',
                  value: isFiniteNumber(latestSnapshot?.coverage?.enrolledCount)
                    ? formatMaybeNumber(latestSnapshot?.coverage?.enrolledCount)
                    : formatMaybePercent(latestSnapshot?.coverage?.enrolledPct, 1),
                },
                {
                  label: 'TPP premium ',
                  value: formatMaybeCurrency(latestSnapshot?.coverage?.premiumMtd),
                },
                {
                  label: 'No rent change (12 mo)',
                  value: formatMaybeNumber(staleRentCount),
                },
                {
                  label: 'Avg length of stay (agg.)',
                  value: 'N/A',
                },
                {
                  label: 'Lifetime value (agg.)',
                  value: 'N/A',
                },
              ]}
              columns={3}
            />

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <ChartCard
                key={`autopay-adoption-${rangeKey}`}
                title="TPP penetration"
                subtitle="Percentage of new customers that enroll in TPP at time of rental"
                info="Parsed from the MSR Autopay Enrolled sheet."
                emptyMessage={autopayEmpty}
              >
                <MemoLineChartWithMonths
                  series={autopaySeries}
                  color="rgba(37,99,235,0.85)"
                  label="TPP adoption"
                  formatValue={formatPercentPoint}
                  labelColor={isDark ? 'rgba(255,255,255,0.92)' : undefined}
                />
              </ChartCard>
              <ChartCard
                key={`autopay-coverage-${rangeKey}`}
                title="TPP enrollment"
                subtitle="Percentage of all customers that are enrolled in TPP"
                info="Parsed from the MSR Coverage Enrollment sheet."
                emptyMessage={coverageEmpty}
              >
                <MemoLineChartWithMonths
                  series={coverageSeries}
                  color="rgba(14,165,233,0.85)"
                  label="TPP enrollment"
                  formatValue={coverageIsPct ? formatPercentPoint : formatNumberPoint}
                  labelColor={isDark ? 'rgba(255,255,255,0.92)' : undefined}
                />
              </ChartCard>
              <ChartCard
                key={`stale-rent-12mo-${rangeKey}`}
                title="No rent change (last 12 months)"
                subtitle="Monthly trend"
                info="Parsed from the MSR No Rent Change Last 12 Months sheet."
                emptyMessage={staleRentEmpty}
              >
                <MemoLineChartWithMonths
                  series={staleRentSeries}
                  color="rgba(129,140,248,0.85)"
                  label="No rent change count"
                  formatValue={formatNumberPoint}
                  labelColor={isDark ? 'rgba(255,255,255,0.92)' : undefined}
                />
              </ChartCard>
            </div>
          </section>

          <section className="ios-card ios-animate-up space-y-6 p-6">
            <SectionHeader title="Rental Statistics" subtitle="Move-in, move-out, net, and transfer activity." />
            <KpiRow
              items={[
                { label: 'Move-ins ', value: formatMaybeNumber(latestMoveIns) },
                { label: 'Move-outs ', value: formatMaybeNumber(latestMoveOuts) },
                { label: 'Net rentals ', value: formatSignedNumber(latestNetRentals) },
                { label: 'Transfers ', value: 'N/A' },
              ]}
              columns={4}
            />

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <ChartCard
                key={`rental-moveins-${rangeKey}`}
                title="Move-ins"
                subtitle="Monthly trend"
                emptyMessage={moveInsEmpty}
              >
                <MemoLineChartWithMonths
                  series={moveInsSeries}
                  color="rgba(37,99,235,0.85)"
                  label="Move-ins"
                  formatValue={formatNumberPoint}
                  labelColor={isDark ? 'rgba(255,255,255,0.92)' : undefined}
                />
              </ChartCard>
              <ChartCard
                key={`rental-moveouts-${rangeKey}`}
                title="Move-outs"
                subtitle="Monthly trend"
                emptyMessage={moveOutsEmpty}
              >
                <MemoLineChartWithMonths
                  series={moveOutsSeries}
                  color="rgba(248,113,113,0.82)"
                  label="Move-outs"
                  formatValue={formatNumberPoint}
                  labelColor={isDark ? 'rgba(255,255,255,0.92)' : undefined}
                />
              </ChartCard>
              <ChartCard
                key={`rental-net-${rangeKey}`}
                title="Net rentals"
                subtitle="Monthly trend"
                emptyMessage={netRentalsEmpty}
              >
                <MemoLineChartWithMonths
                  series={netRentalsSeries}
                  color="rgba(16,185,129,0.9)"
                  label="Net rentals"
                  formatValue={formatSignedPoint}
                  labelColor={isDark ? 'rgba(255,255,255,0.92)' : undefined}
                />
              </ChartCard>
            </div>
          </section>

          <section className="ios-card ios-animate-up space-y-6 p-6">
            <SectionHeader title="Demand Funnel" subtitle="Lead volume and conversion." />
            <KpiRow
              items={[
                { label: 'Total leads ', value: formatMaybeNumber(leadsTotal) },
                { label: 'Move-ins ', value: formatMaybeNumber(latestMoveIns) },
                { label: 'Conversion %', value: formatMaybePercent(conversionPct, 1) },
              ]}
              columns={3}
            />

            <div className="grid gap-4 md:grid-cols-2">
              <ChartCard
                key={`demand-leads-${rangeKey}`}
                title="Leads by channel "
                subtitle="Latest snapshot"
                info="Parsed from the MSR Leads MTD table by channel."
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
                          {[channelTotals.web ?? 0, channelTotals.phone ?? 0, channelTotals.walkIn ?? 0, channelTotals.other ?? 0].map(
                            (value, index) => {
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
                            },
                          )}
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
                info="Computed from MSR Leads MTD total and Move-Ins MTD counts."
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
          </section>
        </div>
      </section>
    </LazyBlock>
  );
}

function FinancialsSection({
  latestSnapshot,
  seriesEntries,
  laggedFinancialSeriesEntries,
  isDark,
}: {
  latestSnapshot: MsrSnapshot | null;
  seriesEntries: SnapshotEntry[];
  laggedFinancialSeriesEntries: SnapshotEntry[];
  isDark: boolean;
}): JSX.Element {
  const netRevenueSeries = buildSeries(seriesEntries, (snapshot) => getSnapshotNumber(snapshot, NET_REVENUE_VALUE_PATHS));
  const expensesSeries = buildSeries(laggedFinancialSeriesEntries, (snapshot) => getSnapshotNumber(snapshot, EXPENSES_VALUE_PATHS));
  const noiSeries = useMemo(
    () =>
      laggedFinancialSeriesEntries.flatMap((entry) => {
        if (!entry.monthIso) return [];
        const netRevenue = getSnapshotNumber(entry.snapshot, NET_REVENUE_VALUE_PATHS);
        const expenses = getSnapshotNumber(entry.snapshot, EXPENSES_VALUE_PATHS);
        const directNoi = getSnapshotNumber(entry.snapshot, NOI_VALUE_PATHS);
        const noi =
          isFiniteNumber(directNoi)
            ? directNoi
            : isFiniteNumber(netRevenue) && isFiniteNumber(expenses)
              ? netRevenue - expenses
              : null;
        return isFiniteNumber(noi) ? [{ monthIso: entry.monthIso, value: noi }] : [];
      }),
    [laggedFinancialSeriesEntries],
  );
  const concessionsSeries = buildSeries(seriesEntries, (snapshot) => snapshot.concessions?.promosDiscountsMtd);
  const creditsSeries = buildSeries(seriesEntries, (snapshot) => snapshot.concessions?.creditsAdjustmentsMtd);
  const refundsSeries = buildSeries(seriesEntries, (snapshot) => snapshot.concessions?.refundsWriteoffsMtd);

  const netRevenueEmpty = getSeriesEmptyMessage(netRevenueSeries.map((point) => point.value), seriesEntries.length);
  const expensesEmpty = getSeriesEmptyMessage(expensesSeries.map((point) => point.value), laggedFinancialSeriesEntries.length);
  const noiEmpty = getSeriesEmptyMessage(noiSeries.map((point) => point.value), laggedFinancialSeriesEntries.length);
  const concessionsEmpty = getSeriesEmptyMessage(concessionsSeries.map((point) => point.value), seriesEntries.length);
  const creditsEmpty = getSeriesEmptyMessage(creditsSeries.map((point) => point.value), seriesEntries.length);
  const refundsEmpty = getSeriesEmptyMessage(refundsSeries.map((point) => point.value), seriesEntries.length);

  const latestNetRevenue =
    (latestSnapshot ? getSnapshotNumber(latestSnapshot, NET_REVENUE_VALUE_PATHS) : null) ?? getLatestSeriesValue(netRevenueSeries);
  const latestExpenses =
    (latestSnapshot ? getSnapshotNumber(latestSnapshot, EXPENSES_VALUE_PATHS) : null) ?? getLatestSeriesValue(expensesSeries);
  const directLatestNoi =
    (latestSnapshot ? getSnapshotNumber(latestSnapshot, NOI_VALUE_PATHS) : null) ?? getLatestSeriesValue(noiSeries);
  const latestNoi =
    isFiniteNumber(directLatestNoi)
      ? directLatestNoi
      : isFiniteNumber(latestNetRevenue) && isFiniteNumber(latestExpenses)
        ? latestNetRevenue - latestExpenses
        : null;
  const marginPct =
    isFiniteNumber(latestNoi) && isFiniteNumber(latestNetRevenue) && latestNetRevenue !== 0
      ? (latestNoi / latestNetRevenue) * 100
      : null;
  const latestClosedFinancialMonthIso =
    noiSeries[noiSeries.length - 1]?.monthIso ??
    expensesSeries[expensesSeries.length - 1]?.monthIso ??
    laggedFinancialSeriesEntries[laggedFinancialSeriesEntries.length - 1]?.monthIso ??
    null;
  const latestClosedFinancialDetail = latestClosedFinancialMonthIso
    ? `As of ${formatMonthAsOfLabel(latestClosedFinancialMonthIso)}`
    : 'Updated monthly';

  return (
    <LazyBlock minHeight={420}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="text-lg font-semibold text-[color:var(--text-primary)]">Financials</div>
            <div className="text-sm text-[color:var(--text-secondary)]">
              Net revenue, expenses, NOI, and margin trends.
            </div>
          </div>
        </div>

        <section className="ios-card ios-animate-up space-y-6 p-6">
          <KpiRow
            items={[
              { label: 'Net revenue', value: formatMaybeCurrency(latestNetRevenue), detail: 'Month to date' },
              { label: 'Expenses', value: formatMaybeCurrency(latestExpenses), detail: latestClosedFinancialDetail },
              { label: 'NOI', value: formatMaybeCurrency(latestNoi), detail: latestClosedFinancialDetail },
              { label: 'NOI margin', value: formatMaybePercent(marginPct, 1), detail: latestClosedFinancialDetail },
            ]}
            columns={4}
          />

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <ChartCard title="Net revenue" subtitle="Monthly trend" emptyMessage={netRevenueEmpty}>
              <MemoLineChartWithMonths
                series={netRevenueSeries}
                color="rgba(14,165,233,0.9)"
                label="Net revenue "
                formatValue={formatCompactCurrency}
                labelColor={isDark ? 'rgba(255,255,255,0.92)' : undefined}
              />
            </ChartCard>
            <ChartCard title="Expenses" subtitle="Monthly trend" emptyMessage={expensesEmpty}>
              <MemoLineChartWithMonths
                series={expensesSeries}
                color="rgba(248,113,113,0.86)"
                label="Expenses "
                formatValue={formatCompactCurrency}
                labelColor={isDark ? 'rgba(255,255,255,0.92)' : undefined}
              />
            </ChartCard>
            <ChartCard title="NOI" subtitle="Monthly trend" emptyMessage={noiEmpty}>
              <MemoLineChartWithMonths
                series={noiSeries}
                color="rgba(16,185,129,0.9)"
                label="NOI "
                formatValue={formatCompactCurrency}
                labelColor={isDark ? 'rgba(255,255,255,0.92)' : undefined}
              />
            </ChartCard>
          </div>
        </section>

        <section className="ios-card ios-animate-up space-y-6 p-6">
          <SectionHeader title="Allowances" subtitle="Concessions and leakage trends." />
          <KpiRow
            items={[
              {
                label: 'Promos ',
                value: formatMaybeCurrency(latestSnapshot?.concessions?.promosDiscountsMtd),
              },
              {
                label: 'Credits ',
                value: formatMaybeCurrency(latestSnapshot?.concessions?.creditsAdjustmentsMtd),
              },
              {
                label: 'Refunds + write-offs ',
                value: formatMaybeCurrency(latestSnapshot?.concessions?.refundsWriteoffsMtd),
              },
            ]}
            columns={3}
          />

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <ChartCard
              key="financials-concessions-promos"
              title="Promos and discounts"
              subtitle="Monthly trend"
              info="Parsed from the MSR Discounts & Promotions MTD sheet."
              emptyMessage={concessionsEmpty}
            >
              <MemoLineChartWithMonths
                series={concessionsSeries}
                color="rgba(37,99,235,0.85)"
                label="Promos + discounts"
                formatValue={formatCompactCurrency}
                labelColor={isDark ? 'rgba(255,255,255,0.92)' : undefined}
              />
            </ChartCard>
            <ChartCard
              key="financials-concessions-credits"
              title="Credits and adjustments"
              subtitle="Monthly trend"
              info="Parsed from the MSR Credits & Adjustments MTD sheet."
              emptyMessage={creditsEmpty}
            >
              <MemoLineChartWithMonths
                series={creditsSeries}
                color="rgba(14,165,233,0.85)"
                label="Credits + adjustments"
                formatValue={formatCompactCurrency}
                labelColor={isDark ? 'rgba(255,255,255,0.92)' : undefined}
              />
            </ChartCard>
            <ChartCard
              key="financials-concessions-refunds"
              title="Refunds + write-offs"
              subtitle="Monthly trend"
              info="Parsed from the MSR Refunds MTD and Write-Offs MTD sheets (combined)."
              emptyMessage={refundsEmpty}
            >
              <MemoLineChartWithMonths
                series={refundsSeries}
                color="rgba(248,113,113,0.8)"
                label="Refunds + write-offs"
                formatValue={formatCompactCurrency}
                labelColor={isDark ? 'rgba(255,255,255,0.92)' : undefined}
              />
            </ChartCard>
          </div>
        </section>
      </div>
    </LazyBlock>
  );
}

function PrintReportHeader({
  propertyName,
  asOfDate,
  sectionLabel,
  rangeLabel,
  items,
}: {
  propertyName: string;
  asOfDate: string;
  sectionLabel: string;
  rangeLabel: string;
  items: PrintMetricItem[];
}): JSX.Element {
  return (
    <div className="print-report-header">
      <div className="print-report-eyebrow">STORE Internal Platform</div>
      <div className="print-report-title">
        {propertyName ? `${propertyName} performance` : 'Property performance'}
      </div>
      <div className="print-report-subtitle">Historical dashboard report formatted for print.</div>
      <div className="print-report-meta">
        <span>As of {asOfDate}</span>
        <span>Section: {sectionLabel}</span>
        <span>Range: {rangeLabel}</span>
      </div>
      <PrintMetricGrid items={items} columns={4} />
    </div>
  );
}

function PrintReportSection({
  title,
  subtitle,
  pageBreakBefore = false,
  children,
}: {
  title: string;
  subtitle?: string;
  pageBreakBefore?: boolean;
  children: ReactNode;
}): JSX.Element {
  return (
    <section className={['print-report-section', pageBreakBefore ? 'print-report-section--page-break' : ''].filter(Boolean).join(' ')}>
      <div className="print-report-section-header">
        <div className="print-report-section-title">{title}</div>
        {subtitle ? <div className="print-report-section-subtitle">{subtitle}</div> : null}
      </div>
      {children}
    </section>
  );
}

function PrintMetricGrid({
  items,
  columns = 4,
}: {
  items: PrintMetricItem[];
  columns?: 2 | 3 | 4;
}): JSX.Element {
  const columnClass =
    columns === 4 ? 'print-report-kpi-grid' : columns === 3 ? 'print-report-grid-3' : 'print-report-grid-2';

  return (
    <div className={columnClass}>
      {items.map((item) => (
        <div key={`${item.label}-${item.value}`} className="print-report-kpi">
          <div className="print-report-kpi-label">{item.label}</div>
          <div className="print-report-kpi-value">{item.value}</div>
          {item.detail ? <div className="print-report-kpi-detail">{item.detail}</div> : null}
        </div>
      ))}
    </div>
  );
}

function PrintBlock({
  title,
  subtitle,
  note,
  children,
  className,
}: {
  title: string;
  subtitle?: string;
  note?: string;
  children: ReactNode;
  className?: string;
}): JSX.Element {
  return (
    <section className={['print-report-card', className].filter(Boolean).join(' ')}>
      <div className="print-report-card-title">{title}</div>
      {subtitle ? <div className="print-report-card-subtitle">{subtitle}</div> : null}
      {children}
      {note ? <div className="print-report-note">{note}</div> : null}
    </section>
  );
}

function PrintLineChart({
  series,
  color,
  formatValue,
  label,
}: {
  series: SeriesPoint[];
  color: string;
  formatValue: (value: number) => string;
  label: string;
}): JSX.Element {
  const values = series.map((point) => point.value);
  const points = getChartPoints(values, SMALL_CHART_WIDTH, SMALL_CHART_HEIGHT, SMALL_CHART_PADDING);
  const linePath = buildLinePath(points);
  const labelIndexes = new Set([0, Math.max(0, series.length - 1)]);

  return (
    <div className="mt-3 rounded-[16px] border border-[color:#e5e7eb] bg-white p-3">
      <div className="flex items-center gap-2 text-[11px] text-slate-600">
        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
        <span>{label}</span>
      </div>
      <svg viewBox={`0 0 ${SMALL_CHART_WIDTH} ${SMALL_CHART_HEIGHT}`} className="mt-2 h-36 w-full">
        {Array.from({ length: 4 }).map((_, index) => {
          const y = SMALL_CHART_PADDING + ((SMALL_CHART_HEIGHT - SMALL_CHART_PADDING * 2) / 4) * index;
          return (
            <line
              key={index}
              x1={SMALL_CHART_PADDING}
              x2={SMALL_CHART_WIDTH - SMALL_CHART_PADDING}
              y1={y}
              y2={y}
              stroke="rgba(148,163,184,0.2)"
              strokeDasharray="4 6"
            />
          );
        })}
        <path d={linePath} fill="none" stroke={color} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
        {points.map((point, index) => (
          <g key={`${series[index]?.monthIso ?? index}-print-point`}>
            <circle cx={point.x} cy={point.y} r={3} fill={color} stroke="#ffffff" strokeWidth={1} />
            {labelIndexes.has(index) ? (
              <text
                x={point.x}
                y={Math.max(point.y - 10, SMALL_CHART_PADDING + 6)}
                fontSize={12}
                textAnchor="middle"
                fill="rgba(51,65,85,0.95)"
              >
                {formatValue(values[index] ?? 0)}
              </text>
            ) : null}
          </g>
        ))}
      </svg>
      <div className="mt-2 flex flex-wrap justify-between gap-2 text-[10px] text-slate-500">
        {series.map((point) => (
          <span key={point.monthIso}>{formatMonthLabel(point.monthIso)}</span>
        ))}
      </div>
    </div>
  );
}

function PrintTrendCard({
  title,
  subtitle,
  series,
  color,
  formatValue,
  note,
}: {
  title: string;
  subtitle?: string;
  series: SeriesPoint[];
  color: string;
  formatValue: (value: number) => string;
  note?: string;
}): JSX.Element {
  return (
    <PrintBlock title={title} subtitle={subtitle} note={note}>
      <PrintLineChart series={series} color={color} formatValue={formatValue} label={title} />
    </PrintBlock>
  );
}

function PrintCollectionsReport({
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
    return entry.buckets.days0to10 + entry.buckets.days11to30 + entry.buckets.days31to60 + entry.buckets.days61plus;
  });
  const agingMax = Math.max(1, ...agingTotals);
  const agingBuckets = [
    { label: '0-10', color: '#38bdf8' },
    { label: '11-30', color: '#818cf8' },
    { label: '31-60', color: '#fbbf24' },
    { label: '61+', color: '#f87171' },
  ] as const;
  const overlockDistribution = Array.isArray(latestAr?.overlockBucketShare)
    ? latestAr.overlockBucketShare.filter((bucket) => isFiniteNumber(bucket.percent))
    : [];
  const topDelinquencies = getTopDelinquencies(latestSnapshot ?? {});

  return (
    <PrintReportSection
      title="Delinquency"
      subtitle="Accounts receivable, aging, and overlock risk for the selected range."
    >
      <PrintMetricGrid
        items={[
          { label: 'Total past due', value: formatMaybeCurrency(latestAr?.totalPastDue), detail: 'All unpaid delinquent balances' },
          { label: '61+ days past due', value: formatMaybeCurrency(latestAr?.pastDue61Plus), detail: 'Oldest aging bucket only' },
          { label: 'Delinquent tenants', value: formatMaybeNumber(latestAr?.delinquentTenantCount), detail: 'Current tenant count past due' },
        ]}
        columns={3}
      />

      <div className="print-report-grid-2">
        {agingSeries.length ? (
          <PrintBlock title="AR aging trend" subtitle="Past-due dollars by bucket">
            <div className="mt-3 rounded-[16px] border border-[color:#e5e7eb] bg-white p-3">
              <div className="relative h-36">
                <div className="absolute inset-0 flex flex-col justify-between">
                  {Array.from({ length: 4 }).map((_, index) => (
                    <div key={index} className="border-t border-dashed border-[rgba(148,163,184,0.2)]" />
                  ))}
                </div>
                <div className="relative z-10 flex h-full items-end gap-2">
                  {agingSeries.map((row) => {
                    const stack = [
                      row.buckets.days0to10,
                      row.buckets.days11to30,
                      row.buckets.days31to60,
                      row.buckets.days61plus,
                    ];
                    return (
                      <div key={row.monthIso} className="flex h-full flex-1 flex-col-reverse">
                        {stack.map((value, stackIndex) => (
                          <div
                            key={`${row.monthIso}-${stackIndex}`}
                            className="history-chart-bar w-full"
                            style={{
                              height: `${(value / agingMax) * 100}%`,
                              backgroundColor: agingBuckets[stackIndex].color,
                            }}
                          />
                        ))}
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-500">
                <div className="flex flex-wrap items-center gap-3">
                  {agingBuckets.map((bucket) => (
                    <span key={bucket.label} className="inline-flex items-center gap-1">
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: bucket.color }} />
                      {bucket.label}
                    </span>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  {agingSeries.map((row) => (
                    <span key={row.monthIso}>{formatMonthLabel(row.monthIso)}</span>
                  ))}
                </div>
              </div>
            </div>
          </PrintBlock>
        ) : null}

        {overlockDistribution.length || isFiniteNumber(latestAr?.overlockTotalBalance) ? (
          <PrintBlock title="Overlock risk" subtitle="Overlocked spaces only">
            <PrintMetricGrid
              items={[
                { label: 'Overlocked units', value: formatMaybeNumber(latestAr?.overlockedUnitCount), detail: 'Subset already overlocked' },
                { label: 'Total balance', value: formatMaybeCurrency(latestAr?.overlockTotalBalance), detail: 'Balance on overlocked units only' },
                { label: 'Avg days late', value: formatMaybeNumber(latestAr?.overlockAvgDaysLate), detail: 'Average for overlocked units' },
              ]}
              columns={3}
            />
            {overlockDistribution.length ? (
              <div className="mt-3 space-y-2">
                {overlockDistribution.map((bucket) => (
                  <div key={bucket.label} className="space-y-1">
                    <div className="flex items-center justify-between text-[10px] text-slate-600">
                      <span>{bucket.label} days</span>
                      <span>{formatMaybePercent(bucket.percent, 0)}</span>
                    </div>
                    <div className="h-2 rounded-full bg-slate-200">
                      <div
                        className="h-full rounded-full bg-[rgba(59,130,246,0.75)]"
                        style={{ width: `${bucket.percent}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </PrintBlock>
        ) : null}
      </div>

      {topDelinquencies.length ? (
        <PrintBlock title="Top delinquent units" subtitle="Highest balances in the latest snapshot" className="print-report-table">
          <SimpleTable
            rows={topDelinquencies}
            columns={[
              { header: 'Tenant', accessor: (row) => row.tenant ?? 'N/A' },
              { header: 'Unit', accessor: (row) => row.unit ?? 'N/A' },
              { header: 'Days late', accessor: (row) => formatMaybeNumber(row.daysLate), align: 'right' },
              { header: 'Balance', accessor: (row) => formatMaybeCurrency(row.balance), align: 'right' },
              { header: 'Start date', accessor: (row) => formatDateValue(row.startDate) },
            ]}
            rowKey={(row, index) => `${row.tenant ?? 'tenant'}-${row.unit ?? 'unit'}-${index}`}
          />
        </PrintBlock>
      ) : null}
    </PrintReportSection>
  );
}

function PrintPricingReport({
  latestSnapshot,
  seriesEntries,
}: {
  latestSnapshot: MsrSnapshot | null;
  seriesEntries: SnapshotEntry[];
}): JSX.Element {
  const pricing = latestSnapshot?.pricing;
  const revenue = latestSnapshot?.revenue;
  const setRate = pricing?.avgSellRatePerSqftOccupied ?? pricing?.avgSellRateOccupied;
  const sellRate = pricing?.avgCurrentRentPerSqftOccupied ?? pricing?.avgCurrentRentOccupied;
  const spreadPct =
    isFiniteNumber(setRate) && isFiniteNumber(sellRate) && sellRate !== 0
      ? ((setRate - sellRate) / sellRate) * 100
      : null;
  const occupiedRateVariancePct = revenue?.occupiedRateVariancePct ?? pricing?.occupiedRateVariancePct;
  const rateSeries = seriesEntries
    .map((entry) => ({
      monthIso: entry.monthIso,
      set: entry.snapshot.pricing?.avgSellRatePerSqftOccupied ?? entry.snapshot.pricing?.avgSellRateOccupied,
      sell: entry.snapshot.pricing?.avgCurrentRentPerSqftOccupied ?? entry.snapshot.pricing?.avgCurrentRentOccupied,
    }))
    .filter((entry): entry is { monthIso: string; set: number; sell: number } => {
      return Boolean(entry.monthIso) && isFiniteNumber(entry.set) && isFiniteNumber(entry.sell);
    });
  const setSeries = rateSeries.map((entry) => ({ monthIso: entry.monthIso, value: entry.set }));
  const sellSeries = rateSeries.map((entry) => ({ monthIso: entry.monthIso, value: entry.sell }));
  const rentChangeSeries = seriesEntries
    .map((entry) => {
      const pricingEntry = entry.snapshot.pricing;
      const count =
        isFiniteNumber(pricingEntry?.rentChangeCount) ? pricingEntry?.rentChangeCount : pricingEntry?.rentChangeCountMtd;
      const pct01 = toPct01(pricingEntry?.avgRentChangePct);
      return {
        monthIso: entry.monthIso,
        count: isFiniteNumber(count) ? count : null,
        pct: isFiniteNumber(pct01) ? pct01 * 100 : null,
      };
    })
    .filter((entry) => Boolean(entry.monthIso));
  const rentChangeCountSeries = rentChangeSeries.flatMap((entry) =>
    isFiniteNumber(entry.count) && entry.monthIso ? [{ monthIso: entry.monthIso, value: entry.count }] : [],
  );
  const rentChangePctSeries = rentChangeSeries.flatMap((entry) =>
    isFiniteNumber(entry.pct) && entry.monthIso ? [{ monthIso: entry.monthIso, value: entry.pct }] : [],
  );
  const staleRentByType = pricing?.noRentChange12MoByType ?? null;
  const staleRentEntries = staleRentByType ? Object.entries(staleRentByType) : [];
  const staleRentTotal = staleRentEntries.reduce((sum, [, value]) => sum + (isFiniteNumber(value) ? value : 0), 0);
  const staleRentCount = pricing?.noRentChange12MoCount;
  const staleUnits =
    isFiniteNumber(staleRentCount) && staleRentCount >= 0 ? staleRentCount : staleRentTotal > 0 ? staleRentTotal : null;
  const totalUnits =
    isFiniteNumber(latestSnapshot?.occupancy?.occupiedCount)
      ? latestSnapshot?.occupancy?.occupiedCount
      : isFiniteNumber(latestSnapshot?.occupancy?.totalCount)
        ? latestSnapshot?.occupancy?.totalCount
        : null;
  const stalePct =
    isFiniteNumber(staleUnits) && isFiniteNumber(totalUnits) && totalUnits > 0 ? (staleUnits / totalUnits) * 100 : null;
  const staleSegments = staleRentEntries
    .map(([label, value]) => ({ label, value: isFiniteNumber(value) ? value : 0 }))
    .filter((entry) => entry.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 5);
  const showRentChange = rentChangeCountSeries.length > 0 || rentChangePctSeries.length > 0;
  const showStaleRent = !showRentChange && staleSegments.length > 0;

  return (
    <PrintReportSection
      title="Pricing & Revenue"
      subtitle="Rate positioning, revenue snapshot, and one supporting pricing drilldown."
    >
      <div className="print-report-grid-2">
        {setSeries.length && sellSeries.length ? (
          <PrintBlock title="GPR rate vs sell rate" subtitle="Rate comparison over time">
            <div className="mt-3">
              <PrintMetricGrid
                items={[
                  { label: 'GPR rate ($/sqft)', value: formatMaybeCurrencyPerSqft(setRate) },
                  { label: 'Sell rate ($/sqft)', value: formatMaybeCurrencyPerSqft(sellRate) },
                  { label: 'Delta percent', value: formatMaybePercent(spreadPct, 1) },
                ]}
                columns={3}
              />
            </div>
            <div className="mt-2 text-[11px] text-slate-500">GPR is Gross Potential Rate.</div>
            <div className="mt-3 print-report-grid-2">
              <PrintLineChart series={setSeries} color="rgba(37,99,235,0.9)" formatValue={formatMaybeCurrencyPerSqft} label="GPR rate" />
              <PrintLineChart series={sellSeries} color="rgba(14,165,233,0.9)" formatValue={formatMaybeCurrencyPerSqft} label="Sell rate" />
            </div>
          </PrintBlock>
        ) : null}

        <PrintBlock title="Revenue statistics" subtitle="Latest snapshot">
          <PrintMetricGrid
            items={[
              { label: 'Gross potential revenue', value: formatMaybeCurrency(revenue?.grossPotentialRevenue) },
              { label: 'Projected rent', value: formatMaybeCurrency(revenue?.economicOccupancy) },
              { label: 'Occupied rate variance', value: formatMaybePercent(occupiedRateVariancePct, 1) },
              { label: 'Net revenue', value: formatMaybeCurrency(revenue?.netRevenueMtd) },
            ]}
            columns={4}
          />
        </PrintBlock>
      </div>

      <div className="print-report-grid-2">
        <PrintBlock title="Rent analysis" subtitle="Rate spread summary">
          <PrintMetricGrid
            items={[
              { label: 'GPR - sell (%)', value: formatMaybePercent(spreadPct, 1), detail: 'Relative spread from current rates' },
              {
                label: 'GPR - sell ($)',
                value: isFiniteNumber(setRate) && isFiniteNumber(sellRate) ? formatMaybeCurrency(setRate - sellRate) : 'N/A',
                detail: 'Absolute spread between rate metrics',
              },
              { label: 'Occupied rate variance', value: formatMaybePercent(occupiedRateVariancePct, 1), detail: 'Variance vs target occupancy' },
            ]}
            columns={3}
          />
        </PrintBlock>

        {showRentChange ? (
          <PrintBlock title="Rent change activity" subtitle="Selected pricing drilldown">
            <PrintMetricGrid
              items={[
                {
                  label: 'Rent changes',
                  value:
                    isFiniteNumber(pricing?.rentChangeCountMtd) || isFiniteNumber(pricing?.rentChangeCount)
                      ? formatMaybeNumber(pricing?.rentChangeCountMtd ?? pricing?.rentChangeCount)
                      : 'N/A',
                },
                { label: 'Avg change %', value: formatMaybePercent(pricing?.avgRentChangePct, 1) },
              ]}
              columns={2}
            />
            <div className="mt-3 print-report-grid-2">
              {rentChangeCountSeries.length ? (
                <PrintLineChart
                  series={rentChangeCountSeries}
                  color="rgba(37,99,235,0.85)"
                  formatValue={formatMaybeNumber}
                  label="Rent change count"
                />
              ) : null}
              {rentChangePctSeries.length ? (
                <PrintLineChart
                  series={rentChangePctSeries}
                  color="rgba(99,102,241,0.85)"
                  formatValue={(value) => formatMaybePercent(value, 1)}
                  label="Average change %"
                />
              ) : null}
            </div>
          </PrintBlock>
        ) : showStaleRent ? (
          <PrintBlock title="Stale rent exposure" subtitle="Units with no ECRI in 12 months">
            <PrintMetricGrid
              items={[
                { label: 'Stale units', value: formatMaybeNumber(staleUnits), detail: isFiniteNumber(stalePct) ? `${formatPercent(stalePct, 1)} of total` : undefined },
                { label: 'Total units', value: formatMaybeNumber(totalUnits) },
              ]}
              columns={2}
            />
            <div className="mt-3 space-y-2">
              {staleSegments.map((segment) => (
                <div key={segment.label} className="flex items-center justify-between border-b border-slate-200 pb-1 text-[11px] text-slate-600">
                  <span>{segment.label}</span>
                  <span>
                    {formatMaybeNumber(segment.value)} ({formatMaybePercent((segment.value / Math.max(staleRentTotal, 1)) * 100, 0)})
                  </span>
                </div>
              ))}
            </div>
          </PrintBlock>
        ) : null}
      </div>
    </PrintReportSection>
  );
}

function PrintOperationsReport({
  latestSnapshot,
  seriesEntries,
}: {
  latestSnapshot: MsrSnapshot | null;
  seriesEntries: SnapshotEntry[];
}): JSX.Element {
  const occupancySeries = buildSeries(seriesEntries, (snapshot) => snapshot.occupancy?.rsfOccPct);
  const sellRateSeries = buildSeries(
    seriesEntries,
    (snapshot) => snapshot.pricing?.avgCurrentRentPerSqftOccupied ?? snapshot.pricing?.avgCurrentRentOccupied,
  );
  const moveInsSeries = buildSeries(seriesEntries, (snapshot) => snapshot.rentals?.moveInsMtd);
  const moveOutsSeries = buildSeries(seriesEntries, (snapshot) => snapshot.rentals?.moveOutsMtd);
  const netRentalsSeries = seriesEntries
    .map((entry) => {
      const rentals = entry.snapshot.rentals;
      const netValue =
        isFiniteNumber(rentals?.netMtd)
          ? rentals?.netMtd
          : isFiniteNumber(rentals?.moveInsMtd) && isFiniteNumber(rentals?.moveOutsMtd)
            ? Number(rentals?.moveInsMtd ?? 0) - Number(rentals?.moveOutsMtd ?? 0)
            : null;
      return Boolean(entry.monthIso) && isFiniteNumber(netValue) ? { monthIso: entry.monthIso!, value: netValue } : null;
    })
    .filter((entry): entry is SeriesPoint => Boolean(entry));
  const latestMoveIns = latestSnapshot?.rentals?.moveInsMtd;
  const latestMoveOuts = latestSnapshot?.rentals?.moveOutsMtd;
  const latestNetRentals =
    isFiniteNumber(latestSnapshot?.rentals?.netMtd)
      ? latestSnapshot?.rentals?.netMtd
      : isFiniteNumber(latestMoveIns) && isFiniteNumber(latestMoveOuts)
        ? Number(latestMoveIns ?? 0) - Number(latestMoveOuts ?? 0)
        : null;
  const latestOccupancy = occupancySeries.length ? occupancySeries[occupancySeries.length - 1].value : null;
  const latestSellRate = sellRateSeries.length ? sellRateSeries[sellRateSeries.length - 1].value : null;
  const channelData = latestSnapshot?.leads?.byChannelMtd ?? {};
  const channelTotals = [
    { label: 'Web', value: isFiniteNumber(channelData.web) ? channelData.web : 0, color: 'rgba(37,99,235,0.72)' },
    { label: 'Phone', value: isFiniteNumber(channelData.phone) ? channelData.phone : 0, color: 'rgba(14,165,233,0.7)' },
    { label: 'Walk-in', value: isFiniteNumber(channelData.walkIn) ? channelData.walkIn : 0, color: 'rgba(129,140,248,0.68)' },
    { label: 'Other', value: isFiniteNumber(channelData.other) ? channelData.other : 0, color: 'rgba(245,158,11,0.68)' },
  ];
  const channelSum = channelTotals.reduce((sum, entry) => sum + entry.value, 0);
  const leadsTotal = isFiniteNumber(latestSnapshot?.leads?.totalMtd) ? latestSnapshot?.leads?.totalMtd : channelSum || null;
  const conversionPct =
    isFiniteNumber(leadsTotal) && isFiniteNumber(latestMoveIns) && leadsTotal > 0 ? (latestMoveIns / leadsTotal) * 100 : null;
  const conversionSeries = seriesEntries
    .map((entry) => {
      const totalLeads = entry.snapshot.leads?.totalMtd;
      const moveIns = entry.snapshot.rentals?.moveInsMtd;
      if (!entry.monthIso || !isFiniteNumber(totalLeads) || !isFiniteNumber(moveIns) || totalLeads <= 0) return null;
      return { monthIso: entry.monthIso, value: (moveIns / totalLeads) * 100 };
    })
    .filter((entry): entry is SeriesPoint => Boolean(entry));
  const unitMix = latestSnapshot?.unitMix;
  const occupiedByType = unitMix?.occupiedRsfByType ?? {};
  const totalOccupiedRsf = isFiniteNumber(unitMix?.totalOccupiedRsf)
    ? unitMix?.totalOccupiedRsf
    : Object.values(occupiedByType).reduce((sum, value) => sum + (isFiniteNumber(value) ? value : 0), 0);
  const unitMixSegments = Object.entries(occupiedByType)
    .filter(([, value]) => isFiniteNumber(value) && value > 0)
    .map(([label, value], index) => ({
      label,
      percent: totalOccupiedRsf > 0 ? (Number(value) / totalOccupiedRsf) * 100 : 0,
      color: UNIT_MIX_COLORS[index % UNIT_MIX_COLORS.length],
    }))
    .sort((a, b) => b.percent - a.percent);

  return (
    <PrintReportSection title="Operations" subtitle="Occupancy, rental velocity, demand funnel, and latest unit mix.">
      <div className="print-report-grid-2">
        <PrintBlock title="Occupancy & unit mix" subtitle="Current occupancy, sell rate, and mix">
          <PrintMetricGrid
            items={[
              { label: 'Occupancy (RSF)', value: formatMaybePercent(latestOccupancy), detail: 'Latest occupancy snapshot' },
              { label: 'Sell rate', value: formatMaybeCurrencyPerSqft(latestSellRate), detail: 'Latest occupied sell rate' },
              { label: 'Occupied RSF', value: isFiniteNumber(totalOccupiedRsf) ? formatMaybeNumber(totalOccupiedRsf) : 'N/A', detail: 'Occupied square footage' },
            ]}
            columns={3}
          />
          <div className="mt-3 print-report-grid-2">
            {occupancySeries.length ? (
              <PrintLineChart
                series={occupancySeries}
                color="rgba(37,99,235,0.9)"
                formatValue={(value) => formatPercent(value, 1)}
                label="Occupancy (RSF)"
              />
            ) : null}
            {sellRateSeries.length ? (
              <PrintLineChart
                series={sellRateSeries}
                color="rgba(14,165,233,0.9)"
                formatValue={formatMaybeCurrencyPerSqft}
                label="Sell rate"
              />
            ) : null}
          </div>
          {unitMixSegments.length ? (
            <div className="mt-3 space-y-2">
              {unitMixSegments.map((segment) => (
                <div key={segment.label} className="flex items-center justify-between border-b border-slate-200 pb-1 text-[11px] text-slate-600">
                  <span className="inline-flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: segment.color }} />
                    {segment.label}
                  </span>
                  <span>{formatMaybePercent(segment.percent, 0)}</span>
                </div>
              ))}
            </div>
          ) : null}
        </PrintBlock>

        <PrintBlock title="Rental statistics" subtitle="Move-ins, move-outs, and net rentals">
          <PrintMetricGrid
            items={[
              { label: 'Move-ins', value: formatMaybeNumber(latestMoveIns) },
              { label: 'Move-outs', value: formatMaybeNumber(latestMoveOuts) },
              { label: 'Net rentals', value: formatSignedNumber(latestNetRentals) },
            ]}
            columns={3}
          />
          <div className="mt-3 print-report-grid-3">
            {moveInsSeries.length ? (
              <PrintLineChart series={moveInsSeries} color="rgba(37,99,235,0.88)" formatValue={formatMaybeNumber} label="Move-ins" />
            ) : null}
            {moveOutsSeries.length ? (
              <PrintLineChart series={moveOutsSeries} color="rgba(248,113,113,0.84)" formatValue={formatMaybeNumber} label="Move-outs" />
            ) : null}
            {netRentalsSeries.length ? (
              <PrintLineChart series={netRentalsSeries} color="rgba(16,185,129,0.9)" formatValue={formatSignedNumber} label="Net rentals" />
            ) : null}
          </div>
        </PrintBlock>
      </div>

      {(channelSum > 0 || conversionSeries.length > 0) ? (
        <div className="print-report-grid-2">
          {channelSum > 0 ? (
            <PrintBlock title="Demand funnel" subtitle="Lead sources in the latest snapshot">
              <PrintMetricGrid
                items={[
                  { label: 'Total leads', value: formatMaybeNumber(leadsTotal) },
                  { label: 'Move-ins', value: formatMaybeNumber(latestMoveIns) },
                  { label: 'Conversion %', value: formatMaybePercent(conversionPct, 1) },
                ]}
                columns={3}
              />
              <div className="mt-3 rounded-[16px] border border-[color:#e5e7eb] bg-white p-3">
                <div className="flex h-32 items-end gap-3">
                  {channelTotals.map((channel) => (
                    <div key={channel.label} className="flex flex-1 flex-col items-center gap-2">
                      <div className="flex h-24 w-full items-end">
                        <div
                          className="history-chart-bar w-full rounded-t-md"
                          style={{
                            height: `${channelSum > 0 ? (channel.value / channelSum) * 100 : 0}%`,
                            backgroundColor: channel.color,
                          }}
                        />
                      </div>
                      <div className="text-center text-[10px] text-slate-600">
                        <div>{channel.label}</div>
                        <div>{formatMaybeNumber(channel.value)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </PrintBlock>
          ) : null}
          {conversionSeries.length ? (
            <PrintTrendCard
              title="Conversion rate"
              subtitle="Move-ins vs leads"
              series={conversionSeries}
              color="rgba(37,99,235,0.9)"
              formatValue={(value) => formatPercent(value, 1)}
            />
          ) : null}
        </div>
      ) : null}
    </PrintReportSection>
  );
}

function PrintFinancialsReport({
  latestSnapshot,
  seriesEntries,
  laggedFinancialSeriesEntries,
}: {
  latestSnapshot: MsrSnapshot | null;
  seriesEntries: SnapshotEntry[];
  laggedFinancialSeriesEntries: SnapshotEntry[];
}): JSX.Element {
  const netRevenueSeries = buildSeries(seriesEntries, (snapshot) => getSnapshotNumber(snapshot, NET_REVENUE_VALUE_PATHS));
  const expensesSeries = buildSeries(laggedFinancialSeriesEntries, (snapshot) => getSnapshotNumber(snapshot, EXPENSES_VALUE_PATHS));
  const noiSeries = laggedFinancialSeriesEntries.flatMap((entry) => {
    if (!entry.monthIso) return [];
    const netRevenue = getSnapshotNumber(entry.snapshot, NET_REVENUE_VALUE_PATHS);
    const expenses = getSnapshotNumber(entry.snapshot, EXPENSES_VALUE_PATHS);
    const directNoi = getSnapshotNumber(entry.snapshot, NOI_VALUE_PATHS);
    const noi =
      isFiniteNumber(directNoi)
        ? directNoi
        : isFiniteNumber(netRevenue) && isFiniteNumber(expenses)
          ? netRevenue - expenses
          : null;
    return isFiniteNumber(noi) ? [{ monthIso: entry.monthIso, value: noi }] : [];
  });
  const concessionsSeries = buildSeries(seriesEntries, (snapshot) => snapshot.concessions?.promosDiscountsMtd);
  const creditsSeries = buildSeries(seriesEntries, (snapshot) => snapshot.concessions?.creditsAdjustmentsMtd);
  const refundsSeries = buildSeries(seriesEntries, (snapshot) => snapshot.concessions?.refundsWriteoffsMtd);
  const latestNetRevenue =
    (latestSnapshot ? getSnapshotNumber(latestSnapshot, NET_REVENUE_VALUE_PATHS) : null) ?? getLatestSeriesValue(netRevenueSeries);
  const latestExpenses =
    (latestSnapshot ? getSnapshotNumber(latestSnapshot, EXPENSES_VALUE_PATHS) : null) ?? getLatestSeriesValue(expensesSeries);
  const directLatestNoi =
    (latestSnapshot ? getSnapshotNumber(latestSnapshot, NOI_VALUE_PATHS) : null) ?? getLatestSeriesValue(noiSeries);
  const latestNoi =
    isFiniteNumber(directLatestNoi)
      ? directLatestNoi
      : isFiniteNumber(latestNetRevenue) && isFiniteNumber(latestExpenses)
        ? latestNetRevenue - latestExpenses
        : null;
  const marginPct =
    isFiniteNumber(latestNoi) && isFiniteNumber(latestNetRevenue) && latestNetRevenue !== 0 ? (latestNoi / latestNetRevenue) * 100 : null;

  return (
    <PrintReportSection title="Financials" subtitle="Revenue, expenses, NOI, and allowance trends.">
      <PrintMetricGrid
        items={[
          { label: 'Net revenue', value: formatMaybeCurrency(latestNetRevenue), detail: 'Current month-to-date' },
          { label: 'Expenses', value: formatMaybeCurrency(latestExpenses), detail: 'Updated monthly; prior month close' },
          { label: 'NOI', value: formatMaybeCurrency(latestNoi), detail: 'Updated monthly; prior month close' },
          { label: 'NOI margin', value: formatMaybePercent(marginPct, 1), detail: 'NOI divided by net revenue' },
        ]}
        columns={4}
      />

      <div className="print-report-grid-3">
        {netRevenueSeries.length ? (
          <PrintTrendCard
            title="Net revenue"
            subtitle="Monthly trend"
            series={netRevenueSeries}
            color="rgba(14,165,233,0.9)"
            formatValue={formatCompactCurrency}
          />
        ) : null}
        {expensesSeries.length ? (
          <PrintTrendCard
            title="Expenses"
            subtitle="Monthly trend"
            series={expensesSeries}
            color="rgba(248,113,113,0.86)"
            formatValue={formatCompactCurrency}
            note="Expenses are intentionally lagged one month to align with monthly close timing."
          />
        ) : null}
        {noiSeries.length ? (
          <PrintTrendCard
            title="NOI"
            subtitle="Monthly trend"
            series={noiSeries}
            color="rgba(16,185,129,0.9)"
            formatValue={formatCompactCurrency}
            note="NOI is intentionally lagged one month to align with monthly close timing."
          />
        ) : null}
      </div>

      {(concessionsSeries.length || creditsSeries.length || refundsSeries.length) ? (
        <PrintReportSection title="Allowances" subtitle="Concessions and leakage trends." pageBreakBefore>
          <PrintMetricGrid
            items={[
              { label: 'Promos', value: formatMaybeCurrency(latestSnapshot?.concessions?.promosDiscountsMtd) },
              { label: 'Credits', value: formatMaybeCurrency(latestSnapshot?.concessions?.creditsAdjustmentsMtd) },
              { label: 'Refunds + write-offs', value: formatMaybeCurrency(latestSnapshot?.concessions?.refundsWriteoffsMtd) },
            ]}
            columns={3}
          />
          <div className="print-report-grid-3">
            {concessionsSeries.length ? (
              <PrintTrendCard
                title="Promos and discounts"
                subtitle="Monthly trend"
                series={concessionsSeries}
                color="rgba(37,99,235,0.85)"
                formatValue={formatCompactCurrency}
              />
            ) : null}
            {creditsSeries.length ? (
              <PrintTrendCard
                title="Credits and adjustments"
                subtitle="Monthly trend"
                series={creditsSeries}
                color="rgba(14,165,233,0.85)"
                formatValue={formatCompactCurrency}
              />
            ) : null}
            {refundsSeries.length ? (
              <PrintTrendCard
                title="Refunds + write-offs"
                subtitle="Monthly trend"
                series={refundsSeries}
                color="rgba(248,113,113,0.8)"
                formatValue={formatCompactCurrency}
              />
            ) : null}
          </div>
        </PrintReportSection>
      ) : null}
    </PrintReportSection>
  );
}

function LineChartWithMonths({
  series,
  color,
  label,
  formatValue,
  labelColor,
  emphasizeTrend,
}: {
  series: SeriesPoint[];
  color: string;
  label: string;
  formatValue: (value: number) => string;
  labelColor?: string;
  emphasizeTrend?: boolean;
}): JSX.Element {
  const values = series.map((point) => point.value);
  const points = getChartPoints(values, SMALL_CHART_WIDTH, SMALL_CHART_HEIGHT, SMALL_CHART_PADDING);
  const linePath = buildLinePath(points);
  const trendDelta = values.length > 1 ? values[values.length - 1] - values[0] : 0;
  const trendUp = values.length > 1 ? trendDelta >= 0 : false;
  const lastPoint = points[points.length - 1] ?? null;
  const plotBottomY = SMALL_CHART_HEIGHT - SMALL_CHART_PADDING;
  const monthLabelY = SMALL_CHART_HEIGHT - 6;

  return (
    <div className="relative rounded-[22px] border border-[color:var(--border-soft)] bg-[color:var(--surface)] p-4 shadow-inner">
      {emphasizeTrend ? (
        <div className="pointer-events-none absolute inset-0 rounded-[22px] bg-[linear-gradient(135deg,rgba(37,99,235,0.18),transparent_55%)]" />
      ) : null}
      {emphasizeTrend && trendUp ? (
        <div className="pointer-events-none absolute right-4 top-4 text-[10px] font-semibold text-[color:var(--text-secondary)]">
          <span className="inline-flex items-center gap-1 rounded-full bg-[color:var(--surface-subtle)] px-2 py-1 shadow-inner">
            <svg viewBox="0 0 24 24" className="h-3 w-3" aria-hidden="true" focusable="false">
              <path
                d="M6 16l6-6 4 4 4-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Trend
          </span>
        </div>
      ) : null}
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
        <line
          x1={SMALL_CHART_PADDING}
          x2={SMALL_CHART_WIDTH - SMALL_CHART_PADDING}
          y1={plotBottomY}
          y2={plotBottomY}
          stroke="rgba(148,163,255,0.24)"
        />
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
        {emphasizeTrend && lastPoint ? (
          <circle
            cx={lastPoint.x}
            cy={lastPoint.y}
            r={6}
            fill="none"
            stroke="rgba(37,99,235,0.85)"
            strokeWidth={2}
          />
        ) : null}
        {points.map((point, index) => {
          const value = values[index];
          const labelText = formatValue(value);
          const labelY = Math.max(point.y - 10, SMALL_CHART_PADDING + 6);
          const isLastPoint = index === points.length - 1;
          const labelX = isLastPoint ? Math.max(SMALL_CHART_PADDING + 28, point.x - 10) : point.x;
          const textAnchor = isLastPoint ? 'end' : 'middle';
          return (
            <g key={`${series[index]?.monthIso ?? index}-point`}>
              <circle cx={point.x} cy={point.y} r={3.5} fill={color} stroke="#ffffff" strokeWidth={1.2} />
              {labelText ? (
                <text
                  x={labelX}
                  y={labelY}
                  fontSize={14}
                  textAnchor={textAnchor}
                  fill={labelColor ?? 'rgba(71,85,105,0.9)'}
                >
                  {labelText}
                </text>
              ) : null}
            </g>
          );
        })}
        {points.map((point, index) => {
          const monthIso = series[index]?.monthIso;
          if (!monthIso) return null;
          return (
            <text
              key={`${monthIso}-axis`}
              x={point.x}
              y={monthLabelY}
              fontSize={11}
              textAnchor="middle"
              fill={labelColor ?? 'var(--text-primary)'}
            >
              {formatMonthLabel(monthIso)}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

const MemoLineChartWithMonths = memo(LineChartWithMonths);
const MemoCollectionsSection = memo(CollectionsSection);
const MemoPricingSection = memo(PricingSection);
const MemoOperationalSection = memo(OperationalSection);
const MemoFinancialsSection = memo(FinancialsSection);
