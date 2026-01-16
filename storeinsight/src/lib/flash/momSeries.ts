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
  0.0,       
    ],
  occupiedPct: [78.0, 78.7, 78.5, 79.0, 80.0, 83.7, 82.91, 0.0, 0.0, 0.0, 0.0, 0.0],
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
