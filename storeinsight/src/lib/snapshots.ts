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

/** Rows arrive as plain JSON (createdAt is an ISO string), so a field compare is enough. */
function sameRows(a: SnapshotRowLite[], b: SnapshotRowLite[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const prev = a[i];
    const next = b[i];
    if (
      prev.id !== next.id ||
      prev.facility !== next.facility ||
      prev.period !== next.period ||
      prev.noi !== next.noi ||
      prev.createdBy !== next.createdBy ||
      prev.createdAt !== next.createdAt
    ) {
      return false;
    }
  }
  return true;
}

export function subscribeSnapshots(
  onRows: (rows: SnapshotRowLite[]) => void,
  take: number = 12,
): () => void {
  let active = true;
  let inFlight: AbortController | null = null;
  let intervalId: number | null = null;
  let lastRows: SnapshotRowLite[] | null = null;

  const emit = (rows: SnapshotRowLite[]) => {
    if (lastRows && sameRows(lastRows, rows)) return;
    lastRows = rows;
    onRows(rows);
  };

  const load = async () => {
    inFlight?.abort();
    const controller = new AbortController();
    inFlight = controller;
    try {
      const rows = await fetchSnapshots(take, controller.signal);
      if (active) emit(rows);
    } catch (error) {
      if ((error as { name?: string } | null)?.name === 'AbortError') return;
      console.error('[snapshots] unable to load snapshots', error);
      if (active) emit([]);
    }
  };

  const startPolling = () => {
    if (intervalId !== null) return;
    intervalId = window.setInterval(() => {
      void load();
    }, SNAPSHOT_POLL_INTERVAL_MS);
  };

  const stopPolling = () => {
    if (intervalId === null) return;
    window.clearInterval(intervalId);
    intervalId = null;
  };

  const onVisibilityChange = () => {
    if (document.visibilityState === 'hidden') {
      stopPolling();
      return;
    }
    void load();
    startPolling();
  };

  void load();
  if (document.visibilityState !== 'hidden') startPolling();
  document.addEventListener('visibilitychange', onVisibilityChange);

  return () => {
    active = false;
    inFlight?.abort();
    stopPolling();
    document.removeEventListener('visibilitychange', onVisibilityChange);
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
