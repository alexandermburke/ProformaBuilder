export type MoMSeries = {
  months: string[];
  grossAccruedRent: number[];
  occupiedPct: number[];
};

const normalizePropertyKey = (value: string): string => value.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_");

export const MOM_SERIES_BY_PROPERTY: Record<string, MoMSeries> = {
  THE_GROVE: {
    months: [
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
      "2025-01",
    ],
    grossAccruedRent: [
      140377.7,
      133329.46,
      104863.57,
      1650.0,
      51.0,
      254.0,
      241.5,
      241.5,
      144.32,
      0.0,
      0.0,
      0.0,
    ],
    occupiedPct: [68.8, 68.2, 66.8, 63.7, 61.0, 58.0, 52.8, 49.4, 44.3, 40.7, 37.7, 36.0],
  },
  PITTMAN: {
    months: [
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
      "2025-01",
    ],
    grossAccruedRent: [
      95300.39,
      64997.9,
      5167.0,
      1518.0,
      79.0,
      0.0,
      0.0,
      0.0,
      0.0,
      0.0,
      0.0,
      0.0,
    ],
    occupiedPct: [79.9, 82.2, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
  },
};

const MOM_SERIES_ALIASES: Record<string, keyof typeof MOM_SERIES_BY_PROPERTY> = {
  L001: "THE_GROVE",
  PROP_PITTMAN: "PITTMAN",
  PROP_THE_GROVE: "THE_GROVE",
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
