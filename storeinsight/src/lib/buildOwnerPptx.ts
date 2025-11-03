import fs from "node:fs/promises";
import path from "node:path";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import type { OwnerFields } from "@/types/ownerReport";

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

function normalizeTemplateTokens(zip: PizZip, keys: string[]): Set<string> {
  const discovered = new Set<string>();
  const keyLookup = new Map(keys.map((key) => [key.toUpperCase(), key]));
  const xmlPaths = Object.keys(zip.files).filter(
    (filename) => filename.startsWith("ppt/") && filename.endsWith(".xml"),
  );
  for (const filename of xmlPaths) {
    const file = zip.file(filename);
    if (!file) continue;
    const original = file.asText();
    const updated = original.replace(/\{\{([\s\S]*?)\}\}/g, (match, rawToken) => {
      const cleaned = rawToken
        .replace(/<\/?[^>]+>/g, "")
        .replace(/&[a-z0-9#]+;/gi, "")
        .replace(/[\s\r\n]+/g, "")
        .replace(/[{}]/g, "")
        .replace(/[^A-Za-z0-9_]/g, "");
      if (!cleaned) return match;
      const lookupKey = cleaned.toUpperCase();
      const canonical = keyLookup.get(lookupKey) ?? lookupKey;
      discovered.add(canonical);
      const normalized = `{{${canonical}}}`;
      return normalized;
    });
    if (updated !== original) {
      zip.file(filename, updated);
    }
  }
  return discovered;
}

export async function buildOwnerPptx(data: OwnerFields): Promise<Buffer> {
  const templatePath = path.join(process.cwd(), "public", "GAMMATEMPLATE.pptx");
  const template = await fs.readFile(templatePath);
  const zip = new PizZip(template);
  const prepared = massageForTemplate(data);
  const templateTokens = normalizeTemplateTokens(zip, Object.keys(prepared));
  for (const token of templateTokens) {
    if (!(token in prepared)) prepared[token] = "";
  }
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    delimiters: { start: "{{", end: "}}" },
    nullGetter: () => "",
  });
  doc.setData(prepared);
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
