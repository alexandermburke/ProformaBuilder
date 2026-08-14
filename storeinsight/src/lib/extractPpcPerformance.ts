import * as XLSX from "xlsx";

// PPC Performance export (one .csv that contains EVERY property's campaigns in a
// single sheet, because the ad platform can't export per-property). Each campaign
// row names the property by street address and/or name, e.g.
//   "555 Pittman Rd, Fairfield, CA, 94534- $1500"
//   "Pmax-  555 Pittman Rd, Fairfield, CA, 94534- $1000"
// Both of those belong to W002 (STORE on Pittman), so we match by keys derived
// from the target property's name + address and AGGREGATE every matching campaign
// (regular + Performance Max). Top-line tokens only:
//   GOOIMPRES = total impressions
//   GOOCLICKS = total clicks
//   GOOCTR    = CTR (total clicks / total impressions)
//   GOOCPC    = Cost/Click (total cost / total clicks)
// The Google-rank / keyword-grid tokens (GOOPOS/POSCHG/KEYMAP/KEYPOS/GOOKEYWORD)
// are not in this export and are intentionally left unset.

export type PpcMatchContext = {
  name?: string | null;
  address?: string | null;
  propertyCode?: string | null;
  propertyId?: string | null;
};

const toNumber = (value: unknown): number => {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const num = Number(String(value ?? "").replace(/[^0-9.+-]/g, ""));
  return Number.isFinite(num) ? num : 0;
};

const norm = (value: unknown): string =>
  String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// Words too generic to identify a property on their own.
const NAME_STOPWORDS = new Set([
  "store", "stores", "self", "storage", "on", "at", "the", "of", "and", "a", "an",
  "llc", "inc", "co", "mini", "management", "property", "properties", "spaces",
  "space", "center", "facility", "the",
]);
const STREET_SUFFIXES = new Set([
  "rd", "road", "ave", "avenue", "st", "street", "blvd", "boulevard", "dr", "drive",
  "ln", "lane", "way", "ct", "court", "pkwy", "parkway", "hwy", "highway", "cir",
  "circle", "ter", "terrace", "pl", "place", "loop", "trl", "trail", "sq", "square",
  "pike", "route", "rte",
]);
const DIRECTIONS = new Set(["n", "s", "e", "w", "ne", "nw", "se", "sw", "north", "south", "east", "west"]);

// Build the set of distinctive tokens that identify this property inside a campaign
// name. We use the property NAME's distinctive word(s) (e.g. "STORE on Pittman" ->
// "pittman") AND the STREET NAME from its address (e.g. "4250 E Camelback Rd" ->
// "camelback"), because some properties are named differently than their campaigns
// (the Grove campaigns are addressed on Camelback). City is deliberately excluded to
// avoid grabbing a different property in the same city.
function deriveMatchKeys(ctx: PpcMatchContext): string[] {
  const keys = new Set<string>();
  for (const word of norm(ctx.name).split(" ")) {
    if (word.length >= 3 && !NAME_STOPWORDS.has(word) && !/^\d+$/.test(word)) keys.add(word);
  }
  if (ctx.address) {
    const firstPart = String(ctx.address).split(",")[0] ?? ""; // street portion
    const tokens = norm(firstPart).split(" ").filter(Boolean);
    const streetTokens = tokens.filter((token, index) => {
      if (index === 0 && /^\d+$/.test(token)) return false; // leading house number
      if (DIRECTIONS.has(token)) return false;
      if (STREET_SUFFIXES.has(token)) return false;
      return true;
    });
    const street = streetTokens.join(" ").trim();
    if (street.length >= 3) keys.add(street);
    for (const token of streetTokens) {
      if (token.length >= 3 && !/^\d+$/.test(token)) keys.add(token);
    }
  }
  return [...keys];
}

type PpcRow = { campaign: string; cost: number; impressions: number; clicks: number };

