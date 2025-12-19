import fs from "node:fs/promises";
import path from "node:path";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import * as XLSX from "xlsx";
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
import { extractWebRateTokensFromAvailableSpaces } from "@/lib/extractAvailableSpaces";

const DASH_CHARACTER = "-";
const BLANK_LITERALS = new Set(["", "NaN", "undefined"]);

const MAPPING_ALIASES: Record<string, string> = {
  TOTALINCOME: "TOTALINCCM",
  TOTALEXPENSES: "TOTEXPCM",
  NETINCOME: "NETINCCM",
  TOTALRENTALINCOME: "TOTRENINCCM",
  SFTOC: "OCCUPIEDAREAPERCENT",
};

const BUDGET_ALIAS_BASES: Record<string, string> = {
  OTHEXP: "OTHEREXP",
  TOTOTHEXP: "TOTOTHEREXP",
};

const BUDGET_SUFFIXES = [
  "CM",
  "PTD",
  "VAR",
  "VARPER",
  "YTD",
  "YTDBUD",
  "YTDVAR",
  "YTDVARPER",
] as const;

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
  !Number.isFinite(value) || value === 0
    ? DASH_CHARACTER
    : value.toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });

const fmtBudgetPercent = (value: number): string => `${Number(value).toFixed(1)}%`;
const fmtPercentWholeNumber = (n: number): string => {
  if (!Number.isFinite(n)) return "";
  const value = Math.abs(n) <= 1 ? n * 100 : n;
  return Math.round(value).toLocaleString("en-US");
};

const MONTH_LABELS: Record<string, number> = {
  JANUARY: 0,
  FEBRUARY: 1,
  MARCH: 2,
  APRIL: 3,
  MAY: 4,
  JUNE: 5,
  JULY: 6,
  AUGUST: 7,
  SEPTEMBER: 8,
  OCTOBER: 9,
  NOVEMBER: 10,
  DECEMBER: 11,
};

const monthNameFormatter = new Intl.DateTimeFormat("en-US", { month: "long" });

