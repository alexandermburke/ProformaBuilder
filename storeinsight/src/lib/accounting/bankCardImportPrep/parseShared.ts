import * as XLSX from "xlsx";

export type ParsedRow = {
  raw: Record<string, unknown>;
  source: string;
};

export type ParseResult = {
  rows: ParsedRow[];
  logs: string[];
  warnings: string[];
};

export function parseBufferToRows(buffer: Buffer, source: string, logs: string[]): ParsedRow[] {
  try {
    const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) return [];
    const sheet = workbook.Sheets[sheetName];
    const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
    logs.push(`[${source}] parsed ${json.length} rows from sheet "${sheetName}"`);
    return json.map((row) => ({ raw: row, source }));
  } catch (err) {
    logs.push(`[${source}] failed to parse file: ${(err as Error)?.message ?? "unknown error"}`);
    return [];
  }
}
