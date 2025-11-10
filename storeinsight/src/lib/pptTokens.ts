import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import PizZip from "pizzip";

export type TemplateTokenFile = {
  path: string;
  tokens: string[];
};

export type PptTokenScanResult = {
  sha256: string;
  files: TemplateTokenFile[];
  tokens: string[];
};

export type PptTokenScanOptions = {
  templateBuffer?: Buffer;
  templatePath?: string;
};

export const REQUIRED_DELINQUENCY_TOKENS = [
  "DELINPER30",
  "DELINUNIT30",
  "DELINDOL30",
  "DELINPER60",
  "DELINUNIT60",
  "DELINDOL60",
  "DELINPER61",
  "DELINUNIT61",
  "DELINDOL61",
] as const;

const MICROTEMPLATE_PATH = path.join(process.cwd(), "public", "MICROTEMPLATE.pptx");
const TOKEN_FILE_PATTERN = /^ppt\/(slides|slideMasters|slideLayouts)\//;
const PLACEHOLDER_PATTERN = /\{\{([^{}]+)\}\}/g;
const TAG_PATTERN = /<[^>]+>/g;
const ENTITY_PATTERN = /&[a-z0-9#]+;/gi;
const HIDDEN_CHAR_PATTERN = /[\u200B-\u200D\u2060\uFEFF\u00A0\u202F]/g;
const NON_TOKEN_CHAR_PATTERN = /[^A-Za-z0-9_]/g;

export function stripHiddenTokenCharacters(value: string): string {
  if (!value) return value;
  return value.replace(HIDDEN_CHAR_PATTERN, "");
}

export function normalizeTokenKey(value: string | undefined | null): string | null {
  if (typeof value !== "string") return null;
  const cleaned = stripHiddenTokenCharacters(value)
    .replace(/[{}]/g, "")
    .replace(/\s+/g, "")
    .replace(NON_TOKEN_CHAR_PATTERN, "");
  if (!cleaned) return null;
  return cleaned.toUpperCase();
}

export async function scanPptTokens(options?: PptTokenScanOptions): Promise<PptTokenScanResult> {
  const templatePath = options?.templatePath ?? MICROTEMPLATE_PATH;
  const templateBuffer = options?.templateBuffer ?? (await fs.readFile(templatePath));
  const sha256 = crypto.createHash("sha256").update(templateBuffer).digest("hex");
  const zip = new PizZip(templateBuffer);
  const targetFiles = Object.keys(zip.files)
    .filter((filename) => TOKEN_FILE_PATTERN.test(filename) && filename.endsWith(".xml"))
    .sort((a, b) => a.localeCompare(b));

  const files: TemplateTokenFile[] = [];
  const allTokens = new Set<string>();

  for (const filename of targetFiles) {
    const file = zip.file(filename);
    if (!file) {
      files.push({ path: filename, tokens: [] });
      continue;
    }
    const xml = file.asText();
    const flattened = stripHiddenTokenCharacters(xml).replace(TAG_PATTERN, "");
    const tokensForFile = new Set<string>();
    for (const match of flattened.matchAll(PLACEHOLDER_PATTERN)) {
      const normalized = normalizePlaceholder(match[1]);
      if (!normalized) continue;
      tokensForFile.add(normalized);
      allTokens.add(normalized);
    }
    files.push({ path: filename, tokens: Array.from(tokensForFile).sort() });
  }

  return {
    sha256,
    files,
    tokens: Array.from(allTokens).sort(),
  };
}

function normalizePlaceholder(rawToken: string): string | null {
  if (!rawToken) return null;
  const withoutEntities = rawToken.replace(ENTITY_PATTERN, "");
  const cleaned = stripHiddenTokenCharacters(withoutEntities)
    .replace(TAG_PATTERN, "")
    .replace(/[{}]/g, "")
    .replace(/\s+/g, "")
    .replace(NON_TOKEN_CHAR_PATTERN, "");
  if (!cleaned) return null;
  return cleaned.toUpperCase();
}