// Parse the PPC table. Column headers repeat a "% Δ" between each metric, so we map
// by the named metric columns and ignore the deltas.
function parsePpcRows(workbook: XLSX.WorkBook): PpcRow[] {
  const out: PpcRow[] = [];
  for (const sheetName of workbook.SheetNames) {
    const grid = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], {
      header: 1,
      raw: false,
    });
    let headerIdx = -1;
    for (let r = 0; r < Math.min(grid.length, 15); r += 1) {
      const cells = (grid[r] ?? []).map((c) => norm(c));
      if (
        cells.some((c) => c.includes("campaign")) &&
        cells.some((c) => c.includes("impress")) &&
        cells.some((c) => c.includes("click"))
      ) {
        headerIdx = r;
        break;
      }
    }
    if (headerIdx === -1) continue;

    const header = (grid[headerIdx] ?? []).map((c) => norm(c));
    const find = (pred: (h: string) => boolean) => header.findIndex(pred);
    const campaignCol = find((h) => h.includes("campaign"));
    const costCol = find((h) => h === "cost" || (h.includes("cost") && !h.includes("conv")));
    const imprCol = find((h) => h.includes("impress"));
    const clicksCol = find((h) => h === "clicks" || (h.includes("click") && !h.includes("ctr")));
    if (campaignCol === -1 || imprCol === -1 || clicksCol === -1) continue;

    for (let r = headerIdx + 1; r < grid.length; r += 1) {
      const row = grid[r] ?? [];
      const campaign = String(row[campaignCol] ?? "").trim();
      if (!campaign) continue;
      out.push({
        campaign,
        cost: costCol >= 0 ? toNumber(row[costCol]) : 0,
        impressions: toNumber(row[imprCol]),
        clicks: toNumber(row[clicksCol]),
      });
    }
  }
  return out;
}

const fmtInt = (n: number): string => Math.round(n).toLocaleString("en-US");
const fmtPct = (n: number): string => `${n.toFixed(2)}%`;
const fmtCurrency = (n: number): string =>
  n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

export function extractPpcPerformanceTokens(
  workbookBuffers: Buffer[],
  context?: PpcMatchContext | string | null,
): Record<string, string | number> {
  if (!workbookBuffers || workbookBuffers.length === 0) return {};
  const ctx: PpcMatchContext = typeof context === "string" ? { name: context } : context ?? {};
  const keys = deriveMatchKeys(ctx);

  if (keys.length === 0) {
    // No way to identify which campaigns belong to this property; refuse to guess
    // rather than summing every property's spend together.
    console.warn("[ppc] no property match keys derived from context; skipping PPC tokens", ctx);
    return {};
  }

  let cost = 0;
  let impressions = 0;
  let clicks = 0;
  const matched: string[] = [];

  for (const buffer of workbookBuffers) {
    let workbook: XLSX.WorkBook;
    try {
      workbook = XLSX.read(buffer, { type: "buffer" });
    } catch (err) {
      console.warn("[ppc] unable to read workbook", err);
      continue;
    }
    for (const row of parsePpcRows(workbook)) {
      const campaignNorm = norm(row.campaign);
      if (!keys.some((key) => campaignNorm.includes(key))) continue;
      matched.push(row.campaign);
      cost += row.cost;
      impressions += row.impressions;
      clicks += row.clicks;
    }
  }

  console.info("[ppc] property match", {
    keys,
    matchedCampaigns: matched,
    totals: { cost: Math.round(cost * 100) / 100, impressions, clicks },
  });

  const tokens: Record<string, string | number> = {};
  if (impressions > 0) tokens.GOOIMPRES = fmtInt(impressions);
  if (clicks > 0) tokens.GOOCLICKS = fmtInt(clicks);
  if (impressions > 0 && clicks > 0) tokens.GOOCTR = fmtPct((clicks / impressions) * 100); // CTR
  if (clicks > 0 && cost > 0) tokens.GOOCPC = fmtCurrency(cost / clicks); // Cost / Click
  return tokens;
}
