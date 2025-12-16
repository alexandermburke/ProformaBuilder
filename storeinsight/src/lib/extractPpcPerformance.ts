import * as XLSX from "xlsx";

const toNumber = (value: unknown): number => {
  const num = typeof value === "number" ? value : Number(String(value).replace(/[^0-9.+-]/g, ""));
  return Number.isFinite(num) ? num : 0;
};

const isHeaderMatch = (headers: string[], required: string[]): boolean =>
  required.every((key) => headers.some((h) => h.includes(key)));

const extractRows = (sheet: XLSX.WorkSheet): Record<string, unknown>[] =>
  XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });

const matchRow = (campaign: string, identifiers: Identifier[]): boolean => {
  const lower = campaign.toLowerCase();
  return identifiers.some((id) => lower.includes(id.toLowerCase()));
};

export function extractPpcPerformanceTokens(
  workbookBuffers: Buffer[],
  propertyHint?: string | null,
): Record<string, number> {
  if (!workbookBuffers || workbookBuffers.length === 0) return {};

  const hint = (propertyHint ?? "").toLowerCase();
  const isPittman = hint.includes("pittman");
  const isGrove = hint.includes("grove") || hint.includes("camelback");
  const targetRows = isGrove ? [3, 5] : [2, 4]; // 1-based row numbers per instructions

  const tokens: Record<string, number> = {};
  let costSum = 0;
  let impressionsSum = 0;
  let clicksSum = 0;
  let conversionsSum = 0;
  const costPerConvValues: number[] = [];

  for (const workbookBuffer of workbookBuffers) {
    let workbook: XLSX.WorkBook;
    try {
      workbook = XLSX.read(workbookBuffer, { type: "buffer" });
    } catch (err) {
      console.warn("[ppc] unable to read workbook", err);
      continue;
    }

    const sheets = workbook.SheetNames.map((name) => ({
      name,
      rows: extractRows(workbook.Sheets[name]),
    }));

    for (const { rows } of sheets) {
      if (rows.length <= 1) continue;
      const headerRow = rows[0];
      const headers = Object.keys(headerRow).map((h) => h.toString().toLowerCase());
      if (!isHeaderMatch(headers, ["campaign", "impressions", "clicks"])) continue;

      const campaignKey = headers.find((h) => h.includes("campaign")) ?? "campaign";
      const costKey = headers.find((h) => h.includes("cost")) ?? "cost";
      const impressionsKey = headers.find((h) => h.includes("impress")) ?? "impressions";
      const clicksKey = headers.find((h) => h.includes("click")) ?? "clicks";
      const conversionsKey = headers.find((h) => h.startsWith("conversion")) ?? "conversions";
      const cpcKey = headers.find((h) => h.includes("cost") && h.includes("conv")) ?? "cost / conv";

      for (const rowIndex of targetRows) {
        const row = rows[rowIndex - 1];
        if (!row) continue;
        const campaign = (row[campaignKey] ?? "") as string;
        if (!campaign) continue;
        costSum += toNumber(row[costKey]);
        impressionsSum += toNumber(row[impressionsKey]);
        clicksSum += toNumber(row[clicksKey]);
        const convs = toNumber(row[conversionsKey]);
        if (convs > 0) conversionsSum += convs;
        const cpc = toNumber(row[cpcKey]);
        if (cpc > 0) costPerConvValues.push(cpc);
      }
    }
  }

  if (impressionsSum > 0) tokens.IMPRE = impressionsSum;
  if (clicksSum > 0) tokens.CLICKS = clicksSum;
  if (conversionsSum > 0) tokens.CONV = conversionsSum;
  if (costPerConvValues.length > 0) {
    const avg = costPerConvValues.reduce((a, b) => a + b, 0) / costPerConvValues.length;
    tokens.COSCON = avg;
  } else if (conversionsSum > 0 && costSum > 0) {
    tokens.COSCON = costSum / conversionsSum;
  }

  return tokens;
}
