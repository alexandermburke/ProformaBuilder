import * as XLSX from "xlsx";

// Source: Budget Comparison workbook (.xlsx) for owner reports
/* Logging helpers for uniform console output */
const moneyFmt = (n: unknown): string =>
  typeof n === "number"
    ? n.toLocaleString("en-US", { style: "currency", currency: "USD" })
    : String(n);
const pctFmt = (n: unknown): string =>
  typeof n === "number" ? `${n.toFixed(2)}%` : String(n);

type CellValue = string | number | boolean | Date | null | undefined;
type Grid = CellValue[][];
type WorkbookInput = ArrayBuffer | Uint8Array | Buffer;

export type BudgetTokenDetail = {
  value: number;
  sheet: string;
  cell: string;
  note?: string;
  source?: string;
  rawValue?: CellValue;
};

export type BudgetExtraction = {
  tokens: Record<string, number>;
  details: Record<string, BudgetTokenDetail>;
  count: number;
  debug: string[];
  templateTokens?: string[];
  ownerGroup?: string | null;
};

type BudgetSuffix = "CM" | "PTD" | "VAR" | "VARPER" | "YTD" | "YTDBUD" | "YTDVAR" | "YTDVARPER";

type ParseNumberOptions = {
  isPercent?: boolean;
  cell?: XLSX.CellObject;
};

type ValueSource = "budget" | "fallback" | "computed";

type HeaderMatch = {
  rowIndex: number;
  labelColumn: number;
  columnMap: Map<number, BudgetSuffix>;
  columnBySuffix: Map<BudgetSuffix, number>;
};

type RowValueMeta = {
  columnIndex: number;
  cellRef: string;
  sheet?: string;
  value?: number;
  source?: ValueSource;
};

type RowState = {
  base: string;
  label: string;
  rowIndex: number;
  sheetName: string;
  meta: Record<BudgetSuffix, RowValueMeta>;
};

const OWNER_PREFIX_REGEX = /^\s*owner\s*=/i;

const stripOwnerParenthetical = (input: string): string => {
  const withoutParens = input.replace(/\([^)]*\)/g, "").replace(/\s{2,}/g, " ");
  return withoutParens.trim();
};

const extractOwnerGroupFromGrid = (grid: Grid): string | null => {
  const maxRows = Math.min(grid.length, 10);
  for (let r = 0; r < maxRows; r += 1) {
    const row = grid[r];
    if (!row) continue;
    const maxCols = Math.min(row.length, 8);
    for (let c = 0; c < maxCols; c += 1) {
      const cell = row[c];
      if (typeof cell !== "string") continue;
      if (OWNER_PREFIX_REGEX.test(cell)) {
        const normalized = stripOwnerParenthetical(cell.replace(OWNER_PREFIX_REGEX, "").trim());
        if (normalized.length > 0) return normalized;
      }
    }
  }
  return null;
};

const HEADER_SEQUENCE: Array<{ suffix: BudgetSuffix; variants: string[] }> = [
  {
    suffix: "CM",
    variants: ["ptd actual", "current month actual", "current month", "ptd actuals"],
  },
  {
    suffix: "PTD",
    variants: ["ptd budget", "current month budget", "budget"],
  },
  {
    suffix: "VAR",
    variants: ["variance", "ptd variance", "variance ptd"],
  },
  {
    suffix: "VARPER",
    variants: ["% var", "% variance", "percent var", "pct var", "percent variance"],
  },
  {
    suffix: "YTD",
    variants: ["ytd actual", "actual ytd", "ytd actuals"],
  },
  {
    suffix: "YTDBUD",
    variants: ["ytd budget", "budget ytd"],
  },
  {
    suffix: "YTDVAR",
    variants: ["variance", "ytd variance", "variance ytd", "ytd var"],
  },
  {
    suffix: "YTDVARPER",
    variants: ["% var", "ytd % var", "ytd % variance", "ytd percent var", "ytd pct var"],
  },
];

const RAW_LABEL_MAP = [
  ["total rental income", "TOTRENINC"],
  ["rental income", "RENTINC"],
  ["admin fees", "ADMFEE"],
  ["late fees", "LATEFEE"],
  ["secure payment fee", "SECPP"],
  ["tenant protection fee", "INSUR"],
  ["tenant income - other", "OTHER"],
  ["retail sales", "RETSAL"],
  ["total income", "TOTALINC"],
  ["advertising & marketing", "ADVER"],
  ["auction expenses", "AUCT"],
  ["cam charges", "CAM"],
  ["credit card merchant fees", "CCM"],
  ["dues & subscriptions", "DUES"],
  ["fire prevention", "FIRE"],
  ["insur exp", "INSURXP"],
  ["insurance", "INSURXP"],
  ["licenses & permits", "PERM"],
  ["payroll costs", "MGMSTF"],
  ["management fees", "MGMT"],
  ["office supplies", "OFFSUP"],
  ["professional fees", "PROF"],
  ["repairs & maintenance", "REP"],
  ["retail products", "RETPROD"],
  ["security", "SEC"],
  ["software", "SOFT"],
  ["supplies - building", "SUPP"],
  ["telephone & internet", "INTER"],
  ["utilities", "UTIL"],
  ["total property expenses", "TOTALPROP"],
  ["total other expenses", "TOTOTHEREXP"],
  ["other expenses", "OTHEREXP"],
  ["total expenses", "TOTEXP"],
  ["interest income", "INTINC"],
  ["net income", "NETINC"],
  ["disc", "DISC"],
  ["discount", "DISC"],
  ["discounts", "DISC"],
] as const;

