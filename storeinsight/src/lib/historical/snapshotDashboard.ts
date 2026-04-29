import type { PropertyConfig } from '@/types/dailySummary';
import type {
  HistoricalPropertyOption,
  HistoricalSnapshotRangeKey,
  HistoricalSnapshotRangeOption,
  MsrSnapshot,
} from '@/lib/historical/dashboardTypes';

type LegacyPropertyOption = {
  id: string;
  label: string;
  city: string;
};

type RangeLikeEntry = {
  monthIso: string | null;
  monthKey: number | null;
  index: number;
};

const normalizeKey = (value: string): string => value.trim().toLowerCase();

const normalizeLabel = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const uniqueNonEmpty = (values: Array<string | null | undefined>): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];

  values.forEach((value) => {
    const trimmed = value?.trim();
    if (!trimmed) return;
    const normalized = normalizeKey(trimmed);
    if (seen.has(normalized)) return;
    seen.add(normalized);
    result.push(trimmed);
  });

  return result;
};

export const TOKEN_SNAPSHOT_RANGE_OPTIONS: HistoricalSnapshotRangeOption[] = [
  { key: '3M', label: '3M', months: 3 },
  { key: '6M', label: '6M', months: 6 },
];

export const INTERNAL_SNAPSHOT_RANGE_OPTIONS: HistoricalSnapshotRangeOption[] = [
  { key: '6M', label: '6M', months: 6 },
  { key: '12M', label: '1Y', months: 12 },
  { key: '24M', label: '2Y', months: 24 },
];

export const INTERNAL_DEFAULT_SNAPSHOT_RANGE: HistoricalSnapshotRangeKey = '24M';
export const TOKEN_DEFAULT_SNAPSHOT_RANGE: HistoricalSnapshotRangeKey = '6M';

export const HISTORICAL_INTERNAL_OVERVIEW_WIDGETS = [
  'occupancy',
  'netRevenue',
  'expenses',
  'noi',
  'pastDue',
  'rateVariance',
] as const;

const SNAPSHOT_RANGE_MONTHS: Record<HistoricalSnapshotRangeKey, number | null> = {
  '3M': 3,
  '6M': 6,
  '12M': 12,
  '24M': 24,
  '36M': 36,
  ALL: null,
};

export function isHistoricalSnapshotRangeKey(value: string | null | undefined): value is HistoricalSnapshotRangeKey {
  if (!value) return false;
  return Object.prototype.hasOwnProperty.call(SNAPSHOT_RANGE_MONTHS, value);
}

export function getSnapshotRangeMonths(range: HistoricalSnapshotRangeKey): number | null {
  return SNAPSHOT_RANGE_MONTHS[range];
}

export function normalizeMonthIso(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (trimmed.length >= 7) return trimmed.slice(0, 7);
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 7);
  }
  if (typeof value === 'number') {
    return new Date(value).toISOString().slice(0, 7);
  }
  if (value instanceof Date) {
    return value.toISOString().slice(0, 7);
  }
  if (typeof (value as { toDate?: () => Date }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate().toISOString().slice(0, 7);
  }
  return null;
}

export function toMonthKey(monthIso: string): number {
  const [yearStr, monthStr] = monthIso.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  if (!year || !month) return 0;
  return year * 12 + (month - 1);
}

export function sanitizeFirebaseValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof (value as { toDate?: () => Date }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeFirebaseValue(entry));
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const sanitized: Record<string, unknown> = {};
    Object.entries(record).forEach(([key, entry]) => {
      sanitized[key] = sanitizeFirebaseValue(entry);
    });
    return sanitized;
  }
  return null;
}

export function getSnapshotArray(data: Record<string, unknown>): unknown[] {
  if (Array.isArray(data.snapshots)) return data.snapshots;
  if (Array.isArray(data.msrSnapshots)) return data.msrSnapshots;
  if (Array.isArray(data.msrHistory)) return data.msrHistory;
  return [];
}

export function normalizeHistoricalSnapshots(rawSnapshots: unknown[]): MsrSnapshot[] {
  return rawSnapshots
    .map((snapshot) => sanitizeFirebaseValue(snapshot))
    .filter((snapshot): snapshot is Record<string, unknown> => Boolean(snapshot) && typeof snapshot === 'object')
    .map((snapshot) => {
      const monthIso = normalizeMonthIso(
        snapshot.monthIso ?? snapshot.month ?? snapshot.reportMonth ?? snapshot.asOfDate,
      );
      return monthIso ? ({ ...snapshot, monthIso } as MsrSnapshot) : (snapshot as MsrSnapshot);
    });
}

export function resolveHistoricalPropertyName(
  data: Record<string, unknown>,
  snapshots: MsrSnapshot[],
  fallbackPropertyName: string,
): string {
  const nameCandidates: Array<unknown> = [
    fallbackPropertyName,
    data.propertyName,
    data.property_name,
    data.name,
    snapshots.find((snapshot) => typeof snapshot.propertyName === 'string' && snapshot.propertyName.trim())
      ?.propertyName,
  ];

  const resolved = nameCandidates.find((value) => typeof value === 'string' && value.trim());
  return typeof resolved === 'string' && resolved.trim() ? resolved.trim() : fallbackPropertyName;
}

