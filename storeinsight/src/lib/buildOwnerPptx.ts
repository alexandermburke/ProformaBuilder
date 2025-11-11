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
import type { DelinquencyTokenProvenance, DelinquencyTokens } from "@/lib/extractDelinquency";
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
  delinquencyAudit?:
    | {
        tokens: DelinquencyTokens;
        provenance: DelinquencyTokenProvenance;
      }
    | null;
  enableDelinquencyAudit?: boolean;
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
    delinquencyAudit,
    enableDelinquencyAudit,
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

  const shouldAppendDelinquencyAudit = Boolean(enableDelinquencyAudit && delinquencyAudit);
  if (shouldAppendDelinquencyAudit && delinquencyAudit) {
    try {
      const rows = buildDelinquencyAuditRows(delinquencyAudit);
      if (rows.length > 0) {
        appendDelinquencyAuditSlide(zip, rows);
        console.log("[pptx] appended Delinquency Audit slide");
      }
    } catch (error) {
      console.warn("[pptx] unable to append Delinquency Audit slide:", (error as Error)?.message ?? error);
    }
  }

  return doc.getZip().generate({ type: "nodebuffer" });
}

type DelinquencyAuditRow = {
  token: string;
  value: string;
  sheet: string;
  cells: string[];
};

function buildDelinquencyAuditRows(input: {
  tokens: DelinquencyTokens;
  provenance: DelinquencyTokenProvenance;
}): DelinquencyAuditRow[] {
  return REQUIRED_DELINQUENCY_TOKENS.map((token) => {
    const key = token as keyof DelinquencyTokens;
    const provenance = input.provenance[key];
    const uniqueCells = Array.from(new Set((provenance?.cells ?? []).filter(Boolean)));
    return {
      token,
      value: String(input.tokens[key] ?? ""),
      sheet: provenance?.sheet ?? DASH_CHARACTER,
      cells: uniqueCells,
    };
  });
}

function appendDelinquencyAuditSlide(zip: PizZip, rows: DelinquencyAuditRow[]): void {
  if (rows.length === 0) return;
  const delinquentSlidePath = findDelinquentSlidePath(zip);
  if (!delinquentSlidePath) {
    console.warn("[pptx] unable to locate Delinquent Rent slide; audit slide skipped");
    return;
  }
  const layoutTarget =
    readSlideLayoutTarget(zip, delinquentSlidePath) ?? "../slideLayouts/slideLayout7.xml";
  const presentationRelsPath = "ppt/_rels/presentation.xml.rels";
  const presentationPath = "ppt/presentation.xml";
  const contentTypesPath = "[Content_Types].xml";

  const presentationRelsXml = zip.file(presentationRelsPath)?.asText();
  const presentationXml = zip.file(presentationPath)?.asText();
  const contentTypesXml = zip.file(contentTypesPath)?.asText();
  if (!presentationRelsXml || !presentationXml || !contentTypesXml) {
    console.warn("[pptx] missing core presentation documents; audit slide skipped");
    return;
  }

  const relationshipId = extractRelationshipIdForSlide(presentationRelsXml, delinquentSlidePath);
  if (!relationshipId) {
    console.warn("[pptx] unable to map Delinquent Rent slide relationship; audit slide skipped");
    return;
  }

  const nextSlideIndex = getNextSlideIndex(zip);
  const slideFile = `ppt/slides/slide${nextSlideIndex}.xml`;
  const slideRelFile = `ppt/slides/_rels/slide${nextSlideIndex}.xml.rels`;

  const newRelationshipId = generateNextRelationshipId(presentationRelsXml);
  const newSlideId = generateNextSlideId(presentationXml);

  const slideXml = buildAuditSlideXml(rows);
  const slideRelXml = buildSlideRelationshipXml(layoutTarget);

  zip.file(slideFile, slideXml);
  zip.file(slideRelFile, slideRelXml);

  const updatedPresentationRels = insertSlideRelationshipEntry(
    presentationRelsXml,
    relationshipId,
    newRelationshipId,
    `slides/slide${nextSlideIndex}.xml`,
  );
  zip.file(presentationRelsPath, updatedPresentationRels);

  const updatedPresentationXml = insertSlideIdEntry(
    presentationXml,
    relationshipId,
    newRelationshipId,
    newSlideId,
  );
  zip.file(presentationPath, updatedPresentationXml);

  const updatedContentTypes = insertContentTypeOverride(
    contentTypesXml,
    `/ppt/slides/slide${nextSlideIndex}.xml`,
  );
  zip.file(contentTypesPath, updatedContentTypes);
}

