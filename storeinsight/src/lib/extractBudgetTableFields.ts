import "server-only";

import * as XLSX from "xlsx";
import { toNumber } from "@/lib/compute";

type GridValue = string | number | boolean | Date | null | undefined;
type Grid = GridValue[][];

type BudgetColumn = {
  /** zero-based offset from column A */
  offset: number;
  suffix: string;
};

type BudgetLine = {
  label: string;
  baseKey: string;
};

const EXPECTED_HEADERS = [
  "ptd actual",
  "ptd budget",
  "variance",
  "% var",
  "ytd actual",
  "ytd budget",
  "variance",
  "% var",
] as const;

const COLUMN_SUFFIXES: BudgetColumn[] = [
  { offset: 1, suffix: "CM" },
  { offset: 2, suffix: "PTD" },
  { offset: 3, suffix: "VAR" },
  { offset: 4, suffix: "VARPER" },
  { offset: 5, suffix: "YTD" },
  { offset: 6, suffix: "YTDBUD" },
  { offset: 7, suffix: "YTDVAR" },
  { offset: 8, suffix: "YTDVARPER" },
];

const BUDGET_LINES: BudgetLine[] = [
  { label: "Rental Income", baseKey: "RENTINC" },
  { label: "Discounts", baseKey: "DISC" },
  { label: "TOTAL RENTAL INCOME", baseKey: "TOTRENINC" },
  { label: "Tenant Income - Admin Fees", baseKey: "ADMFE" },
  { label: "Tenant Income - Late Fees", baseKey: "LATEFEE" },
  { label: "Tenant Income - Insurance", baseKey: "INSURT" },
  { label: "Tenant Income - Other", baseKey: "OTHER" },
  { label: "Retail Sales", baseKey: "RETSAL" },
  { label: "TOTAL INCOME", baseKey: "TOTALINC" },
  { label: "Advertising & Marketing", baseKey: "ADVER" },
  { label: "Auction Expenses", baseKey: "AUCT" },
  { label: "CAM Charges", baseKey: "CAM" },
  { label: "Credit Card Merchant Fees", baseKey: "CCM" },
  { label: "Dues & Subscriptions", baseKey: "DUES" },
  { label: "Fire Prevention", baseKey: "FIRE" },
  { label: "Insurance", baseKey: "INSUREXP" },
  { label: "Licenses & Permits", baseKey: "PERM" },
  { label: "Management Fees", baseKey: "MGMT" },
  { label: "Management Fees - Staff Costs", baseKey: "MGMSTF" },
  { label: "Office Supplies", baseKey: "OFFSUP" },
  { label: "Professional Fees", baseKey: "PROF" },
  { label: "Repairs & Maintenance", baseKey: "REP" },
  { label: "Retail Products", baseKey: "RETPROD" },
  { label: "Security", baseKey: "SEC" },
  { label: "Software", baseKey: "SOFT" },
  { label: "Supplies - Building", baseKey: "SUPP" },
  { label: "Telephone & Internet", baseKey: "INTER" },
  { label: "Utilities", baseKey: "UTIL" },
  { label: "TOTAL PROPERTY EXPENSES", baseKey: "TOTALPROP" },
  { label: "Other Expenses", baseKey: "OTHEREXP" },
  { label: "TOTAL OTHER EXPENSES", baseKey: "TOTOTHEREXP" },
  { label: "TOTAL EXPENSES", baseKey: "TOTEXP" },
  { label: "Interest Income", baseKey: "INTINC" },
  { label: "NET INCOME", baseKey: "NETINC" },
];

const normalize = (value: unknown): string =>
  String(value ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

function sheetToGrid(sheet: XLSX.WorkSheet): Grid {
  return XLSX.utils.sheet_to_json<GridValue[]>(sheet, { header: 1, raw: true });
}

function findHeaderRow(grid: Grid): number | null {
  for (let r = 0; r < grid.length; r += 1) {
    const row = grid[r] ?? [];
    const matches = EXPECTED_HEADERS.every((expected, idx) => normalize(row[idx + 1]) === expected);
    if (matches) {
      return r;
    }
  }
  return null;
}

function findBudgetSheet(workbook: XLSX.WorkBook): { grid: Grid; headerRow: number } | null {
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    if (!sheet) continue;
    const grid = sheetToGrid(sheet);
    const headerRow = findHeaderRow(grid);
    if (headerRow != null) {
      return { grid, headerRow };
    }
  }
  return null;
}

