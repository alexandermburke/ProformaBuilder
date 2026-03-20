import * as XLSX from 'xlsx';

export type LakehouseTemplateType =
  | 'public-storage'
  | 'extra-space'
  | 'cubesmart'
  | 'wentworth-results'
  | 'storquest'
  | 'custom-other';

export type WorkbookSectionKey =
  | 'ops_summary'
  | 'income_statement'
  | 'balance_sheet'
  | 'rent_roll'
  | 'unit_mix'
  | 'unit_rates'
  | 'trial_balance'
  | 'gl_detail'
  | 'budget_variance'
  | 'activity_summary'
  | 'other';

export type WorkbookSheetProfile = {
  sheetName: string;
  sectionKey: WorkbookSectionKey;
  nonEmptyRowCount: number;
  firstMeaningfulRow: number | null;
  previewRows: Array<{
    rowNumber: number;
    values: string[];
  }>;
};

export type WorkbookProfile = {
  workbookTitle: string | null;
  sheetNames: string[];
  detectedSections: WorkbookSectionKey[];
  totalNonEmptyRows: number;
  sheetProfiles: WorkbookSheetProfile[];
};

function normalizeSheetName(value: string): string {
  return value.trim().toLowerCase();
}

function toDisplayValue(value: unknown): string {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : String(value);
  return String(value).replace(/\s+/g, ' ').trim();
}

function detectWorkbookSection(sheetName: string): WorkbookSectionKey {
  const normalized = normalizeSheetName(sheetName);

  if (/(ops sum|summary of rental experience|36 month summary|monthly summary|activity summary)/.test(normalized)) {
    return 'ops_summary';
  }
  if (/(^is$|income statement|rolling is|isytd)/.test(normalized)) {
    return 'income_statement';
  }
  if (/(^bs$|balance sheet)/.test(normalized)) {
    return 'balance_sheet';
  }
  if (/(rent roll)/.test(normalized)) {
    return 'rent_roll';
  }
  if (/(unit mix|cube mix|sre detail|unit status)/.test(normalized)) {
    return 'unit_mix';
  }
  if (/(unit rate|street rate)/.test(normalized)) {
    return 'unit_rates';
  }
  if (/(trial bal|trial balance|current month tb|year to date tb)/.test(normalized)) {
    return 'trial_balance';
  }
  if (/(^gl$|gl detail|check register|monthly activity)/.test(normalized)) {
    return 'gl_detail';
  }
  if (/(bva|fva|cvp|act v bud|yoy)/.test(normalized)) {
    return 'budget_variance';
  }
  if (/(cash flow|monthly activity)/.test(normalized)) {
    return 'activity_summary';
  }
  return 'other';
}

function readWorksheetPreview(sheet: XLSX.WorkSheet): {
  nonEmptyRowCount: number;
  firstMeaningfulRow: number | null;
  previewRows: Array<{ rowNumber: number; values: string[] }>;
} {
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true });
  let nonEmptyRowCount = 0;
  let firstMeaningfulRow: number | null = null;
  const previewRows: Array<{ rowNumber: number; values: string[] }> = [];

  for (let index = 0; index < rows.length; index += 1) {
    const row = Array.isArray(rows[index]) ? rows[index] : [];
    const values = row.map(toDisplayValue);
    const filteredValues = values.filter((value) => value.length > 0);
    if (filteredValues.length === 0) continue;

    nonEmptyRowCount += 1;
    if (firstMeaningfulRow == null) firstMeaningfulRow = index + 1;
    if (previewRows.length < 6) {
      previewRows.push({
        rowNumber: index + 1,
        values: values.slice(0, 10),
      });
    }
  }

  return { nonEmptyRowCount, firstMeaningfulRow, previewRows };
}

function deriveWorkbookTitle(sheetProfiles: WorkbookSheetProfile[]): string | null {
  for (const profile of sheetProfiles) {
    for (const row of profile.previewRows) {
      for (const value of row.values) {
        const trimmed = String(value ?? '').trim();
        if (!trimmed) continue;
        if (
          /(ops summary report|income statement|summary of rental experience|balance sheet|wentworth|cubesmart|extra)/i.test(
            trimmed,
          )
        ) {
          return trimmed;
        }
      }
    }
  }
  return null;
}

export function profileWorkbook(buffer: Buffer): WorkbookProfile {
  const workbook = XLSX.read(buffer, {
    type: 'buffer',
    cellDates: true,
    cellNF: false,
    cellText: false,
  });

  const sheetProfiles = workbook.SheetNames.map((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    const preview = readWorksheetPreview(sheet);
    return {
      sheetName,
      sectionKey: detectWorkbookSection(sheetName),
      nonEmptyRowCount: preview.nonEmptyRowCount,
      firstMeaningfulRow: preview.firstMeaningfulRow,
      previewRows: preview.previewRows,
    };
  });

  return {
    workbookTitle: deriveWorkbookTitle(sheetProfiles),
    sheetNames: workbook.SheetNames,
    detectedSections: Array.from(new Set(sheetProfiles.map((profile) => profile.sectionKey))),
    totalNonEmptyRows: sheetProfiles.reduce((sum, profile) => sum + profile.nonEmptyRowCount, 0),
    sheetProfiles,
  };
}

export function isWorkbookFilename(filename: string): boolean {
  return /\.(xlsx|xls|xlsm)$/i.test(filename);
}

export function isCsvFilename(filename: string): boolean {
  return /\.csv$/i.test(filename);
}

export function sanitizeStoragePathPart(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, '_');
}
