import fs from "node:fs/promises";
import path from "node:path";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import type { OwnerFields } from "@/types/ownerReport";
import { extractBudgetTableFields } from "@/lib/extractBudget";

const fmtNumber = (n: number) => new Intl.NumberFormat("en-US").format(n);
const fmtPercent = (n: number) => {
  if (!Number.isFinite(n)) return "";
  const value = Math.abs(n) <= 1 ? n * 100 : n;
  return `${value.toFixed(1)}%`;
};

function massageForTemplate(fields: OwnerFields): Record<string, string> {
  return {
    CURRENTDATE: fields.CURRENTDATE,
    ADDRESS: fields.ADDRESS,
    OWNERGROUP: fields.OWNERGROUP,
    ACQUIREDDATE: fields.ACQUIREDDATE,
    TOTALUNITS: fmtNumber(fields.TOTALUNITS),
    RENTABLESQFT: fmtNumber(fields.RENTABLESQFT),
    CURRENTMONTH: fields.CURRENTMONTH,
    TOTALRENTALINCOME: fmtNumber(fields.TOTALRENTALINCOME),
    TOTALINCOME: fmtNumber(fields.TOTALINCOME),
    TOTALEXPENSES: fmtNumber(fields.TOTALEXPENSES),
    NETINCOME: fmtNumber(fields.NETINCOME),
    OCCUPIEDAREASQFT: fmtNumber(fields.OCCUPIEDAREASQFT),
    OCCUPANCYBYUNITS: fmtNumber(fields.OCCUPANCYBYUNITS),
    OCCUPIEDAREAPERCENT: fmtPercent(fields.OCCUPIEDAREAPERCENT),
    MOVEINS_TODAY: fmtNumber(fields.MOVEINS_TODAY),
    MOVEINS_MTD: fmtNumber(fields.MOVEINS_MTD),
    MOVEINS_YTD: fmtNumber(fields.MOVEINS_YTD),
    MOVEOUTS_TODAY: fmtNumber(fields.MOVEOUTS_TODAY),
    MOVEOUTS_MTD: fmtNumber(fields.MOVEOUTS_MTD),
    MOVEOUTS_YTD: fmtNumber(fields.MOVEOUTS_YTD),
    NET_TODAY: fmtNumber(fields.NET_TODAY),
    NET_MTD: fmtNumber(fields.NET_MTD),
    NET_YTD: fmtNumber(fields.NET_YTD),
    MOVEINS_SQFT_MTD: fmtNumber(fields.MOVEINS_SQFT_MTD),
    MOVEOUTS_SQFT_MTD: fmtNumber(fields.MOVEOUTS_SQFT_MTD),
    NET_SQFT_MTD: fmtNumber(fields.NET_SQFT_MTD),
  };
}

type TokenMeta = {
  trailingPercent: boolean;
};

function normalizeTemplateTokens(zip: PizZip, keys: string[]): Map<string, TokenMeta> {
  const discovered = new Map<string, TokenMeta>();
  const keyLookup = new Map(keys.map((key) => [key.toUpperCase(), key]));
  const xmlPaths = Object.keys(zip.files).filter(
    (filename) => filename.startsWith("ppt/") && filename.endsWith(".xml"),
  );
  for (const filename of xmlPaths) {
    const file = zip.file(filename);
    if (!file) continue;
    const original = file.asText();
    const updated = original.replace(/\{\{([\s\S]*?)\}\}/g, (match, rawToken, offset) => {
      const cleaned = rawToken
        .replace(/<\/?[^>]+>/g, "")
        .replace(/&[a-z0-9#]+;/gi, "")
        .replace(/[\s\r\n]+/g, "")
        .replace(/[{}]/g, "")
        .replace(/[^A-Za-z0-9_]/g, "");
      if (!cleaned) return match;
      const lookupKey = cleaned.toUpperCase();
      const canonical = keyLookup.get(lookupKey) ?? lookupKey;
      const meta = discovered.get(canonical) ?? { trailingPercent: false };
      const nextChar = original[offset + match.length];
      if (nextChar === "%") {
        meta.trailingPercent = true;
      }
      discovered.set(canonical, meta);
      const normalized = `{{${canonical}}}`;
      return normalized;
    });
    if (updated !== original) {
      zip.file(filename, updated);
    }
  }
  return discovered;
}

type BudgetOptions = {
  budget?: Buffer | null;
  financial?: Buffer | null;
  budgetTokens?: Record<string, number>;
  overrides?: Record<string, number>;
};

export async function buildOwnerPptx(
  data: OwnerFields,
  options?: BudgetOptions,
): Promise<Buffer> {
  const templatePath = path.join(process.cwd(), "public", "XRAYTEMPLATE.pptx");
  const template = await fs.readFile(templatePath);
  const zip = new PizZip(template);
  const ownerTokens = massageForTemplate(data);

  let budgetTokens: Record<string, number> = options?.budgetTokens ?? {};
  if (!options?.budgetTokens && options?.budget) {
    try {
      const result = await extractBudgetTableFields(options.budget, options.financial ?? undefined);
      budgetTokens = result.tokens;
    } catch (err) {
      console.error("[owner-reports] Unable to extract budget tokens", err);
      budgetTokens = {};
    }
  }

  const mergedTokens: Record<string, string | number> = {
    ...ownerTokens,
    ...budgetTokens,
    ...(options?.overrides ?? {}),
  };

  const templateTokens = normalizeTemplateTokens(zip, Object.keys(mergedTokens));
  const tokensWithTrailingPercent = new Set(
    [...templateTokens.entries()].filter(([, meta]) => meta.trailingPercent).map(([token]) => token),
  );

  const percentFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

  const payload: Record<string, string> = {};
  for (const [key, value] of Object.entries(mergedTokens)) {
    if (typeof value === "number") {
      if (key.endsWith("VARPER") || key.endsWith("YTDVARPER")) {
        const formatted = percentFormatter.format(value);
        payload[key] = tokensWithTrailingPercent.has(key) ? formatted : `${formatted}%`;
      } else {
        payload[key] = String(value);
      }
    } else {
      payload[key] = String(value ?? "");
    }
  }

  for (const token of templateTokens.keys()) {
    if (!(token in payload)) payload[token] = "";
  }
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    delimiters: { start: "{{", end: "}}" },
    nullGetter: () => "",
  });
  doc.setData(payload);
  try {
    doc.render();
  } catch (err) {
    if (err instanceof Error) {
      const enriched = err as Error & { properties?: { errors?: unknown } };
      if (enriched.properties?.errors) {
        const details = JSON.stringify(enriched.properties.errors, null, 2);
        throw new Error(`Unable to populate PowerPoint template. Check token formatting.\n${details}`);
      }
    }
    throw err;
  }
  return doc.getZip().generate({ type: "nodebuffer" });
}
