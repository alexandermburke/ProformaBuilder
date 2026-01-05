import { parseBufferToRows, type ParseResult } from "./parseShared";

export async function parseOtherBank(buffer: Buffer): Promise<ParseResult> {
  const logs: string[] = [];
  const warnings: string[] = [];
  const rows = parseBufferToRows(buffer, "other-bank", logs);
  if (rows.length === 0) {
    warnings.push("[other-bank] No rows detected in the uploaded file.");
  }
  return { rows, logs, warnings };
}