export function sliceSnapshotEntriesByRange<T extends RangeLikeEntry>(
  entries: T[],
  range: HistoricalSnapshotRangeKey,
): T[] {
  if (!entries.length) return [];

  const rangeMonths = getSnapshotRangeMonths(range);
  if (rangeMonths === null) {
    return [...entries];
  }

  const latest = entries[entries.length - 1];
  if (latest.monthKey !== null) {
    const minKey = latest.monthKey - (rangeMonths - 1);
    return entries.filter((entry) => entry.monthKey !== null && entry.monthKey >= minKey);
  }

  return entries.slice(-rangeMonths);
}

export function sliceLaggedFinancialEntriesByRange<T extends RangeLikeEntry>(
  entries: T[],
  range: HistoricalSnapshotRangeKey,
): T[] {
  if (!entries.length) return [];

  const rangeMonths = getSnapshotRangeMonths(range);
  if (rangeMonths === null) {
    return entries.slice(0, -1).filter((entry) => entry.monthIso);
  }

  const latest = entries[entries.length - 1];
  if (latest.monthKey !== null) {
    const maxKey = latest.monthKey - 1;
    const minKey = maxKey - (rangeMonths - 1);
    return entries.filter(
      (entry) => entry.monthKey !== null && entry.monthKey >= minKey && entry.monthKey <= maxKey && entry.monthIso,
    );
  }

  return entries.slice(-(rangeMonths + 1), -1).filter((entry) => entry.monthIso);
}

const sharesAlias = (option: HistoricalPropertyOption, aliases: string[]): boolean => {
  const optionAliasSet = new Set(option.aliases.map((alias) => normalizeKey(alias)));
  return aliases.some((alias) => optionAliasSet.has(normalizeKey(alias)));
};

function shouldReplaceLabel(current: string, next: string): boolean {
  if (!current.trim()) return true;
  if (normalizeLabel(current) === normalizeLabel(next)) return false;
  if (/^untitled property$/i.test(current)) return true;
  return current === current.toUpperCase() && next !== next.toUpperCase();
}

function mergePropertyOption(
  existing: HistoricalPropertyOption,
  next: HistoricalPropertyOption,
): HistoricalPropertyOption {
  return {
    ...existing,
    id: existing.id || next.id,
    label: shouldReplaceLabel(existing.label, next.label) ? next.label : existing.label,
    city: existing.city || next.city,
    enabled: existing.enabled || next.enabled,
    aliases: uniqueNonEmpty([...existing.aliases, ...next.aliases]),
    propertyId: existing.propertyId || next.propertyId,
    tenantPropertyId: existing.tenantPropertyId || next.tenantPropertyId,
    propertyCode: existing.propertyCode || next.propertyCode,
  };
}

export function buildHistoricalPropertyOptions(
  propertyConfigs: PropertyConfig[],
  legacyOptions: LegacyPropertyOption[],
): HistoricalPropertyOption[] {
  const options: HistoricalPropertyOption[] = [];

  propertyConfigs.forEach((property) => {
    const aliases = uniqueNonEmpty([property.id, property.propertyId, property.tenantPropertyId, property.propertyCode]);
    if (!aliases.length) return;

    const nextOption: HistoricalPropertyOption = {
      id: property.propertyId?.trim() || property.id?.trim() || property.tenantPropertyId?.trim() || aliases[0],
      label: property.name?.trim() || property.propertyId?.trim() || property.id?.trim() || aliases[0],
      city: '',
      enabled: property.enabled !== false,
      aliases,
      propertyId: property.propertyId?.trim() || undefined,
      tenantPropertyId: property.tenantPropertyId?.trim() || undefined,
      propertyCode: property.propertyCode?.trim() || undefined,
    };

    const existingIndex = options.findIndex((option) => sharesAlias(option, nextOption.aliases));
    if (existingIndex >= 0) {
      options[existingIndex] = mergePropertyOption(options[existingIndex], nextOption);
    } else {
      options.push(nextOption);
    }
  });

  legacyOptions.forEach((property) => {
    const nextOption: HistoricalPropertyOption = {
      id: property.id,
      label: property.label,
      city: property.city,
      enabled: true,
      aliases: uniqueNonEmpty([property.id]),
    };

    const existingIndex = options.findIndex((option) => {
      if (sharesAlias(option, nextOption.aliases)) return true;
      return normalizeLabel(option.label) === normalizeLabel(nextOption.label);
    });

    if (existingIndex >= 0) {
      options[existingIndex] = mergePropertyOption(options[existingIndex], nextOption);
    } else {
      options.push(nextOption);
    }
  });

  return options.sort((left, right) => {
    if (left.enabled !== right.enabled) return left.enabled ? -1 : 1;
    return left.label.localeCompare(right.label);
  });
}

export function findHistoricalPropertyOption(
  options: HistoricalPropertyOption[],
  requestedPropertyId?: string | null,
): HistoricalPropertyOption | null {
  if (!options.length) return null;
  if (!requestedPropertyId?.trim()) {
    return options.find((option) => option.enabled) ?? options[0];
  }

  const normalizedRequested = normalizeKey(requestedPropertyId);
  return (
    options.find((option) => {
      if (normalizeKey(option.id) === normalizedRequested) return true;
      return option.aliases.some((alias) => normalizeKey(alias) === normalizedRequested);
    }) ??
    options.find((option) => option.enabled) ??
    options[0]
  );
}
