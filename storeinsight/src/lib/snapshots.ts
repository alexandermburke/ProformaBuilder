// /src/lib/snapshots.ts
import { db } from './firebase';
import {
  addDoc,
  collection,
  onSnapshot,
  orderBy,
  query,
  limit,
  Timestamp,
  type Firestore,
} from 'firebase/firestore';
import type { SnapshotRowLite } from './types';

const SNAP_COLLECTION = 'snapshots';

export function subscribeSnapshots(
  onRows: (rows: SnapshotRowLite[]) => void,
  take: number = 12
): () => void {
  if (!db) {
    console.warn('[snapshots] Firestore disabled (missing env). Returning empty list.');
    onRows([]);
    // no-op unsubscribe
    return () => {};
  }

  const q = query(
    collection(db as Firestore, SNAP_COLLECTION),
    orderBy('createdAt', 'desc'),
    limit(take)
  );
  return onSnapshot(q, (snap) => {
    const rows: SnapshotRowLite[] = [];
    snap.forEach((d) => {
      const data = d.data() as any;
      const createdAt =
        data.createdAt instanceof Timestamp
          ? data.createdAt.toDate().toISOString()
          : (data.createdAt ?? new Date().toISOString());

      rows.push({
        id: data.id,
        facility: data.facility,
        period: data.period,
        noi: Number(data.noi) || 0,
        createdBy: data.createdBy || 'User',
        createdAt,
      });
    });
    onRows(rows);
  });
}

export async function createSnapshotRow(row: SnapshotRowLite): Promise<boolean> {
  if (!db) {
    console.warn('[snapshots] Firestore disabled (missing env). Skipping remote write.');
    return false;
  }
  try {
    await addDoc(collection(db, SNAP_COLLECTION), {
      ...row,
      createdAt: row.createdAt ?? new Date().toISOString(),
    });
    return true;
  } catch (err) {
    console.error('[snapshots] createSnapshotRow failed', err);
    return false;
  }
}