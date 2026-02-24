import {
  getHistoricalPlaceholder,
  RANGE_KEYS,
  type HistoricalPlaceholderData,
  type RangeKey,
} from '@/lib/historical/placeholder';
import type { MoMSeries } from '@/lib/flash/momSeries';

export type HistoricalDataByRange = Record<RangeKey, HistoricalPlaceholderData>;

export type HistoricalDataBundle = {
  historicalByRange: HistoricalDataByRange;
  momSeriesByProperty?: Record<string, MoMSeries>;
};

export type PropertyHistoricalPayload = {
  historicalByRange: HistoricalDataByRange;
  momSeries?: MoMSeries;
};

export type PropertyHistoricalValidationResult = {
  ok: boolean;
  errors: string[];
  warnings: string[];
  summary: {
    rangeMonthCounts: Record<RangeKey, number>;
    momSeriesLength?: number;
  };
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
    '1Y': getHistoricalPlaceholder('1Y'),
    '2Y': getHistoricalPlaceholder('2Y'),
  },
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
        '1Y': payload as HistoricalPlaceholderData,
        '2Y': payload as HistoricalPlaceholderData,
      }
    : null;

  const historicalByRange =
    coerceHistoricalByRange(payload.historicalByRange) ??
    coerceHistoricalByRange(payload.ranges) ??
    (RANGE_KEYS.every((key) => key in payload) ? coerceHistoricalByRange(payload) : null) ??
    directHistorical;

  if (!historicalByRange) {
    return {
      error: 'historicalByRange must include 3M, 6M, 1Y, and 2Y datasets with series, tables, and metrics.',
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

const normalizeMoMSeriesValue = (value: unknown): MoMSeries | undefined => {
  if (!isRecord(value)) return undefined;
  if (!Array.isArray(value.months) || !Array.isArray(value.grossAccruedRent) || !Array.isArray(value.occupiedPct)) {
    return undefined;
  }
  return normalizeMoMSeries(value as MoMSeries);
};

export const parsePropertyHistoricalInput = (
  raw: string,
  propertyId?: string,
): { data?: PropertyHistoricalPayload; error?: string } => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { error: 'Invalid JSON. Ensure the payload is valid JSON.' };
  }
  if (!isRecord(parsed)) return { error: 'Top-level payload must be an object.' };
  const payload = parsed as Record<string, unknown>;

  const historicalByRange =
    coerceHistoricalByRange(payload.historicalByRange) ??
    coerceHistoricalByRange(payload.ranges) ??
    (RANGE_KEYS.every((key) => key in payload) ? coerceHistoricalByRange(payload) : null) ??
    (hasHistoricalShape(payload)
      ? {
          '3M': payload as HistoricalPlaceholderData,
          '6M': payload as HistoricalPlaceholderData,
          '1Y': payload as HistoricalPlaceholderData,
          '2Y': payload as HistoricalPlaceholderData,
        }
      : null);

  if (!historicalByRange) {
    return {
      error: 'historicalByRange must include 3M, 6M, 1Y, and 2Y datasets with series, tables, and metrics.',
    };
  }

  const momSeriesDirect = normalizeMoMSeriesValue(payload.momSeries);
  const momSeriesByProperty = normalizeMoMSeriesMap(payload.momSeriesByProperty);
  const momSeries =
    momSeriesDirect ||
    (propertyId ? momSeriesByProperty[propertyId] : undefined) ||
    (Object.keys(momSeriesByProperty).length === 1 ? Object.values(momSeriesByProperty)[0] : undefined);

  return {
    data: {
      historicalByRange,
      momSeries,
    },
  };
};

export const validatePropertyHistoricalPayload = (
  payload: PropertyHistoricalPayload,
): PropertyHistoricalValidationResult => {
  const errors: string[] = [];
  const warnings: string[] = [];
  const rangeMonthCounts = {} as Record<RangeKey, number>;
  const seriesKeys = ['arAging', 'pricing', 'demand', 'concessions', 'autopay', 'inventory'] as const;
  const tableKeys = ['topDelinquencies', 'staleRentExposure', 'vacantUnits'] as const;

  for (const range of RANGE_KEYS) {
    const rangeData = payload.historicalByRange[range];
    if (!rangeData) {
      errors.push(`Missing ${range} data.`);
      rangeMonthCounts[range] = 0;
      continue;
    }
    const series = rangeData.series as Record<string, Array<{ month?: string }>>;
    let baselineMonths: string[] = [];
    for (const key of seriesKeys) {
      const rows = series[key];
      if (!Array.isArray(rows)) {
        errors.push(`${range} series.${key} must be an array.`);
        continue;
      }
      if (!baselineMonths.length && rows.length) {
        baselineMonths = rows.map((row) => row?.month ?? '').filter(Boolean);
      }
    }
    rangeMonthCounts[range] = baselineMonths.length;

    if (!baselineMonths.length) {
      warnings.push(`${range} has no month entries across series.`);
    }

    for (const key of seriesKeys) {
      const rows = series[key];
      if (!Array.isArray(rows)) continue;
      if (baselineMonths.length && rows.length !== baselineMonths.length) {
        errors.push(`${range} series.${key} length ${rows.length} does not match ${baselineMonths.length}.`);
      }
      rows.forEach((row, index) => {
        if (!row?.month || typeof row.month !== 'string') {
          errors.push(`${range} series.${key}[${index}] is missing a month string.`);
          return;
        }
        if (baselineMonths[index] && row.month !== baselineMonths[index]) {
          errors.push(`${range} series.${key}[${index}] month ${row.month} does not match ${baselineMonths[index]}.`);
        }
      });
    }

    const tables = rangeData.tables as Record<string, unknown>;
    for (const key of tableKeys) {
      if (!Array.isArray(tables?.[key])) {
        errors.push(`${range} tables.${key} must be an array.`);
      }
    }
  }

  if (payload.momSeries) {
    const { months, grossAccruedRent, occupiedPct } = payload.momSeries;
    if (!Array.isArray(months) || !Array.isArray(grossAccruedRent) || !Array.isArray(occupiedPct)) {
      errors.push('momSeries must include months, grossAccruedRent, and occupiedPct arrays.');
    } else {
      const minLength = Math.min(months.length, grossAccruedRent.length, occupiedPct.length);
      if (months.length !== grossAccruedRent.length || months.length !== occupiedPct.length) {
        errors.push('momSeries arrays must be the same length.');
      }
      if (minLength === 0) {
        warnings.push('momSeries arrays are empty.');
      }
      if (minLength > 0 && !months.every((value) => typeof value === 'string' && value.trim())) {
        errors.push('momSeries.months must contain YYYY-MM strings.');
      }
      rangeMonthCounts['1Y'] = rangeMonthCounts['1Y'] ?? 0;
    }
  } else {
    warnings.push('momSeries is missing; overview charts will not render.');
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    summary: {
      rangeMonthCounts,
      momSeriesLength: payload.momSeries?.months?.length,
    },
  };
};