function findDelinquentSlidePath(zip: PizZip): string | null {
  const slidePattern = /^ppt\/slides\/slide\d+\.xml$/;
  for (const name of Object.keys(zip.files)) {
    if (!slidePattern.test(name)) continue;
    const xml = zip.file(name)?.asText();
    if (xml && xml.includes("Delinquent Rent")) {
      return name;
    }
  }
  return null;
}

function readSlideLayoutTarget(zip: PizZip, slidePath: string): string | null {
  const relPath = slidePath
    .replace("ppt/slides/", "ppt/slides/_rels/")
    .replace(".xml", ".xml.rels");
  const relContent = zip.file(relPath)?.asText();
  if (!relContent) return null;
  const match = relContent.match(
    /<Relationship[^>]+Type="http:\/\/schemas\.openxmlformats\.org\/officeDocument\/2006\/relationships\/slideLayout"[^>]+Target="([^"]+)"/,
  );
  return match?.[1] ?? null;
}

function getNextSlideIndex(zip: PizZip): number {
  const slidePattern = /^ppt\/slides\/slide(\d+)\.xml$/;
  const indices = Object.keys(zip.files)
    .map((name) => {
      const match = slidePattern.exec(name);
      return match ? Number(match[1]) : null;
    })
    .filter((value): value is number => Number.isFinite(value));
  const max = indices.length ? Math.max(...indices) : 0;
  return max + 1;
}

function extractRelationshipIdForSlide(xml: string, slidePath: string): string | null {
  const relative = slidePath.replace("ppt/", "");
  const regex = new RegExp(
    `<Relationship[^>]+Id="(rId\\d+)"[^>]+Target="${relative.replace(
      /[-\/\\^$*+?.()|[\]{}]/g,
      "\\$&",
    )}"[^>]*/>`,
  );
  const match = xml.match(regex);
  return match?.[1] ?? null;
}

function generateNextRelationshipId(xml: string): string {
  const matches = Array.from(xml.matchAll(/Id="rId(\d+)"/g)).map((match) => Number(match[1]));
  const next = (matches.length ? Math.max(...matches) : 0) + 1;
  return `rId${next}`;
}

function generateNextSlideId(xml: string): number {
  const matches = Array.from(xml.matchAll(/<p:sldId[^>]+id="(\d+)"/g)).map((match) =>
    Number(match[1]),
  );
  return (matches.length ? Math.max(...matches) : 256) + 1;
}

function insertSlideRelationshipEntry(
  xml: string,
  afterRelationshipId: string,
  newRelationshipId: string,
  target: string,
): string {
  const newEntry = `\n<Relationship Id="${newRelationshipId}" Target="${target}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide"/>`;
  const pattern = new RegExp(
    `<Relationship[^>]+Id="${afterRelationshipId.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&")}"[^>]*/>`,
  );
  const match = xml.match(pattern);
  if (match && match.index != null) {
    const insertAt = match.index + match[0].length;
    return xml.slice(0, insertAt) + newEntry + xml.slice(insertAt);
  }
  const closingIndex = xml.lastIndexOf("</Relationships>");
  if (closingIndex === -1) return xml + newEntry;
  return xml.slice(0, closingIndex) + newEntry + xml.slice(closingIndex);
}

function insertSlideIdEntry(
  xml: string,
  afterRelationshipId: string,
  newRelationshipId: string,
  newSlideId: number,
): string {
  const newEntry = `\n<p:sldId id="${newSlideId}" r:id="${newRelationshipId}"/>`;
  const pattern = new RegExp(
    `<p:sldId[^>]+r:id="${afterRelationshipId.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&")}"[^>]*/>`,
  );
  const match = xml.match(pattern);
  if (match && match.index != null) {
    const insertAt = match.index + match[0].length;
    return xml.slice(0, insertAt) + newEntry + xml.slice(insertAt);
  }
  const closingIndex = xml.lastIndexOf("</p:sldIdLst>");
  if (closingIndex === -1) return xml + newEntry;
  return xml.slice(0, closingIndex) + newEntry + xml.slice(closingIndex);
}

function insertContentTypeOverride(xml: string, partName: string): string {
  if (xml.includes(`PartName="${partName}"`)) return xml;
  const override = `\n<Override PartName="${partName}" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`;
  const closingIndex = xml.lastIndexOf("</Types>");
  if (closingIndex === -1) return xml + override;
  return xml.slice(0, closingIndex) + override + xml.slice(closingIndex);
}