const SUFFIX_ORDER: BudgetSuffix[] = HEADER_SEQUENCE.map((item) => item.suffix);
const PERCENT_SUFFIXES = new Set<BudgetSuffix>(["VARPER", "YTDVARPER"]);

const BUDGET_BASES = Array.from(new Set(RAW_LABEL_MAP.map(([, base]) => base)));


export function buildAllExpectedBudgetKeys(): string[] {
  return BUDGET_BASES.flatMap((base) => SUFFIX_ORDER.map((suffix) => `${base}${suffix}`));
}

export const TOTAL_BUDGET_TOKENS = buildAllExpectedBudgetKeys().length; // 272

const normalizeWhitespace = (value: string): string =>
  value
    .replace(/\s+/g, " ")
    .trim();

const normalizeHeaderText = (value: CellValue): string =>
  normalizeWhitespace(
    String(value ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9% ]+/g, " "),
  );

const normalizeLabelText = (value: CellValue): string =>
  normalizeWhitespace(
    String(value ?? "")
      .toLowerCase()
      .replace(/&/g, "and")
      .replace(/[@#$%^*+=~`'"]/g, " ")
      .replace(/[-–—]/g, " ")
      .replace(/[()]/g, " ")
      .replace(/[^a-z0-9 ]+/g, " "),
  );

type LabelEntry = { match: string; base: string };

const EXACT_LABEL_MAP = new Map(
  RAW_LABEL_MAP.map(([label, base]) => [normalizeLabelText(label), base]),
);

const INSURXP_EXCLUDED_TERMS = ["payable", "liabilit", "prepaid", "accrued", "accrual"];
const DISC_EXCLUDED_TERMS = ["unrecognized", "unrecognised"];

const LABEL_MAP: LabelEntry[] = [...RAW_LABEL_MAP]
  .map(([label, base]) => ({
    match: normalizeLabelText(label),
    base,
  }))
  .sort((a, b) => b.match.length - a.match.length);

const toWorkbookSource = (
  input: WorkbookInput,
): { data: Uint8Array | Buffer; type: "array" | "buffer" } => {
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(input)) {
    return { data: input, type: "buffer" };
  }
  if (input instanceof ArrayBuffer) {
    return { data: new Uint8Array(input), type: "array" };
  }
  if (input instanceof Uint8Array) {
    return { data: input, type: "array" };
  }
  throw new TypeError("Unsupported workbook input type");
};

const readWorkbook = (input: WorkbookInput): XLSX.WorkBook => {
  const source = toWorkbookSource(input);
  return XLSX.read(source.data, {
    type: source.type,
    cellDates: true,
    cellNF: false,
    cellText: false,
  });
};

const sheetToGrid = (sheet: XLSX.WorkSheet): Grid =>
  XLSX.utils.sheet_to_json<CellValue[]>(sheet, { header: 1, raw: true });

const matchesHeaderVariant = (cell: CellValue, variants: string[]): boolean => {
  const normalized = normalizeHeaderText(cell);
  if (!normalized) return false;
  return variants.some((variant) => normalized.includes(variant));
};

const findHeader = (grid: Grid): HeaderMatch | null => {
  for (let r = 0; r < grid.length; r += 1) {
    const row = grid[r] ?? [];
    if (row.length < HEADER_SEQUENCE.length) continue;
    for (let c = 0; c <= row.length - HEADER_SEQUENCE.length; c += 1) {
      let matched = true;
      for (let idx = 0; idx < HEADER_SEQUENCE.length; idx += 1) {
        const headerDef = HEADER_SEQUENCE[idx];
        if (!matchesHeaderVariant(row[c + idx], headerDef.variants)) {
          matched = false;
          break;
        }
      }
      if (!matched) continue;
      const columnMap = new Map<number, BudgetSuffix>();
      const columnBySuffix = new Map<BudgetSuffix, number>();
      for (let idx = 0; idx < HEADER_SEQUENCE.length; idx += 1) {
        const columnIndex = c + idx;
        const suffix = HEADER_SEQUENCE[idx].suffix;
        columnMap.set(columnIndex, suffix);
        columnBySuffix.set(suffix, columnIndex);
      }
      return {
        rowIndex: r,
        labelColumn: Math.max(0, c - 1),
        columnMap,
        columnBySuffix,
      };
    }
  }
  return null;
};

const locateBudgetSheet = (
  workbook: XLSX.WorkBook,
): { grid: Grid; header: HeaderMatch; sheetName: string } | null => {
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    if (!sheet) continue;
    const grid = sheetToGrid(sheet);
    const header = findHeader(grid);
    if (header) {
      return { grid, header, sheetName: name };
    }
  }
  return null;
};


