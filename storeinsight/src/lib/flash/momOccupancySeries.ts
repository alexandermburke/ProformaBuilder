export type MoMOccupancySeries = {
  months: string[];
  occupiedPct: Array<number | null>;
  grossAccruedRent: number[];
};

const BASE_MONTHS_2025 = [
  '2025-12',
  '2025-11',
  '2025-10',
  '2025-09',
  '2025-08',
  '2025-07',
  '2025-06',
  '2025-05',
  '2025-04',
  '2025-03',
  '2025-02',
  '2025-01',
];

const normalizePropertyKey = (value: string): string => value.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_');

const MOM_OCCUPANCY_SERIES: Record<string, MoMOccupancySeries> = {
  // TODO: Replace THE_GROVE with the actual propertyId used by the endpoint.
  THE_GROVE: {
    months: BASE_MONTHS_2025,
    occupiedPct: [68.8, 68.2, 66.8, 63.7, 61.0, 58.0, 52.8, 49.4, 44.3, 40.7, 37.7, 36.0],
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
  },
  // TODO: Replace PITTMAN with the actual propertyId used by the endpoint.
  PITTMAN: {
    months: BASE_MONTHS_2025,
    // Extracted from row 115 (columns C..N) of "Management History Report - STORE on Pittman - 2026-01-15.xlsx".
    occupiedPct: [79.9, 82.2, null, null, null, null, null, null, null, null, null, null],
    // Extracted from row 41 (columns C..N) of the same report.
    grossAccruedRent: [95300.39, 64997.9, 5167, 1518, 79, 0, 0, 0, 0, 0, 0, 0],
  },
};

export const getMoMOccupancySeries = (propertyId: string): MoMOccupancySeries | null => {
  if (!propertyId) return null;
  const key = normalizePropertyKey(propertyId);
  if (MOM_OCCUPANCY_SERIES[key]) return MOM_OCCUPANCY_SERIES[key] ?? null;
  const aliasKey = MOM_OCCUPANCY_ALIASES[key];
  if (aliasKey && MOM_OCCUPANCY_SERIES[aliasKey]) {
    return MOM_OCCUPANCY_SERIES[aliasKey] ?? null;
  }
  return null;
};

const MOM_OCCUPANCY_ALIASES: Record<string, keyof typeof MOM_OCCUPANCY_SERIES> = {
  PROP_PITTMAN: 'PITTMAN',
};
