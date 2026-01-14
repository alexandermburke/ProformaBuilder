import * as XLSX from "xlsx";

// Source: Budget Comparison workbook (.xlsx) for owner reports
/* Logging helpers for uniform console output */
const moneyFmt = (n: unknown): string =>
  typeof n === "number"
    ? n.toLocaleString("en-US", { style: "currency", currency: "USD" })
    : String(n);
const pctFmt = (n: unknown): string =>
  typeof n === "number" ? `${n.toFixed(1)}%` : String(n);

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
  ["insurance", "INSUREXP"],
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
  ["discounts", "DISC"],
] as const;

const SUFFIX_ORDER: BudgetSuffix[] = HEADER_SEQUENCE.map((item) => item.suffix);
const PERCENT_SUFFIXES = new Set<BudgetSuffix>(["VARPER", "YTDVARPER"]);

const BUDGET_BASES = Array.from(new Set(RAW_LABEL_MAP.map(([, base]) => base)));

// Manual cell-level mappings for the Owner's Report Budget Comparison sheet.
// These override or supplement the label-based extraction to ensure the exact
// cells/formulas are used for the PPTX tokens.
const OWNER_REPORT_CELL_MAP: Record<
  string,
  { sheet: string; ref: string; mode?: "sum"; note?: string }
