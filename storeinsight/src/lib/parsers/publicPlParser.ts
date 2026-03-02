import * as XLSX from 'xlsx';

export type PublicPlVerticalRow = {
  actualBudget: 'Actual';
  entity: string;
  operatorAccount: string;
  month: string;
  year: number;
  period: number;
  amount: number;
};

export type ParsedPublicPlResult = {
  entity: string;
  monthsDetected: string[];
  rows: PublicPlVerticalRow[];
  sheetName: string;
};

type MonthMeta = {
  monthLabel: string;
  period: number;
  year: number;
};

type MonthColumn = MonthMeta & {
  columnIndex: number;
};

type HeaderDetection = {
  headerRowIndex: number;
  monthColumns: MonthColumn[];
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const MONTH_LOOKUP: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

const SHEET_PRIORITY = ['income statement', 'profit', 'p&l', 'p/l', 'pnl', 'is'];

function normalizeText(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).replace(/\s+/g, ' ').trim();
}

function parseAmount(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  const raw = normalizeText(value);
  if (!raw) return null;
  const cleaned = raw
    .replace(/\$/g, '')
    .replace(/,/g, '')
    .replace(/\(([^)]+)\)/g, '-$1')
    .replace(/\s+/g, '');
  if (!/^[-+]?\d*\.?\d+$/.test(cleaned)) return null;
  const numeric = Number(cleaned);
  return Number.isFinite(numeric) ? numeric : null;
}

function parseMonthMeta(value: unknown): MonthMeta | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    const monthIndex = value.getMonth();
    const year = value.getFullYear();
    return {
      monthLabel: MONTHS[monthIndex],
      period: monthIndex + 1,
      year,
    };
  }

  if (typeof value === 'number' && Number.isFinite(value) && value > 20000 && value < 90000) {
    const parsedDate = XLSX.SSF.parse_date_code(value);
    if (parsedDate && Number.isFinite(parsedDate.m) && Number.isFinite(parsedDate.y)) {
      const period = parsedDate.m;
      const year = parsedDate.y;
      if (period >= 1 && period <= 12) {
        return {
          monthLabel: MONTHS[period - 1],
          period,
          year,
        };
      }
    }
  }

  const text = normalizeText(value);
  if (!text) return null;
  const lowered = text.toLowerCase();
  if (lowered.includes('ytd') || lowered.includes('ttm') || lowered.includes('total')) return null;

  const monthMatch = lowered.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i);
  const yearMatch = lowered.match(/\b(20\d{2}|19\d{2}|\d{2})\b/);
  if (!monthMatch) {
    const slashDateMatch = lowered.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/);
    if (slashDateMatch) {
      const month = Number(slashDateMatch[1]);
      if (month >= 1 && month <= 12) {
        const yearPart = slashDateMatch[3];
        const year = yearPart ? (Number(yearPart) < 100 ? 2000 + Number(yearPart) : Number(yearPart)) : new Date().getFullYear();
        return {
          monthLabel: MONTHS[month - 1],
          period: month,
          year,
        };
      }
    }
    return null;
  }

  const period = MONTH_LOOKUP[monthMatch[1].toLowerCase()];
  if (!period) return null;

  let year = new Date().getFullYear();
  if (yearMatch) {
    const rawYear = Number(yearMatch[1]);
    year = rawYear < 100 ? 2000 + rawYear : rawYear;
  }

  return {
    monthLabel: MONTHS[period - 1],
    period,
    year,
  };
}

function findIncomeStatementSheetName(workbook: XLSX.WorkBook): string {
  const sheetNames = workbook.SheetNames ?? [];
  if (sheetNames.length === 0) {
    throw new Error('Workbook does not contain any worksheets.');
  }

  const ranked = sheetNames
    .map((name) => {
      const lowered = name.toLowerCase();
      const priority = SHEET_PRIORITY.findIndex((token) => lowered.includes(token));
      return { name, priority: priority < 0 ? Number.POSITIVE_INFINITY : priority };
    })
    .sort((a, b) => a.priority - b.priority);

  return ranked[0]?.name ?? sheetNames[0];
}

function detectMonthColumnsFromRows(primaryRow: unknown[], secondaryRow: unknown[] | null): MonthColumn[] {
  const monthColumns: MonthColumn[] = [];

  const maxColumns = Math.max(primaryRow.length, secondaryRow?.length ?? 0);
  for (let columnIndex = 0; columnIndex < maxColumns; columnIndex += 1) {
    const direct = parseMonthMeta(primaryRow[columnIndex]);
    if (direct) {
      monthColumns.push({ ...direct, columnIndex });
      continue;
    }
    const combined = secondaryRow
      ? parseMonthMeta(`${normalizeText(primaryRow[columnIndex])} ${normalizeText(secondaryRow[columnIndex])}`.trim())
      : null;
    if (combined) monthColumns.push({ ...combined, columnIndex });
  }

  const deduped = new Map<string, MonthColumn>();
  for (const col of monthColumns) {
    const key = `${col.year}-${String(col.period).padStart(2, '0')}`;
    if (!deduped.has(key)) deduped.set(key, col);
  }

  return Array.from(deduped.values()).sort((a, b) => {
    if (a.year !== b.year) return a.year - b.year;
    return a.period - b.period;
  });
}

