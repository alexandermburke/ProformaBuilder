import * as XLSX from "xlsx";
import type { ParseResult, ParsedRow } from "./parseShared";

const HEADER_SCAN_LIMIT = 30;

const REQUIRED_HEADERS = ["transaction number", "date"];
const DEBIT_HEADERS = ["amount debit", "debit"];
const CREDIT_HEADERS = ["amount credit", "credit"];

function findHeaderRow(rows: unknown[][]): { header: string[]; index: number } | null {
  for (let i = 0; i < Math.min(rows.length, HEADER_SCAN_LIMIT); i += 1) {
    const row = rows[i];
    if (!Array.isArray(row)) continue;
    const normalized = row.map((cell) => String(cell ?? "").trim().toLowerCase());
    const hasRequired = REQUIRED_HEADERS.every((needle) => normalized.some((cell) => cell.includes(needle)));
    const hasDebitOrCredit =
      normalized.some((cell) => DEBIT_HEADERS.some((needle) => cell.includes(needle))) ||
      normalized.some((cell) => CREDIT_HEADERS.some((needle) => cell.includes(needle)));
    if (hasRequired && hasDebitOrCredit) {
      return { header: normalized, index: i };
    }
  }
  return null;
}

function findIndex(header: string[], candidates: string[]): number {
  return header.findIndex((cell) => candidates.some((candidate) => cell.includes(candidate)));
}

export async function parseBank(buffer: Buffer): Promise<ParseResult> {
  const logs: string[] = [];
  const warnings: string[] = [];
  const rows: ParsedRow[] = [];

  try {
    const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      warnings.push("[bank] No sheets detected in the uploaded file.");
      return { rows, logs, warnings };
    }
    const sheet = workbook.Sheets[sheetName];
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      raw: true,
      defval: "",
      blankrows: false,
    });

    const headerMatch = findHeaderRow(matrix);
    if (!headerMatch) {
      warnings.push("[bank] Unable to locate header row (Transaction Number/Date/Amount Debit/Credit).");
      return { rows, logs, warnings };
    }

    const { header, index: headerIndex } = headerMatch;
    const dateIdx = findIndex(header, ["date"]);
    const descIdx = findIndex(header, ["description"]);
    const memoIdx = findIndex(header, ["memo"]);
    const debitIdx = findIndex(header, DEBIT_HEADERS);
    const creditIdx = findIndex(header, CREDIT_HEADERS);

    const dataRows = matrix.slice(headerIndex + 1);
    for (const row of dataRows) {
      if (!Array.isArray(row)) continue;
      const meaningful = [dateIdx, descIdx, memoIdx, debitIdx, creditIdx]
        .map((idx) => (idx >= 0 ? row[idx] : ""))
        .map((val) => (typeof val === "string" ? val.trim() : val));
      if (meaningful.every((val) => val === "" || val == null)) continue;

      rows.push({
        source: "bank",
        raw: {
          date: dateIdx >= 0 ? row[dateIdx] : null,
          description: descIdx >= 0 ? row[descIdx] : null,
          memo: memoIdx >= 0 ? row[memoIdx] : null,
          amountdebit: debitIdx >= 0 ? row[debitIdx] : null,
          amountcredit: creditIdx >= 0 ? row[creditIdx] : null,
        },
      });
    }

    logs.push(`[bank] header found at row ${headerIndex + 1} on sheet "${sheetName}"`);
    logs.push(`[bank] parsed ${rows.length} transaction rows`);
  } catch (err) {
    warnings.push(`[bank] failed to parse file: ${(err as Error)?.message ?? "unknown error"}`);
  }

  if (rows.length === 0) {
    warnings.push("[bank] No rows detected in the uploaded file.");
  }
  return { rows, logs, warnings };
}