> = {
  DISCCM: { sheet: "Budget Comparison", ref: "C12" },
  DISCYTD: { sheet: "Budget Comparison", ref: "G12" },
  DISCYTDBUD: { sheet: "Budget Comparison", ref: "H12" },
  TOTRENINCVAR: { sheet: "Budget Comparison", ref: "E14" },
  TOTRENINCVARPER: { sheet: "Budget Comparison", ref: "F14" },
  TOTRENVAR: { sheet: "Budget Comparison", ref: "E14" },
  TOTRENVARPER: { sheet: "Budget Comparison", ref: "F14" },
  TOTRENINCCM: { sheet: "Budget Comparison", ref: "C13" },
  ADMFEEYTD: { sheet: "Budget Comparison", ref: "G15" },
  ADMFEEVARPER: { sheet: "Budget Comparison", ref: "F15" },
  SECPPCM: { sheet: "Budget Comparison", ref: "C16" },
  SECPPPTD: { sheet: "Budget Comparison", ref: "D16" },
  SECPPVAR: { sheet: "Budget Comparison", ref: "E16" },
  SECPPVARPER: { sheet: "Budget Comparison", ref: "F16" },
  SECPPYTD: { sheet: "Budget Comparison", ref: "G16" },
  SECPPYTDBUD: { sheet: "Budget Comparison", ref: "H16" },
  SECPPYTDVAR: { sheet: "Budget Comparison", ref: "I16" },
  SECPPYTDVARPER: { sheet: "Budget Comparison", ref: "J16" },
  RETSALVAR: { sheet: "Budget Comparison", ref: "E19" },
  TOTALINCVARPER: { sheet: "Budget Comparison", ref: "F21" },
  ADVERVAR: { sheet: "Budget Comparison", ref: "E24" },
  ADVERYTD: { sheet: "Budget Comparison", ref: "G24" },
  AUCTVAR: { sheet: "Budget Comparison", ref: "E25" },
  AUCTVARPER: { sheet: "Budget Comparison", ref: "F25" },
  AUCTYTDVARPER: { sheet: "Budget Comparison", ref: "J25" },
  CAMVAR: { sheet: "Budget Comparison", ref: "E27" },
  CAMVARPER: { sheet: "Budget Comparison", ref: "F27" },
  CAMYTD: { sheet: "Budget Comparison", ref: "G27" },
  CCMPTD: { sheet: "Budget Comparison", ref: "D28" },
  CCMYTD: { sheet: "Budget Comparison", ref: "G28" },
  DUESCM: { sheet: "Budget Comparison", ref: "C29" },
  FIRECM: { sheet: "Budget Comparison", ref: "C31" },
  FIREVARPER: { sheet: "Budget Comparison", ref: "F31" },
  FIREYTDVARPER: { sheet: "Budget Comparison", ref: "J31" },
  PERMVARPER: { sheet: "Budget Comparison", ref: "F34" },
  PERMYTDVARPER: { sheet: "Budget Comparison", ref: "J34" },
  MGMTCM: { sheet: "Budget Comparison", ref: "C35" },
  MGMTSTFYTDVARPER: { sheet: "Budget Comparison", ref: "J36" },
  OFFSUPYTD: { sheet: "Budget Comparison", ref: "G37" },
  RETAYTD: { sheet: "Budget Comparison", ref: "G42" },
  SECCM: { sheet: "Budget Comparison", ref: "C43" },
  SECVARPER: { sheet: "Budget Comparison", ref: "F43" },
  SOFTYTD: { sheet: "Budget Comparison", ref: "G44" },
  INTERVAR: { sheet: "Budget Comparison", ref: "E46" },
  UTILPTD: { sheet: "Budget Comparison", ref: "D47:D49", mode: "sum", note: "SUM(D47:D49)" },
  UTILYTDBUD: { sheet: "Budget Comparison", ref: "H47:H49", mode: "sum", note: "SUM(H47:H49)" },
  TOTALPROPYTDBUD: { sheet: "Budget Comparison", ref: "H51" },
  TOTALPROPYTDVARPER: { sheet: "Budget Comparison", ref: "J51" },
  TOTALPROPYTDPER: { sheet: "Budget Comparison", ref: "J51" },
  OTHEREXPVARPER: { sheet: "Budget Comparison", ref: "F53" },
  OTHEREXPYTDVARPER: { sheet: "Budget Comparison", ref: "J53" },
  TOTOTHEREXPVARPER: { sheet: "Budget Comparison", ref: "F55" },
  TOTOTHEREXPYTDVARPER: { sheet: "Budget Comparison", ref: "J55" },
  INTINCCM: { sheet: "Budget Comparison", ref: "C58" },
  INTINCYTD: { sheet: "Budget Comparison", ref: "G58" },
  INTINCVARPER: { sheet: "Budget Comparison", ref: "F58" },
  INTINCYTDVARPER: { sheet: "Budget Comparison", ref: "J58" },
  NETINCCM: { sheet: "Budget Comparison", ref: "C60" },
  NETINCPTD: { sheet: "Budget Comparison", ref: "D60" },
  NETINCVAR: { sheet: "Budget Comparison", ref: "E60" },
  NETINCVARPER: { sheet: "Budget Comparison", ref: "F60" },
  NETINCYTD: { sheet: "Budget Comparison", ref: "G60" },
  NETINCYTDBUD: { sheet: "Budget Comparison", ref: "H60" },
  NETINCYTDVAR: { sheet: "Budget Comparison", ref: "I60" },
  NETINCYTDVARPER: { sheet: "Budget Comparison", ref: "J60" },
};

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

const findBudgetComparisonSheet = (
  workbook: XLSX.WorkBook,
  preferredName?: string,
): { sheet: XLSX.WorkSheet; name: string } | null => {
  if (preferredName) {
    const sheet = workbook.Sheets[preferredName];
    if (sheet) return { sheet, name: preferredName };
  }
  const direct = workbook.Sheets["Budget Comparison"];
  if (direct) return { sheet: direct, name: "Budget Comparison" };
  for (const name of workbook.SheetNames) {
    const normalized = name.trim().toLowerCase();
    if (normalized.startsWith("budget comparison")) {
      const sheet = workbook.Sheets[name];
      if (sheet) return { sheet, name };
    }
  }
  return null;
};

