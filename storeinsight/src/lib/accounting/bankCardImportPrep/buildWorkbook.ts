import * as XLSX from "xlsx";
import type { ValidatedRow } from "./validate";

export type BuildResult = {
  buffer: Buffer;
  filename: string;
  emitted: number;
};

const HEADERS = [
  "Tran_Seq_Number",
  "JournalDate",
  "PostMonth",
  "Property_Name",
  "Account",
  "Reference",
  "Notes",
  "Debit",
  "Credit",
  "DetailNotes",
  "Book",
  "Unit",
] as const;

type BuildOptions = {
  cashAccount?: string;
  referenceFallback?: string;
  filename?: string;
};

export function buildWorkbook(rows: ValidatedRow[], options: BuildOptions): BuildResult {
  const aoa: Array<Array<string | number | Date | null>> = [HEADERS as unknown as Array<string>];
  const cashAccount = options.cashAccount?.trim() ?? "";
  if (!cashAccount) {
    throw new Error("Missing cash account for cash-side journal lines");
  }
  let emitted = 0;
  const cashRows: ValidatedRow[] = [];
  const offsetRows: ValidatedRow[] = [];

  const pushRow = (row: ValidatedRow, override?: Partial<ValidatedRow>) => {
    const merged = { ...row, ...override };
    aoa.push([
      merged.Tran_Seq_Number,
      merged.JournalDate ?? null,
      merged.PostMonth ?? null,
      merged.Property_Name ?? null,
      merged.Account ?? null,
      merged.Reference ?? options.referenceFallback ?? null,
      merged.Notes ?? null,
      merged.Debit ?? null,
      merged.Credit ?? null,
      merged.DetailNotes ?? null,
      merged.Book ?? null,
      merged.Unit ?? null,
    ]);
    emitted += 1;
  };

  const transactions: { base: ValidatedRow; amount: number; direction: "in" | "out"; reference: string }[] = [];

  rows.forEach((row) => {
    const amount = row.Debit ?? row.Credit ?? null;
    if (!amount || !row.Property_Name || !row.Account) return;
    const direction = row.Credit && row.Credit > 0 ? "in" : "out";
    const baseRef =
      row.Reference ??
      options.referenceFallback ??
      (row.PostMonth ? `Bank/Card Import ${row.PostMonth}` : "Bank/Card Import");

    transactions.push({ base: row, amount, direction, reference: baseRef });
  });

  const sortedTransactions = [...transactions].sort((a, b) => {
    const timeA = a.base.JournalDate instanceof Date ? a.base.JournalDate.getTime() : Number.POSITIVE_INFINITY;
    const timeB = b.base.JournalDate instanceof Date ? b.base.JournalDate.getTime() : Number.POSITIVE_INFINITY;
    if (timeA !== timeB) return timeA - timeB;
    const dirA = a.direction === "in" ? 0 : 1;
    const dirB = b.direction === "in" ? 0 : 1;
    if (dirA !== dirB) return dirA - dirB;
    const notesA = a.base.Notes ?? "";
    const notesB = b.base.Notes ?? "";
    return notesA.localeCompare(notesB);
  });

  sortedTransactions.forEach((tx, idx) => {
    const seq = idx + 1;
    const cashLine: ValidatedRow = {
      ...tx.base,
      Tran_Seq_Number: seq,
      Account: cashAccount,
      Debit: tx.direction === "in" ? tx.amount : null,
      Credit: tx.direction === "out" ? tx.amount : null,
      Reference: tx.reference,
    };
    cashRows.push(cashLine);
  });

  sortedTransactions.forEach((tx, idx) => {
    const seq = idx + 1;
    const offsetLine: ValidatedRow = {
      ...tx.base,
      Tran_Seq_Number: seq,
      Account: tx.base.Account,
      Debit: tx.direction === "out" ? tx.amount : null,
      Credit: tx.direction === "in" ? tx.amount : null,
      Reference: tx.reference,
    };
    offsetRows.push(offsetLine);
  });

  cashRows.forEach((row) => pushRow(row));
  offsetRows.forEach((row) => pushRow(row));

  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  XLSX.utils.book_append_sheet(workbook, sheet, "Yardi_Import");
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const filename = options.filename?.trim() || `yardi_import_${Date.now()}.xlsx`;

  const countMismatch = cashRows.length !== offsetRows.length ? Math.max(cashRows.length, offsetRows.length) : 0;
  if (countMismatch > 0) {
    throw new Error("Unbalanced journal rows: cash and offset block lengths differ");
  }

  const invalidCashSeqs = cashRows
    .map((row) => row.Tran_Seq_Number ?? 0)
    .filter((num) => num < 1 || num > cashRows.length || !Number.isInteger(num))
    .slice(0, 5);
  const invalidOffsetSeqs = offsetRows
    .map((row) => row.Tran_Seq_Number ?? 0)
    .filter((num) => num < 1 || num > offsetRows.length || !Number.isInteger(num))
    .slice(0, 5);
  if (invalidCashSeqs.length > 0 || invalidOffsetSeqs.length > 0) {
    throw new Error("Tran_Seq_Number must be 1..N for both cash and offset blocks");
  }

  const amountMismatch = cashRows
    .map((cashRow, idx) => {
      const offsetRow = offsetRows[idx];
      const cashAmount = cashRow.Debit ?? cashRow.Credit ?? 0;
      const offsetAmount = offsetRow.Debit ?? offsetRow.Credit ?? 0;
      const oppositeSides =
        (cashRow.Debit && offsetRow.Credit === cashRow.Debit) ||
        (cashRow.Credit && offsetRow.Debit === cashRow.Credit);
      return cashAmount === offsetAmount && oppositeSides;
    })
    .some((ok) => !ok);
  if (amountMismatch) {
    throw new Error("Cash and offset rows must balance per transaction");
  }

  emitted = cashRows.length + offsetRows.length;

  return { buffer, filename, emitted };
}
