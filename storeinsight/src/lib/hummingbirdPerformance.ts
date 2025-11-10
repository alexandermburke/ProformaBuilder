import * as XLSX from "xlsx";
import {
  buildPerformancePreview,
  formatPercent,
  InventoryPerformanceResult,
  InventoryTokenValues,
  pctChange,
} from "@/lib/inventoryPerformance";

type WorkbookInput = ArrayBuffer | ArrayBufferView;

const MOVE_SHEETS = [
  { key: "moveIns", name: "Move In", dateColumn: "Date" },
  { key: "moveOuts", name: "Move Out", dateColumn: "Date" },
] as const;

type MoveSheetKey = (typeof MOVE_SHEETS)[number]["key"];

type MonthRecord = {
  month: Date;
  moveIns: number;
  moveOuts: number;
  net: number;
};

const monthFormatter = new Intl.DateTimeFormat("en-US", {
  month: "long",
  year: "numeric",
});

export function computeHummingbirdPerformance(input: WorkbookInput): InventoryPerformanceResult {
  let workbook: XLSX.WorkBook;
  try {
    const arrayBuffer = toArrayBuffer(input);
    workbook = XLSX.read(arrayBuffer, { type: "array" });
  } catch {
    return {
      ok: false,
      code: "parse_error",
      message: "Unable to read the workbook. Upload the original Hummingbird export.",
    };
  }

  const moveCounts: Record<MoveSheetKey, Map<string, number>> = {
    moveIns: new Map(),
    moveOuts: new Map(),
  };

  let latestMoveDate: Date | null = null;
  let totalRowsProcessed = 0;

  for (const sheetMeta of MOVE_SHEETS) {
    const sheet = workbook.Sheets[sheetMeta.name];
    if (!sheet) {
      return {
        ok: false,
        code: "missing_sheet",
        message: `Sheet "${sheetMeta.name}" not found in workbook.`,
      };
    }
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });
    for (const row of rows) {
      const rawDate = row[sheetMeta.dateColumn];
      const parsedDate = parseWorkbookDate(rawDate);
      if (!parsedDate) continue;
      totalRowsProcessed += 1;
      const normalized = startOfDay(parsedDate);
      if (!latestMoveDate || normalized > latestMoveDate) {
        latestMoveDate = normalized;
      }
      const key = monthKey(startOfMonth(normalized));
      const target = moveCounts[sheetMeta.key];
      target.set(key, (target.get(key) ?? 0) + 1);
    }
  }

  const monthKeySet = new Set<string>([
    ...moveCounts.moveIns.keys(),
    ...moveCounts.moveOuts.keys(),
  ]);

  if (monthKeySet.size === 0 || !latestMoveDate) {
    return {
      ok: false,
      code: "no_rows",
      message: "No dated rows found in Move In or Move Out sheets.",
    };
  }

  const monthKeysSorted = Array.from(monthKeySet).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const firstMonth = monthKeyToDate(monthKeysSorted[0]);
  const lastMonth = monthKeyToDate(monthKeysSorted[monthKeysSorted.length - 1]);

  if (!firstMonth || !lastMonth) {
    return {
      ok: false,
      code: "parse_error",
      message: "Unable to determine month range from workbook.",
    };
  }

  const monthRecords: MonthRecord[] = [];
  for (
    let cursor = new Date(firstMonth);
    cursor.getTime() <= lastMonth.getTime();
    cursor = addMonths(cursor, 1)
  ) {
    const key = monthKey(cursor);
    const moveIns = moveCounts.moveIns.get(key) ?? 0;
    const moveOuts = moveCounts.moveOuts.get(key) ?? 0;
    monthRecords.push({
      month: cursor,
      moveIns,
      moveOuts,
      net: moveIns - moveOuts,
    });
  }

  const monthMap = new Map(monthRecords.map((record) => [record.month.getTime(), record]));

  const currentMonthStart = startOfMonth(latestMoveDate);
  const previousMonthStart = addMonths(currentMonthStart, -1);
  const trailing3Start = addMonths(currentMonthStart, -2);
  const trailing6Start = addMonths(currentMonthStart, -5);
  const trailing12Start = addMonths(currentMonthStart, -11);

  const currentMonthRecord = monthMap.get(currentMonthStart.getTime()) ?? {
    month: currentMonthStart,
    moveIns: 0,
    moveOuts: 0,
    net: 0,
  };
  const previousMonthRecord = monthMap.get(previousMonthStart.getTime()) ?? {
    month: previousMonthStart,
    moveIns: 0,
    moveOuts: 0,
    net: 0,
  };

  const tokens: InventoryTokenValues = {
    CURRENTMONTH: monthFormatter.format(currentMonthStart),
    MOVEINS: currentMonthRecord.moveIns,
    MOVEOUTS: currentMonthRecord.moveOuts,
    NETMOVE: currentMonthRecord.net,
    MOVEINSTRL3: sumWindow(monthRecords, trailing3Start, currentMonthStart, "moveIns"),
    MOVEOUTSTRL3: sumWindow(monthRecords, trailing3Start, currentMonthStart, "moveOuts"),
    NETTRL3: sumWindow(monthRecords, trailing3Start, currentMonthStart, "net"),
    MOVEINSTRL6: sumWindow(monthRecords, trailing6Start, currentMonthStart, "moveIns"),
    MOVEOUTSTRL6: sumWindow(monthRecords, trailing6Start, currentMonthStart, "moveOuts"),
    NETTRL6: sumWindow(monthRecords, trailing6Start, currentMonthStart, "net"),
    MOVEINSTRL12: sumWindow(monthRecords, trailing12Start, currentMonthStart, "moveIns"),
    MOVEOUTSTRL12: sumWindow(monthRecords, trailing12Start, currentMonthStart, "moveOuts"),
    NETTRL12: sumWindow(monthRecords, trailing12Start, currentMonthStart, "net"),
    MOVIPER: formatPercent(pctChange(currentMonthRecord.moveIns, previousMonthRecord.moveIns)),
    MOVOPER: formatPercent(pctChange(currentMonthRecord.moveOuts, previousMonthRecord.moveOuts)),
    MOVN: formatPercent(pctChange(currentMonthRecord.net, previousMonthRecord.net)),
  };

  const preview = buildPerformancePreview(tokens);

  return {
    ok: true,
    tokens,
    preview,
    metadata: {
      latestDateISO: dateKey(latestMoveDate),
      rowCount: totalRowsProcessed,
      distinctDates: monthRecords.length,
    },
  };
}

function toArrayBuffer(input: WorkbookInput): ArrayBuffer {
  if (input instanceof ArrayBuffer) return input;
  const view = input as ArrayBufferView;
  return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
}

function parseWorkbookDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    const ms = Math.round(value * 86400 * 1000);
    const date = new Date(excelEpoch.getTime() + ms);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addMonths(date: Date, months: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

function monthKey(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  return `${yyyy}-${mm}-01`;
}

function monthKeyToDate(key: string): Date | null {
  const match = /^(\d{4})-(\d{2})-01$/.exec(key);
  if (!match) return null;
  const [, y, m] = match;
  return new Date(Number(y), Number(m) - 1, 1);
}

function dateKey(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function sumWindow(records: MonthRecord[], start: Date, inclusiveEnd: Date, field: "moveIns" | "moveOuts" | "net") {
  const startTime = start.getTime();
  const endTime = inclusiveEnd.getTime();
  return records.reduce((total, record) => {
    const time = record.month.getTime();
    if (time >= startTime && time <= endTime) {
      return total + Number(record[field]);
    }
    return total;
  }, 0);
}
