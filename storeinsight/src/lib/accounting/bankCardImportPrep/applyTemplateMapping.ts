import type { TemplateMapping, TemplateTx } from "./parseTemplateOutput";
import type { ValidatedRow } from "./validate";

const normalizeNotes = (value: unknown): string =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();

const toDateOnly = (value: Date | string | null | undefined): string | null => {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) return value.toISOString().slice(0, 10);
  if (typeof value === "string" || typeof value === "number") {
    const d = new Date(value);
    if (!Number.isNaN(d.valueOf())) return d.toISOString().slice(0, 10);
  }
  return null;
};

const makeExactKey = (date: string | null, amount: number, direction: "in" | "out", notesNorm: string) =>
  `${date ?? "NA"}|${amount}|${direction}|${notesNorm}`;

const makeFallbackKey = (date: string | null, amount: number, direction: "in" | "out") =>
  `${date ?? "NA"}|${amount}|${direction}`;

const pickBestFallback = (txNotes: string, candidates: TemplateTx[]): TemplateTx | null => {
  if (!candidates.length) return null;
  if (!txNotes) return candidates[0] ?? null;
  let best: TemplateTx | null = null;
  let bestScore = -1;
  for (const candidate of candidates) {
    const candNotes = candidate.notesNorm || "";
    const contains = txNotes.includes(candNotes) || candNotes.includes(txNotes);
    const score = contains ? Math.max(txNotes.length, candNotes.length) : 0;
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best ?? candidates[0] ?? null;
};

export function applyTemplateMapping(
  rows: ValidatedRow[],
  template: TemplateMapping | null,
): {
  rows: ValidatedRow[];
  matched: number;
  templateCount: number;
  unmatchedSamples: Array<{ journalDate: string | null; amount: number; notes: string | null }>;
} {
  if (!template || !template.templateTxCount) {
    return { rows, matched: 0, templateCount: 0, unmatchedSamples: [] };
  }

  let matched = 0;
  const unmatchedSamples: Array<{ journalDate: string | null; amount: number; notes: string | null }> = [];

  const mappedRows = rows.map((row) => {
    if (row.passthrough) return row;
    const amount = row.Debit ?? row.Credit ?? null;
    if (!amount) return row;
    const direction = row.Credit && row.Credit > 0 ? "in" : "out";
    const date = toDateOnly(row.JournalDate);
    const notesNorm = normalizeNotes(row.Notes ?? row.DetailNotes ?? "");

    const exactKey = makeExactKey(date, amount, direction, notesNorm);
    const fallbackKey = makeFallbackKey(date, amount, direction);

    const exactHit = template.exactMap.get(exactKey);
    const fallbackHit = !exactHit ? pickBestFallback(notesNorm, template.fallbackMap.get(fallbackKey) ?? []) : null;
    const match = exactHit ?? fallbackHit;

    if (!match) {
      if (unmatchedSamples.length < 10) {
        unmatchedSamples.push({ journalDate: date, amount, notes: notesNorm || null });
      }
      return row;
    }

    matched += 1;
    return {
      ...row,
      Account: match.offsetAccount || row.Account,
      Reference: match.reference ?? row.Reference,
      DetailNotes: match.detailNotes ?? match.reference ?? row.DetailNotes,
    };
  });

  return {
    rows: mappedRows,
    matched,
    templateCount: template.templateTxCount,
    unmatchedSamples,
  };
}
