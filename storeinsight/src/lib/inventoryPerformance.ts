type CsvRow = string[];

const REQUIRED_HEADERS = ["dtdate", "occ", "n"] as const;

export const PERFORMANCE_PREVIEW_FIELDS = [
  { token: "CURRENTMONTH", label: "Current Month", kind: "string" },
  { token: "MOVEINS", label: "Move-Ins (Current Month)", kind: "integer" },
  { token: "MOVEOUTS", label: "Move-Outs (Current Month)", kind: "integer" },
  { token: "NETMOVE", label: "Net Move (Current Month)", kind: "integer" },
  { token: "MOVEINSTRL3", label: "Move-Ins (Trailing 3 Months)", kind: "integer" },
  { token: "MOVEOUTSTRL3", label: "Move-Outs (Trailing 3 Months)", kind: "integer" },
  { token: "NETTRL3", label: "Net Move (Trailing 3 Months)", kind: "integer" },
  { token: "MOVEINSTRL6", label: "Move-Ins (Trailing 6 Months)", kind: "integer" },
  { token: "MOVEOUTSTRL6", label: "Move-Outs (Trailing 6 Months)", kind: "integer" },
  { token: "NETTRL6", label: "Net Move (Trailing 6 Months)", kind: "integer" },
  { token: "MOVEINSTRL12", label: "Move-Ins (Trailing 12 Months)", kind: "integer" },
  { token: "MOVEOUTSTRL12", label: "Move-Outs (Trailing 12 Months)", kind: "integer" },
  { token: "NETTRL12", label: "Net Move (Trailing 12 Months)", kind: "integer" },
  { token: "MOVIPER", label: "Move-Ins vs Prior Month", kind: "percent" },
  { token: "MOVOPER", label: "Move-Outs vs Prior Month", kind: "percent" },
  { token: "MOVN", label: "Net vs Prior Month", kind: "percent" },
] as const;

export type InventoryTokenKey = (typeof PREVIEW_FIELDS)[number]["token"];

type IntegerTokenKey =
  | "MOVEINS"
  | "MOVEOUTS"
  | "NETMOVE"
  | "MOVEINSTRL3"
  | "MOVEOUTSTRL3"
  | "NETTRL3"
  | "MOVEINSTRL6"
  | "MOVEOUTSTRL6"
  | "NETTRL6"
  | "MOVEINSTRL12"
  | "MOVEOUTSTRL12"
  | "NETTRL12";

type PercentTokenKey = "MOVIPER" | "MOVOPER" | "MOVN";

export type InventoryTokenValues = {
  CURRENTMONTH: string;
} & Record<IntegerTokenKey, number> &
  Record<PercentTokenKey, string>;

export type InventoryPreviewRow = {
  token: InventoryTokenKey;
  label: string;
  value: string;
};

export type InventoryPerformanceErrorCode =
  | "missing_columns"
  | "missing_sheet"
  | "insufficient_history"
  | "no_rows"
  | "parse_error";

export type InventoryPerformanceResult =
  | {
      ok: true;
      tokens: InventoryTokenValues;
      preview: InventoryPreviewRow[];
      metadata: {
        latestDateISO: string;
        rowCount: number;
        distinctDates: number;
      };
    }
  | {
      ok: false;
      code: InventoryPerformanceErrorCode;
      message: string;
    };

type DailyAggregation = {
  date: Date;
  key: string;
  occupied: number;
  units: number;
};

type DailyMove = DailyAggregation & {
  delta: number;
  moveIns: number;
  moveOuts: number;
  net: number;
};

const monthFormatter = new Intl.DateTimeFormat("en-US", {
  month: "long",
  year: "numeric",
});

const integerFormatter = new Intl.NumberFormat("en-US");

const percentFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

export function buildPerformancePreview(tokens: InventoryTokenValues): InventoryPreviewRow[] {
  return PERFORMANCE_PREVIEW_FIELDS.map(({ token, label, kind }) => {
    const rawValue = tokens[token];
    if (kind === "string") {
      return { token, label, value: String(rawValue ?? "") };
    }
    if (kind === "percent") {
      return { token, label, value: String(rawValue ?? "—") };
    }
    return {
      token,
      label,
      value:
        typeof rawValue === "number" && Number.isFinite(rawValue)
          ? integerFormatter.format(rawValue)
          : "0",
    };
  });
}