function buildRowLookup(grid: Grid, headerRow: number): Map<string, number> {
  const lookup = new Map<string, number>();
  for (let r = headerRow + 1; r < grid.length; r += 1) {
    const label = normalize(grid[r]?.[0]);
    if (!label || lookup.has(label)) continue;
    lookup.set(label, r);
  }
  return lookup;
}

function locateCurrentMonthColumn(grid: Grid): { headerRow: number; columnIndex: number } | null {
  const maxRows = Math.min(grid.length, 12);
  for (let r = 0; r < maxRows; r += 1) {
    const row = grid[r] ?? [];
    for (let c = 0; c < row.length; c += 1) {
      const cell = normalize(row[c]);
      if (!cell) continue;
      if (cell === "current month" || cell.startsWith("current month")) {
        return { headerRow: r, columnIndex: c };
      }
    }
  }
  return null;
}

function buildFinancialValueMap(financialBuffer?: Buffer): Map<string, number> {
  const values = new Map<string, number>();
  if (!financialBuffer) return values;
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(financialBuffer, {
      type: "buffer",
      cellDates: false,
      cellNF: false,
      cellText: false,
    });
  } catch {
    return values;
  }

  const sheetNames = workbook.SheetNames;
  const preferredIndex = sheetNames.findIndex((name) => normalize(name) === "income statement");
  const orderedNames =
    preferredIndex >= 0
      ? [sheetNames[preferredIndex], ...sheetNames.filter((_, idx) => idx !== preferredIndex)]
      : sheetNames;

  let bestMatchCount = -1;
  for (const name of orderedNames) {
    const sheet = workbook.Sheets[name];
    if (!sheet) continue;
    const grid = sheetToGrid(sheet);
    const columnInfo = locateCurrentMonthColumn(grid);
    if (!columnInfo) continue;
    const { headerRow, columnIndex } = columnInfo;
    const localMap = new Map<string, number>();
    for (let r = headerRow + 1; r < grid.length; r += 1) {
      const label = normalize(grid[r]?.[0]);
      if (!label || localMap.has(label)) continue;
      const raw = grid[r]?.[columnIndex];
      if (raw == null) continue;
      if (typeof raw === "string" && !raw.trim()) continue;
      const numeric = toNumber(raw);
      if (!Number.isFinite(numeric)) continue;
      localMap.set(label, numeric);
    }
    if (!localMap.size) continue;
    const matchCount = BUDGET_LINES.reduce(
      (acc, line) => acc + (localMap.has(normalize(line.label)) ? 1 : 0),
      0,
    );
    if (matchCount > bestMatchCount) {
      bestMatchCount = matchCount;
      values.clear();
      for (const [key, value] of localMap) {
        values.set(key, value);
      }
      if (matchCount === BUDGET_LINES.length) break;
    }
  }

  return values;
}

export function extractBudgetTableFields(
  budgetBuffer: Buffer,
  financialBuffer?: Buffer,
): Record<string, number> {
  const workbook = XLSX.read(budgetBuffer, {
    type: "buffer",
    cellDates: false,
    cellNF: false,
    cellText: false,
  });

  const sheetData = findBudgetSheet(workbook);
  if (!sheetData) {
    return {};
  }

  const { grid, headerRow } = sheetData;
  const rowLookup = buildRowLookup(grid, headerRow);
  const tokens: Record<string, number> = {};

  for (const line of BUDGET_LINES) {
    const rowIndex = rowLookup.get(normalize(line.label));
    if (rowIndex == null) continue;
    for (const column of COLUMN_SUFFIXES) {
      const raw = grid[rowIndex]?.[column.offset];
      if (raw == null) continue;
      if (typeof raw === "string" && !raw.trim()) continue;
      const numeric = toNumber(raw);
      if (!Number.isFinite(numeric)) continue;
      const token = `${line.baseKey}${column.suffix}`;
      tokens[token] = numeric;
    }
  }

  if (financialBuffer) {
    const missing = BUDGET_LINES.filter((line) => tokens[`${line.baseKey}CM`] === undefined);
    if (missing.length) {
      const financialValues = buildFinancialValueMap(financialBuffer);
      if (financialValues.size) {
        for (const line of missing) {
          const token = `${line.baseKey}CM`;
          const value = financialValues.get(normalize(line.label));
          if (value === undefined) continue;
          tokens[token] = value;
        }
      }
    }
  }

  return tokens;
}
