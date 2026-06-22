// Helpers for the Daily Flash "STORE Managed" chart marker.
//
// The marker should sit at the month STORE took over a property. When a property
// has been managed since BEFORE the chart's window (e.g. managed since 2024 but the
// MoM chart only goes back ~7 months), there is no meaningful "managed since" point
// inside the chart, so the marker must be hidden rather than pinned to an arbitrary
// month. The authoritative management date is the property's facilityOpenDate (the
// same "STORE Managed since ..." value shown in the report footer).

const MONTH_INDEX: Record<string, number> = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
  jan: 0, feb: 1, mar: 2, apr: 3, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11,
};

// Parse a free-text management date ("March 2024", "2024-03", "03/2024", a parseable
// Date string) into a "YYYY-MM" key, or null if it cannot be parsed.
export function parseManagedSinceMonth(value?: string | null): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s) return null;

  let m = s.match(/^(\d{4})-(\d{1,2})/);
  if (m) return `${m[1]}-${String(Number(m[2])).padStart(2, "0")}`;

  m = s.match(/([A-Za-z]{3,})\.?\s+(\d{4})/);
  if (m) {
    const idx = MONTH_INDEX[m[1].toLowerCase()];
    if (idx != null) return `${m[2]}-${String(idx + 1).padStart(2, "0")}`;
  }

  m = s.match(/^(\d{1,2})\/(\d{4})/);
  if (m) return `${m[2]}-${String(Number(m[1])).padStart(2, "0")}`;

  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }
  return null;
}

// True when the property has been STORE-managed since before the chart's earliest
// visible month, in which case the "STORE Managed" marker should be hidden. Returns
// false for unknown/unparseable dates so existing behavior is left unchanged.
export function isManagedBeforeChart(
  facilityOpenDate: string | null | undefined,
  earliestChartMonth: string | null | undefined,
): boolean {
  const managedSince = parseManagedSinceMonth(facilityOpenDate);
  if (!managedSince || !earliestChartMonth) return false;
  // YYYY-MM compares lexicographically in chronological order.
  return managedSince < earliestChartMonth;
}