const parseMonthLabel = (value?: TemplateValue): Date | null => {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;

  const match = raw.match(/^([A-Za-z]+)(?:\s+(\d{4}))?/);
  if (match) {
    const monthName = match[1]?.toUpperCase();
    const monthIndex = monthName ? MONTH_LABELS[monthName] : undefined;
    if (monthIndex !== undefined) {
      const year = match[2] ? Number(match[2]) : new Date().getFullYear();
      if (Number.isFinite(year)) {
        return new Date(year, monthIndex, 1);
      }
    }
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Date(parsed.getFullYear(), parsed.getMonth(), 1);
};

const previousMonthLabel = (value?: TemplateValue): string | null => {
  const parsed = parseMonthLabel(value);
  if (!parsed) return null;
  parsed.setMonth(parsed.getMonth() - 1);
  return monthNameFormatter.format(parsed);
};

const nextMonthLabel = (value?: TemplateValue): string | null => {
  const parsed = parseMonthLabel(value);
  if (!parsed) return null;
  parsed.setMonth(parsed.getMonth() + 1);
  return monthNameFormatter.format(parsed);
};

const directionLabel = (value?: TemplateValue): "increase" | "decrease" => {
  if (value == null) return "increase";
  if (typeof value === "number") {
    return value < 0 ? "decrease" : "increase";
  }
  const cleaned = value.replace(/[^\d.-]+/g, "");
  const numeric = Number(cleaned);
  if (Number.isFinite(numeric) && numeric < 0) return "decrease";
  return "increase";
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
    MOVEINS: fmtNumber(fields.MOVEINS),
    INSURPER: fmtPercentWholeNumber(fields.INSURPER),
    OVERALLPER: fmtOwnerPercent(fields.OVERALLPER),
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
  availableSpacesTokens?: Record<string, string> | null;
  availableSpacesBuffer?: Buffer | null;
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
    availableSpacesTokens,
    availableSpacesBuffer,
    performanceTokens,
  } = options;

  const templateBuffer =
    providedTemplateBuffer ??
    (await fs.readFile(path.join(process.cwd(), "public", "OWNERTEMPLATE.pptx")));

  const tokenScan = await scanPptTokens({ templateBuffer });
  console.log(`[pptx] template sha256 ${tokenScan.sha256}`);
  console.log(`[pptx] template tokens (${tokenScan.tokens.length}): ${tokenScan.tokens.join(", ")}`);
  const scannedTokenSet = new Set(tokenScan.tokens);
  const missingDelinquencyTokens = REQUIRED_DELINQUENCY_TOKENS.filter(
    (token) => !scannedTokenSet.has(token),
  );
  if (missingDelinquencyTokens.length > 0) {
    const message = [
      `public/OWNERTEMPLATE.pptx is missing delinquency placeholders: ${missingDelinquencyTokens.join(", ")}`,
      "The desktop PPTX may differ from public/OWNERTEMPLATE.pptx. Replace the file with the version that contains all 9 {{DELIN…}} placeholders and re-run.",
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
  let availableSpacesTokenValues =
    availableSpacesTokens && Object.keys(availableSpacesTokens).length > 0
      ? normalizeValueRecord(availableSpacesTokens)
      : undefined;

  if ((!availableSpacesTokenValues || Object.keys(availableSpacesTokenValues).length === 0) && availableSpacesBuffer) {
    try {
      const workbook = XLSX.read(availableSpacesBuffer, { type: "buffer" });
      const extracted = extractWebRateTokensFromAvailableSpaces(workbook);
      if (extracted && Object.keys(extracted).length > 0) {
        availableSpacesTokenValues = normalizeValueRecord(extracted);
      }
    } catch (err) {
      console.warn(
        "[available-spaces] Unable to parse Available Spaces workbook in builder:",
        (err as Error)?.message ?? err,
      );
    }
  }

  const tokenKeys = Array.from(
    new Set([
      ...Object.keys(ownerTokens),
      ...Object.keys(budgetTokensNumeric),
      ...Object.keys(budgetOverrideValues),
      ...(performanceTokenValues ? Object.keys(performanceTokenValues) : []),
      ...(availableSpacesTokenValues ? Object.keys(availableSpacesTokenValues) : []),
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

  for (const [aliasBase, sourceBase] of Object.entries(BUDGET_ALIAS_BASES)) {
    for (const suffix of BUDGET_SUFFIXES) {
      const sourceKey = `${sourceBase}${suffix}`;
      const aliasKey = `${aliasBase}${suffix}`;

      if (budgetTokens[sourceKey] !== undefined && budgetTokens[aliasKey] === undefined) {
        budgetTokens[aliasKey] = budgetTokens[sourceKey];
      }
      if (budgetOverrides[sourceKey] !== undefined && budgetOverrides[aliasKey] === undefined) {
        budgetOverrides[aliasKey] = budgetOverrides[sourceKey];
      }
      if (appliedNumeric[sourceKey] !== undefined && appliedNumeric[aliasKey] === undefined) {
        appliedNumeric[aliasKey] = appliedNumeric[sourceKey];
      }
      const detail = effectiveDetails[sourceKey];
      if (detail && !effectiveDetails[aliasKey]) {
        effectiveDetails[aliasKey] = { ...detail };
      }
    }
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
    ...(availableSpacesTokenValues ?? {}),
    ...budgetTokens,
    ...budgetOverrides,
  };
  const templateData = normalizeValueRecord(data);
  const ownerCurrentMonth = summaryFields.CURRENTMONTH ?? ownerValues.CURRENTMONTH ?? "";
  const ownerCurrentDate = summaryFields.CURRENTDATE ?? ownerValues.CURRENTDATE ?? "";
  templateData.CURRENTMONTH = ownerCurrentMonth;
  templateData.CURRENTDATE = ownerCurrentDate;
  const nextMonth = nextMonthLabel(ownerCurrentMonth ?? ownerValues.CURRENTMONTH);
  if (nextMonth) {
    templateData.NEXTMONTH = nextMonth;
  }

  for (const [displayKey, sourceKey] of Object.entries(MAPPING_ALIASES)) {
    const sourceValue = templateData[sourceKey];
    if (sourceValue === undefined || isBlankValue(sourceValue)) continue;
    templateData[displayKey] = sourceValue;
  }
  // Force TOTALRENTALINCOME to only come from the budget token (C13), with no fallback.
  templateData.TOTALRENTALINCOME = isBlankValue(templateData.TOTRENINCCM)
    ? ""
    : templateData.TOTRENINCCM;

  const prevMonth = previousMonthLabel(
    templateData.CURRENTMONTH ?? ownerValues.CURRENTMONTH,
  );
  if (prevMonth) {
    templateData.PREVMON = prevMonth;
  }

  templateData.INCORDEC1 = directionLabel(templateData.MOVIPER);
  templateData.INCORDEC2 = directionLabel(templateData.MOVOPER);
  templateData.INCORDEC3 = directionLabel(templateData.MOVN);

  const unsignedTokens = ["MOVIPER", "MOVOPER", "MOVN"];
  for (const token of unsignedTokens) {
    const value = templateData[token];
    if (typeof value === "number") {
      templateData[token] = Math.abs(value);
      continue;
    }
    if (typeof value === "string") {
      const trimmed = value.trim();
      templateData[token] = trimmed.replace(/^-\s*/, "");
    }
  }

  const aliasMap: Record<string, string> = {
    // Admin Fees: ADMFE* already populated
    ADMFEEECM: "ADMFECM",
    ADMFEEPTD: "ADMFEPTD",
    ADMFEEVAR: "ADMFEVAR",
    ADMFEEYTD: "ADMFEYTD",
    ADMFEEYTDBUD: "ADMFEYTDBUD",
    ADMFEEYTDVAR: "ADMFEYTDVAR",
    ADMFEEYTDVARPER: "ADMFEYTDVARPER",

    // Tenant Income - Insurance: INSURT* already populated
    INSURCM: "INSURTCM",
    INSURPTD: "INSURTPTD",
    INSURVAR: "INSURTVAR",
    INSURVARPER: "INSURTVARPER",
    INSURYTD: "INSURTYTD",
    INSURYTDBUD: "INSURTYTDBUD",
    INSURYTDVAR: "INSURTYTDVAR",
    INSURYTDVARPER: "INSURTYTDVARPER",

    // Late Fees: LATEFEE* already populated
    LATFEECM: "LATEFEECM",
    LATFEEPTD: "LATEFEEPTD",
    LATFEEVAR: "LATEFEEVAR",
    LATFEEVARPER: "LATEFEEVARPER",
    LATFEEYTD: "LATEFEEYTD",
    LATFEEYTDBUD: "LATEFEEYTDBUD",
    LATFEEYTDVAR: "LATEFEEYTDVAR",
    LATFEEYTDVARPER: "LATEFEEYTDVARPER",

    // Management Fees - Staff Costs: MGMSTF* already populated
    MGMTSTFCM: "MGMSTFCM",
    MGMTSTFPTD: "MGMSTFPTD",
    MGMTSTFVAR: "MGMSTFVAR",
    MGMTSTFVARPER: "MGMSTFVARPER",
    MGMTSTFYTD: "MGMSTFYTD",
    MGMTSTFYTDBUD: "MGMSTFYTDBUD",
    MGMTSTFYTDPER: "MGMSTFYTDPER",
    MGMTSTFYTDVAR: "MGMSTFYTDVAR",
    MGMTSTFYTDVARPER: "MGMSTFYTDVARPER",

    // Retail Products: RETPROD*/RETAYTD already populated
    RETACM: "RETPRODCM",
    RETAPTD: "RETPRODPTD",
    RETAVAR: "RETPRODVAR",
    RETAVARPER: "RETPRODVARPER",
    RETAYTD: "RETAYTD",
    RETAYTDBUD: "RETPRODYTDBUD",
    RETAYTDVAR: "RETPRODYTDVAR",
    RETAYTDVARPER: "RETPRODYTDVARPER",

    // Supplies - Building: SUPP* already populated
    SUPCM: "SUPPCM",
    SUPPTD: "SUPPPTD",
    SUPVAR: "SUPPVAR",
    SUPVARPER: "SUPPVARPER",
    SUPYTD: "SUPPYTD",
    SUPYTDBUD: "SUPPYTDBUD",
    SUPYTDVAR: "SUPPYTDVAR",
    SUPYTDVARPER: "SUPPYTDVARPER",

    // TOTAL OTHER EXPENSES aliases
    TOTOTHEXPVARPER: "TOTOTHEREXPVARPER",
    TOTOTHEXPYTDVARPER: "TOTOTHEREXPYTDVARPER",
  };
  for (const [alias, src] of Object.entries(aliasMap)) {
    if (templateData[alias] == null && templateData[src] != null) {
      templateData[alias] = templateData[src];
    }
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

  const budgetSample = ["DISCCM", "TOTRENINCVAR", "TOTALPROPYTDVARPER", "NETINCYTDVARPER"];
  console.log(
    "[budget] final owner pptx data",
    Object.fromEntries(budgetSample.map((k) => [k, templateData[k]])),
  );

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