const parseNumber = (value: CellValue, options: ParseNumberOptions = {}): number => {
  if (value == null || value === "") return Number.NaN;
  const { isPercent = false, cell } = options;
  const percentCellFormat = String(cell?.z ?? cell?.w ?? "");
  const isPercentFormattedCell = percentCellFormat.includes("%");

  if (typeof value === "number") {
    if (!Number.isFinite(value)) return Number.NaN;
    if (!isPercent) return value;
    const abs = Math.abs(value);
    // Budget variance columns often store plain numeric percentages like 0.96,
    // which means 0.96% and must not be scaled to 96%. Only scale ratio-style
    // raw numbers when Excel explicitly marks the cell with percent formatting.
    return isPercentFormattedCell && abs <= 1 ? value * 100 : value;
  }

  if (value instanceof Date) return Number.NaN;

  let str = String(value ?? "").trim();
  if (!str) return Number.NaN;
  const hadPercentSymbol = str.includes("%");

  const upper = str.toUpperCase();
  if (upper === "N/A" || upper === "NA" || upper === "NONE" || upper === "--") return Number.NaN;

  let isNegative = false;
  if (/^\(.*\)$/.test(str)) {
    isNegative = true;
    str = str.slice(1, -1);
  }

  const percentLike = isPercent || hadPercentSymbol || isPercentFormattedCell;

  str = str.replace(/[$,%]/g, "").replace(/\s+/g, "");
  if (!str) return Number.NaN;

  const parsed = Number(str.replace(/,/g, ""));
  if (!Number.isFinite(parsed)) return Number.NaN;

  let result = parsed;
  // If the workbook already gave us an explicit percent string like "0.96%",
  // do not scale it again. Only scale ratio-style values such as 0.0096.
  if (percentLike && !hadPercentSymbol && isPercentFormattedCell && Math.abs(result) <= 1) {
    result *= 100;
  }
  if (isNegative) result *= -1;
  return result;
};


const columnIndexToLetter = (index: number): string => {
  let dividend = index + 1;
  let columnLabel = "";
  while (dividend > 0) {
    const modulo = (dividend - 1) % 26;
    columnLabel = String.fromCharCode(65 + modulo) + columnLabel;
    dividend = Math.floor((dividend - modulo) / 26);
  }
  return columnLabel;
};

const resolveLabelBase = (value: CellValue): string | null => {
  const normalized = normalizeLabelText(value);
  if (!normalized) return null;
  const isExcludedInsurxp = INSURXP_EXCLUDED_TERMS.some((term) => normalized.includes(term));
  const isExcludedDisc = DISC_EXCLUDED_TERMS.some((term) => normalized.includes(term));
  const exact = EXACT_LABEL_MAP.get(normalized);
  if (exact !== undefined) {
    if (exact === "INSURXP" && isExcludedInsurxp) return null;
    if (exact === "DISC" && isExcludedDisc) return null;
    return exact;
  }
  for (const entry of LABEL_MAP) {
    if (normalized.includes(entry.match)) {
      if (entry.base === "INSURXP" && isExcludedInsurxp) continue;
      if (entry.base === "DISC" && isExcludedDisc) continue;
      return entry.base;
    }
  }
  return null;
};

const roundMoney = (value: number): number => Math.round(value * 100) / 100;
const roundPercent = (value: number): number => Math.round(value * 100) / 100;
const normalizeZero = (value: number): number => (Object.is(value, -0) ? 0 : value);

const hasValue = (meta?: RowValueMeta): meta is RowValueMeta & { value: number } =>
  Boolean(meta && meta.value !== undefined && Number.isFinite(meta.value));


const ensureMeta = (
  row: RowState,
  header: HeaderMatch,
  suffix: BudgetSuffix,
): RowValueMeta => {
  let meta = row.meta[suffix];
  if (meta) return meta;
  const columnIndex = header.columnBySuffix.get(suffix) ?? 0;
  const cellRef = `${columnIndexToLetter(columnIndex)}${row.rowIndex + 1}`;
  meta = { columnIndex, cellRef, sheet: row.sheetName };
  row.meta[suffix] = meta;
  return meta;
};

