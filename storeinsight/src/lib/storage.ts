import type { SnapshotDetail, SnapshotId, SnapshotRowLite } from './types';
import type { RequiredField } from './coa';
import type { Assumptions } from './assumptions';

const KEY_LIST = 'store-demo-snapshots';
const KEY_DETAIL_PREFIX = 'store-demo-snapshot:';
const KEY_MAP_MEMORY = 'store-demo-map-memory';
const KEY_ASSUMP_PREFIX = 'store-demo-assumptions:'; // per-facility defaults

/** -------- Snapshots (list + detail) -------- */

export function loadSnapshots(): SnapshotRowLite[] {
  try {
    const raw = localStorage.getItem(KEY_LIST);
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown;
    return Array.isArray(arr) ? (arr as SnapshotRowLite[]) : [];
  } catch (e) {
    console.log('[storage] load list error', e);
    return [];
  }
}

export function saveSnapshotRow(row: SnapshotRowLite): void {
  const list = loadSnapshots();
  const next = [row, ...list].slice(0, 200);
  try {
    localStorage.setItem(KEY_LIST, JSON.stringify(next));
    console.log('[storage] saved snapshot row', { id: row.id, count: next.length });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.log('[storage] save snapshot row error', { id: row.id, error });
  }
}

export function saveSnapshotDetail(detail: SnapshotDetail): void {
  const key = KEY_DETAIL_PREFIX + detail.id;
  try {
    localStorage.setItem(key, JSON.stringify(detail));
    console.log('[storage] saved snapshot detail', { id: detail.id });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.log('[storage] save snapshot detail error', { id: detail.id, error });
  }
}

export function loadSnapshotDetail(id: SnapshotId): SnapshotDetail | null {
  try {
    const raw = localStorage.getItem(KEY_DETAIL_PREFIX + id);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SnapshotDetail;
    return parsed;
  } catch (e) {
    console.log('[storage] load detail error', { id, e });
    return null;
  }
}

/** -------- Mapping memory (learn-as-you-go) -------- */

export type MappingMemory = {
  vendor: string;          // e.g., "Extra Space"
  header: string;          // vendor column name
  field: RequiredField;    // our target field
  lastUsedISO: string;
  times: number;           // hit count
};

export function loadMappingMemory(): MappingMemory[] {
  try {
    const raw = localStorage.getItem(KEY_MAP_MEMORY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as MappingMemory[]) : [];
  } catch (e) {
    console.log('[storage] load map memory error', e);
    return [];
  }
}

export function upsertMappingMemory(entries: MappingMemory[]): void {
  const cur = loadMappingMemory();
  for (const ent of entries) {
    const idx = cur.findIndex(
      (m) => m.vendor === ent.vendor && m.header === ent.header && m.field === ent.field
    );
    if (idx >= 0) {
      cur[idx] = { ...cur[idx], lastUsedISO: ent.lastUsedISO, times: cur[idx].times + 1 };
    } else {
      cur.push(ent);
    }
  }
  try {
    localStorage.setItem(KEY_MAP_MEMORY, JSON.stringify(cur));
    console.log('[storage] map memory upsert', { added: entries.length, total: cur.length });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.log('[storage] map memory upsert error', { added: entries.length, error });
  }
}

/** -------- Facility assumptions (per-facility defaults) -------- */

export function loadFacilityAssumptions(facility: string): Assumptions | null {
  try {
    const raw = localStorage.getItem(KEY_ASSUMP_PREFIX + facility);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Assumptions;
    console.log('[storage] loaded assumptions', { facility });
    return parsed;
  } catch (e) {
    console.log('[storage] load assumptions error', { facility, e });
    return null;
  }
}

export function saveFacilityAssumptions(facility: string, as: Assumptions): void {
  try {
    localStorage.setItem(KEY_ASSUMP_PREFIX + facility, JSON.stringify(as));
    console.log('[storage] saved assumptions', { facility });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.log('[storage] save assumptions error', { facility, error });
  }
}
