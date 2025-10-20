import type { SnapshotRowLite } from './types';

export type SnapshotStats = {
  count: number;
  totalNOI: number;
  avgNOI: number;
  minNOI: number | null;
  maxNOI: number | null;
  facilities: number;
  byFacility: Array<{ facility: string; count: number; totalNOI: number; avgNOI: number }>;
};

export function computeSnapshotStats(rows: SnapshotRowLite[]): SnapshotStats {
  const count = rows.length;
  if (count === 0) {
    return {
      count: 0, totalNOI: 0, avgNOI: 0, minNOI: null, maxNOI: null, facilities: 0, byFacility: []
    };
  }
  let total = 0;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  const byF: Record<string, { count: number; total: number }> = {};

  for (const r of rows) {
    total += r.noi;
    if (r.noi < min) min = r.noi;
    if (r.noi > max) max = r.noi;
    byF[r.facility] = byF[r.facility] || { count: 0, total: 0 };
    byF[r.facility].count++;
    byF[r.facility].total += r.noi;
  }
  const byFacility = Object.entries(byF).map(([facility, v]) => ({
    facility,
    count: v.count,
    totalNOI: v.total,
    avgNOI: v.total / v.count
  })).sort((a, b) => b.totalNOI - a.totalNOI);

  return {
    count,
    totalNOI: total,
    avgNOI: total / count,
    minNOI: Number.isFinite(min) ? min : null,
    maxNOI: Number.isFinite(max) ? max : null,
    facilities: Object.keys(byF).length,
    byFacility
  };
}