function detectHeader(grid: unknown[][]): HeaderDetection {
  let best: HeaderDetection | null = null;

  const maxScan = Math.min(grid.length, 60);
  for (let rowIndex = 0; rowIndex < maxScan; rowIndex += 1) {
    const primary = grid[rowIndex] ?? [];
    const secondary = rowIndex + 1 < grid.length ? (grid[rowIndex + 1] ?? []) : null;
    const months = detectMonthColumnsFromRows(primary, secondary);
    if (months.length < 2) continue;

    if (!best || months.length > best.monthColumns.length) {
      best = {
        headerRowIndex: rowIndex,
        monthColumns: months,
      };
    }
  }

  if (best) return best;
  throw new Error('Unable to detect the month header row in the P&L sheet.');
}

function detectAccountColumn(grid: unknown[][], headerRowIndex: number, monthColumns: MonthColumn[]): number {
  const fallback = 1;
  const firstMonthColumn = monthColumns.length > 0 ? monthColumns[0].columnIndex : 2;
  const maxCandidate = Math.max(0, firstMonthColumn - 1);

  let bestColumn = fallback;
  let bestScore = 0;

  for (let col = 0; col <= maxCandidate; col += 1) {
    let score = 0;
    for (let rowIndex = headerRowIndex + 1; rowIndex < Math.min(grid.length, headerRowIndex + 80); rowIndex += 1) {
      const value = normalizeText(grid[rowIndex]?.[col]);
      if (!value) continue;
      if (/^total\b/i.test(value)) continue;
      if (/^(account|description)$/i.test(value)) continue;
      if (parseAmount(value) !== null) continue;
      score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      bestColumn = col;
    }
  }

  return bestScore > 0 ? bestColumn : fallback;
}

function detectEntity(grid: unknown[][], sheetName: string): string {
  const maxRows = Math.min(grid.length, 25);
  for (let rowIndex = 0; rowIndex < maxRows; rowIndex += 1) {
    const row = grid[rowIndex] ?? [];
    for (const cell of row) {
      const text = normalizeText(cell);
      if (!text) continue;
      const matched = text.match(/(?:entity|property|facility|site)\s*[:\-]\s*(.+)$/i);
      if (matched && matched[1]) return matched[1].trim();
    }
  }

  return sheetName;
}

function shouldSkipAccountLabel(label: string): boolean {
  if (!label) return true;
  if (/^total\b/i.test(label)) return true;
  if (/^(revenue|expense|income|operating expenses?)$/i.test(label)) return true;
  return false;
}

export function parsePublicPlWorkbook(buffer: Buffer): ParsedPublicPlResult {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const preferredSheet = findIncomeStatementSheetName(workbook);
  const candidateNames = [preferredSheet, ...(workbook.SheetNames ?? []).filter((name) => name !== preferredSheet)];

  let sheetName = preferredSheet;
  let grid: unknown[][] | null = null;
  let detection: HeaderDetection | null = null;

  for (const candidateName of candidateNames) {
    const sheet = workbook.Sheets[candidateName];
    if (!sheet) continue;
    const candidateGrid = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      raw: true,
      defval: null,
      blankrows: false,
    }) as unknown[][];
    if (candidateGrid.length === 0) continue;

    try {
      const candidateDetection = detectHeader(candidateGrid);
      if (!detection || candidateDetection.monthColumns.length > detection.monthColumns.length) {
        sheetName = candidateName;
        grid = candidateGrid;
        detection = candidateDetection;
      }
    } catch {
      continue;
    }
  }

  if (!grid || !detection) {
    throw new Error('Unable to detect a valid P&L sheet with monthly columns.');
  }

  const headerRowIndex = detection.headerRowIndex;
  const monthColumns = detection.monthColumns;

  const accountColumnIndex = detectAccountColumn(grid, headerRowIndex, monthColumns);
  const entity = detectEntity(grid, sheetName);

  const rows: PublicPlVerticalRow[] = [];
  for (let rowIndex = headerRowIndex + 1; rowIndex < grid.length; rowIndex += 1) {
    const sourceRow = grid[rowIndex] ?? [];
    const accountLabel = normalizeText(sourceRow[accountColumnIndex]);
    if (shouldSkipAccountLabel(accountLabel)) continue;

    for (const monthColumn of monthColumns) {
      const amount = parseAmount(sourceRow[monthColumn.columnIndex]);
      if (amount === null) continue;

      rows.push({
        actualBudget: 'Actual',
        entity,
        operatorAccount: accountLabel,
        month: monthColumn.monthLabel,
        year: monthColumn.year,
        period: monthColumn.period,
        amount,
      });
    }
  }

  const monthsDetected = monthColumns.map((monthColumn) => `${monthColumn.monthLabel}-${monthColumn.year}`);

  return {
    entity,
    monthsDetected,
    rows,
    sheetName,
  };
}

export function parseOperatorPlWorkbook(buffer: Buffer, operatorType: string): ParsedPublicPlResult {
  const normalized = operatorType.trim().toLowerCase();
  if (normalized === 'public') {
    return parsePublicPlWorkbook(buffer);
  }

  throw new Error(`Unsupported operator type: ${operatorType}`);
}
