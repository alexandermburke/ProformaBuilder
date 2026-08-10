import type { PropertyConfig } from "@/types/dailySummary";

const normalizeText = (value: string): string => value.trim().replace(/\s+/g, " ");

// Exported so other property-label matchers (e.g. the FacilIQ invoice import prep)
// build their lookup keys with the same rules instead of forking normalization.
export const normalizeLookup = (value: string | undefined | null): string =>
  normalizeText(value ?? "").toLowerCase();

export const normalizeCompactLookup = (value: string | undefined | null): string =>
  normalizeLookup(value).replace(/[^a-z0-9]+/g, "");

const addCandidate = (candidates: Set<string>, value: string | undefined | null): void => {
  const normalized = normalizeLookup(value);
  if (normalized) candidates.add(normalized);
  const compact = normalizeCompactLookup(value);
  if (compact) candidates.add(compact);
};

export function extractPropertyLookupCandidates(label: string | undefined | null): string[] {
  const candidates = new Set<string>();
  const normalized = normalizeText(label ?? "");
  if (!normalized) return [];

  addCandidate(candidates, normalized);

  const codePrefixMatch = normalized.match(/^([A-Za-z0-9]{2,12})\s*(?:[-–—:|·]\s*)+(.+)$/);
  if (codePrefixMatch) {
    addCandidate(candidates, codePrefixMatch[1]);
    addCandidate(candidates, codePrefixMatch[2]);
  }

  return Array.from(candidates);
}

export function resolvePropertyFromLabels(
  properties: PropertyConfig[],
  labels: Array<string | undefined | null>,
): PropertyConfig | undefined {
  const byLookup = new Map<string, PropertyConfig>();

  for (const property of properties) {
    const values = [
      property.id,
      property.propertyId,
      property.tenantPropertyId,
      property.propertyCode,
      property.name,
    ];
    for (const value of values) {
      const normalized = normalizeLookup(value);
      if (normalized && !byLookup.has(normalized)) {
        byLookup.set(normalized, property);
      }
      const compact = normalizeCompactLookup(value);
      if (compact && !byLookup.has(compact)) {
        byLookup.set(compact, property);
      }
    }
  }

  const candidates = labels.flatMap((label) => extractPropertyLookupCandidates(label));
  for (const candidate of candidates) {
    const match = byLookup.get(candidate);
    if (match) return match;
  }

  return undefined;
}