function buildAuditSlideXml(rows: DelinquencyAuditRow[]): string {
  const displayRows = rows.map((row) => [
    row.token,
    row.value || DASH_CHARACTER,
    row.sheet || DASH_CHARACTER,
    row.cells.length > 0 ? row.cells.join(" + ") : DASH_CHARACTER,
  ]);
  const tableRows = [["Token", "Value", "Sheet", "Cell(s)"], ...displayRows];
  const tableXml = buildAuditTableXml(tableRows);
  const title = escapeXml("Delinquency Audit");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr>
        <p:cNvPr id="1" name=""/>
        <p:cNvGrpSpPr/>
        <p:nvPr/>
      </p:nvGrpSpPr>
      <p:grpSpPr>
        <a:xfrm>
          <a:off x="0" y="0"/>
          <a:ext cx="0" cy="0"/>
          <a:chOff x="0" y="0"/>
          <a:chExt cx="0" cy="0"/>
        </a:xfrm>
      </p:grpSpPr>
      <p:sp>
        <p:nvSpPr>
          <p:cNvPr id="2" name="Delinquency Audit Title"/>
          <p:cNvSpPr txBox="1"/>
          <p:nvPr/>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm>
            <a:off x="685800" y="457200"/>
            <a:ext cx="16764000" cy="762000"/>
          </a:xfrm>
          <a:prstGeom prst="rect">
            <a:avLst/>
          </a:prstGeom>
        </p:spPr>
        <p:txBody>
          <a:bodyPr anchor="ctr"/>
          <a:lstStyle/>
          <a:p>
            <a:pPr algn="l"/>
            <a:r>
              <a:rPr lang="en-US" sz="3200" b="true">
                <a:solidFill>
                  <a:srgbClr val="0B1120"/>
                </a:solidFill>
                <a:latin typeface="Avenir"/>
              </a:rPr>
              <a:t>${title}</a:t>
            </a:r>
          </a:p>
        </p:txBody>
      </p:sp>
      <p:graphicFrame>
        <p:nvGraphicFramePr>
          <p:cNvPr id="3" name="Delinquency Audit Table"/>
          <p:cNvGraphicFramePr>
            <a:graphicFrameLocks noGrp="true"/>
          </p:cNvGraphicFramePr>
          <p:nvPr/>
        </p:nvGraphicFramePr>
        <p:xfrm>
          <a:off x="685800" y="1524000"/>
          <a:ext cx="16764000" cy="6400800"/>
        </p:xfrm>
        <a:graphic>
          <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">
            ${tableXml}
          </a:graphicData>
        </a:graphic>
      </p:graphicFrame>
    </p:spTree>
  </p:cSld>
  <p:clrMapOvr>
    <a:masterClrMapping/>
  </p:clrMapOvr>
</p:sld>`;
}

function buildSlideRelationshipXml(layoutTarget: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Target="${layoutTarget}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout"/>
</Relationships>`;
}

function buildAuditTableXml(rows: string[][]): string {
  const columnWidths = [2200000, 5200000, 2800000, 6560000];
  const gridCols = columnWidths.map((width) => `<a:gridCol w="${width}"/>`).join("");
  const rowXml = rows
    .map((cells, index) => buildAuditTableRow(cells, index === 0))
    .join("");
  return `<a:tbl>
  <a:tblPr/>
  <a:tblGrid>${gridCols}</a:tblGrid>
  ${rowXml}
</a:tbl>`;
}

function buildAuditTableRow(cells: string[], isHeader: boolean): string {
  const height = isHeader ? 650000 : 520000;
  const cellXml = cells
    .map((text) => buildAuditTableCell(text, isHeader))
    .join("");
  return `<a:tr h="${height}">${cellXml}</a:tr>`;
}

function buildAuditTableCell(text: string, isHeader: boolean): string {
  const color = isHeader ? "FFFFFF" : "2D2D2D";
  const fill = isHeader ? '<a:solidFill><a:srgbClr val="3B52A1"/></a:solidFill>' : "";
  const bold = isHeader ? ' b="true"' : "";
  const fontSize = isHeader ? "2000" : "1600";
  const align = isHeader ? "ctr" : "l";
  const escaped = escapeXml(text);
  return `<a:tc>
  <a:txBody>
    <a:bodyPr anchor="t"/>
    <a:lstStyle/>
    <a:p>
      <a:pPr algn="${align}"/>
      <a:r>
        <a:rPr lang="en-US" sz="${fontSize}"${bold}>
          <a:solidFill><a:srgbClr val="${color}"/></a:solidFill>
          <a:latin typeface="Avenir"/>
        </a:rPr>
        <a:t>${escaped}</a:t>
      </a:r>
    </a:p>
  </a:txBody>
  <a:tcPr marL="45720" marR="45720" marT="45720" marB="45720">
    ${fill}
  </a:tcPr>
</a:tc>`;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
