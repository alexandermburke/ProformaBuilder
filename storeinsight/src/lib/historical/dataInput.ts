import {
  getHistoricalPlaceholder,
  RANGE_KEYS,
  type HistoricalPlaceholderData,
  type RangeKey,
} from '@/lib/historical/placeholder';
import { MOM_SERIES_BY_PROPERTY, type MoMSeries } from '@/lib/flash/momSeries';

export type HistoricalDataByRange = Record<RangeKey, HistoricalPlaceholderData>;

export type HistoricalDataBundle = {
  historicalByRange: HistoricalDataByRange;
  momSeriesByProperty?: Record<string, MoMSeries>;
};

export const HISTORICAL_DATA_STORAGE_KEY = 'storeinsight:historical-data-input';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const hasHistoricalShape = (value: unknown): value is HistoricalPlaceholderData => {
  if (!isRecord(value)) return false;
  const { series, tables, metrics } = value;
  if (!isRecord(series) || !isRecord(tables) || !isRecord(metrics)) return false;
  const seriesKeys = ['arAging', 'pricing', 'demand', 'concessions', 'autopay', 'inventory'] as const;
  const tableKeys = ['topDelinquencies', 'staleRentExposure', 'vacantUnits'] as const;
  if (!seriesKeys.every((key) => Array.isArray(series[key]))) return false;
  if (!tableKeys.every((key) => Array.isArray(tables[key]))) return false;
  return true;
};

const coerceHistoricalByRange = (value: unknown): HistoricalDataByRange | null => {
  if (!isRecord(value)) return null;
  const result: Partial<HistoricalDataByRange> = {};
  for (const key of RANGE_KEYS) {
    const entry = value[key];
    if (!hasHistoricalShape(entry)) return null;
    result[key] = entry as HistoricalPlaceholderData;
  }
  return result as HistoricalDataByRange;
};

const normalizeMoMSeries = (series: MoMSeries): MoMSeries => {
  const minLength = Math.min(
    series.months.length,
    series.grossAccruedRent.length,
    series.occupiedPct.length,
  );
  return {
    months: series.months.slice(0, minLength),
    grossAccruedRent: series.grossAccruedRent.slice(0, minLength),
    occupiedPct: series.occupiedPct.slice(0, minLength),
  };
};

const normalizeMoMSeriesMap = (value: unknown): Record<string, MoMSeries> => {
  if (!isRecord(value)) return {};
  const result: Record<string, MoMSeries> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!isRecord(entry)) continue;
    if (!Array.isArray(entry.months) || !Array.isArray(entry.grossAccruedRent) || !Array.isArray(entry.occupiedPct)) {
      continue;
    }
    result[key] = normalizeMoMSeries(entry as MoMSeries);
  }
  return result;
};

export const getHistoricalTemplatePayload = (): HistoricalDataBundle => ({
  historicalByRange: {
    '3M': getHistoricalPlaceholder('3M'),
    '6M': getHistoricalPlaceholder('6M'),
    '12M': getHistoricalPlaceholder('12M'),
  },
  momSeriesByProperty: MOM_SERIES_BY_PROPERTY,
});

export const parseHistoricalInput = (raw: string): { data?: HistoricalDataBundle; error?: string } => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { error: 'Invalid JSON. Ensure the payload is valid JSON.' };
  }
  if (!isRecord(parsed)) return { error: 'Top-level payload must be an object.' };
  const payload = parsed as Record<string, unknown>;

  const directHistorical = hasHistoricalShape(payload)
    ? {
        '3M': payload as HistoricalPlaceholderData,
        '6M': payload as HistoricalPlaceholderData,
        '12M': payload as HistoricalPlaceholderData,
      }
    : null;

  const historicalByRange =
    coerceHistoricalByRange(payload.historicalByRange) ??
    coerceHistoricalByRange(payload.ranges) ??
    (RANGE_KEYS.every((key) => key in payload) ? coerceHistoricalByRange(payload) : null) ??
    directHistorical;

  if (!historicalByRange) {
    return {
      error: 'historicalByRange must include 3M, 6M, and 12M datasets with series, tables, and metrics.',
    };
  }

  const momSeriesByProperty = normalizeMoMSeriesMap(payload.momSeriesByProperty);

  return {
    data: {
      historicalByRange,
      momSeriesByProperty: Object.keys(momSeriesByProperty).length ? momSeriesByProperty : undefined,
    },
  };
};
