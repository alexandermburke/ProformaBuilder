import { similarity } from './fuzzy';
import { COA_SYNONYMS, RequiredField } from './coa';
import type { HeaderMapping, ParsedSheet } from './types';
import { loadMappingMemory, upsertMappingMemory, type MappingMemory } from './storage';

export type AutoOptions = {
  vendorHint?: string | null;
  autoDetectFacilityPeriod: boolean;
  autoMap: boolean;
  threshold: number; // 0..1
};

export type Suggestion = { header: string; score: number } | null;
export type SuggestionsByField = Record<RequiredField, Suggestion>;

export function detectVendor(fileName: string, sheet: ParsedSheet): string {
  const hdr = sheet.headers.join('|').toLowerCase();
  if (hdr.includes('extra space')) return 'Extra Space';
  if (/veritec/i.test(hdr) || /veritec/i.test(fileName)) return 'Veritec';
  if (/yardi/i.test(hdr) || /yardi/i.test(fileName)) return 'Yardi';
  if (/tenant/i.test(hdr)) return 'Tenant Inc';
  return 'Unknown';
}

const MONTHS = [
  'jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec',
  'january','february','march','april','june','july','august','september','october','november','december'
];

export function detectFacilityPeriodFromFileName(fileName: string): { facility?: string; period?: string } {
  const base = fileName.replace(/\.[a-z0-9]+$/i, '');
  const parts = base.split(/[_\-\s]+/);
  let period: string | undefined;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i].toLowerCase();
    if (MONTHS.includes(p)) {
      const month = parts[i].slice(0,3);
      const y = parts[i + 1] && /^[0-9]{4}$/.test(parts[i + 1]) ? parts[i + 1] : undefined;
      if (y) {
        period = `${capitalize(month)} ${y}`;
        break;
      }
    }
  }
  // crude facility guess: first chunk before month token
  const monthIdx = parts.findIndex((p) => MONTHS.includes(p.toLowerCase()));
  const facility = monthIdx > 0 ? parts.slice(0, monthIdx).join(' ') : undefined;
  if (facility) console.log('[auto] facility guess (file)', facility);
  if (period) console.log('[auto] period guess (file)', period);
  return { facility, period };
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

function suggestForField(field: RequiredField, headers: string[], memory: MappingMemory[], vendor?: string): Suggestion {
  // Memory first
  const mem = memory
    .filter((m) => m.field === field && (!vendor || m.vendor === vendor))
    .sort((a, b) => (b.times - a.times));
  if (mem.length) {
    const bestHeader = mem[0].header;
    if (headers.includes(bestHeader)) {
      console.log('[auto] memory hit', { field, bestHeader });
      return { header: bestHeader, score: 1.0 };
    }
  }

  // Synonyms-based similarity
  const candidates: Array<{ h: string; score: number }> = [];
  for (const h of headers) {
    let best = 0;
    for (const syn of COA_SYNONYMS[field]) {
      best = Math.max(best, similarity(h, syn));
    }
    candidates.push({ h, score: best });
  }
  candidates.sort((a, b) => b.score - a.score);
  const top = candidates[0];
  if (!top) return null;
  return { header: top.h, score: top.score };
}

export function autoMapRequiredFields(
  required: RequiredField[],
  headers: string[],
  opts: AutoOptions
): { mapping: HeaderMapping; suggestions: SuggestionsByField; unresolved: RequiredField[]; vendor: string } {
  const memory = loadMappingMemory();
  const vendor = opts.vendorHint ?? 'Unknown';
  const mapping: HeaderMapping = {};
  const suggestions: Partial<SuggestionsByField> = {};
  const unresolved: RequiredField[] = [];

  for (const field of required) {
    const s = suggestForField(field, headers, memory, vendor);
    suggestions[field] = s ?? null;
    if (opts.autoMap && s && s.score >= opts.threshold) {
      mapping[field] = s.header;
      console.log('[auto] mapping applied', { field, header: s.header, score: s.score.toFixed(3) });
    } else {
      mapping[field] = '';
      unresolved.push(field);
      if (s) console.log('[auto] mapping held for confirm', { field, header: s.header, score: s.score.toFixed(3) });
    }
  }

  return { mapping, suggestions: suggestions as SuggestionsByField, unresolved, vendor };
}

export function learnMappings(mapping: HeaderMapping, vendor: string): void {
  const entries: MappingMemory[] = [];
  (Object.keys(mapping) as Array<keyof HeaderMapping>).forEach((k) => {
    const field = String(k) as RequiredField;
    const header = mapping[k];
    if (!header) return;
    entries.push({
      vendor,
      header,
      field,
      lastUsedISO: new Date().toISOString(),
      times: 1
    });
  });
  upsertMappingMemory(entries);
  console.log('[auto] learned mapping', { count: entries.length, vendor });
}