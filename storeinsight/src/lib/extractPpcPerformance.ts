import * as XLSX from "xlsx";

const toNumber = (value: unknown): number => {
  const num = typeof value === "number" ? value : Number(String(value).replace(/[^0-9.+-]/g, ""));
  return Number.isFinite(num) ? num : 0;
};

const isHeaderMatch = (headers: string[], required: string[]): boolean =>
  required.every((key) => headers.some((h) => h.includes(key)));

const extractRows = (sheet: XLSX.WorkSheet): Record<string, unknown>[] =>
  XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });

export function extractPpcPerformanceTokens(
  workbookBuffers: Buffer[],
  propertyHint?: string | null,
): Record<string, number> {
  if (!workbookBuffers || workbookBuffers.length === 0) return {};

  const hint = (propertyHint ?? "").toLowerCase();
  const isPittman = hint.includes("pittman");
  const isGrove = hint.includes("grove") || hint.includes("camelback");

  const tokens: Record<string, number> = {};
  let costSum = 0;
  let impressionsSum = 0;
  let clicksSum = 0;
  let conversionsSum = 0;
  const costPerConvValues: number[] = [];
  const cpcValues: number[] = [];

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
      const avgCpcKey = headers.find((h) => h.includes("avg") && h.includes("cpc")) ?? "avg. cpc";

      const groveRows: number[] = [];
      const pittmanRows: number[] = [];
      rows.slice(1).forEach((row, idx) => {
        const campaignRaw = row[campaignKey];
        const campaign = typeof campaignRaw === "string" ? campaignRaw.toLowerCase() : "";
        const rowNumber = idx + 2; // 1-based row number
        if (campaign.includes("camelback") || campaign.includes("grove")) groveRows.push(rowNumber);
        if (campaign.includes("pittman")) pittmanRows.push(rowNumber);
      });

      let targetRows: number[] = [];
      if (isGrove && groveRows.length > 0) targetRows = groveRows;
      else if (isPittman && pittmanRows.length > 0) targetRows = pittmanRows;
      else if (groveRows.length > 0 && pittmanRows.length === 0) targetRows = groveRows;
      else if (pittmanRows.length > 0) targetRows = pittmanRows;
      else targetRows = [2, 3, 4, 5].filter((n) => n <= rows.length);

      for (const rowIndex of targetRows) {
        const row = rows[rowIndex - 1];
        if (!row) continue;
        const campaign = (row[campaignKey] ?? "") as string;
        if (!campaign) continue;
        costSum += toNumber(row[costKey]);
        impressionsSum += toNumber(row[impressionsKey]);
        clicksSum += toNumber(row[clicksKey]);
        const convsRaw = toNumber(row[conversionsKey]);
        const convs = convsRaw > 0 ? convsRaw : toNumber(row[clicksKey]); // fall back to clicks as conversions proxy
        if (convs > 0) conversionsSum += convs;
        const cpcConv = toNumber(row[cpcKey]);
        if (cpcConv > 0) costPerConvValues.push(cpcConv);
        const avgCpc = toNumber(row[avgCpcKey]);
        if (avgCpc > 0) cpcValues.push(avgCpc);
        // ctrKey parsed but not currently tokenized; kept for potential future mapping
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
  } else if (cpcValues.length > 0) {
    const avg = cpcValues.reduce((a, b) => a + b, 0) / cpcValues.length;
    tokens.COSCON = avg;
  }

  return tokens;
}
