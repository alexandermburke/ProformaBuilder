import * as XLSX from "xlsx";
import type { NormalizedRow } from "../normalize";

type RawRow = Record<string, unknown>;

export type TrainingExample = {
  direction: "in" | "out";
  amount: number;
  date: string | null;
  merchantNorm: string;
  signature: string;
  offsetAccount: string;
  reference: string | null;
  detailNotes: string | null;
};

export type LearnedRules = {
  exactMap: Map<string, TrainingExample>;
  signatureMap: Map<
    string,
    {
      total: number;
      counts: Map<string, number>;
      reference: string | null;
      detailNotes: string | null;
      dominantAccount: string | null;
    }
  >;
  cashAccount: string | null;
  propertyName: string | null;
  totalExamples: number;
};

const STOPWORDS = new Set([
  "PAYMENT",
  "POS",
  "DEPOSIT",
  "ONLINE",
  "ACH",
  "INC",
  "LLC",
  "THE",
  "STORE",
  "TRANSFER",
]);

const normalizeText = (value: unknown): string =>
  String(value ?? "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();

const buildSignature = (text: string): string => {
  const tokens = text
    .split(" ")
    .map((t) => t.trim())
    .filter((t) => t && !STOPWORDS.has(t))
    .slice(0, 4);
  return tokens.join(" ");
};

const toDateOnly = (value: unknown): string | null => {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) return value.toISOString().slice(0, 10);
  if (typeof value === "string" || typeof value === "number") {
    const d = new Date(value);
    if (!Number.isNaN(d.valueOf())) return d.toISOString().slice(0, 10);
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

const makeExactKey = (ex: { date: string | null; amount: number; direction: "in" | "out"; merchantNorm: string }) =>
  `${ex.date ?? "NA"}|${ex.amount}|${ex.direction}|${ex.merchantNorm}`;

export function parseCodedWorkbook(
  buffer: Buffer,
  providedCash?: string,
): { examples: TrainingExample[]; cashAccount: string | null; propertyName: string | null } {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const sheet = workbook.Sheets["Yardi_Import"] ?? workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) return { examples: [], cashAccount: null, propertyName: null };
  const rows = XLSX.utils.sheet_to_json<RawRow>(sheet, { defval: null }) as RawRow[];
  if (!rows.length) return { examples: [], cashAccount: null, propertyName: null };

  const accountCounts = new Map<string, number>();
  rows.slice(0, 50).forEach((row) => {
    const acct = String(row.Account ?? "").trim();
    if (!acct) return;
    accountCounts.set(acct, (accountCounts.get(acct) ?? 0) + 1);
  });
  let mostCommonAccount: string | null = null;
  for (const [acct, count] of accountCounts.entries()) {
    if (!mostCommonAccount || count > (accountCounts.get(mostCommonAccount) ?? 0)) {
      mostCommonAccount = acct;
    }
  }

  const detectedCash = providedCash?.trim() || mostCommonAccount || String(rows[0].Account ?? "").trim();
  let cashCount = 0;
  for (const row of rows) {
    if (String(row.Account ?? "").trim() === detectedCash) cashCount += 1;
    else break;
  }
  const effectiveCashCount = cashCount > 0 ? cashCount : Math.floor(rows.length / 2);
  const cashBlock = rows.slice(0, effectiveCashCount);
  const offsetBlock = rows.slice(effectiveCashCount, effectiveCashCount * 2);
  const total = Math.min(cashBlock.length, offsetBlock.length);

  const examples: TrainingExample[] = [];
  const propertyCounts = new Map<string, number>();
  for (let i = 0; i < total; i += 1) {
    const cashRow = cashBlock[i];
    const offsetRow = offsetBlock[i];
    const { amount, direction } = getAmountDirection(cashRow);
    if (!amount || !direction) continue;
    const merchantNorm = normalizeText(`${cashRow.Notes ?? ""} ${cashRow.DetailNotes ?? ""}`);
    const signature = buildSignature(merchantNorm);
    examples.push({
      direction,
      amount,
      date: toDateOnly(cashRow.JournalDate),
      merchantNorm,
      signature,
      offsetAccount: String(offsetRow.Account ?? "").trim(),
      reference: cashRow.Reference ? String(cashRow.Reference) : null,
      detailNotes: cashRow.DetailNotes ? String(cashRow.DetailNotes) : cashRow.Reference ? String(cashRow.Reference) : null,
    });
    const prop = String(cashRow.Property_Name ?? cashRow.PropertyName ?? cashRow.Property ?? "").trim();
    if (prop) propertyCounts.set(prop, (propertyCounts.get(prop) ?? 0) + 1);
  }

  let propertyName: string | null = null;
  for (const [prop, count] of propertyCounts.entries()) {
    if (!propertyName || count > (propertyCounts.get(propertyName) ?? 0)) {
      propertyName = prop;
    }
  }

  return { examples, cashAccount: detectedCash || null, propertyName };
}

export function buildRules(examples: TrainingExample[]): LearnedRules {
  const exactMap = new Map<string, TrainingExample>();
  const signatureMap: LearnedRules["signatureMap"] = new Map();

  examples.forEach((ex) => {
    const exactKey = makeExactKey(ex);
    if (!exactMap.has(exactKey)) {
      exactMap.set(exactKey, ex);
    }

    const sigKey = `${ex.direction}|${ex.signature}`;
    const existing = signatureMap.get(sigKey) ?? { total: 0, counts: new Map<string, number>(), reference: ex.reference, detailNotes: ex.detailNotes, dominantAccount: null };
    existing.total += 1;
    existing.counts.set(ex.offsetAccount, (existing.counts.get(ex.offsetAccount) ?? 0) + 1);
    if (!existing.reference && ex.reference) existing.reference = ex.reference;
    if (!existing.detailNotes && ex.detailNotes) existing.detailNotes = ex.detailNotes;
    signatureMap.set(sigKey, existing);
  });

  for (const [key, meta] of signatureMap.entries()) {
    let dominant: string | null = null;
    let top = 0;
    for (const [acct, count] of meta.counts.entries()) {
      if (count > top) {
        dominant = acct;
        top = count;
      }
    }
    meta.dominantAccount = dominant;
    signatureMap.set(key, meta);
  }

  return { exactMap, signatureMap, cashAccount: null, propertyName: null, totalExamples: examples.length };
}

function canUseSignature(direction: "in" | "out", meta: { total: number; counts: Map<string, number>; dominantAccount: string | null }): boolean {
  if (!meta.dominantAccount || meta.total < 3) return false;
  const top = meta.counts.get(meta.dominantAccount) ?? 0;
  const share = top / meta.total;
  if (direction === "in") {
    return share >= 0.9;
  }
  return share >= 0.8;
}

export function applyRules(
  rows: NormalizedRow[],
  rules: LearnedRules,
): {
  rows: NormalizedRow[];
  exactMatches: number;
  signatureMatches: number;
  unmatched: number;
  unmatchedSamples: Array<{ journalDate: string | null; amount: number; notes: string | null }>;
} {
  if (!rules.totalExamples) {
    return { rows, exactMatches: 0, signatureMatches: 0, unmatched: 0, unmatchedSamples: [] };
  }

  let exactMatches = 0;
  let signatureMatches = 0;
  const unmatchedSamples: Array<{ journalDate: string | null; amount: number; notes: string | null }> = [];

  const mapped = rows.map((row) => {
    if (row.passthrough) return row;
    const amount = row.debit ?? row.credit ?? null;
    if (!amount) return row;
    const direction = row.credit && row.credit > 0 ? "in" : "out";
    const date = toDateOnly(row.journalDate);
    const rawNotes = row.rawNotes ?? row.notes;
    const rawDetailNotes = row.rawDetailNotes ?? row.detailNotes;
    const merchantNorm = normalizeText(`${rawNotes ?? ""} ${rawDetailNotes ?? ""}`);
    const signature = buildSignature(merchantNorm);

    const exactKey = makeExactKey({ date, amount, direction, merchantNorm });
    const exact = rules.exactMap.get(exactKey);
    if (exact) {
      exactMatches += 1;
      return {
        ...row,
        account: exact.offsetAccount || row.account,
        reference: exact.reference ?? row.reference,
        detailNotes: exact.detailNotes ?? exact.reference ?? row.detailNotes,
      };
    }

    const sigKey = `${direction}|${signature}`;
    const sigMeta = rules.signatureMap.get(sigKey);
    if (sigMeta && canUseSignature(direction, sigMeta) && sigMeta.dominantAccount) {
      signatureMatches += 1;
      return {
        ...row,
        account: sigMeta.dominantAccount,
        reference: sigMeta.reference ?? row.reference,
        detailNotes: sigMeta.detailNotes ?? sigMeta.reference ?? row.detailNotes,
      };
    }

    if (unmatchedSamples.length < 10) {
      unmatchedSamples.push({ journalDate: date, amount, notes: merchantNorm || null });
    }
    return row;
  });

  return {
    rows: mapped,
    exactMatches,
    signatureMatches,
    unmatched: rows.filter((row) => !row.passthrough).length - (exactMatches + signatureMatches),
    unmatchedSamples,
  };
}
