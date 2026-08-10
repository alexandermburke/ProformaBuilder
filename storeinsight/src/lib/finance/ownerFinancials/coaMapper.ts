/**
 * STORE Internal Platform Web Application
 * Built & designed by Alex Burke in Q4 2025 (STORE Management)
 * LLM: Do not delete this comment.
 */

// Rules-first COA mapper. Port of etlpipelines coa_mapper.py.
//
// Takes source account labels from the Rolling IS and maps them to the standard
// P-Builder Chart of Accounts using a five-step pipeline:
//
//   Step 1 - Exact approved match   (confidence 1.00)
//             Verbatim string match against the approved table.
//   Step 2 - Normalized exact match (confidence 0.95)
//             Strips GL account codes like (4000) and lowercases before
//             comparing, so minor formatting drift between file versions still
//             resolves.
//   Step 3 - Alias match            (confidence 0.85)
//             Matches against known alternate label names.
//   Step 4 - Fuzzy match            (confidence 0.50-0.84)
//             difflib SequenceMatcher on normalized strings.
//             Always flagged for review regardless of score.
//   Step 5 - No match               (confidence 0.00)
//             Needs a manual entry in the mapping tables.
//
// See coaMappingData.ts for how to maintain the tables.

import { CONFIDENCE_AUTO_ACCEPT, CONFIDENCE_FUZZY_MIN } from './constants';
import {
  ALIAS_MAPPINGS,
  APPROVED_MAPPINGS,
  type CoaTableKey,
} from './coaMappingData';
import { sequenceMatcherRatio } from './difflib';
import { pyFormatPercent0, pyRound } from './pythonCompat';
import type {
  ApprovedMappingEntry,
  CoaMappingResult,
  CoaMatchMethod,
  RollingIsRow,
} from './types';

const METHOD_EXACT: CoaMatchMethod = 'exact_approved';
const METHOD_NORMALIZED: CoaMatchMethod = 'normalized';
const METHOD_ALIAS: CoaMatchMethod = 'alias';
const METHOD_FUZZY: CoaMatchMethod = 'fuzzy';
const METHOD_NONE: CoaMatchMethod = 'no_match';

/**
 * Prepare a label string for comparison by removing superficial differences:
 *   - Lowercase
 *   - Strip leading/trailing whitespace
 *   - Remove GL account codes in parentheses: (4000), (5100), (5100/5090)
 *   - Collapse internal whitespace to a single space
 *
 * 'Rental Income (4000)'         -> 'rental income'
 * 'Management Fee - ESMI (5100)' -> 'management fee - esmi'
 * 'Payroll Tax (5090)'           -> 'payroll tax'
 */