const buildRowStates = (
  grid: Grid,
  header: HeaderMatch,
  sheetName: string,
  sheet: XLSX.WorkSheet,
  resolveBase: (value: CellValue) => string | null = resolveLabelBase,
): RowState[] => {
  const rows: RowState[] = [];
  for (let r = header.rowIndex + 1; r < grid.length; r += 1) {
    const row = grid[r] ?? [];
    const labelCell = row[header.labelColumn];
    const base = resolveBase(labelCell);
    if (!base) continue;
    const labelText = String(labelCell ?? "").trim() || base;
    const meta = {} as Record<BudgetSuffix, RowValueMeta>;
    for (const suffix of SUFFIX_ORDER) {
      const columnIndex = header.columnBySuffix.get(suffix);
      if (columnIndex === undefined) continue;
      const cellRef = `${columnIndexToLetter(columnIndex)}${r + 1}`;
      const rawValue = row[columnIndex];
      const cell = sheet[cellRef] as XLSX.CellObject | undefined;
      const numeric = parseNumber(rawValue, {
        isPercent: PERCENT_SUFFIXES.has(suffix),
        cell,
      });
      if (Number.isFinite(numeric)) {
        const value = normalizeZero(
          PERCENT_SUFFIXES.has(suffix) ? roundPercent(numeric) : roundMoney(numeric),
        );
        meta[suffix] = { columnIndex, cellRef, sheet: sheetName, value, source: "budget" };
      } else {
        meta[suffix] = { columnIndex, cellRef, sheet: sheetName };
      }
    }
    rows.push({ base, label: labelText, rowIndex: r, sheetName, meta });
  }
  return rows;
};

const parseFinancialFallback = (
  input: WorkbookInput,
): Map<string, { value: number; cellRef: string; sheet: string }> => {
  const result = new Map<string, { value: number; cellRef: string; sheet: string }>();
  try {
    const workbook = readWorkbook(input);
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) return result;
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) return result;
    const grid = sheetToGrid(sheet);
    for (let r = 0; r < grid.length; r += 1) {
      const row = grid[r] ?? [];
      const base = resolveLabelBase(row[0]);
      if (!base) continue;
      for (let c = 1; c < row.length; c += 1) {
        const numeric = parseNumber(row[c], { isPercent: false });
        if (!Number.isFinite(numeric)) continue;
        const value = normalizeZero(roundMoney(numeric));
        const cellRef = `${columnIndexToLetter(c)}${r + 1}`;
        result.set(base, { value, cellRef, sheet: sheetName });
        break;
      }
    }
  } catch (error) {
    console.warn("[budget] unable to read financial workbook", error);
  }
  return result;
};

const applyFallbacks = (
  rows: RowState[],
  header: HeaderMatch,
  fallbackMap: Map<string, { value: number; cellRef: string; sheet: string }>,
): void => {
  for (const row of rows) {
    const fallback = fallbackMap.get(row.base);
    if (!fallback) continue;
    const meta = ensureMeta(row, header, "CM");
    if (!hasValue(meta)) {
      meta.value = fallback.value;
      meta.source = "fallback";
      meta.cellRef = fallback.cellRef;
      meta.sheet = fallback.sheet;
    }
  }
};

const computeDerivedValues = (row: RowState, header: HeaderMatch): void => {
  const cmMeta = ensureMeta(row, header, "CM");
  const ptdMeta = ensureMeta(row, header, "PTD");
  const varMeta = ensureMeta(row, header, "VAR");
  if (!hasValue(varMeta) && hasValue(cmMeta) && hasValue(ptdMeta)) {
    const variance = normalizeZero(roundMoney(cmMeta.value - ptdMeta.value));
    varMeta.value = variance;
    varMeta.source = "computed";
  }

  const varPerMeta = ensureMeta(row, header, "VARPER");
  if (!hasValue(varPerMeta) && hasValue(varMeta) && hasValue(ptdMeta)) {
    const denominator = Math.abs(ptdMeta.value);
    if (denominator >= 1e-6) {
      const raw = (varMeta.value / ptdMeta.value) * 100;
      varPerMeta.value = normalizeZero(roundPercent(raw));
      varPerMeta.source = "computed";
    }
  }

  const ytdMeta = ensureMeta(row, header, "YTD");
  const ytdBudMeta = ensureMeta(row, header, "YTDBUD");
  const ytdVarMeta = ensureMeta(row, header, "YTDVAR");
  if (!hasValue(ytdVarMeta) && hasValue(ytdMeta) && hasValue(ytdBudMeta)) {
    const variance = normalizeZero(roundMoney(ytdMeta.value - ytdBudMeta.value));
    ytdVarMeta.value = variance;
    ytdVarMeta.source = "computed";
  }

  const ytdVarPerMeta = ensureMeta(row, header, "YTDVARPER");
  if (!hasValue(ytdVarPerMeta) && hasValue(ytdVarMeta) && hasValue(ytdBudMeta)) {
    const denominator = Math.abs(ytdBudMeta.value);
    if (denominator >= 1e-6) {
      const raw = (ytdVarMeta.value / ytdBudMeta.value) * 100;
      ytdVarPerMeta.value = normalizeZero(roundPercent(raw));
      ytdVarPerMeta.source = "computed";
    }
  }
};

