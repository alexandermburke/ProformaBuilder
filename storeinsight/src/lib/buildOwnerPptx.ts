import fs from "node:fs/promises";
import path from "node:path";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import type { OwnerFields } from "@/types/ownerReport";
import {
  extractBudgetTableFields,
  type BudgetTokenDetail,
} from "@/lib/extractBudget";
import type { OwnerPerformanceTokenValues } from "@/lib/ownerPerformance";
import {
  normalizeTokenKey,
  REQUIRED_DELINQUENCY_TOKENS,
  scanPptTokens,
  stripHiddenTokenCharacters,
} from "@/lib/pptTokens";

const DASH_CHARACTER = "\u2013";
const BLANK_LITERALS = new Set(["", "NaN", "undefined"]);

const MAPPING_ALIASES: Record<string, string> = {
  TOTALINCOME: "TOTALINCCM",
  TOTALEXPENSES: "TOTEXPCM",
  NETINCOME: "NETINCCM",
  SFTOC: "OCCUPIEDAREAPERCENT",
};

const PPT_XML_FILE_PATTERN = /^ppt\/(slides|slideLayouts|slideMasters)\/.*\.xml$/;

type TemplateValue = string | number;

const scrubHiddenCharactersFromZip = (zip: PizZip): void => {
  const xmlPaths = Object.keys(zip.files).filter((filename) => PPT_XML_FILE_PATTERN.test(filename));
  for (const filename of xmlPaths) {
    const file = zip.file(filename);
    if (!file) continue;
    const original = file.asText();
    const sanitized = stripHiddenTokenCharacters(original);
    if (sanitized !== original) {
      zip.file(filename, sanitized);
    }
  }
};

const normalizeNumberRecord = (record?: Record<string, number> | null): Record<string, number> => {
  const normalized: Record<string, number> = {};
  if (!record) return normalized;
  for (const [key, value] of Object.entries(record)) {
    const canonical = normalizeTokenKey(key);
    const numericValue = Number(value);
    if (!canonical || !Number.isFinite(numericValue)) continue;
    normalized[canonical] = numericValue;
  }
  return normalized;
};

const normalizeValueRecord = (
  record?: Record<string, TemplateValue> | null,
): Record<string, TemplateValue> => {
  const normalized: Record<string, TemplateValue> = {};
  if (!record) return normalized;
  for (const [key, value] of Object.entries(record)) {
    const canonical = normalizeTokenKey(key);
    if (!canonical) continue;
    normalized[canonical] = value;
  }
  return normalized;
};

const isBlankValue = (value: unknown): boolean => {
  if (value == null) return true;
  if (typeof value === "number") return Number.isNaN(value);
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed.length === 0) return true;
  return BLANK_LITERALS.has(trimmed);
};

const coerceNegativeZeroString = (input: string): string => {
  if (/^-\$0(\.0+)?$/.test(input)) {
    return input.replace("-$", "$0");
  }
  if (/^\$-0(\.0+)?$/.test(input)) {
    return input.replace("$-0", "$0");
  }
  if (/^-0(\.0+)?(%?)$/.test(input)) {
    return input.replace("-0", "0");
  }
  if (/^-0(\.0+)?([A-Za-z]+)$/.test(input)) {
    return input.replace("-0", "0");
  }
  return input;
};

const normalizeRenderedValue = (value: unknown): string => {
  if (value == null) return DASH_CHARACTER;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return DASH_CHARACTER;
    return coerceNegativeZeroString(String(value));
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) return DASH_CHARACTER;
    if (BLANK_LITERALS.has(trimmed)) return DASH_CHARACTER;
    return coerceNegativeZeroString(trimmed);
  }
  return DASH_CHARACTER;
};

const fmtNumber = (n: number) => new Intl.NumberFormat("en-US").format(n);
const fmtOwnerPercent = (n: number) => {
  if (!Number.isFinite(n)) return "";
  const value = Math.abs(n) <= 1 ? n * 100 : n;
  return `${value.toFixed(1)}%`;
};

const isPercentToken = (token: string): boolean => /(VARPER|YTDVARPER)$/.test(token);

const fmtCurrency = (value: number): string =>
  value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const fmtBudgetPercent = (value: number): string => `${Number(value).toFixed(1)}%`;

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
    OCCUPIEDAREAPERCENT: fmtOwnerPercent(fields.OCCUPIEDAREAPERCENT),
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
      return `{{${canonical}}}`;
    });
    if (updated !== original) {
      zip.file(filename, updated);
    }
  }
  return discovered;
}

type BuildOwnerPptxOptions = {
  templateBuffer?: Buffer;
  ownerValues: OwnerFields;
  budgetTokensNumeric?: Record<string, number>;
  budgetDetails?: Record<string, BudgetTokenDetail>;
  budgetOverrides?: Record<string, number>;
  templateTokens?: string[];
  budgetBuffer?: Buffer | null;
  performanceTokens?: (OwnerPerformanceTokenValues | Record<string, string | number>) | null;
};

