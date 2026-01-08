import * as XLSX from "xlsx";

type RawRow = Record<string, unknown>;

export type TemplateTx = {
  date: string | null;
  amount: number;
  direction: "in" | "out";
  notesNorm: string;
  offsetAccount: string;
  reference: string | null;
  detailNotes: string | null;
};

export type TemplateMapping = {
  templateCashAccount: string | null;
  templateTxCount: number;
  exactMap: Map<string, TemplateTx>;
  fallbackMap: Map<string, TemplateTx[]>;
};

const normalizeNotes = (value: unknown): string =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();

const toDateOnly = (value: unknown): string | null => {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "string" || typeof value === "number") {
    const d = new Date(value);
    if (!Number.isNaN(d.valueOf())) {
      return d.toISOString().slice(0, 10);
    }
  }
  return null;
};

const getAmountDirection = (row: RawRow): { amount: number | null; direction: "in" | "out" | null } => {
  const debit = typeof row.Debit === "number" ? Math.abs(row.Debit) : null;
  const credit = typeof row.Credit === "number" ? Math.abs(row.Credit) : null;
  if (debit && !credit) return { amount: debit, direction: "out" };
  if (credit && !debit) return { amount: credit, direction: "in" };
  return { amount: null, direction: null };
};

const makeExactKey = (date: string | null, amount: number, direction: "in" | "out", notesNorm: string) =>
  `${date ?? "NA"}|${amount}|${direction}|${notesNorm}`;

const makeFallbackKey = (date: string | null, amount: number, direction: "in" | "out") =>
  `${date ?? "NA"}|${amount}|${direction}`;

export function parseTemplateOutput(buffer: Buffer): TemplateMapping {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    return { templateCashAccount: null, templateTxCount: 0, exactMap: new Map(), fallbackMap: new Map() };
  }
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<RawRow>(sheet, { defval: null }) as RawRow[];
  if (!rows.length) {
    return { templateCashAccount: null, templateTxCount: 0, exactMap: new Map(), fallbackMap: new Map() };
  }

  const cashAccount = String(rows[0].Account ?? "").trim();
  let cashCount = 0;
  for (const row of rows) {
    if (String(row.Account ?? "").trim() === cashAccount) {
      cashCount += 1;
    } else {
      break;
    }
  }

  const cashBlock = rows.slice(0, cashCount);
  const offsetBlock = rows.slice(cashCount, cashCount * 2);
  const templateTxCount = Math.min(cashBlock.length, offsetBlock.length);

  const exactMap = new Map<string, TemplateTx>();
  const fallbackMap = new Map<string, TemplateTx[]>();

  for (let i = 0; i < templateTxCount; i += 1) {
    const cashRow = cashBlock[i];
    const offsetRow = offsetBlock[i];
    const { amount, direction } = getAmountDirection(cashRow);
    if (!amount || !direction) continue;

    const date = toDateOnly(cashRow.JournalDate);
    const notesNorm = normalizeNotes(cashRow.Notes ?? cashRow.DetailNotes ?? "");
    const tx: TemplateTx = {
      date,
      amount,
      direction,
      notesNorm,
      offsetAccount: String(offsetRow.Account ?? "").trim(),
      reference: cashRow.Reference ? String(cashRow.Reference) : null,
      detailNotes: cashRow.DetailNotes ? String(cashRow.DetailNotes) : cashRow.Reference ? String(cashRow.Reference) : null,
    };

    const exactKey = makeExactKey(date, amount, direction, notesNorm);
    exactMap.set(exactKey, tx);

    const fallbackKey = makeFallbackKey(date, amount, direction);
    const list = fallbackMap.get(fallbackKey) ?? [];
    list.push(tx);
    fallbackMap.set(fallbackKey, list);
  }

  return { templateCashAccount: cashAccount || null, templateTxCount, exactMap, fallbackMap };
}
