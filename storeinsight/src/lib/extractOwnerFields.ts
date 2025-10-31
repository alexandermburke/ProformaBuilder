import * as XLSX from "xlsx";
import { DEFAULT_OWNER_FIELDS, FIELD_LABELS, type OwnerFields } from "@/types/ownerReport";

type Grid = (string | number | boolean | Date | null | undefined)[][];

const norm = (s: unknown) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

function pickNeighbor(grid: Grid, r: number, c: number): unknown {
  return grid[r]?.[c + 1] ?? grid[r + 1]?.[c] ?? grid[r]?.[c + 2] ?? "";
}

function toNumber(v: unknown): number {
  if (typeof v === "number") return v;
  const raw = String(v ?? "").trim();
  if (!raw) return 0;
  const isNegative = /^\(.*\)$/.test(raw);
  const cleaned = raw.replace(/[(),$%\s]/g, "");
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return 0;
  return isNegative ? -n : n;
}

function toISODateMaybe(v: unknown): string {
  if (v instanceof Date && !isNaN(v as unknown as number)) {
    const yyyy = v.getFullYear();
    const mm = String(v.getMonth() + 1).padStart(2, "0");
    const dd = String(v.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }
  const s = String(v ?? "").trim();
  if (!s) return "";
  return s;
}

function currentDateFromFilename(filename: string): string {
  const iso = filename.match(/(20\d{2})[-_\.]?(0[1-9]|1[0-2])[-_\.]?(0[1-9]|[12]\d|3[01])/);
  if (iso) {
    const [, y, m, d] = iso;
    return `${y}-${m}-${d}`;
  }
  return "";
}

function cellValue(grid: Grid, row: number, col: number): unknown {
  return grid[row]?.[col];
}

function cellRefToIndex(cell: string): [number, number] | null {
  const match = /^([A-Za-z]+)(\d+)$/.exec(cell.trim());
  if (!match) return null;
  const [, letters, rowStr] = match;
  let col = 0;
  for (const ch of letters.toUpperCase()) {
    col = col * 26 + (ch.charCodeAt(0) - 64);
  }
  const row = Number.parseInt(rowStr, 10);
  if (!Number.isFinite(row) || row <= 0) return null;
  return [row - 1, col - 1];
}

function valueFromCellRef(grid: Grid, cell: string): unknown {
  const index = cellRefToIndex(cell);
  if (!index) return undefined;
  const [row, col] = index;
  return cellValue(grid, row, col);
}

function excelSerialToDate(serial: number): Date | null {
  if (!Number.isFinite(serial)) return null;
  const excelEpoch = new Date(Date.UTC(1899, 11, 30));
  const ms = Math.round(serial * 86400 * 1000);
  const date = new Date(excelEpoch.getTime() + ms);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseDate(value: unknown): Date | null {
  if (value instanceof Date && !isNaN(value as unknown as number)) {
    return value;
  }
  if (typeof value === "number") {
    return excelSerialToDate(value);
  }
  const str = String(value ?? "").trim();
  if (!str) return null;
  const iso = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    const date = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const mdY = str.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (mdY) {
    const [month, day, year] = [Number(mdY[1]), Number(mdY[2]), Number(mdY[3].length === 2 ? `20${mdY[3]}` : mdY[3])];
    const date = new Date(year, month - 1, day);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const parsed = new Date(str);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatMonthYear(value: unknown): string {
  const date = parseDate(value);
  if (!date) return "";
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(date);
}

function monthLabel(value: unknown): string {
  const formatted = formatMonthYear(value);
  const source = formatted || String(value ?? "").trim();
  if (!source) return "";
  const withoutYear = source.replace(/\s+\d{4}$/, "").trim();
  return withoutYear || source;
}

type CellFallbackKind = "string" | "number" | "month";

const CELL_FALLBACKS: Partial<
  Record<
    keyof OwnerFields,
    {
      ref: string;
      kind: CellFallbackKind;
    }
  >
> = {
  CURRENTDATE: { ref: "A3", kind: "month" },
  CURRENTMONTH: { ref: "A3", kind: "month" },
  ADDRESS: { ref: "K2", kind: "string" },
  TOTALUNITS: { ref: "K22", kind: "number" },
  RENTABLESQFT: { ref: "M22", kind: "number" },
  TOTALRENTALINCOME: { ref: "E31", kind: "number" },
  TOTALINCOME: { ref: "E49", kind: "number" },
  OCCUPIEDAREASQFT: { ref: "M19", kind: "number" },
  OCCUPANCYBYUNITS: { ref: "L19", kind: "number" },
  OCCUPIEDAREAPERCENT: { ref: "N19", kind: "number" },
  MOVEINS_TODAY: { ref: "I7", kind: "number" },
  MOVEINS_MTD: { ref: "J7", kind: "number" },
  MOVEINS_YTD: { ref: "K7", kind: "number" },
  MOVEOUTS_TODAY: { ref: "I8", kind: "number" },
  MOVEOUTS_MTD: { ref: "J8", kind: "number" },
  MOVEOUTS_YTD: { ref: "K8", kind: "number" },
  NET_TODAY: { ref: "I9", kind: "number" },
  NET_MTD: { ref: "J9", kind: "number" },
  NET_YTD: { ref: "K9", kind: "number" },
  MOVEINS_SQFT_MTD: { ref: "L12", kind: "number" },
  MOVEOUTS_SQFT_MTD: { ref: "L13", kind: "number" },
  NET_SQFT_MTD: { ref: "L14", kind: "number" },
};

export function extractOwnerFields(buffer: Buffer, filename = "report.xlsx"): OwnerFields {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const firstSheetName = wb.SheetNames[0];
  const ws = wb.Sheets[firstSheetName];
  const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true }) as Grid;

  const out: OwnerFields = { ...DEFAULT_OWNER_FIELDS };

  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < (grid[r]?.length ?? 0); c++) {
      const val = grid[r]?.[c];
      const n = norm(val);
      if (!n) continue;

      for (const key of Object.keys(FIELD_LABELS) as (keyof OwnerFields)[]) {
        if (out[key]) continue;
        const matches = FIELD_LABELS[key].some((lbl) => n.includes(lbl));
        if (!matches) continue;
        const neighbor = pickNeighbor(grid, r, c);
        switch (key) {
          case "TOTALUNITS":
            out.TOTALUNITS = toNumber(neighbor);
            break;
          case "RENTABLESQFT":
            out.RENTABLESQFT = toNumber(neighbor);
            break;
          case "ACQUIREDDATE": {
            const iso = toISODateMaybe(neighbor);
            out.ACQUIREDDATE = iso || String(neighbor ?? "");
            break;
          }
          case "CURRENTDATE": {
            const formatted = formatMonthYear(neighbor);
            if (formatted) out.CURRENTDATE = formatted;
            break;
          }
          case "CURRENTMONTH":
            break;
          case "TOTALRENTALINCOME":
            out.TOTALRENTALINCOME = toNumber(neighbor);
            break;
          case "TOTALINCOME":
            out.TOTALINCOME = toNumber(neighbor);
            break;
          case "TOTALEXPENSES":
            out.TOTALEXPENSES = toNumber(neighbor);
            break;
          case "NETINCOME":
            out.NETINCOME = toNumber(neighbor);
            break;
          case "OCCUPIEDAREASQFT":
            out.OCCUPIEDAREASQFT = toNumber(neighbor);
            break;
          case "OCCUPANCYBYUNITS":
            out.OCCUPANCYBYUNITS = toNumber(neighbor);
            break;
          case "OCCUPIEDAREAPERCENT":
            out.OCCUPIEDAREAPERCENT = toNumber(neighbor);
            break;
          case "MOVEINS_TODAY":
            out.MOVEINS_TODAY = toNumber(neighbor);
            break;
          case "MOVEINS_MTD":
            out.MOVEINS_MTD = toNumber(neighbor);
            break;
          case "MOVEINS_YTD":
            out.MOVEINS_YTD = toNumber(neighbor);
            break;
          case "MOVEOUTS_TODAY":
            out.MOVEOUTS_TODAY = toNumber(neighbor);
            break;
          case "MOVEOUTS_MTD":
            out.MOVEOUTS_MTD = toNumber(neighbor);
            break;
          case "MOVEOUTS_YTD":
            out.MOVEOUTS_YTD = toNumber(neighbor);
            break;
          case "NET_TODAY":
            out.NET_TODAY = toNumber(neighbor);
            break;
          case "NET_MTD":
            out.NET_MTD = toNumber(neighbor);
            break;
          case "NET_YTD":
            out.NET_YTD = toNumber(neighbor);
            break;
          case "MOVEINS_SQFT_MTD":
            out.MOVEINS_SQFT_MTD = toNumber(neighbor);
            break;
          case "MOVEOUTS_SQFT_MTD":
            out.MOVEOUTS_SQFT_MTD = toNumber(neighbor);
            break;
          case "NET_SQFT_MTD":
            out.NET_SQFT_MTD = toNumber(neighbor);
            break;
          default:
            out[key] = String(neighbor ?? "");
        }
      }
    }
  }

  if (!out.CURRENTDATE) out.CURRENTDATE = currentDateFromFilename(filename);
  if (out.CURRENTDATE) {
    const formattedDate = formatMonthYear(out.CURRENTDATE);
    if (formattedDate) out.CURRENTDATE = formattedDate;
  }

  const writableOut = out as Record<keyof OwnerFields, unknown>;
  for (const key of Object.keys(CELL_FALLBACKS) as (keyof OwnerFields)[]) {
    const meta = CELL_FALLBACKS[key];
    if (!meta) continue;
    const existing = writableOut[key];
    const isNumberField = typeof DEFAULT_OWNER_FIELDS[key] === "number";
    const needsValue = isNumberField ? Number(existing ?? 0) === 0 : !String(existing ?? "").trim();
    if (!needsValue) continue;
    const raw = valueFromCellRef(grid, meta.ref);
    if (raw == null || raw === "") continue;
    if (meta.kind === "number") {
      writableOut[key] = toNumber(raw);
    } else if (meta.kind === "string") {
      writableOut[key] = String(raw);
    } else if (meta.kind === "month") {
      const formatted = key === "CURRENTMONTH" ? monthLabel(raw) : formatMonthYear(raw);
      if (formatted) writableOut[key] = formatted;
    }
  }

  if (!out.CURRENTMONTH && out.CURRENTDATE) {
    const monthOnly = monthLabel(out.CURRENTDATE);
    if (monthOnly) out.CURRENTMONTH = monthOnly;
  }
  if (!out.TOTALUNITS) {
    for (let r = 0; r < grid.length; r++) {
      if (grid[r]?.some((v) => norm(v) === "total")) {
        const nums = (grid[r] ?? []).map(toNumber).filter((n) => n > 0);
        if (nums.length) {
          out.TOTALUNITS = nums[0];
          break;
        }
      }
    }
  }

  return out;
}