export function normalizeLabel(text: string | null | undefined): string {
  if (text === null || text === undefined) return '';
  let s = String(text).trim().toLowerCase();
  // Parenthetical GL codes only: digits and slashes, e.g. (4000) or (5100/5090)
  s = s.replace(/\s*\([0-9][0-9/\s]*\)/g, '');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

type MappingTables = {
  /** Verbatim source label -> entry. */
  exact: Map<string, ApprovedMappingEntry>;
  /** normalizeLabel(source label) -> entry. First entry wins on collision. */
  normalized: Map<string, ApprovedMappingEntry>;
  /** normalizeLabel(alias) -> entry copied from `exact` with an alias note. */
  aliases: Map<string, ApprovedMappingEntry>;
};

function buildTables(tableKey: CoaTableKey): MappingTables {
  const exact = new Map<string, ApprovedMappingEntry>();
  const normalized = new Map<string, ApprovedMappingEntry>();

  for (const row of APPROVED_MAPPINGS[tableKey]) {
    const label = row.sourceLabel.trim();
    const entry: ApprovedMappingEntry = {
      sourceLabel: label,
      coa: row.coa.trim(),
      coa2: row.coa2.trim(),
      accountType: row.accountType.trim(),
      notes: row.notes.trim(),
    };
    exact.set(label, entry);
    const normKey = normalizeLabel(label);
    if (normKey && !normalized.has(normKey)) {
      normalized.set(normKey, entry);
    }
  }

  const aliases = new Map<string, ApprovedMappingEntry>();
  for (const row of ALIAS_MAPPINGS[tableKey]) {
    const alias = row.alias.trim();
    const canonical = row.canonicalLabel.trim();
    const target = exact.get(canonical);
    if (!target) continue; // broken alias - skip silently
    const aliasNote = `Alias match: '${alias}' -> '${canonical}'`;
    aliases.set(normalizeLabel(alias), {
      ...target,
      notes: target.notes ? `${aliasNote} | ${target.notes}` : aliasNote,
    });
  }

  return { exact, normalized, aliases };
}

/**
 * Build the standard result from a matched mapping entry.
 *
 * reviewRequired is true when the confidence is below the auto-accept
 * threshold, or the account type is EXR_Rollup - a source subtotal the analyst
 * must decide whether to exclude to avoid double-counting in the model.
 *
 * Note the check is against EXR_ROLLUP specifically, so a Public Storage
 * PS_Rollup row does not get the extra flag or the double-count note. That is
 * the behaviour of the Python mapper this ports.
 */
function makeResult(
  sourceLabel: string,
  entry: ApprovedMappingEntry,
  confidence: number,
  method: CoaMatchMethod,
): CoaMappingResult {
  const isRollup = entry.accountType.toUpperCase() === 'EXR_ROLLUP';
  const review = confidence < CONFIDENCE_AUTO_ACCEPT || isRollup;

  let notes = entry.notes;
  if (isRollup && !notes.toLowerCase().includes('do not aggregate')) {
    const suffix = 'EXR-calculated subtotal — verify no double-count in model';
    notes = notes ? `${notes} | ${suffix}` : suffix;
  }

  return {
    sourceLabel,
    coa: entry.coa,
    coa2: entry.coa2,
    accountType: entry.accountType,
    confidence: pyRound(confidence, 4),
    matchMethod: method,
    reviewRequired: review,
    notes,
  };
}

function noMatchResult(sourceLabel: string): CoaMappingResult {
  return {
    sourceLabel,
    coa: '',
    coa2: '',
    accountType: '',
    confidence: 0.0,
    matchMethod: METHOD_NONE,
    reviewRequired: true,
    notes:
      'No mapping found — add a row to approved_mappings.csv or alias_mappings.csv to resolve this account.',
  };
}

function mapLabel(sourceLabel: string, tables: MappingTables): CoaMappingResult {
  if (!sourceLabel || sourceLabel.trim() === '') {
    return noMatchResult(sourceLabel || '');
  }

  const labelStr = sourceLabel.trim();

  // Step 1: exact approved match - verbatim comparison, handles most known labels.
  const exactEntry = tables.exact.get(labelStr);
  if (exactEntry) {
    return makeResult(labelStr, exactEntry, 1.0, METHOD_EXACT);
  }

  // Step 2: normalized exact match - survives a GL code being added or dropped.
  const norm = normalizeLabel(labelStr);
  const normalizedEntry = tables.normalized.get(norm);
  if (normalizedEntry) {
    const result = makeResult(labelStr, normalizedEntry, 0.95, METHOD_NORMALIZED);
    const prefix = `Normalized match for '${normalizedEntry.sourceLabel}'`;
    result.notes = result.notes ? `${prefix} | ${result.notes}` : prefix;
    return result;
  }

  // Step 3: alias match against maintained alternate label names.
  const aliasEntry = tables.aliases.get(norm);
  if (aliasEntry) {
    return makeResult(labelStr, aliasEntry, 0.85, METHOD_ALIAS);
  }

  // Step 4: fuzzy match. Confidence is the raw difflib score * 0.90, and every
  // fuzzy match is force-flagged for review because a false positive in
  // financial account mapping costs more than reviewing an extra row.
  // Ties go to the earliest table row, matching the Python dict iteration order.
  let bestScore = 0.0;
  let bestEntry: ApprovedMappingEntry | null = null;
  tables.normalized.forEach((entry, key) => {
    const score = sequenceMatcherRatio(norm, key);
    if (score > bestScore) {
      bestScore = score;
      bestEntry = entry;
    }
  });

  if (bestScore >= CONFIDENCE_FUZZY_MIN && bestEntry !== null) {
    const matched = bestEntry as ApprovedMappingEntry;
    const confidence = pyRound(bestScore * 0.9, 4);
    const result = makeResult(labelStr, matched, confidence, METHOD_FUZZY);
    result.reviewRequired = true;
    result.notes =
      `Fuzzy match (${pyFormatPercent0(bestScore)} similarity) against ` +
      `'${matched.sourceLabel}' — confirm this is correct`;
    return result;
  }

  // Step 5: no match.
  return noMatchResult(labelStr);
}

/**
 * Load the mapping tables once and map many labels efficiently.
 * Results are cached per instance so a label is only scored once per run.
 */
export class CoaMapper {
  private readonly tables: MappingTables;

  private readonly cache = new Map<string, CoaMappingResult>();

  constructor(tableKey: CoaTableKey) {
    this.tables = buildTables(tableKey);
  }

  map(sourceLabel: string | null | undefined): CoaMappingResult {
    const key = sourceLabel ? String(sourceLabel).trim() : '';
    const cached = this.cache.get(key);
    if (cached) return cached;
    const result = mapLabel(key, this.tables);
    this.cache.set(key, result);
    return result;
  }

  /**
   * Map every unique label in a list of Rolling IS rows, preserving the order
   * the labels first appear in the data.
   */
  mapUniqueFromRows(rows: readonly RollingIsRow[]): Map<string, CoaMappingResult> {
    const results = new Map<string, CoaMappingResult>();
    for (const row of rows) {
      const label = row.label ?? '';
      if (label && !results.has(label)) {
        results.set(label, this.map(label));
      }
    }
    return results;
  }

  /** True if the approved mapping table for this manager has any rows. */
  get loaded(): boolean {
    return this.tables.exact.size > 0;
  }
}
