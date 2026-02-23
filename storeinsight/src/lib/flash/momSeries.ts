export type MoMSeries = {
  months: string[];
  grossAccruedRent: number[];
  occupiedPct: number[];
};

const normalizePropertyKey = (value: string): string => value.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_");

export const MOM_SERIES_BY_PROPERTY: Record<string, MoMSeries> = {
 THE_GROVE: {
  months: [
    "2026-01",
    "2025-12",
    "2025-11",
    "2025-10",
    "2025-09",
    "2025-08",
    "2025-07",
    "2025-06",
    "2025-05",
    "2025-04",
    "2025-03",
    "2025-02",
  ],
  grossAccruedRent: [
    143983.4,
    141770.0,
    133329.46,
    124580.0,
    123244.0,
    124752.0,
    128019.0,
    123876.0,
    0.0,
    0.0,
    0.0,
    0.0,
  ],
  occupiedPct: [
  85.3,
  85.6,
  81.6,
  81.0,
  78.1,
  73.9,
  70.7,
  68.0,
  63.8,
  59.8,
  54.3,
  49.9,
],
},
 PITTMAN: {
  months: [
    "2026-01",
    "2025-12",
    "2025-11",
    "2025-10",
    "2025-09",
    "2025-08",
    "2025-07",
    "2025-06",
    "2025-05",
    "2025-04",
    "2025-03",
    "2025-02",
  ],
  grossAccruedRent: [
    93099.5,
    95000.0,
    93729.94,
    90673.55,
    94378.71,
    96031.2,
    90231.89,
    93118.53,
    0.0,
    0.0,
    0.0,
    0.0,
  ],
  occupiedPct: [
    81.8,
    78.0,
    78.7,
    78.5,
    79.0,
    80.0,
    83.7,
    82.91,
    0.0,
    0.0,
    0.0,
    0.0,
  ],
},
};

const MOM_SERIES_ALIASES: Record<string, keyof typeof MOM_SERIES_BY_PROPERTY> = {
  L001: "THE_GROVE",
  PROP_PITTMAN: "PITTMAN",
  PROP_THE_GROVE: "THE_GROVE",
  W002: "PITTMAN",
};

export const getMoMSeries = (propertyId: string): MoMSeries | null => {
  if (!propertyId) return null;
  const key = normalizePropertyKey(propertyId);
  if (MOM_SERIES_BY_PROPERTY[key]) return MOM_SERIES_BY_PROPERTY[key] ?? null;
  const aliasKey = MOM_SERIES_ALIASES[key];
  if (aliasKey && MOM_SERIES_BY_PROPERTY[aliasKey]) {
    return MOM_SERIES_BY_PROPERTY[aliasKey] ?? null;
  }
  return null;
};

const buildPlaceholderMonths = (count = 12, now = new Date()): string[] => {
  const months: string[] = [];
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  for (let i = 0; i < count; i += 1) {
    const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - i, 1));
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    months.push(`${yyyy}-${mm}`);
  }
  return months;
};

export const buildPlaceholderMoMSeries = (monthCount = 12): MoMSeries => {
  const months = buildPlaceholderMonths(monthCount);
  return {
    months,
    grossAccruedRent: new Array(months.length).fill(0),
    occupiedPct: new Array(months.length).fill(0),
  };
};
