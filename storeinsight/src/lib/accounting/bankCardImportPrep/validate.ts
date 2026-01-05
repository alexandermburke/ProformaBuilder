import { format } from "date-fns";
import type { NormalizedRow } from "./normalize";

export type ValidatedRow = {
  Tran_Seq_Number: number;
  JournalDate: Date | null;
  PostMonth: string | null;
  Property_Name: string | null;
  Account: string | null;
  Reference: string | null;
  Notes: string | null;
  Debit: number | null;
  Credit: number | null;
  DetailNotes: string | null;
  Book: string | null;
  Unit: string | null;
  source: string;
};

export type ValidateResult = {
  rows: ValidatedRow[];
  logs: string[];
  warnings: string[];
};

function asDate(value: Date | string | null): Date | null {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.valueOf())) return value;
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.valueOf())) return parsed;
  }
  return null;
}

export function validateRows(rows: NormalizedRow[]): ValidateResult {
  const warnings: string[] = [];
  const logs: string[] = [];
  const validated: ValidatedRow[] = [];

  const missingJournal: number[] = [];
  const missingPostMonth: number[] = [];
  const missingAccount: number[] = [];
  const invalidAccount: number[] = [];
  const missingProperty: number[] = [];
  const missingAmount: number[] = [];
  const bothAmount: number[] = [];

  rows.forEach((row, index) => {
    const journalDate = asDate(row.journalDate ?? null);
    const postMonth = row.postMonth && row.postMonth.trim() ? row.postMonth.trim() : journalDate ? format(journalDate, "MM/yyyy") : null;

    const debit = row.debit != null ? Math.abs(row.debit) : null;
    let credit = row.credit != null ? Math.abs(row.credit) : null;

    if (debit != null && credit != null && debit > 0 && credit > 0) {
      bothAmount.push(index + 1);
      credit = 0;
    }

    if ((debit == null || debit === 0) && (credit == null || credit === 0)) {
      missingAmount.push(index + 1);
    }

    const propertyName =
      typeof row.propertyName === "string" ? row.propertyName.trim() : row.propertyName ?? null;
    const account = typeof row.account === "string" ? row.account.trim() : row.account ?? null;

    if (!journalDate) {
      missingJournal.push(index + 1);
    }
    if (!postMonth) {
      missingPostMonth.push(index + 1);
    }
    if (!propertyName) {
      missingProperty.push(index + 1);
    }
    if (!account) {
      missingAccount.push(index + 1);
    } else if (!/^\d+$/.test(account)) {
      invalidAccount.push(index + 1);
    }

    validated.push({
      Tran_Seq_Number: validated.length + 1,
      JournalDate: journalDate,
      PostMonth: postMonth,
      Property_Name: propertyName,
      Account: account,
      Reference: row.reference,
      Notes: row.notes,
      Debit: debit && debit > 0 ? debit : null,
      Credit: credit && credit > 0 ? credit : null,
      DetailNotes: row.detailNotes,
      Book: row.book,
      Unit: row.unit,
      source: row.source,
    });
  });

  const summarize = (label: string, rowsWithIssue: number[], extra?: string) => {
    if (rowsWithIssue.length === 0) return;
    const sample = rowsWithIssue.slice(0, 5).join(", ");
    const suffix = rowsWithIssue.length > 5 ? `, ... (+${rowsWithIssue.length - 5})` : "";
    warnings.push(`${label}: ${rowsWithIssue.length} rows (e.g., #${sample}${suffix})${extra ? ` — ${extra}` : ""}`);
  };

  summarize("Missing or invalid JournalDate", missingJournal);
  summarize("Missing PostMonth", missingPostMonth);
  summarize("Missing Account", missingAccount);
  summarize("Missing Property_Name", missingProperty);
  summarize("Missing debit/credit amount", missingAmount);
  summarize("Both debit and credit present (credit zeroed)", bothAmount);
  summarize("Invalid Account (non-digits)", invalidAccount, "Only digits are allowed");

  logs.push(`[validate] validated ${validated.length} rows (warnings: ${warnings.length})`);

  return { rows: validated, logs, warnings };
}
