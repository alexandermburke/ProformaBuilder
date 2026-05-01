import {
  getGraphAccessToken,
  resolveSharedDriveItem,
  type GraphDriveItemRef,
} from './graph';
import type { DealAnalysis } from './dealAnalysis';

export const AI_COLUMNS = [
  'AI Verdict',
  'AI Confidence',
  'AI Last Run',
  'AI Link',
] as const;

type AiColumnName = (typeof AI_COLUMNS)[number];

const VERDICT_LABEL: Record<DealAnalysis['recommendation'], string> = {
  pursue: 'Pursue',
  pass: 'Pass',
  investigate: 'Investigate',
};

const CONFIDENCE_LABEL: Record<DealAnalysis['confidence'], string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
};

type GraphTable = {
  name: string;
  id: string;
  showHeaders: boolean;
};

type GraphColumn = {
  name: string;
  index: number;
  id: string;
};

async function graph<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const url = path.startsWith('https://') ? path : `https://graph.microsoft.com/v1.0${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Graph ${init?.method ?? 'GET'} ${path} failed (${res.status}): ${text.slice(0, 400)}`);
  }
  return (await res.json()) as T;
}

async function findFirstTable(
  token: string,
  ref: GraphDriveItemRef,
): Promise<GraphTable> {
  const data = await graph<{ value: GraphTable[] }>(
    token,
    `/drives/${ref.driveId}/items/${ref.itemId}/workbook/tables`,
  );
  if (!data.value || data.value.length === 0) {
    throw new Error(
      'Deal tracker workbook has no Excel Table — write-back requires a formatted table. Convert the range to a Table (Insert → Table) and try again.',
    );
  }
  const named = data.value.find((t) => /deal/i.test(t.name)) ?? data.value[0];
  return named;
}

async function listColumns(
  token: string,
  ref: GraphDriveItemRef,
  tableName: string,
): Promise<GraphColumn[]> {
  const data = await graph<{ value: GraphColumn[] }>(
    token,
    `/drives/${ref.driveId}/items/${ref.itemId}/workbook/tables/${encodeURIComponent(tableName)}/columns`,
  );
  return data.value;
}

async function getTableRowCount(
  token: string,
  ref: GraphDriveItemRef,
  tableName: string,
): Promise<number> {
  // Includes header row.
  const range = await graph<{ rowCount: number }>(
    token,
    `/drives/${ref.driveId}/items/${ref.itemId}/workbook/tables/${encodeURIComponent(tableName)}/range`,
  );
  return range.rowCount;
}

async function ensureAiColumns(
  token: string,
  ref: GraphDriveItemRef,
  tableName: string,
): Promise<Record<AiColumnName, GraphColumn>> {
  let columns = await listColumns(token, ref, tableName);
  const existingByName = new Map(columns.map((c) => [c.name, c]));
  const missing = AI_COLUMNS.filter((c) => !existingByName.has(c));

  if (missing.length > 0) {
    // Graph's /columns/add expects a 2D `values` array whose first row is the
    // header text. Passing the bare `{ name }` form sometimes works but isn't
    // documented; the values form is the supported shape.
    const totalRows = await getTableRowCount(token, ref, tableName);
    const dataRowCount = Math.max(totalRows - 1, 0);
    for (const colName of missing) {
      const values: (string | number | null)[][] = [[colName]];
      for (let i = 0; i < dataRowCount; i += 1) values.push(['']);
      await graph(
        token,
        `/drives/${ref.driveId}/items/${ref.itemId}/workbook/tables/${encodeURIComponent(tableName)}/columns/add`,
        {
          method: 'POST',
          body: JSON.stringify({ values }),
        },
      );
    }
  }

  // Excel Online has propagation delay: a GET immediately after creating a
  // column sometimes returns the pre-add state. Retry until all four AI
  // columns are visible, or give up after a few attempts.
  let allFound: Record<AiColumnName, GraphColumn> | null = null;
  let lastSeen: GraphColumn[] = columns;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (attempt > 0) {
      lastSeen = await listColumns(token, ref, tableName);
    } else if (missing.length > 0) {
      lastSeen = await listColumns(token, ref, tableName);
    }
    const partial = {} as Record<AiColumnName, GraphColumn>;
    let complete = true;
    for (const colName of AI_COLUMNS) {
      const found = lastSeen.find((c) => c.name === colName);
      if (!found) {
        complete = false;
        break;
      }
      partial[colName] = found;
    }
    if (complete) {
      allFound = partial;
      break;
    }
    await new Promise((r) => setTimeout(r, 600));
  }
  if (!allFound) {
    throw new Error(
      `AI columns did not appear in the table within retry window. Existing columns: ${lastSeen
        .map((c) => c.name)
        .join(', ')}`,
    );
  }
  return allFound;
}