const applyTokensAndLogs = (
  row: RowState,
  tokens: Record<string, number>,
  details: Record<string, BudgetTokenDetail>,
  debug: string[],
): void => {
  let printedRowHeader = false;
  const headerLabel = `[budget] ${row.label} (row ${row.rowIndex + 1})`;
  for (const suffix of SUFFIX_ORDER) {
    const meta = row.meta[suffix];
    if (!hasValue(meta)) continue;
    const token = `${row.base}${suffix}`;
    tokens[token] = meta.value;

    const sheet = meta.sheet ?? row.sheetName;
    const origin = `${sheet}!${meta.cellRef}`;
    const isPercent = PERCENT_SUFFIXES.has(suffix);
    const pretty = isPercent ? pctFmt(meta.value) : moneyFmt(meta.value);
    const noteParts: string[] = [];
    if (meta.source === "computed") noteParts.push("computed");
    if (meta.source === "fallback") noteParts.push("financial fallback");
    if (PERCENT_SUFFIXES.has(suffix)) {
      noteParts.push("percent stored as numeric (e.g., -12.4 for -12.4%)");
    }
    const note = noteParts.length > 0 ? noteParts.join("; ") : undefined;
    const noteSuffix = note ? ` (${note})` : "";
    const message = `  ${pretty} from ${origin} applied --> {{${token}}}${noteSuffix}`;

    if (!printedRowHeader) {
      console.log(headerLabel);
      debug.push(headerLabel);
      printedRowHeader = true;
    }
    console.log(message);
    debug.push(message);

    details[token] = {
      value: meta.value,
      sheet,
      cell: meta.cellRef,
      ...(note ? { note } : {}),
    };
  }
};

// --- QuickBooks "Budget vs. Actuals" support ---------------------------------
// QuickBooks exports a different layout than the legacy Yardi budget comparison:
//   - Column headers are Actual / Budget / Over budget by / Percent of budget,
//     repeated for the period (e.g. "May 2026") and the running "Total" (YTD).
//   - Row labels carry GL account numbers ("4100 Rental Income") and QB-style
//     "Total for <account>" subtotals.
//   - The "Percent of budget" column is actual / budget, NOT a variance %, so we
//     deliberately ignore it and compute the variance % from (variance / budget),
//     matching the template's "% Var" columns and the legacy Yardi behavior.
// Internal token bases stay identical to the Yardi parser so buildOwnerPptx's
// existing alias map (LATFEE<-LATEFEE, MGMTSTF<-MGMSTF, SUP<-SUPP, RETA<-RETPROD,
// TOTOTHEXP<-TOTOTHEREXP, ...) keeps mapping them onto the template tokens.
const isQbActual = (cell: CellValue): boolean => normalizeHeaderText(cell) === "actual";
const isQbBudget = (cell: CellValue): boolean => normalizeHeaderText(cell) === "budget";
const isQbOverBudget = (cell: CellValue): boolean => normalizeHeaderText(cell).includes("over budget");
const isQbPercentOfBudget = (cell: CellValue): boolean =>
  normalizeHeaderText(cell).includes("percent of budget");

// A QuickBooks budget header row carries one Actual/Budget/Over budget by/Percent of
// budget column GROUP per period, plus a final "Total" group. The row directly above
// holds the period labels ("May 2026", ..., "Total"). Exports can be a single month
// ([Month][Total]) or many months ([Jan][Feb]...[May][Total]); in both cases we map
// the CURRENT month (the last month group, immediately before Total) to MTD and the
// "Total" group to YTD. Intentionally omit VARPER / YTDVARPER: QB's "percent of
// budget" is actual/budget, not a variance %, so those are computed downstream.
const findQbHeader = (grid: Grid): HeaderMatch | null => {
  for (let r = 0; r < grid.length; r += 1) {
    const row = grid[r] ?? [];
    const groupStarts: number[] = [];
    for (let c = 0; c + 3 < row.length; ) {
      if (
        isQbActual(row[c]) &&
        isQbBudget(row[c + 1]) &&
        isQbOverBudget(row[c + 2]) &&
        isQbPercentOfBudget(row[c + 3])
      ) {
        groupStarts.push(c);
        c += 4;
      } else {
        c += 1;
      }
    }
    if (groupStarts.length === 0) continue;

    // Period labels sit in the row above, aligned over each group's "Actual" column.
    const superRow = grid[r - 1] ?? [];
    const totalGroupIndex = groupStarts.findIndex((start) =>
      normalizeHeaderText(superRow[start]).includes("total"),
    );

    let mtdStart: number;
    let ytdStart: number;
    if (totalGroupIndex >= 0) {
      ytdStart = groupStarts[totalGroupIndex];
      const monthStarts = groupStarts.filter((_, i) => i !== totalGroupIndex);
      mtdStart = monthStarts.length > 0 ? monthStarts[monthStarts.length - 1] : ytdStart;
    } else {
      // No "Total" column: use the most recent month group for both MTD and YTD.
      mtdStart = groupStarts[groupStarts.length - 1];
      ytdStart = mtdStart;
    }

    const columnBySuffix = new Map<BudgetSuffix, number>([
      ["CM", mtdStart],
      ["PTD", mtdStart + 1],
      ["VAR", mtdStart + 2],
      ["YTD", ytdStart],
      ["YTDBUD", ytdStart + 1],
      ["YTDVAR", ytdStart + 2],
    ]);
    const columnMap = new Map<number, BudgetSuffix>();
    for (const [suffix, columnIndex] of columnBySuffix) columnMap.set(columnIndex, suffix);
    return {
      rowIndex: r,
      labelColumn: Math.max(0, groupStarts[0] - 1),
      columnMap,
      columnBySuffix,
    };
  }
  return null;
};

