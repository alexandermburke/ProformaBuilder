import * as XLSX from "xlsx";
import type { ParseResult, ParsedRow } from "./parseShared";

export async function parseCard(buffer: Buffer): Promise<ParseResult> {
  const logs: string[] = [];
  const warnings: string[] = [];
  const rows: ParsedRow[] = [];

  try {
    const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      warnings.push("[card] No sheets detected in the uploaded file.");
      return { rows, logs, warnings };
    }
    const sheet = workbook.Sheets[sheetName];
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      raw: true,
      defval: "",
      blankrows: false,
    });

    for (const row of matrix) {
      if (!Array.isArray(row)) continue;
      const trimmed = row.map((val) => (typeof val === "string" ? val.trim() : val));
      if (trimmed.every((val) => val === "" || val == null)) continue;

      rows.push({
        source: "card",
        raw: {
          date: row[1] ?? null,
          merchant: row[3] ?? null,
          account: row[4] ?? null,
          amount: row[5] ?? null,
          detailnotes: row[6] ?? null,
        },
      });
    }

    logs.push(`[card] parsed ${rows.length} rows from sheet "${sheetName}"`);
  } catch (err) {
    warnings.push(`[card] failed to parse file: ${(err as Error)?.message ?? "unknown error"}`);
  }

  if (rows.length === 0) {
    warnings.push("[card] No rows detected in the uploaded file.");
  }
  return { rows, logs, warnings };
}