export function computeInventoryPerformance(csvText: string): InventoryPerformanceResult {
  const sanitized = csvText.replace(/^\uFEFF/, "");
  const trimmed = sanitized.trim();
  if (!trimmed) {
    return {
      ok: false,
      code: "no_rows",
      message: "Upload a CSV with at least one data row.",
    };
  }

  let rows: CsvRow[];
  try {
    rows = parseCsv(trimmed);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unable to parse CSV. Confirm the file is valid.";
    return {
      ok: false,
      code: "parse_error",
      message,
    };
  }

  if (rows.length === 0) {
    return {
      ok: false,
      code: "no_rows",
      message: "Upload a CSV with at least one data row.",
    };
  }

  const header = rows[0].map((cell) => cell.trim());
  const normalizedHeader = header.map((cell) => cell.toLowerCase());
  const columnIndex: Partial<Record<(typeof REQUIRED_HEADERS)[number], number>> = {};

  for (const required of REQUIRED_HEADERS) {
    const idx = normalizedHeader.indexOf(required);
    if (idx === -1) {
      return {
        ok: false,
        code: "missing_columns",
        message: "CSV must include dtDate, occ, and n.",
      };
    }
    columnIndex[required] = idx;
  }

  const dataRows = rows.slice(1);
  const dailyMap = new Map<string, DailyAggregation>();

  const dateIndex = columnIndex.dtdate!;
  const occIndex = columnIndex.occ!;
  const unitsIndex = columnIndex.n!;

  for (const row of dataRows) {
    const rawDate = row[dateIndex] ?? "";
    const parsedDate = parseDateValue(rawDate);
    if (!parsedDate) continue;
    const normalizedDate = new Date(
      parsedDate.getFullYear(),
      parsedDate.getMonth(),
      parsedDate.getDate(),
    );
    const key = dateKey(normalizedDate);
    const occupied = parseNumeric(row[occIndex] ?? "");
    const units = parseNumeric(row[unitsIndex] ?? "");
    if (!dailyMap.has(key)) {
      dailyMap.set(key, {
        date: normalizedDate,
        key,
        occupied: 0,
        units: 0,
      });
    }
    const entry = dailyMap.get(key)!;
    entry.occupied += occupied;
    entry.units += units;
  }

  const daily = Array.from(dailyMap.values()).sort(
    (a, b) => a.date.getTime() - b.date.getTime(),
  );

  if (daily.length === 0) {
    return {
      ok: false,
      code: "no_rows",
      message: "No valid dtDate rows found in CSV.",
    };
  }

  if (daily.length < 2) {
    return {
      ok: false,
      code: "insufficient_history",
      message: "Only one date found; cannot compute moves.",
    };
  }

  const dailyMoves: DailyMove[] = daily.map((entry, index) => {
    const prev = index > 0 ? daily[index - 1] : null;
    const delta = prev ? entry.occupied - prev.occupied : 0;
    const moveIns = delta > 0 ? delta : 0;
    const moveOuts = delta < 0 ? Math.abs(delta) : 0;
    return {
      ...entry,
      delta,
      moveIns,
      moveOuts,
      net: delta,
    };
  });

  const latest = dailyMoves[dailyMoves.length - 1];
  const currentMonthStart = startOfMonth(latest.date);
  const nextMonthStart = addMonths(currentMonthStart, 1);
  const previousMonthStart = addMonths(currentMonthStart, -1);
  const trailing3Start = addMonths(currentMonthStart, -2);
  const trailing6Start = addMonths(currentMonthStart, -5);
  const trailing12Start = addMonths(currentMonthStart, -11);

  const currentMonthAgg = sumWindow(dailyMoves, currentMonthStart, nextMonthStart);
  const previousMonthAgg = sumWindow(dailyMoves, previousMonthStart, currentMonthStart);
  const trailing3Agg = sumWindow(dailyMoves, trailing3Start, nextMonthStart);
  const trailing6Agg = sumWindow(dailyMoves, trailing6Start, nextMonthStart);
  const trailing12Agg = sumWindow(dailyMoves, trailing12Start, nextMonthStart);

  const tokens: InventoryTokenValues = {
    CURRENTMONTH: monthFormatter.format(currentMonthStart),
    MOVEINS: roundInteger(currentMonthAgg.moveIns),
    MOVEOUTS: roundInteger(currentMonthAgg.moveOuts),
    NETMOVE: roundInteger(currentMonthAgg.net),
    MOVEINSTRL3: roundInteger(trailing3Agg.moveIns),
    MOVEOUTSTRL3: roundInteger(trailing3Agg.moveOuts),
    NETTRL3: roundInteger(trailing3Agg.net),
    MOVEINSTRL6: roundInteger(trailing6Agg.moveIns),
    MOVEOUTSTRL6: roundInteger(trailing6Agg.moveOuts),
    NETTRL6: roundInteger(trailing6Agg.net),
    MOVEINSTRL12: roundInteger(trailing12Agg.moveIns),
    MOVEOUTSTRL12: roundInteger(trailing12Agg.moveOuts),
    NETTRL12: roundInteger(trailing12Agg.net),
    MOVIPER: formatPercent(pctChange(currentMonthAgg.moveIns, previousMonthAgg.moveIns)),
    MOVOPER: formatPercent(pctChange(currentMonthAgg.moveOuts, previousMonthAgg.moveOuts)),
    MOVN: formatPercent(pctChange(currentMonthAgg.net, previousMonthAgg.net)),
  };

  const preview = buildPerformancePreview(tokens);

  return {
    ok: true,
    tokens,
    preview,
    metadata: {
      latestDateISO: latest.key,
      rowCount: dataRows.length,
      distinctDates: daily.length,
    },
  };
}