export async function buildOwnerPptx(options: BuildOwnerPptxOptions): Promise<Buffer> {
  const {
    templateBuffer: providedTemplateBuffer,
    ownerValues,
    budgetTokensNumeric: providedBudgetTokens,
    budgetDetails: providedBudgetDetails,
    budgetOverrides: providedBudgetOverrides,
    templateTokens,
    budgetBuffer,
    performanceTokens,
  } = options;

  const templateBuffer =
    providedTemplateBuffer ??
    (await fs.readFile(path.join(process.cwd(), "public", "MICROTEMPLATE.pptx")));

  const tokenScan = await scanPptTokens({ templateBuffer });
  console.log(`[pptx] template sha256 ${tokenScan.sha256}`);
  console.log(`[pptx] template tokens (${tokenScan.tokens.length}): ${tokenScan.tokens.join(", ")}`);
  const scannedTokenSet = new Set(tokenScan.tokens);
  const missingDelinquencyTokens = REQUIRED_DELINQUENCY_TOKENS.filter(
    (token) => !scannedTokenSet.has(token),
  );
  if (missingDelinquencyTokens.length > 0) {
    const message = [
      `public/MICROTEMPLATE.pptx is missing delinquency placeholders: ${missingDelinquencyTokens.join(", ")}`,
      "The desktop PPTX may differ from public/MICROTEMPLATE.pptx. Replace the file with the version that contains all 9 {{DELIN…}} placeholders and re-run.",
    ].join("\n");
    throw new Error(message);
  }

  const zip = new PizZip(templateBuffer);
  scrubHiddenCharactersFromZip(zip);
  const ownerTokens = normalizeValueRecord(massageForTemplate(ownerValues));

  let budgetTokensNumeric = normalizeNumberRecord(providedBudgetTokens);
  let budgetDetails: Record<string, BudgetTokenDetail> = {};
  if (providedBudgetDetails) {
    for (const [token, detail] of Object.entries(providedBudgetDetails)) {
      const canonicalToken = normalizeTokenKey(token);
      if (!canonicalToken) continue;
      budgetDetails[canonicalToken] = { ...detail };
    }
  }

  if (Object.keys(budgetTokensNumeric).length === 0 && budgetBuffer) {
    try {
      const extraction = await extractBudgetTableFields(budgetBuffer, undefined);
      budgetTokensNumeric = normalizeNumberRecord(extraction.tokens);
      budgetDetails = {};
      for (const [token, detail] of Object.entries(extraction.details)) {
        const canonicalToken = normalizeTokenKey(token);
        if (!canonicalToken) continue;
        budgetDetails[canonicalToken] = { ...detail };
      }
    } catch (error) {
      console.error("[owner-reports] Unable to extract budget tokens on server", error);
    }
  }

  const budgetOverrideValues = normalizeNumberRecord(providedBudgetOverrides);
  const performanceTokenValues =
    performanceTokens && Object.keys(performanceTokens).length > 0
      ? normalizeValueRecord(performanceTokens as Record<string, TemplateValue>)
      : undefined;

  const tokenKeys = Array.from(
    new Set([
      ...Object.keys(ownerTokens),
      ...Object.keys(budgetTokensNumeric),
      ...Object.keys(budgetOverrideValues),
      ...(performanceTokenValues ? Object.keys(performanceTokenValues) : []),
    ]),
  );

  const templateMeta = normalizeTemplateTokens(zip, tokenKeys);
  const tokensWithTrailingPercent = new Set(
    [...templateMeta.entries()]
      .filter(([, meta]) => meta.trailingPercent)
      .map(([token]) => normalizeTokenKey(token) ?? token.toUpperCase()),
  );

  const summaryFields: Record<string, string | number> = { ...ownerTokens };
  const budgetTokens: Record<string, string | number> = {};
  const budgetOverrides: Record<string, string | number> = {};
  const appliedNumeric: Record<string, number> = {};

  const effectiveDetails: Record<string, BudgetTokenDetail> = {};
  for (const [token, detail] of Object.entries(budgetDetails)) {
    effectiveDetails[token] = { ...detail };
  }

  for (const [token, rawValue] of Object.entries(budgetTokensNumeric)) {
    const numericValue = Number(rawValue);
    if (!Number.isFinite(numericValue)) continue;
    const printable = isPercentToken(token)
      ? tokensWithTrailingPercent.has(token)
        ? Number(numericValue).toFixed(1)
        : fmtBudgetPercent(numericValue)
      : fmtCurrency(numericValue);
    budgetTokens[token] = printable;
    appliedNumeric[token] = numericValue;
    const detail = effectiveDetails[token];
    if (detail) {
      effectiveDetails[token] = { ...detail, value: numericValue };
    } else {
      effectiveDetails[token] = {
        value: numericValue,
        sheet: "Budget Comparison",
        cell: "-",
      };
    }
  }

  for (const [token, overrideValue] of Object.entries(budgetOverrideValues)) {
    const numericValue = Number(overrideValue);
    if (!Number.isFinite(numericValue)) continue;
    const printable = isPercentToken(token)
      ? tokensWithTrailingPercent.has(token)
        ? Number(numericValue).toFixed(1)
        : fmtBudgetPercent(numericValue)
      : fmtCurrency(numericValue);
    budgetOverrides[token] = printable;
    appliedNumeric[token] = numericValue;
    const existing = effectiveDetails[token];
    effectiveDetails[token] = {
      value: numericValue,
      sheet: existing?.sheet ?? "Manual Override",
      cell: existing?.cell ?? "-",
      note: existing?.note ? `${existing.note}; manual override` : "manual override",
    };
  }

  const templateTokenSet = new Set<string>(scannedTokenSet);
  if (templateTokens && templateTokens.length > 0) {
    for (const token of templateTokens) {
      const canonicalToken = normalizeTokenKey(token);
      if (!canonicalToken) continue;
      templateTokenSet.add(canonicalToken);
    }
  }
  for (const token of templateMeta.keys()) {
    const canonicalToken = normalizeTokenKey(token);
    if (!canonicalToken) continue;
    templateTokenSet.add(canonicalToken);
  }
  const templateTokenList = Array.from(templateTokenSet);

  const data: Record<string, TemplateValue> = {
    ...summaryFields,
    ...(performanceTokenValues ?? {}),
    ...budgetTokens,
    ...budgetOverrides,
  };
  const templateData = normalizeValueRecord(data);

  for (const [displayKey, sourceKey] of Object.entries(MAPPING_ALIASES)) {
    const sourceValue = templateData[sourceKey];
    if (sourceValue === undefined || isBlankValue(sourceValue)) continue;
    templateData[displayKey] = sourceValue;
  }

  // Optional: quick auditor to spot template tokens that won't be filled
  // Provide a list of expected keys if you maintain one elsewhere
  // const expectedKeys = Object.keys(data);
  // console.log('[pptx] first 10 keys:', expectedKeys.slice(0,10));

  const missingTokens = templateTokenList.filter((token) => isBlankValue(templateData[token]));
  const appliedCount = templateTokenList.length - missingTokens.length;

  if (missingTokens.length > 0) {
    const preview = missingTokens.slice(0, 20);
    const remaining = missingTokens.length - preview.length;
    console.warn(
      `[budget] WARNING: missing tokens not applied (rendered as ${DASH_CHARACTER}):`,
      preview,
      remaining > 0 ? `(+${remaining} more)` : "",
    );
    console.log("[budget] applied", appliedCount, "of", templateTokenList.length);
  } else if (templateTokenList.length > 0) {
    console.log("[budget] applied", appliedCount, "of", templateTokenList.length);
  }

  for (const token of templateTokenList) {
    if (isBlankValue(templateData[token])) {
      templateData[token] = DASH_CHARACTER;
    }
  }

  for (const [key, rawValue] of Object.entries(templateData)) {
    templateData[key] = normalizeRenderedValue(rawValue);
  }

  for (const [token, detail] of Object.entries(effectiveDetails)) {
    const numericValue = appliedNumeric[token];
    if (numericValue === undefined) continue;
    const display = isPercentToken(token)
      ? fmtBudgetPercent(numericValue)
      : fmtCurrency(numericValue);
    const sheetLabel = detail.sheet || "Unknown Sheet";
    const cellLabel = detail.cell || "-";
    const noteSuffix = detail.note ? ` (${detail.note})` : "";
    console.log(
      `[budget] ${display} from ${sheetLabel}!${cellLabel} applied --> {{${token}}}${noteSuffix}`,
    );
  }

  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    delimiters: { start: "{{", end: "}}" },
    nullGetter: () => "",
  });

  // Build the data object exactly once (summary fields + budget tokens + overrides)
  const keys = Object.keys(templateData);
  console.log(`[pptx] rendering ${keys.length} unique keys`);
  for (const k of keys) {
    console.log(`[pptx] key ${k} ->`, templateData[k]);
  }

  // New Docxtemplater API: pass data directly to render
  // (removes deprecated .setData())
  doc.render(templateData);

  // Optional sanity check: count placeholders inside the PPTX template
  try {
    const fullText = doc.getFullText && doc.getFullText();
    if (typeof fullText === "string") {
      const matches = fullText.match(/\{\{[^}]+\}\}/g) ?? [];
      console.log(
        `[pptx] template contains ${matches.length} total placeholders (including duplicates)`,
      );
    }
  } catch (err) {
    console.warn("[pptx] unable to count placeholders (non-fatal):", (err as Error)?.message ?? err);
  }

  return doc.getZip().generate({ type: "nodebuffer" });
}
