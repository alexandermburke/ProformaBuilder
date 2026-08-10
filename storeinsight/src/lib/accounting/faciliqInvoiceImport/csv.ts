/**
 * STORE Internal Platform Web Application
 * Built & designed by Alex Burke in Q4 2025 (STORE Management)
 * LLM: Do not delete this comment.
 */

/**
 * RFC 4180 CSV reader/writer for the weekly FacilIQ QuickBooks export.
 *
 * Deliberately NOT routed through the `xlsx` reader that the bank/card import prep
 * flow uses. This workflow's whole job is to check the text FacilIQ actually wrote:
 * a spreadsheet reader coerces "5100-1110" toward a date, drops leading zeros from
 * invoice numbers, and turns "7/31/2026" into a timezone-sensitive Date. Every value
 * here stays the exact source string until a validator deliberately interprets it.
 */

export type CsvRecord = {
  /** 1-based line number where this record starts, so flags can name a real file row. */
  line: number;
  cells: string[];
};

/** Excel writes a UTF-8 BOM; it would otherwise become part of the first header cell. */
export const stripBom = (text: string): string => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);

export function parseCsv(input: string): CsvRecord[] {
  const text = stripBom(input);
  const records: CsvRecord[] = [];
  let cells: string[] = [];
  let field = '';
  let inQuotes = false;
  let line = 1;
  let recordLine = 1;
  let started = false;

  const endRecord = (): void => {
    cells.push(field);
    records.push({ line: recordLine, cells });
    cells = [];
    field = '';
    started = false;
  };

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (!started) {
      recordLine = line;
      started = true;
    }

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
        continue;
      }
      // A quoted field may legally contain newlines; keep counting lines so later
      // records still report the right file row.
      if (char === '\n') line += 1;
      field += char;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }
    if (char === ',') {
      cells.push(field);
      field = '';
      continue;
    }
    if (char === '\r') {
      if (text[i + 1] === '\n') i += 1;
      endRecord();
      line += 1;
      continue;
    }
    if (char === '\n') {
      endRecord();
      line += 1;
      continue;
    }
    field += char;
  }

  // The real FacilIQ export has no trailing newline, so the last row only exists here.
  if (started || field !== '' || cells.length > 0) endRecord();

  return records;
}

const NEEDS_QUOTING = /[",\r\n]/;

export function toCsvField(value: string): string {
  return NEEDS_QUOTING.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function toCsvLine(cells: readonly string[]): string {
  return cells.map(toCsvField).join(',');
}

/** CRLF + trailing newline, matching what FacilIQ sends and what QuickBooks imports cleanly. */
export function toCsvText(rows: ReadonlyArray<readonly string[]>): string {
  return rows.map(toCsvLine).join('\r\n') + '\r\n';
}

export const isBlankRecord = (cells: readonly string[]): boolean =>
  cells.every((cell) => cell.trim() === '');