type GraphRange = { rowIndex: number; rowCount: number; values: unknown[][] };

async function findRowIndexByDealNumber(
  token: string,
  ref: GraphDriveItemRef,
  tableName: string,
  dealNumber: string,
): Promise<number> {
  const dataBody = await graph<GraphRange>(
    token,
    `/drives/${ref.driveId}/items/${ref.itemId}/workbook/tables/${encodeURIComponent(tableName)}/dataBodyRange`,
  );
  const dealCol = await graph<{ values: unknown[][] }>(
    token,
    `/drives/${ref.driveId}/items/${ref.itemId}/workbook/tables/${encodeURIComponent(tableName)}/columns('Deal #')/dataBodyRange`,
  ).catch(async () => {
    // Fallback: pull first column.
    const cols = await listColumns(token, ref, tableName);
    const first = cols.find((c) => /^deal\s*#/i.test(c.name)) ?? cols[0];
    return graph<{ values: unknown[][] }>(
      token,
      `/drives/${ref.driveId}/items/${ref.itemId}/workbook/tables/${encodeURIComponent(tableName)}/columns('${encodeURIComponent(first.name)}')/dataBodyRange`,
    );
  });
  const target = dealNumber.trim();
  for (let i = 0; i < dealCol.values.length; i += 1) {
    const cell = dealCol.values[i]?.[0];
    if (cell === null || cell === undefined) continue;
    if (String(cell).trim() === target) {
      return dataBody.rowIndex + i;
    }
  }
  throw new Error(`Deal #${dealNumber} not found in tracker for write-back.`);
}

async function patchCell(
  token: string,
  ref: GraphDriveItemRef,
  tableName: string,
  rowIndex: number,
  column: GraphColumn,
  value: string,
): Promise<void> {
  const colLetter = columnIndexToLetter(column.index);
  const address = `${colLetter}${rowIndex + 1}`;
  await graph(
    token,
    `/drives/${ref.driveId}/items/${ref.itemId}/workbook/worksheets/${encodeURIComponent(tableName)}/range(address='${address}')`,
    {
      method: 'PATCH',
      body: JSON.stringify({ values: [[value]] }),
    },
  ).catch(async () => {
    // The above assumes the table name == worksheet name. If not, fall back to
    // resolving the table's worksheet via its range address.
    const tableRange = await graph<{ address: string }>(
      token,
      `/drives/${ref.driveId}/items/${ref.itemId}/workbook/tables/${encodeURIComponent(tableName)}/range`,
    );
    const sheetName = tableRange.address.split('!')[0].replace(/^'|'$/g, '');
    await graph(
      token,
      `/drives/${ref.driveId}/items/${ref.itemId}/workbook/worksheets/${encodeURIComponent(sheetName)}/range(address='${address}')`,
      {
        method: 'PATCH',
        body: JSON.stringify({ values: [[value]] }),
      },
    );
  });
}

function columnIndexToLetter(index: number): string {
  let n = index;
  let result = '';
  do {
    result = String.fromCharCode((n % 26) + 65) + result;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return result;
}

export type WriteBackInput = {
  dealNumber: string;
  recommendation: DealAnalysis['recommendation'];
  confidence: DealAnalysis['confidence'];
  runAtIso: string;
  analysisLink: string;
};

export async function writeAiVerdictToTracker(input: WriteBackInput): Promise<void> {
  const shareUrl = process.env.MS_DEAL_TRACKER_SHARE_URL;
  if (!shareUrl) {
    throw new Error('MS_DEAL_TRACKER_SHARE_URL missing');
  }
  const token = await getGraphAccessToken();
  const ref = await resolveSharedDriveItem(shareUrl);
  const table = await findFirstTable(token, ref);
  const aiCols = await ensureAiColumns(token, ref, table.name);
  const rowIndex = await findRowIndexByDealNumber(token, ref, table.name, input.dealNumber);

  const lastRunDisplay = new Date(input.runAtIso).toISOString().slice(0, 10);
  const updates: { col: GraphColumn; value: string }[] = [
    { col: aiCols['AI Verdict'], value: VERDICT_LABEL[input.recommendation] },
    { col: aiCols['AI Confidence'], value: CONFIDENCE_LABEL[input.confidence] },
    { col: aiCols['AI Last Run'], value: lastRunDisplay },
    { col: aiCols['AI Link'], value: input.analysisLink },
  ];
  for (const u of updates) {
    await patchCell(token, ref, table.name, rowIndex, u.col, u.value);
  }
}