const locateQbBudgetSheet = (
  workbook: XLSX.WorkBook,
): { grid: Grid; header: HeaderMatch; sheetName: string } | null => {
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    if (!sheet) continue;
    const grid = sheetToGrid(sheet);
    const header = findQbHeader(grid);
    if (header) return { grid, header, sheetName: name };
  }
  return null;
};

const stripLeadingAccountCode = (label: string): string => label.replace(/^\d{3,6}\s+/, "").trim();

const qbResolveLabelBase = (value: CellValue): string | null => {
  const normalized = normalizeLabelText(value);
  if (!normalized) return null;

  // QB subtotals: "Total for <account> <name>". Map the ones with a template row;
  // skip the rest so they never clobber the underlying line items.
  if (normalized.startsWith("total for")) {
    const rest = stripLeadingAccountCode(normalized.slice("total for".length).trim());
    if (rest.includes("rental income")) return "TOTRENINC";
    if (rest.includes("other tenant income")) return null; // no template row
    if (rest.includes("other expenses")) return "TOTOTHEREXP";
    if (rest.includes("utilities")) return "UTIL"; // template has one Utilities line
    if (rest === "income") return "TOTALINC";
    if (rest === "expenses") return "TOTALPROP";
    return null;
  }

  const stripped = stripLeadingAccountCode(normalized);
  // QuickBooks merges Office Supplies + Supplies - Building into one account.
  if (stripped.includes("office") && stripped.includes("supplies")) return "OFFSUP";
  // QB-only expense lines that the template now itemizes (so the expense column foots).
  if (stripped.includes("bank charge")) return "BANKCHG";
  if (stripped.includes("travel")) return "TRAVEL";
  return resolveLabelBase(stripped);
};

// Template has a Total Expenses row but QuickBooks has no single matching line,
// so derive it from Total Operating Expenses + Total Other Expenses.
const computeQbTotalExpenses = (
  tokens: Record<string, number>,
  details: Record<string, BudgetTokenDetail>,
): void => {
  const moneySuffixes: BudgetSuffix[] = ["CM", "PTD", "VAR", "YTD", "YTDBUD", "YTDVAR"];
  let produced = false;
  for (const suffix of moneySuffixes) {
    const operating = tokens[`TOTALPROP${suffix}`];
    const other = tokens[`TOTOTHEREXP${suffix}`];
    if (operating === undefined && other === undefined) continue;
    const total = normalizeZero(roundMoney((operating ?? 0) + (other ?? 0)));
    tokens[`TOTEXP${suffix}`] = total;
    details[`TOTEXP${suffix}`] = {
      value: total,
      sheet: "Budget Comparison",
      cell: "-",
      note: "computed: Total Operating Expenses + Total Other Expenses",
    };
    produced = true;
  }
  if (!produced) return;
  const percentPairs: Array<[BudgetSuffix, BudgetSuffix, BudgetSuffix]> = [
    ["VARPER", "VAR", "PTD"],
    ["YTDVARPER", "YTDVAR", "YTDBUD"],
  ];
  for (const [target, varSuffix, budgetSuffix] of percentPairs) {
    const variance = tokens[`TOTEXP${varSuffix}`];
    const budget = tokens[`TOTEXP${budgetSuffix}`];
    if (variance === undefined || budget === undefined || Math.abs(budget) < 1e-6) continue;
    const pct = normalizeZero(roundPercent((variance / budget) * 100));
    tokens[`TOTEXP${target}`] = pct;
    details[`TOTEXP${target}`] = { value: pct, sheet: "Budget Comparison", cell: "-", note: "computed" };
  }
};

const extractQuickBooksBudget = (
  workbook: XLSX.WorkBook,
  located: { grid: Grid; header: HeaderMatch; sheetName: string },
): BudgetExtraction => {
  const { grid, header, sheetName } = located;
  const ownerGroup = extractOwnerGroupFromGrid(grid);
  const rows = buildRowStates(grid, header, sheetName, workbook.Sheets[sheetName]!, qbResolveLabelBase);

  const tokens: Record<string, number> = {};
  const details: Record<string, BudgetTokenDetail> = {};
  const debug: string[] = [];

  for (const row of rows) {
    computeDerivedValues(row, header);
    applyTokensAndLogs(row, tokens, details, debug);
  }
  computeQbTotalExpenses(tokens, details);

  const count = Object.keys(tokens).length;
  console.log(`[budget][qb] detected ${count} numeric tokens from QuickBooks export`);
  return { tokens, details, count, debug, ownerGroup };
};