function parseCsv(text: string): CsvRow[] {
  const rows: CsvRow[] = [];
  let currentCell = "";
  let currentRow: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"') {
      if (inQuotes && text[i + 1] === '"') {
        currentCell += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if ((char === "," || char === "\t") && !inQuotes) {
      currentRow.push(currentCell);
      currentCell = "";
      continue;
    }
    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && text[i + 1] === "\n") {
        i += 1;
      }
      currentRow.push(currentCell);
      if (currentRow.some((cell) => cell.trim().length > 0)) {
        rows.push(currentRow);
      }
      currentRow = [];
      currentCell = "";
      continue;
    }
    currentCell += char;
  }

  currentRow.push(currentCell);
  if (currentRow.some((cell) => cell.trim().length > 0)) {
    rows.push(currentRow);
  }
  return rows;
}

function parseDateValue(raw: string): Date | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    const [, y, m, d] = isoMatch;
    return new Date(Number(y), Number(m) - 1, Number(d));
  }
  const mdyMatch = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (mdyMatch) {
    const month = Number(mdyMatch[1]);
    const day = Number(mdyMatch[2]);
    const year = Number(mdyMatch[3].length === 2 ? `20${mdyMatch[3]}` : mdyMatch[3]);
    return new Date(year, month - 1, day);
  }
  const numeric = Number(trimmed);
  if (Number.isFinite(numeric) && numeric > 59) {
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    const date = new Date(excelEpoch.getTime() + numeric * 86400 * 1000);
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }
  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) {
    return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
  }
  return null;
}

function dateKey(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function parseNumeric(raw: string): number {
  if (raw == null) return 0;
  const trimmed = String(raw).trim();
  if (!trimmed) return 0;
  const negative = /^\(.*\)$/.test(trimmed);
  const cleaned = trimmed.replace(/[(),$%\s]/g, "");
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return 0;
  return negative ? -value : value;
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date: Date, months: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

function sumWindow(rows: DailyMove[], start: Date, end: Date) {
  return rows.reduce(
    (acc, row) => {
      if (row.date >= start && row.date < end) {
        acc.moveIns += row.moveIns;
        acc.moveOuts += row.moveOuts;
        acc.net += row.net;
      }
      return acc;
    },
    { moveIns: 0, moveOuts: 0, net: 0 },
  );
}

function roundInteger(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const rounded = Math.round(value);
  if (!Number.isFinite(rounded)) return 0;
  return Object.is(rounded, -0) ? 0 : rounded;
}

export function pctChange(curr: number, prev: number): number | null {
  if (!Number.isFinite(prev) || prev === 0) return null;
  if (!Number.isFinite(curr)) return null;
  return (curr - prev) / prev;
}

export function formatPercent(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${percentFormatter.format(value * 100)}%`;
}
