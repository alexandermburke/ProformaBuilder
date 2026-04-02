import { firestore } from '@/server/firebaseAdmin';
import type { HistoricalDataByRange } from '@/lib/historical/dataInput';
import type { HistoricalPropertyOption, MsrSnapshot } from '@/lib/historical/dashboardTypes';
import type { MoMSeries } from '@/lib/flash/momSeries';
import {
  getSnapshotArray,
  normalizeHistoricalSnapshots,
  normalizeMonthIso,
  resolveHistoricalPropertyName,
} from '@/lib/historical/snapshotDashboard';
import { syncLatestMsrSnapshotForProperty } from '@/lib/historical/syncLatestMsrSnapshot';

const COLLECTION = 'property_historical';

type HistoricalDocCandidate = {
  alias: string;
  data: Record<string, unknown>;
  propertyName: string;
  snapshots: MsrSnapshot[];
  historicalByRange: HistoricalDataByRange | undefined;
  momSeries: MoMSeries | undefined;
  updatedAt: string | null;
  latestSnapshotMonth: string | null;
};

const normalizeAliasKey = (value: string | null | undefined): string => (value ?? '').trim().toLowerCase();

const deepMergeSnapshotValues = (base: unknown, overlay: unknown): unknown => {
  if (overlay === undefined) return base;
  if (overlay === null) return base ?? null;
  if (Array.isArray(overlay)) return overlay;
  if (Array.isArray(base)) return overlay ?? base;
  if (
    base &&
    overlay &&
    typeof base === 'object' &&
    typeof overlay === 'object' &&
    !(base instanceof Date) &&
    !(overlay instanceof Date)
  ) {
    const merged: Record<string, unknown> = { ...(base as Record<string, unknown>) };
    for (const [key, value] of Object.entries(overlay as Record<string, unknown>)) {
      merged[key] = key in merged ? deepMergeSnapshotValues(merged[key], value) : value;
    }
    return merged;
  }
  return overlay;
};

const mergeSnapshotsByMonth = (
  baseSnapshots: MsrSnapshot[],
  overlayCandidates: HistoricalDocCandidate[],
): MsrSnapshot[] => {
  return baseSnapshots.map((snapshot) => {
    const monthIso = normalizeMonthIso(snapshot.monthIso ?? snapshot.month ?? snapshot.reportMonth ?? snapshot.asOfDate);
    if (!monthIso) return snapshot;

    return overlayCandidates.reduce<MsrSnapshot>((current, candidate) => {
      const matchingSnapshot = candidate.snapshots.find((entry) => {
        const entryMonth = normalizeMonthIso(entry.monthIso ?? entry.month ?? entry.reportMonth ?? entry.asOfDate);
        return entryMonth === monthIso;
      });
      if (!matchingSnapshot) return current;
      return deepMergeSnapshotValues(current, matchingSnapshot) as MsrSnapshot;
    }, snapshot);
  });
};

export type LoadedHistoricalPropertyRecord = {
  matchedAlias: string | null;
  propertyName: string;
  snapshots: MsrSnapshot[];
  updatedAt: string | null;
  latestSnapshotMonth: string | null;
  historicalByRange?: HistoricalDataByRange;
  momSeries?: MoMSeries;
};

