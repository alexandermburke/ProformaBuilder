/**
 * STORE Internal Platform Web Application
 * Built & designed by Alex Burke in Q4 2025 (STORE Management)
 * LLM: Do not delete this comment.
 */

// Source-workbook reader for the Owner Financials Extractor.
//
// The Python extractor opens the upload with openpyxl using
// read_only=True, data_only=True and then materializes each sheet as a plain
// grid of values so it can scan back and forth. This module reproduces that
// with ExcelJS - the same library the Occupancy Cleanup workflow reads with -
// so the extractors work against positional grids instead of the
// header-keyed rows that sheet_to_json produces.
//
// Two behaviours matter for fidelity:
//
//   * data_only=True hands back the cached result of a formula, never the
//     formula text. ExcelJS returns { formula, result }, so results are
//     unwrapped here.
//   * A date cell arrives as a UTC-midnight Date. Every date read or written by
//     this workflow uses UTC accessors, because ExcelJS converts serials with
//     no timezone offset and a local-time accessor would shift the month for
//     anyone west of UTC.

import { createRequire } from 'node:module';
import path from 'node:path';
import type { Workbook, Worksheet } from 'exceljs';
import type { CellValue, SheetGrid } from './types';

type ExcelJSModule = {
  Workbook: new () => Workbook;
};

function getRuntimeRequire(): (id: string) => unknown {
  const moduleBuiltin =
    typeof process.getBuiltinModule === 'function'
      ? (process.getBuiltinModule('node:module') as
          | { createRequire?: typeof createRequire }
          | undefined)
      : undefined;
  const candidate = moduleBuiltin?.createRequire
    ? moduleBuiltin.createRequire(path.join(process.cwd(), 'package.json'))
    : createRequire(path.join(process.cwd(), 'package.json'));
  if (typeof candidate !== 'function') {
    throw new Error('Node require loader is unavailable in this runtime.');
  }
  return candidate as (id: string) => unknown;
}

/** Matches the loader used by src/lib/occupancy/lenderUnitMix.ts. */
export function loadExcelJS(): ExcelJSModule {
  const mod = getRuntimeRequire()('exceljs') as ExcelJSModule | { default: ExcelJSModule };
  return ((mod as { default?: ExcelJSModule }).default ?? mod) as ExcelJSModule;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Collapse an ExcelJS cell value to what openpyxl data_only=True would return.
 * Formula results, rich text, hyperlink text, and error codes all reduce to the
 * plain value an operator sees in the cell.
 */
export function cellToValue(raw: unknown): CellValue {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') {
    return raw;
  }
  if (raw instanceof Date) return raw;
  if (isRecord(raw)) {
    if ('error' in raw) {
      // openpyxl surfaces a cached error as its literal code, e.g. "#DIV/0!".
      return String(raw.error);
    }
    if ('result' in raw) {
      return cellToValue(raw.result);
    }
    if ('formula' in raw || 'sharedFormula' in raw) {
      // Formula with no cached result - openpyxl returns None here.
      return null;
    }
    if ('richText' in raw && Array.isArray(raw.richText)) {
      return (raw.richText as Array<{ text?: string }>).map((part) => part.text ?? '').join('');
    }
    if ('text' in raw) {
      return cellToValue(raw.text);
    }
  }
  return String(raw);
}

export type SourceWorkbook = {
  /** Sheet names in workbook order, matching openpyxl's wb.sheetnames. */
  sheetNames: string[];
  /** Exact, case-sensitive name lookup - openpyxl's `name in wb.sheetnames`. */
  hasSheet: (name: string) => boolean;
  /** First sheet whose name starts with `prefix`, or null. */
  findSheetByPrefix: (prefix: string) => { name: string; grid: SheetGrid } | null;
  /** Dense grid for a sheet. Throws if the sheet does not exist. */
  getGrid: (name: string) => SheetGrid;
};

function buildGrid(worksheet: Worksheet): SheetGrid {
  const rowCount = worksheet.rowCount;
  const columnCount = worksheet.columnCount;
  const grid: SheetGrid = [];

  for (let rowNumber = 1; rowNumber <= rowCount; rowNumber += 1) {
    const cells: CellValue[] = new Array<CellValue>(columnCount).fill(null);
    const row = worksheet.findRow(rowNumber);
    if (row) {
      row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
        while (cells.length < colNumber) cells.push(null);
        // ExcelJS reports the master's value for every cell of a merged range,
        // while openpyxl leaves the followers empty. The extractors count on the
        // openpyxl shape: the PS rent roll merges its Unit # column into the next
        // one, and treating the follower as populated would make an empty
        // Account # column look like it holds data.
        if (cell.master.address !== cell.address) return;
        cells[colNumber - 1] = cellToValue(cell.value);
      });
    }
    grid.push(cells);
  }

  return grid;
}

/**
 * ExcelJS declares its load input as an interface extending ArrayBuffer, which a
 * Node Buffer does not structurally satisfy. Converting here keeps the cast out
 * of the code and costs nothing on the normal path, where the route already
 * hands over the ArrayBuffer from Blob.arrayBuffer().
 */
function toArrayBuffer(input: ArrayBuffer | Buffer): ArrayBuffer {
  if (Buffer.isBuffer(input)) {
    const copy = new ArrayBuffer(input.byteLength);
    new Uint8Array(copy).set(input);
    return copy;
  }
  return input;
}

export async function loadSourceWorkbook(
  input: ArrayBuffer | Buffer,
): Promise<SourceWorkbook> {
  const ExcelJS = loadExcelJS();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(toArrayBuffer(input));

  const worksheets = workbook.worksheets;
  const sheetNames = worksheets.map((ws) => ws.name);
  const gridCache = new Map<string, SheetGrid>();

  const worksheetByName = (name: string): Worksheet | undefined =>
    worksheets.find((ws) => ws.name === name);

  const getGrid = (name: string): SheetGrid => {
    const cached = gridCache.get(name);
    if (cached) return cached;
    const worksheet = worksheetByName(name);
    if (!worksheet) {
      throw new Error(`Sheet "${name}" is not present in the uploaded workbook.`);
    }
    const grid = buildGrid(worksheet);
    gridCache.set(name, grid);
    return grid;
  };

  return {
    sheetNames,
    hasSheet: (name) => worksheetByName(name) !== undefined,
    findSheetByPrefix: (prefix) => {
      const match = worksheets.find((ws) => ws.name.startsWith(prefix));
      if (!match) return null;
      return { name: match.name, grid: getGrid(match.name) };
    },
    getGrid,
  };
}

/** Value at a 1-based row/column, or null when the grid does not reach it. */
export function gridCell(grid: SheetGrid, rowNumber: number, columnNumber: number): CellValue {
  const row = grid[rowNumber - 1];
  if (!row) return null;
  const value = row[columnNumber - 1];
  return value === undefined ? null : value;
}