const parseNumber = (value: CellValue, options: ParseNumberOptions = {}): number => {
  if (value == null || value === "") return Number.NaN;
  const { isPercent = false } = options;

  if (typeof value === "number") {
    if (!Number.isFinite(value)) return Number.NaN;
    if (!isPercent) return value;
    const abs = Math.abs(value);
    return abs <= 1 ? value * 100 : value;
  }

  if (value instanceof Date) return Number.NaN;

  let str = String(value ?? "").trim();
  if (!str) return Number.NaN;

  const upper = str.toUpperCase();
  if (upper === "N/A" || upper === "NA" || upper === "NONE" || upper === "--") return Number.NaN;

  let isNegative = false;
  if (/^\(.*\)$/.test(str)) {
    isNegative = true;
    str = str.slice(1, -1);
  }

  const percentLike = isPercent || str.includes("%");

  str = str.replace(/[$,%]/g, "").replace(/\s+/g, "");
  if (!str) return Number.NaN;

  const parsed = Number(str.replace(/,/g, ""));
  if (!Number.isFinite(parsed)) return Number.NaN;

  let result = parsed;
  if (percentLike && !str.includes("%") && Math.abs(result) <= 1) {
    result *= 100;
  }
  if (isNegative) result *= -1;
  return result;
};

const readCellValue = (sheet: XLSX.WorkSheet | undefined, ref: string): CellValue => {
  if (!sheet) return undefined;
  const cell = sheet[ref];
  if (!cell) return undefined;
  if ("v" in cell && cell.v !== undefined) return cell.v as CellValue;
  if ("w" in cell && cell.w !== undefined) return cell.w as CellValue;
  return undefined;
};

const sumRange = (sheet: XLSX.WorkSheet | undefined, rangeRef: string): number => {
  if (!sheet) return Number.NaN;
  let total = 0;
  let found = false;
  const range = XLSX.utils.decode_range(rangeRef);
  for (let r = range.s.r; r <= range.e.r; r += 1) {
    for (let c = range.s.c; c <= range.e.c; c += 1) {
      const cellRef = XLSX.utils.encode_cell({ r, c });
      const raw = readCellValue(sheet, cellRef);
      const numeric = parseNumber(raw, { isPercent: false });
      if (!Number.isFinite(numeric)) continue;
      total += numeric;
      found = true;
    }
  }
  return found ? total : Number.NaN;
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
  for (const entry of LABEL_MAP) {
    if (normalized.includes(entry.match)) {
      return entry.base;
    }
  }
  return null;
};

const roundMoney = (value: number): number => Math.round(value * 100) / 100;
const roundPercent = (value: number): number => Math.round(value * 10) / 10;
const normalizeZero = (value: number): number => (Object.is(value, -0) ? 0 : value);

const hasValue = (meta?: RowValueMeta): meta is RowValueMeta & { value: number } =>
  Boolean(meta && meta.value !== undefined && Number.isFinite(meta.value));

const isPercentTokenKey = (token: string): boolean => /(VARPER|YTDVARPER)$/i.test(token);