// --- L001 (Hibernia Camelback) "Budget vs. Actuals" variant ------------------
// Same column layout as the standard QB export (month groups + a Total group) but
// with different header text ("over Budget" / "% of Budget") and QuickBooks-desktop
// subtotal labels ("Total 4099 Net Rental Income", "Total Income", "Total Expenses",
// "Total Other Expenses") that carry leading-whitespace indentation. This path runs
// ONLY when the caller selects format "l001", so the standard parser is never touched.
const isL001PercentOfBudget = (cell: CellValue): boolean =>
  normalizeHeaderText(cell).includes("of budget");

const findL001Header = (grid: Grid): HeaderMatch | null => {
  for (let r = 0; r < grid.length; r += 1) {
    const row = grid[r] ?? [];
    const groupStarts: number[] = [];
    for (let c = 0; c + 3 < row.length; ) {
      if (
        isQbActual(row[c]) &&
        isQbBudget(row[c + 1]) &&
        isQbOverBudget(row[c + 2]) &&
        isL001PercentOfBudget(row[c + 3])
      ) {
        groupStarts.push(c);
        c += 4;
      } else {
        c += 1;
      }
    }
    if (groupStarts.length === 0) continue;
    const superRow = grid[r - 1] ?? [];
    const totalGroupIndex = groupStarts.findIndex((start) =>
      normalizeHeaderText(superRow[start]).includes("total"),
    );
    let mtdStart: number;
    let ytdStart: number;
    if (totalGroupIndex >= 0) {
      ytdStart = groupStarts[totalGroupIndex];
      const monthStarts = groupStarts.filter((_, i) => i !== totalGroupIndex);
      mtdStart = monthStarts.length > 0 ? monthStarts[monthStarts.length - 1] : ytdStart;
    } else {
      mtdStart = groupStarts[groupStarts.length - 1];
      ytdStart = mtdStart;
    }
    const columnBySuffix = new Map<BudgetSuffix, number>([
      ["CM", mtdStart],
      ["PTD", mtdStart + 1],
      ["VAR", mtdStart + 2],
      ["YTD", ytdStart],
      ["YTDBUD", ytdStart + 1],
      ["YTDVAR", ytdStart + 2],
    ]);
    const columnMap = new Map<number, BudgetSuffix>();
    for (const [suffix, columnIndex] of columnBySuffix) columnMap.set(columnIndex, suffix);
    return { rowIndex: r, labelColumn: Math.max(0, groupStarts[0] - 1), columnMap, columnBySuffix };
  }
  return null;
};

const locateL001BudgetSheet = (
  workbook: XLSX.WorkBook,
): { grid: Grid; header: HeaderMatch; sheetName: string } | null => {
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    if (!sheet) continue;
    const grid = sheetToGrid(sheet);
    const header = findL001Header(grid);
    if (header) return { grid, header, sheetName: name };
  }
  return null;
};

const stripL001Code = (label: string): string => label.replace(/^\d{3,5}\s+/, "").trim();

const l001ResolveLabelBase = (value: CellValue): string | null => {
  const norm = normalizeLabelText(value); // lowercased, &->and, punctuation+indent stripped, trimmed
  if (!norm) return null;

  if (norm.startsWith("total")) {
    if (/^total\s+\d/.test(norm)) {
      // Coded subtotal, e.g. "Total 4099 Net Rental Income" / "Total 4000 Income".
      const rest = stripL001Code(norm.replace(/^total\s+/, ""));
      if (rest.includes("other tenant income")) return null;
      if (rest.includes("rental income")) return "TOTRENINC";
      if (rest.includes("utilities")) return "UTIL";
      if (rest === "income") return "TOTRENINC"; // "Total 4000 Income" == rental subtotal here
      return null;
    }
    // Plain subtotal with no code.
    const rest = norm.replace(/^total\s+/, "").trim();
    if (rest === "income") return "TOTALINC";
    if (rest === "expenses") return "TOTALPROP"; // L001 "Total Expenses" = operating expenses
    if (rest.includes("other expenses")) return "TOTOTHEREXP";
    if (rest.includes("rental income")) return "TOTRENINC";
    if (rest.includes("other tenant income")) return null;
    if (rest.includes("utilities")) return "UTIL";
    return null;
  }

  const s = stripL001Code(norm);
  if (s.includes("rental income")) return "RENTINC";
  if (s.includes("discount")) return "DISC";
  if (s.includes("admin")) return "ADMFEE"; // "Fee Income - Admin"
  if (s.includes("late fee")) return "LATEFEE";
  if (s.includes("secure payment")) return "SECPP";
  if (s.includes("tenant protection")) return "INSUR";
  if (s.includes("retail sales")) return "RETSAL";
  if (s.includes("advertising")) return "ADVER";
  if (s.includes("auction")) return "AUCT";
  if (s.includes("bank charge")) return "BANKCHG";
  if (s.includes("cam charge") || s.includes("cam ")) return "CAM";
  if (s.includes("credit card")) return "CCM";
  if (s.includes("dues")) return "DUES";
  if (s.includes("fire prevention")) return "FIRE";
  if (/\binsurance\b/.test(s) && !s.includes("tenant")) return "INSURXP";
  if (s.includes("licenses")) return "PERM";
  if (s.includes("management fee")) return "MGMT";
  if (s.includes("office") && s.includes("supplies")) return "OFFSUP";
  if (s.includes("payroll")) return "MGMSTF";
  if (s.includes("professional")) return "PROF";
  if (s.includes("property tax")) return "PROPTAX"; // L001-only account (no token in standard map)
  if (s.includes("repairs")) return "REP";
  if (s.includes("retail products")) return "RETPROD";
  if (/\bsecurity\b/.test(s)) return "SEC";
  if (s.includes("software")) return "SOFT";
  if (s.includes("telephone")) return "INTER";
  if (s.includes("utilities")) return "UTIL"; // utility parent / subrows (overwritten by the Total)
  if (s.includes("interest income")) return "INTINC";
  if (s.includes("net income")) return "NETINC"; // not "net operating income" / "net other income"
  return null; // below-the-line items roll into Total Other Expenses
};

