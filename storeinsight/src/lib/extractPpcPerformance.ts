import * as XLSX from "xlsx";

type Identifier = string;

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

export function extractPpcPerformanceTokens(workbookBuffers: Buffer[], identifiers: Identifier[]): Record<string, number> {
  if (!workbookBuffers || workbookBuffers.length === 0 || identifiers.length === 0) return {};

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
      if (rows.length === 0) continue;
      const headers = Object.keys(rows[0]).map((h) => h.toString().toLowerCase());

      // Table with Cost/Impressions/Clicks
      if (isHeaderMatch(headers, ["campaign", "impressions", "clicks"])) {
        for (const row of rows) {
          const campaign = (row[headers.find((h) => h.includes("campaign")) ?? "campaign"] ?? "") as string;
          if (!campaign || !matchRow(campaign, identifiers)) continue;
          costSum += toNumber(row[headers.find((h) => h === "cost" || h.includes("cost")) ?? "cost"]);
          impressionsSum += toNumber(row[headers.find((h) => h.includes("impression")) ?? "impressions"]);
          clicksSum += toNumber(row[headers.find((h) => h.includes("click")) ?? "clicks"]);
        }
      }

      // Table with Conversions / Cost per conversion
      if (isHeaderMatch(headers, ["campaign", "convers"])) {
        for (const row of rows) {
          const campaign = (row[headers.find((h) => h.includes("campaign")) ?? "campaign"] ?? "") as string;
          if (!campaign || !matchRow(campaign, identifiers)) continue;
          conversionsSum += toNumber(row[headers.find((h) => h.startsWith("conversion")) ?? "conversions"]);
          const costPerConv =
            toNumber(row[headers.find((h) => h.includes("cost") && h.includes("conv")) ?? "cost / conv"]) || null;
          if (costPerConv && costPerConv > 0) {
            costPerConvValues.push(costPerConv);
          }
          const rowCost = toNumber(row[headers.find((h) => h === "cost" || h.includes("cost")) ?? "cost"]);
          if (rowCost) costSum += rowCost;
        }
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
