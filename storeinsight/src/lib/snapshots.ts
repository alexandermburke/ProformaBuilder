import type { SnapshotRowLite } from './types';

const SNAPSHOT_POLL_INTERVAL_MS = 30_000;

async function fetchSnapshots(take: number, signal?: AbortSignal): Promise<SnapshotRowLite[]> {
  const response = await fetch(`/api/snapshots?take=${encodeURIComponent(String(take))}`, {
    method: 'GET',
    credentials: 'same-origin',
    cache: 'no-store',
    signal,
  });
  if (!response.ok) {
    throw new Error(`Snapshot fetch failed with status ${response.status}`);
  }
  const payload = (await response.json()) as { rows?: SnapshotRowLite[] };
  return Array.isArray(payload.rows) ? payload.rows : [];
}

export function subscribeSnapshots(
  onRows: (rows: SnapshotRowLite[]) => void,
  take: number = 12,
): () => void {
  let active = true;
  let inFlight: AbortController | null = null;

  const load = async () => {
    inFlight?.abort();
    const controller = new AbortController();
    inFlight = controller;
    try {
      const rows = await fetchSnapshots(take, controller.signal);
      if (active) onRows(rows);
    } catch (error) {
      if ((error as { name?: string } | null)?.name === 'AbortError') return;
      console.error('[snapshots] unable to load snapshots', error);
      if (active) onRows([]);
    }
  };

  void load();
  const intervalId = window.setInterval(() => {
    void load();
  }, SNAPSHOT_POLL_INTERVAL_MS);

  return () => {
    active = false;
    inFlight?.abort();
    window.clearInterval(intervalId);
  };
}

export async function createSnapshotRow(row: SnapshotRowLite): Promise<boolean> {
  try {
    const response = await fetch('/api/snapshots', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ row }),
    });
    return response.ok;
  } catch (error) {
    console.error('[snapshots] createSnapshotRow failed', error);
    return false;
  }
}