const applyOwnerReportOverrides = (
  workbook: XLSX.WorkBook,
  tokens: Record<string, number>,
  details: Record<string, BudgetTokenDetail>,
  debug: string[],
  preferredSheetName?: string,
): void => {
  const budgetSheetResult = findBudgetComparisonSheet(workbook, preferredSheetName);
  const budgetSheet = budgetSheetResult?.sheet;
  const budgetSheetName = budgetSheetResult?.name ?? "Budget Comparison";
  const priorValues = {
    totalExpenses: tokens.TOTALEXPENSES ?? tokens.TOTEXPCM,
    totalExpensesDetail: details.TOTALEXPENSES ?? details.TOTEXPCM,
    netIncome: tokens.NETINCCM ?? tokens.NETINCOME,
    netIncomeDetail: details.NETINCCM ?? details.NETINCOME,
  };

  // Ensure we don't keep stale values for these overrides if parsing elsewhere set them.
  ["TOTALEXPENSES", "TOTEXPCM", "NETINCCM", "NETINCOME"].forEach((key) => {
    delete tokens[key];
    delete details[key];
  });

  for (const [rawToken, mapping] of Object.entries(OWNER_REPORT_CELL_MAP)) {
    const token = rawToken.trim().toUpperCase();
    if (!token) continue;
    const sheet = workbook.Sheets[mapping.sheet];
    if (!sheet) continue;

    const cellRef = mapping.note ?? mapping.ref;
    const cellValue = mapping.mode === "sum" ? undefined : readCellValue(sheet, mapping.ref);

    const numeric = mapping.mode === "sum"
      ? sumRange(sheet, mapping.ref)
      : parseNumber(cellValue, { isPercent: isPercentTokenKey(token) });

    if (!Number.isFinite(numeric)) continue;

    const isPercent = isPercentTokenKey(token);
    const value = normalizeZero(isPercent ? roundPercent(numeric) : roundMoney(numeric));

    tokens[token] = value;

    const note = mapping.note ? `manual mapping; ${mapping.note}` : "manual mapping";
    details[token] = {
      value,
      sheet: mapping.sheet,
      cell: cellRef,
      note,
      source: "owner-report-cell-map",
      rawValue: cellValue,
    };

    const pretty = isPercent ? pctFmt(value) : moneyFmt(value);
    const origin = `${mapping.sheet}!${cellRef}`;
    const message = `  ${pretty} from ${origin} applied --> {{${token}}} (${note})`;
    console.log(message);
    debug.push(message);
    console.log("[budget] applied override", {
      tokenName: token,
      sheetName: mapping.sheet,
      cell: cellRef,
      value,
    });
  }

  // Manual single-cell overrides for owner report aggregates.
  // TOTALEXPENSES (and TOTEXPCM) -> Budget Comparison!C56
  // NETINCOME/NETINCCM -> Budget Comparison!C21 minus C56
  if (!budgetSheet) {
    debug.push("Budget Comparison sheet missing; skipping C56/C21 overrides.");
  } else {
    let wroteExpenses = false;
    let wroteNetIncome = false;

    const totalExpensesRaw = readCellValue(budgetSheet, "C56");
    const totalExpenses = parseNumber(totalExpensesRaw, { isPercent: false });
    let effectiveExpenses: number | undefined;
    if (Number.isFinite(totalExpenses)) {
      effectiveExpenses = normalizeZero(roundMoney(totalExpenses));
      tokens.TOTALEXPENSES = effectiveExpenses;
      tokens.TOTEXPCM = effectiveExpenses;
      const note = "manual mapping";
      const detail: BudgetTokenDetail = {
        value: effectiveExpenses,
        sheet: budgetSheetName,
        cell: "C56",
        note,
        source: "owner-report-cell-map",
        rawValue: totalExpensesRaw,
      };
      details.TOTALEXPENSES = detail;
      details.TOTEXPCM = detail;
      const pretty = moneyFmt(effectiveExpenses);
      const message = `  ${pretty} from Budget Comparison!C56 applied --> {{TOTALEXPENSES}}/{{TOTEXPCM}} (${note})`;
      console.log(message);
      debug.push(message);
      wroteExpenses = true;
    } else if (Number.isFinite(Number(priorValues.totalExpenses))) {
      effectiveExpenses = Number(priorValues.totalExpenses);
      tokens.TOTALEXPENSES = effectiveExpenses;
      tokens.TOTEXPCM = effectiveExpenses;
      if (priorValues.totalExpensesDetail) {
        details.TOTALEXPENSES = priorValues.totalExpensesDetail;
        details.TOTEXPCM = priorValues.totalExpensesDetail;
      }
      debug.push("C56 unavailable; reused prior total expenses value.");
      wroteExpenses = true;
    } else {
      debug.push("C56 unavailable and no prior total expenses value.");
    }

    const totalIncomeRaw = readCellValue(budgetSheet, "C21");
    const totalIncome = parseNumber(totalIncomeRaw, { isPercent: false });
    if (Number.isFinite(totalIncome) && Number.isFinite(effectiveExpenses)) {
      const netIncome = normalizeZero(roundMoney(totalIncome - (effectiveExpenses ?? 0)));
      tokens.NETINCCM = netIncome;
      tokens.NETINCOME = netIncome;
      const note = "manual mapping; C21 - C56";
      const detail: BudgetTokenDetail = {
        value: netIncome,
        sheet: budgetSheetName,
        cell: "C21,C56",
        note,
        source: "owner-report-cell-map",
        rawValue: `${totalIncomeRaw} - ${totalExpensesRaw}`,
      };
      details.NETINCCM = detail;
      details.NETINCOME = detail;
      const pretty = moneyFmt(netIncome);
      const message = `  ${pretty} from Budget Comparison!(C21 - C56) applied --> {{NETINCCM}}/{{NETINCOME}} (${note})`;
      console.log(message);
      debug.push(message);
      wroteNetIncome = true;
    } else if (Number.isFinite(Number(priorValues.netIncome))) {
      const netIncome = Number(priorValues.netIncome);
      tokens.NETINCCM = netIncome;
      tokens.NETINCOME = netIncome;
      if (priorValues.netIncomeDetail) {
        details.NETINCCM = priorValues.netIncomeDetail;
        details.NETINCOME = priorValues.netIncomeDetail;
      }
      debug.push("C21/C56 unavailable; reused prior net income value.");
      wroteNetIncome = true;
    } else {
      debug.push("C21/C56 unavailable and no prior net income value.");
    }

    if (!wroteExpenses) {
      delete tokens.TOTALEXPENSES;
      delete tokens.TOTEXPCM;
      delete details.TOTALEXPENSES;
      delete details.TOTEXPCM;
    }
    if (!wroteNetIncome) {
      delete tokens.NETINCCM;
      delete tokens.NETINCOME;
      delete details.NETINCCM;
      delete details.NETINCOME;
    }
  }
};

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

