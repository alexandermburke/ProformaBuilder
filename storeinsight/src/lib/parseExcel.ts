// /src/lib/parseExcel.ts
/* eslint-disable @typescript-eslint/no-explicit-any */
import * as XLSX from 'xlsx';

export type ParsedSheet = {
  name: string;
  headers: string[];
  rows: Record<string, any>[];
  /** 2D grid of raw cell values (kept for band detection) */
  grid?: any[][];
};

export type UploadParseResult = {
  fileName: string;
  sheets: ParsedSheet[];
};

/* ---------------------------- helpers ---------------------------------- */

function readAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as ArrayBuffer);
    fr.onerror = () => reject(fr.error);
    fr.readAsArrayBuffer(file);
  });
}

function coerceHeaderCell(v: unknown, idx: number): string {
  if (typeof v === 'string' && v.trim()) return v.trim();
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'number') return String(v);
  return `__EMPTY_${idx + 1}`;
}

/** Excel serial to Date (1900 system) */
function excelSerialToDate(n: number): Date {
  // Excel's day 1 is 1899-12-31, but it treats 1900 as leap (off by 1).
  const epoch = new Date(Date.UTC(1899, 11, 30)); // 1899-12-30
  const ms = Math.round(n * 24 * 60 * 60 * 1000);
  return new Date(epoch.getTime() + ms);
}

/** Normalize to "mmm-YYYY" or "" */
function normalizeMonth(v: unknown): string {
  const tryFmt = (d: Date) =>
    new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric' })
      .format(d)
      .replace(' ', '-')
      .toLowerCase(); // "Sep-2025" -> "sep-2025"

  if (v instanceof Date) return tryFmt(v);

  if (typeof v === 'number' && Number.isFinite(v) && v > 20000 && v < 80000) {
    // plausible Excel serial
    return tryFmt(excelSerialToDate(v));
  }

  if (typeof v === 'string') {
    const s = v.trim();

    // Mon YYYY
    let m = s.match(/^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{4})$/i);
    if (m) return `${m[1].slice(0, 3).toLowerCase()}-${m[2]}`;

    // MMM-YY
    m = s.match(/^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[-\s]?(\d{2})$/i);
    if (m) return `${m[1].slice(0, 3).toLowerCase()}-20${m[2]}`;

    // M/YYYY or MM/YYYY
    m = s.match(/^(\d{1,2})[\/](\d{4})$/);
    if (m) {
      const mm = Number(m[1]) - 1;
      const y = m[2];
      const mon = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'][mm];
      if (mon) return `${mon}-${y}`;
    }

    // YYYY-MM
    m = s.match(/^(\d{4})[-](\d{1,2})$/);
    if (m) {
      const y = m[1];
      const mm = Number(m[2]) - 1;
      const mon = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'][mm];
      if (mon) return `${mon}-${y}`;
    }
  }
  return '';
}

function toMonthIndex(norm: string): number | null {
  const m = norm.match(/^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)-(\d{4})$/);
  if (!m) return null;
  const idx = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(
    m[1]
  );
  return Number(m[2]) * 12 + idx;
}

function isSequential12(norms: string[]): boolean {
  const idxs = norms.map(toMonthIndex);
  if (idxs.some((x) => x == null)) return false;
  let ok = 0;
  for (let i = 1; i < idxs.length; i++) if ((idxs[i] as number) - (idxs[i - 1] as number) === 1) ok++;
  return ok >= 9; // allow a couple of gaps/oddities
}

/** Find first 12-month horizontal band in a 2D grid */
function findMonthBandInGrid(
  grid: any[][]
): { row: number; startCol: number; labels: string[] } | null {
  if (!grid || !grid.length) return null;

  for (let r = 0; r < Math.min(grid.length, 120); r++) {
    const row = grid[r] ?? [];
    for (let c = 0; c < Math.max(0, row.length - 11); c++) {
      const labels: string[] = [];
      for (let k = 0; k < 12; k++) {
        const norm = normalizeMonth(row[c + k]);
        if (!norm) {
          labels.length = 0;
          break;
        }
        labels.push(norm);
      }
      if (labels.length === 12) {
        const uniq = new Set(labels);
        if (uniq.size >= 8 && isSequential12(labels)) {
          return { row: r, startCol: c, labels };
        }
      }
    }
  }
  return null;
}

/* ----------------------------- main parse -------------------------------- */

export async function parseExcelFile(file: File): Promise<UploadParseResult> {
  const buf = await readAsArrayBuffer(file);
  const wb = XLSX.read(buf, { cellDates: true, cellNF: true, cellText: false });

  const outSheets: ParsedSheet[] = [];

  wb.SheetNames.forEach((name) => {
    const ws = wb.Sheets[name];
    // 2D grid for detection
    const grid = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' }) as any[][];
    // simple header row (first row, but we won't rely on it later)
    const headers = (grid[0] ?? []).map((v, i) => coerceHeaderCell(v, i));
    // simple rows (kept for backwards compatibility)
    const rows = XLSX.utils.sheet_to_json(ws, {
      raw: true,
      defval: '',
      header: headers.length ? headers : 1,
    }) as Record<string, any>[];

    outSheets.push({ name, headers: headers.length ? headers : [], rows, grid });
  });

  // Reorder: put first sheet with a valid 12-month band first
  const idx = outSheets.findIndex((s) => findMonthBandInGrid(s.grid ?? []) !== null);
  if (idx > 0) {
    const [hit] = outSheets.splice(idx, 1);
    outSheets.unshift(hit);
  }

  return {
    fileName: file.name,
    sheets: outSheets,
  };
}