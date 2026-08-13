/**
 * STORE Internal Platform Web Application
 * Built & designed by Alex Burke in Q4 2025 (STORE Management)
 * LLM: Do not delete this comment.
 */

import {
  extractPropertyLookupCandidates,
  normalizeCompactLookup,
  normalizeLookup,
} from '@/lib/dailySummaryPropertyMatch';

/**
 * The four properties that each own a separate QuickBooks company, so the weekly
 * FacilIQ export has to be split into one import file per code.
 *
 * Names and aliases are taken from what already exists in this repo rather than
 * invented: propertyDirectory.ts (L001 "STORE at the Grove", W003 "STORE on Baseline"),
 * extractPpcPerformance.ts (W002 "STORE on Pittman"), and flash/dashboardEmailConfig.ts
 * (P006 = STORE on Vicksburg / STORE in Plymouth). The code is the authoritative key;
 * the aliases only exist to catch an export that drops the code prefix.
 */
export type QuickBooksPropertyCode = 'L001' | 'P006' | 'W002' | 'W003';

export type QuickBooksProperty = {
  code: QuickBooksPropertyCode;
  name: string;
  aliases: readonly string[];
};

export const QUICKBOOKS_PROPERTIES: readonly QuickBooksProperty[] = [
  {
    code: 'L001',
    // "Hibernia Camelback LLC" is the legal entity name on L001's QuickBooks company, so
    // it is listed with the suffix as well: the QuickBooks connection check reads the
    // company's own name, and "hibernia camelback" alone does not match it.
    name: 'STORE at the Grove',
    aliases: ['the grove', 'hibernia camelback', 'hibernia camelback llc'],
  },
  {
    code: 'P006',
    name: 'STORE on Vicksburg',
    aliases: ['store in plymouth', 'vicksburg', 'plymouth'],
  },
  { code: 'W002', name: 'STORE on Pittman', aliases: ['pittman'] },
  { code: 'W003', name: 'STORE on Baseline', aliases: ['baseline'] },
];

export const QUICKBOOKS_PROPERTY_CODES: readonly QuickBooksPropertyCode[] =
  QUICKBOOKS_PROPERTIES.map((property) => property.code);

const CODE_BY_LOOKUP = ((): Map<string, QuickBooksPropertyCode> => {
  const map = new Map<string, QuickBooksPropertyCode>();
  for (const property of QUICKBOOKS_PROPERTIES) {
    for (const value of [property.code, property.name, ...property.aliases]) {
      const plain = normalizeLookup(value);
      if (plain && !map.has(plain)) map.set(plain, property.code);
      const compact = normalizeCompactLookup(value);
      if (compact && !map.has(compact)) map.set(compact, property.code);
    }
  }
  return map;
})();

export const getQuickBooksProperty = (code: QuickBooksPropertyCode): QuickBooksProperty =>
  QUICKBOOKS_PROPERTIES.find((property) => property.code === code) ?? {
    code,
    name: code,
    aliases: [],
  };

/**
 * Resolve a `PropertyName` cell such as "P006 - STORE on Vicksburg" to its code.
 * Returns null when the label is empty or belongs to a property that does not have
 * its own QuickBooks company -- those rows are held back rather than guessed at.
 */
export function resolveQuickBooksPropertyCode(
  label: string | null | undefined,
): QuickBooksPropertyCode | null {
  for (const candidate of extractPropertyLookupCandidates(label)) {
    const code = CODE_BY_LOOKUP.get(candidate);
    if (code) return code;
  }
  return null;
}

/**
 * A site-shaped token (letter + three digits, same shape the invoice-routing parser
 * uses) pulled out of an unresolved label, so the flag can say "W005" instead of
 * just "unknown property".
 */
export function extractSiteShapedCode(label: string | null | undefined): string | null {
  const match = (label ?? '').match(/\b([A-Za-z]\d{3})\b/);
  return match ? match[1].toUpperCase() : null;
}