const extractL001Budget = (
  workbook: XLSX.WorkBook,
  located: { grid: Grid; header: HeaderMatch; sheetName: string },
): BudgetExtraction => {
  const { grid, header, sheetName } = located;
  const ownerGroup = extractOwnerGroupFromGrid(grid);
  const rows = buildRowStates(grid, header, sheetName, workbook.Sheets[sheetName]!, l001ResolveLabelBase);
  const tokens: Record<string, number> = {};
  const details: Record<string, BudgetTokenDetail> = {};
  const debug: string[] = [];
  for (const row of rows) {
    computeDerivedValues(row, header);
    applyTokensAndLogs(row, tokens, details, debug);
  }
  computeQbTotalExpenses(tokens, details);
  const count = Object.keys(tokens).length;
  console.log(`[budget][l001] detected ${count} numeric tokens from L001 export`);
  return { tokens, details, count, debug, ownerGroup };
};

export async function extractBudgetTableFields(
  budgetBuffer: WorkbookInput,
  financialsBuffer?: WorkbookInput,
  format: "standard" | "l001" = "standard",
): Promise<BudgetExtraction> {
  let workbook: XLSX.WorkBook;
  try {
    workbook = readWorkbook(budgetBuffer);
  } catch (error) {
    console.warn("[budget] unable to read budget workbook", error);
    return { tokens: {}, details: {}, count: 0, debug: [], ownerGroup: null };
  }

  // Explicit override: force the L001 parser when the caller asks for it.
  if (format === "l001") {
    const forced = locateL001BudgetSheet(workbook);
    if (forced) {
      return extractL001Budget(workbook, forced);
    }
    console.warn("[budget][l001] L001 header not found despite l001 format; auto-detecting");
  }

  // Auto-detect by layout. Standard QB ("Percent of budget") is tried FIRST so a
  // standard file is always matched before L001 is considered and never reaches the
  // L001 parser. L001 ("% of Budget") is only used when standard detection fails.
  const qbLocated = locateQbBudgetSheet(workbook);
  if (qbLocated) {
    return extractQuickBooksBudget(workbook, qbLocated);
  }

  const l001AutoLocated = locateL001BudgetSheet(workbook);
  if (l001AutoLocated) {
    return extractL001Budget(workbook, l001AutoLocated);
  }

  const located = locateBudgetSheet(workbook);
  if (!located) {
    console.warn("[budget] header not found: check PTD/YTD columns in sheet");
    return { tokens: {}, details: {}, count: 0, debug: [], ownerGroup: null };
  }

  const { grid, header, sheetName } = located;
  const ownerGroup = extractOwnerGroupFromGrid(grid);
  const rows = buildRowStates(grid, header, sheetName, workbook.Sheets[sheetName]!);

  if (financialsBuffer) {
    const fallbackMap = parseFinancialFallback(financialsBuffer);
    applyFallbacks(rows, header, fallbackMap);
  }

  const tokens: Record<string, number> = {};
  const details: Record<string, BudgetTokenDetail> = {};
  const debug: string[] = [];

  for (const row of rows) {
    computeDerivedValues(row, header);
    applyTokensAndLogs(row, tokens, details, debug);
  }

  const applied = Object.keys(tokens).length;
  const expected = TOTAL_BUDGET_TOKENS; // 272
  console.log(`[budget] detected ${applied} numeric tokens`);
  if (applied !== expected) {
    const expectedKeys = buildAllExpectedBudgetKeys(); // BUDGET_LINES x BUDGET_COLUMNS
    const missing = expectedKeys.filter((key) => !(key in tokens)).sort();
    console.warn(
      "[budget] WARNING: missing tokens not applied:",
      missing.length > 50 ? `${missing.length} tokens` : missing,
    );
  }

  const count = Object.keys(tokens).length;
  return { tokens, details, count, debug, ownerGroup };
}