const buildRowStates = (grid: Grid, header: HeaderMatch, sheetName: string): RowState[] => {
  const rows: RowState[] = [];
  for (let r = header.rowIndex + 1; r < grid.length; r += 1) {
    const row = grid[r] ?? [];
    const labelCell = row[header.labelColumn];
    const base = resolveLabelBase(labelCell);
    if (!base) continue;
    const labelText = String(labelCell ?? "").trim() || base;
    const meta = {} as Record<BudgetSuffix, RowValueMeta>;
    for (const suffix of SUFFIX_ORDER) {
      const columnIndex = header.columnBySuffix.get(suffix);
      if (columnIndex === undefined) continue;
      const cellRef = `${columnIndexToLetter(columnIndex)}${r + 1}`;
      const rawValue = row[columnIndex];
      const numeric = parseNumber(rawValue, { isPercent: PERCENT_SUFFIXES.has(suffix) });
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

export async function extractBudgetTableFields(
  budgetBuffer: WorkbookInput,
  financialsBuffer?: WorkbookInput,
): Promise<BudgetExtraction> {
  let workbook: XLSX.WorkBook;
  try {
    workbook = readWorkbook(budgetBuffer);
  } catch (error) {
    console.warn("[budget] unable to read budget workbook", error);
    return { tokens: {}, details: {}, count: 0, debug: [], ownerGroup: null };
  }

  const located = locateBudgetSheet(workbook);
  if (!located) {
    console.warn("[budget] header not found: check PTD/YTD columns in sheet");
    return { tokens: {}, details: {}, count: 0, debug: [], ownerGroup: null };
  }

  const { grid, header, sheetName } = located;
  const ownerGroup = extractOwnerGroupFromGrid(grid);
  const rows = buildRowStates(grid, header, sheetName);

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

  applyOwnerReportOverrides(workbook, tokens, details, debug, sheetName);

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