const toIsoString = (value: unknown): string | null => {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  if (typeof value === 'number') return new Date(value).toISOString();
  if (typeof (value as { toDate?: () => Date }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  return null;
};

const getLatestSnapshotMonth = (snapshots: MsrSnapshot[]): string | null => {
  const months = snapshots
    .map((snapshot) => normalizeMonthIso(snapshot.monthIso ?? snapshot.month ?? snapshot.reportMonth ?? snapshot.asOfDate))
    .filter((month): month is string => Boolean(month));

  return months.length ? months.reduce((max, value) => (value > max ? value : max), months[0]) : null;
};

async function maybeSyncProperty(option: HistoricalPropertyOption): Promise<void> {
  const candidates = [option.id, option.propertyId, option.tenantPropertyId].filter(
    (value): value is string => Boolean(value?.trim()),
  );

  for (const candidate of candidates) {
    try {
      const result = await syncLatestMsrSnapshotForProperty(candidate);
      if (result.synced || result.reason !== 'missing-property-id') {
        return;
      }
    } catch {
      // ignore sync failures and continue loading stored data
    }
  }
}

const sortCandidates = (left: HistoricalDocCandidate, right: HistoricalDocCandidate): number => {
  if (left.snapshots.length !== right.snapshots.length) {
    return right.snapshots.length - left.snapshots.length;
  }
  if (Boolean(left.historicalByRange) !== Boolean(right.historicalByRange)) {
    return left.historicalByRange ? -1 : 1;
  }
  return (right.updatedAt ?? '').localeCompare(left.updatedAt ?? '');
};

export async function loadHistoricalPropertyRecord(
  option: HistoricalPropertyOption,
  params?: { syncLatest?: boolean; canonicalAlias?: string | null },
): Promise<LoadedHistoricalPropertyRecord> {
  if (params?.syncLatest) {
    await maybeSyncProperty(option);
  }

  const db = firestore;
  if (!db) {
    return {
      matchedAlias: null,
      propertyName: option.label,
      snapshots: [],
      updatedAt: null,
      latestSnapshotMonth: null,
    };
  }

  const snapshotsByAlias = await Promise.all(
    option.aliases.map(async (alias) => {
      const snapshot = await db.collection(COLLECTION).doc(alias).get();
      if (!snapshot.exists) return null;

      const data = (snapshot.data() ?? {}) as Record<string, unknown>;
      const snapshots = normalizeHistoricalSnapshots(getSnapshotArray(data));
      const updatedAt = toIsoString(data.updated_at);
      const propertyName = resolveHistoricalPropertyName(data, snapshots, option.label);

      return {
        alias,
        data,
        propertyName,
        snapshots,
        historicalByRange: data.historicalByRange as HistoricalDataByRange | undefined,
        momSeries: data.momSeries as MoMSeries | undefined,
        updatedAt,
        latestSnapshotMonth: getLatestSnapshotMonth(snapshots),
      } satisfies HistoricalDocCandidate;
    }),
  );

  const candidates = snapshotsByAlias
    .filter((entry): entry is HistoricalDocCandidate => entry !== null)
    .sort(sortCandidates);
  const canonicalAlias = normalizeAliasKey(params?.canonicalAlias);
  const canonicalCandidate =
    canonicalAlias.length > 0 ? candidates.find((candidate) => normalizeAliasKey(candidate.alias) === canonicalAlias) : null;

  if (canonicalCandidate) {
    const overlayCandidates = candidates
      .filter((candidate) => normalizeAliasKey(candidate.alias) !== canonicalAlias)
      .sort((left, right) => (left.updatedAt ?? '').localeCompare(right.updatedAt ?? ''));
    const mergedSnapshots = mergeSnapshotsByMonth(canonicalCandidate.snapshots, overlayCandidates);
    const freshestUpdatedAt = candidates.reduce<string | null>(
      (latest, candidate) => ((candidate.updatedAt ?? '') > (latest ?? '') ? candidate.updatedAt : latest),
      canonicalCandidate.updatedAt,
    );

    return {
      matchedAlias: canonicalCandidate.alias,
      propertyName: canonicalCandidate.propertyName,
      snapshots: mergedSnapshots,
      updatedAt: freshestUpdatedAt,
      latestSnapshotMonth: getLatestSnapshotMonth(mergedSnapshots),
      historicalByRange: canonicalCandidate.historicalByRange,
      momSeries: canonicalCandidate.momSeries,
    };
  }

  const best = candidates[0];

  if (!best) {
    return {
      matchedAlias: null,
      propertyName: option.label,
      snapshots: [],
      updatedAt: null,
      latestSnapshotMonth: null,
    };
  }

  return {
    matchedAlias: best.alias,
    propertyName: best.propertyName,
    snapshots: best.snapshots,
    updatedAt: best.updatedAt,
    latestSnapshotMonth: best.latestSnapshotMonth,
    historicalByRange: best.historicalByRange,
    momSeries: best.momSeries,
  };
}
