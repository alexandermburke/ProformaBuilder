import * as XLSX from "xlsx";
import type { ValidatedRow } from "./validate";

export type BuildResult = {
  buffer: Buffer;
  filename: string;
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

export function buildWorkbook(rows: ValidatedRow[]): BuildResult {
  const aoa: Array<Array<string | number | Date | null>> = [HEADERS as unknown as Array<string>];

  rows.forEach((row, index) => {
    aoa.push([
      row.Tran_Seq_Number ?? index + 1,
      row.JournalDate ?? null,
      row.PostMonth ?? null,
      row.Property_Name ?? null,
      row.Account ?? null,
      row.Reference ?? null,
      row.Notes ?? null,
      row.Debit ?? null,
      row.Credit ?? null,
      row.DetailNotes ?? null,
      row.Book ?? null,
      row.Unit ?? null,
    ]);
  });

  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  XLSX.utils.book_append_sheet(workbook, sheet, "Yardi_Import");
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const filename = `yardi_import_${Date.now()}.xlsx`;

  return { buffer, filename };
}

