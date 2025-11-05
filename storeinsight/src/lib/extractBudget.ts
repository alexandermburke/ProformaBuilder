import * as XLSX from "xlsx";

type CellValue = string | number | boolean | Date | null | undefined;
type Grid = CellValue[][];
type WorkbookInput = ArrayBuffer | Uint8Array | Buffer;

const norm = (value: unknown): string =>
  String(value ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const toNum = (value: unknown): number => {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const str = String(value ?? "").trim();
  if (!str) return 0;
  const neg = /^\(.*\)$/.test(str);
  const parsed = Number(str.replace(/[,$%()\s]/g, ""));
  if (!Number.isFinite(parsed)) return 0;
  return neg ? -parsed : parsed;
};

const SUFFIX_BY_HEADER: Record<string, string> = {
  "ptd actual": "CM",
  "current month": "CM",
  "ptd budget": "PTD",
  variance: "VAR",
  "% var": "VARPER",
  "% variance": "VARPER",
  "percent var": "VARPER",
  "pct var": "VARPER",
  "ytd actual": "YTD",
  "ytd budget": "YTDBUD",
  "ytd variance": "YTDVAR",
  "ytd % var": "YTDVARPER",
  "ytd % variance": "YTDVARPER",
  "ytd percent var": "YTDVARPER",
  "ytd pct var": "YTDVARPER",
};

const LABELS: Record<string, string> = {
  "rental income": "RENTINC",
  discounts: "DISC",
  "total rental income": "TOTRENINC",
  "tenant income - admin fees": "ADMFE",
  "tenant income - late fees": "LATEFEE",
  "tenant income - insurance": "INSURT",
  "tenant income - other": "OTHER",
  "retail sales": "RETSAL",
  "total income": "TOTALINC",
  "advertising & marketing": "ADVER",
  "auction expenses": "AUCT",
  "cam charges": "CAM",
  "credit card merchant fees": "CCM",
  "dues & subscriptions": "DUES",
  "fire prevention": "FIRE",
  insurance: "INSUREXP",
  "licenses & permits": "PERM",
  "management fees": "MGMT",
  "management fees - staff costs": "MGMSTF",
  "office supplies": "OFFSUP",
  "professional fees": "PROF",
  "repairs & maintenance": "REP",
  "retail products": "RETPROD",
  security: "SEC",
  software: "SOFT",
  "supplies - building": "SUPP",
  "telephone & internet": "INTER",
  utilities: "UTIL",
  "total property expenses": "TOTALPROP",
  "other expenses": "OTHEREXP",
  "total other expenses": "TOTOTHEREXP",
  "total expenses": "TOTEXP",
  "interest income": "INTINC",
  "net income": "NETINC",
};

const HEADER_VARIANTS: Record<string, string> = {
  "ytd %": "ytd % var",
  "% variance": "% var",
};

type HeaderMatch = { rowIndex: number; columnMap: Map<number, string> };

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

const findHeader = (grid: Grid): HeaderMatch | null => {
  for (let r = 0; r < grid.length; r += 1) {
    const row = grid[r] ?? [];
    const columnMap = new Map<number, string>();
    let hits = 0;
    for (let c = 0; c < row.length; c += 1) {
      const rawKey = norm(row[c]);
      if (!rawKey) continue;
      const normalized = HEADER_VARIANTS[rawKey] ?? rawKey;
      const suffix = SUFFIX_BY_HEADER[normalized];
      if (!suffix || columnMap.has(c)) continue;
      columnMap.set(c, suffix);
      hits += 1;
    }
    if (hits >= 5) return { rowIndex: r, columnMap };
  }
  return null;
};

const locateBudgetSheet = (workbook: XLSX.WorkBook): { grid: Grid; header: HeaderMatch } | null => {
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    if (!sheet) continue;
    const grid = sheetToGrid(sheet);
    const header = findHeader(grid);
    if (header) return { grid, header };
  }
  return null;
};

const buildToken = (base: string, suffix: string): string => `${base}${suffix}`;

export async function extractBudgetTableFields(
  budgetBuffer: WorkbookInput,
  financialsBuffer?: WorkbookInput,
): Promise<{ tokens: Record<string, number>; count: number }> {
  let workbook: XLSX.WorkBook;
  try {
    workbook = readWorkbook(budgetBuffer);
  } catch (err) {
    console.warn("[budget] unable to read budget workbook", err);
    return { tokens: {}, count: 0 };
  }

  const located = locateBudgetSheet(workbook);
  if (!located) {
    console.warn("[budget] header not found: check PTD/YTD columns in sheet 1");
    return { tokens: {}, count: 0 };
  }

  const headerSummary = Array.from(located.header.columnMap.entries())
    .map(([col, suffix]) => `${col}:${suffix}`)
    .join(",");
  console.warn("[budget] header row", located.header.rowIndex, "cols", headerSummary);

  const {
    grid,
    header: { rowIndex: headerRow, columnMap },
  } = located;
  const headerColumns = [...columnMap.keys()].sort((a, b) => a - b);
  const labelColumn = Math.max(0, (headerColumns[0] ?? 1) - 1);

  const tokens: Record<string, number> = {};

  for (let r = headerRow + 1; r < grid.length; r += 1) {
    const labelKey = norm(grid[r]?.[labelColumn]);
    if (!labelKey) continue;
    const base = LABELS[labelKey];
    if (!base) continue;

    for (const [colIndex, suffix] of columnMap.entries()) {
      const cell = grid[r]?.[colIndex];
      if (cell == null || cell === "") continue;
      const numeric = toNum(cell);
      // Skip decorative rows that coerce to zero and have no textual value.
      if (numeric === 0 && String(cell ?? "").trim() === "") continue;
      tokens[buildToken(base, suffix)] = numeric;
    }
  }

  if (financialsBuffer) {
    try {
      const financialWorkbook = readWorkbook(financialsBuffer);
      const sheetName = financialWorkbook.SheetNames[0];
      if (sheetName) {
        const sheet = financialWorkbook.Sheets[sheetName];
        if (sheet) {
          const fgrid = sheetToGrid(sheet);
          for (let r = 0; r < fgrid.length; r += 1) {
            const labelKey = norm(fgrid[r]?.[0]);
            const base = LABELS[labelKey];
            if (!base) continue;
            const token = buildToken(base, "CM");
            if (tokens[token] !== undefined) continue;
            for (let c = 1; c < (fgrid[r]?.length ?? 0); c += 1) {
              const cell = fgrid[r]?.[c];
              if (cell == null || cell === "") continue;
              const numeric = toNum(cell);
              if (numeric === 0) continue;
              tokens[token] = numeric;
              break;
            }
          }
        }
      }
    } catch (err) {
      console.warn("[budget] unable to read financial workbook", err);
    }
  }

  const count = Object.keys(tokens).length;
  console.warn("[budget] detected", count);
  return { tokens, count };
}

