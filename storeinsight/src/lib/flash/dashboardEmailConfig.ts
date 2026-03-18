const normalizePropertyKey = (value: string): string =>
  value.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_");

const DASHBOARD_EMAIL_PROPERTY_ID_BY_KEY = new Map<string, string>([
  ["L001", "L001"],
  ["W003", "W003"],
  ["STOREONBASELINE", "W003"],
  ["BASELINE", "W003"],
  ["PROP_PITTMAN", "prop-pittman"],
  ["PITTMAN", "prop-pittman"],
]);

export const DASHBOARD_BETA_INVESTOR_ID = "test-investor";

export function resolveDashboardEmailPropertyId(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    if (!value) continue;
    const normalized = normalizePropertyKey(value);
    const mapped = DASHBOARD_EMAIL_PROPERTY_ID_BY_KEY.get(normalized);
    if (mapped) return mapped;
  }
  return null;
}
