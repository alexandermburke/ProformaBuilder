export const RANGE_KEYS = ['3M', '6M', '1Y', '2Y'] as const;
export type RangeKey = (typeof RANGE_KEYS)[number];

export type MonthlyArAging = {
  month: string;
  current: number;
  days0to10: number;
  days11to30: number;
  days31to60: number;
  days61plus: number;
  delinquentTenants: number;
};

export type MonthlyPricing = {
  month: string;
  setRate: number;
  sellRate: number;
  variancePct: number;
  rentChangeCount: number;
  avgIncreasePct: number;
};

export type MonthlyDemand = {
  month: string;
  leadsWeb: number;
  leadsPhone: number;
  leadsWalkIn: number;
  leadsOther: number;
  moveIns: number;
  medianDays: number;
};

export type MonthlyConcessions = {
  month: string;
  promos: number;
  credits: number;
  refunds: number;
  writeOffs: number;
};

export type MonthlyAutopay = {
  month: string;
  autopayPct: number;
  coverageEnroll: number;
  premiumRevenue: number;
};

export type MonthlyInventory = {
  month: string;
  climate: number;
  driveUp: number;
  parking: number;
  flex: number;
};

export type DelinquencyRow = {
  tenant: string;
  unit: string;
  daysLate: number;
  balance: number;
  startDate: string;
};

export type StaleRentExposureRow = {
  unitType: string;
  count: number;
};

export type VacantUnitRow = {
  unit: string;
  type: string;
  size: string;
  status: string;
};

export type OverlockRisk = {
  overlockedUnits: number;
  totalBalance: number;
  avgDaysLate: number;
  bucketShare: Array<{ label: string; percent: number }>;
};

export type HistoricalPlaceholderData = {
  series: {
    arAging: MonthlyArAging[];
    pricing: MonthlyPricing[];
    demand: MonthlyDemand[];
    concessions: MonthlyConcessions[];
    autopay: MonthlyAutopay[];
    inventory: MonthlyInventory[];
  };
  tables: {
    topDelinquencies: DelinquencyRow[];
    staleRentExposure: StaleRentExposureRow[];
    vacantUnits: VacantUnitRow[];
  };
  metrics: {
    overlockRisk: OverlockRisk;
    staleRentCount: number;
  };
};

const RANGE_MONTHS: Record<RangeKey, number> = {
  '3M': 3,
  '6M': 6,
  '1Y': 12,
  '2Y': 24,
};

const END_YEAR = 2025;
const END_MONTH = 12;

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);

const wave = (index: number, amplitude: number, period = 6): number =>
  Math.sin((index / period) * Math.PI * 2) * amplitude;

const toMonthString = (year: number, month: number): string =>
  `${year}-${String(month).padStart(2, '0')}`;

const buildMonths = (count: number): string[] => {
  const endIndex = END_YEAR * 12 + (END_MONTH - 1);
  const startIndex = endIndex - (count - 1);
  const months: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const idx = startIndex + i;
    const year = Math.floor(idx / 12);
    const month = (idx % 12) + 1;
    months.push(toMonthString(year, month));
  }
  return months;
};

const buildArAging = (months: string[]): MonthlyArAging[] =>
  months.map((month, index) => {
    const total = 52000 + index * 260 + wave(index, 1800, 8);
    const pastDueShare = clamp(0.15 + wave(index, 0.02, 7), 0.11, 0.21);
    const pastDue = total * pastDueShare;
    const current = total - pastDue;
    const bucket0to10 = pastDue * clamp(0.36 + wave(index, 0.03, 5), 0.3, 0.42);
    const bucket11to30 = pastDue * clamp(0.27 + wave(index, 0.02, 6), 0.22, 0.32);
    const bucket31to60 = pastDue * clamp(0.19 + wave(index, 0.015, 4), 0.15, 0.24);
    const bucket61plus = Math.max(pastDue - bucket0to10 - bucket11to30 - bucket31to60, pastDue * 0.1);
    const delinquentTenants = Math.round(36 + index * 0.3 + wave(index, 3, 6));
    return {
      month,
      current: Math.round(current),
      days0to10: Math.round(bucket0to10),
      days11to30: Math.round(bucket11to30),
      days31to60: Math.round(bucket31to60),
      days61plus: Math.round(bucket61plus),
      delinquentTenants,
    };
  });

const buildPricing = (months: string[]): MonthlyPricing[] =>
  months.map((month, index) => {
    const setRate = 178 + index * 0.35 + wave(index, 2.2, 8);
    const gap = 9 + wave(index, 1.5, 5);
    const sellRate = setRate - gap;
    const variancePct = clamp(-1.2 + wave(index, 2.2, 6) + index * 0.02, -4.5, 3.8);
    const rentChangeCount = Math.round(42 + index * 0.4 + wave(index, 7, 7));
    const avgIncreasePct = clamp(4.6 + wave(index, 0.8, 9) + index * 0.02, 3.6, 6.8);
    return {
      month,
      setRate: Math.round(setRate * 10) / 10,
      sellRate: Math.round(sellRate * 10) / 10,
      variancePct: Math.round(variancePct * 10) / 10,
      rentChangeCount,
      avgIncreasePct: Math.round(avgIncreasePct * 10) / 10,
    };
  });

const buildDemand = (months: string[]): MonthlyDemand[] =>
  months.map((month, index) => {
    const totalLeads = Math.round(280 + index * 1.4 + wave(index, 28, 6));
    const web = Math.round(totalLeads * 0.46);
    const phone = Math.round(totalLeads * 0.24);
    const walkIn = Math.round(totalLeads * 0.2);
    const other = Math.max(totalLeads - web - phone - walkIn, 12);
    const conversion = clamp(0.28 + wave(index, 0.03, 8), 0.21, 0.36);
    const moveIns = Math.max(Math.round(totalLeads * conversion), 40);
    const medianDays = Math.round(12 + wave(index, 2, 7) + (index % 3) * 0.3);
    return {
      month,
      leadsWeb: web,
      leadsPhone: phone,
      leadsWalkIn: walkIn,
      leadsOther: other,
      moveIns,
      medianDays,
    };
  });

const buildConcessions = (months: string[]): MonthlyConcessions[] =>
  months.map((month, index) => {
    const promos = 11200 + index * 90 + wave(index, 900, 6);
    const credits = 3200 + wave(index, 400, 5);
    const refunds = 2100 + wave(index, 350, 7);
    const writeOffs = 1500 + wave(index, 280, 4);
    return {
      month,
      promos: Math.round(promos),
      credits: Math.round(credits),
      refunds: Math.round(refunds),
      writeOffs: Math.round(writeOffs),
    };
  });

const buildAutopay = (months: string[]): MonthlyAutopay[] =>
  months.map((month, index) => {
    const autopayPct = clamp(62 + index * 0.12 + wave(index, 1.8, 10), 56, 78);
    const coverageEnroll = Math.round(210 + index * 1.6 + wave(index, 14, 8));
    const premiumRevenue = 7600 + index * 75 + wave(index, 500, 7);
    return {
      month,
      autopayPct: Math.round(autopayPct * 10) / 10,
      coverageEnroll,
      premiumRevenue: Math.round(premiumRevenue),
    };
  });

const buildInventory = (months: string[]): MonthlyInventory[] =>
  months.map((month, index) => ({
    month,
    climate: clamp(91 + index * 0.15 + wave(index, 1.4, 8), 86, 97),
    driveUp: clamp(88 + index * 0.12 + wave(index, 1.5, 7), 82, 95),
    parking: clamp(82 + index * 0.1 + wave(index, 1.8, 9), 76, 92),
    flex: clamp(76 + index * 0.08 + wave(index, 2, 6), 70, 88),
  }));

const TOP_DELINQUENCIES: DelinquencyRow[] = [
  { tenant: 'Jordan Reed', unit: 'C-102', daysLate: 18, balance: 460, startDate: '2024-11-07' },
  { tenant: 'Avery Lane', unit: 'D-221', daysLate: 26, balance: 720, startDate: '2024-10-24' },
  { tenant: 'Morgan Wells', unit: 'B-118', daysLate: 34, balance: 980, startDate: '2024-10-01' },
  { tenant: 'Cameron Gray', unit: 'E-014', daysLate: 41, balance: 1210, startDate: '2024-09-12' },
  { tenant: 'Riley Brooks', unit: 'A-030', daysLate: 52, balance: 1385, startDate: '2024-08-19' },
  { tenant: 'Taylor Knox', unit: 'F-006', daysLate: 61, balance: 1560, startDate: '2024-08-02' },
  { tenant: 'Harper Fox', unit: 'C-079', daysLate: 68, balance: 1715, startDate: '2024-07-18' },
  { tenant: 'Quinn Shaw', unit: 'B-214', daysLate: 74, balance: 1875, startDate: '2024-07-03' },
];

const STALE_RENT_EXPOSURE: StaleRentExposureRow[] = [
  { unitType: 'Climate', count: 84 },
  { unitType: 'Drive-up', count: 56 },
  { unitType: 'Parking', count: 32 },
  { unitType: 'Flex', count: 21 },
];

const VACANT_UNITS: VacantUnitRow[] = [
  { unit: 'C-104', type: 'Climate', size: '10x10', status: 'Ready' },
  { unit: 'D-208', type: 'Drive-up', size: '10x15', status: 'Cleaning' },
  { unit: 'A-012', type: 'Parking', size: '10x20', status: 'Ready' },
  { unit: 'F-002', type: 'Flex', size: '12x20', status: 'Hold' },
  { unit: 'B-044', type: 'Climate', size: '5x10', status: 'Ready' },
  { unit: 'D-119', type: 'Drive-up', size: '10x20', status: 'Repair' },
  { unit: 'P-017', type: 'Parking', size: '12x25', status: 'Ready' },
  { unit: 'F-009', type: 'Flex', size: '10x25', status: 'Cleaning' },
  { unit: 'C-078', type: 'Climate', size: '10x10', status: 'Ready' },
  { unit: 'D-034', type: 'Drive-up', size: '5x10', status: 'Ready' },
];

const buildOverlockRisk = (arAging: MonthlyArAging[]): OverlockRisk => {
  const latest = arAging[arAging.length - 1];
  const totalPastDue =
    (latest?.days0to10 ?? 0) +
    (latest?.days11to30 ?? 0) +
    (latest?.days31to60 ?? 0) +
    (latest?.days61plus ?? 0);
  const overlockedUnits = Math.round((latest?.delinquentTenants ?? 36) * 0.6 + 12);
  const totalBalance = Math.round((latest?.days31to60 ?? 0) + (latest?.days61plus ?? 0));
  const avgDaysLate = Math.round(34 + ((latest?.days61plus ?? 0) / Math.max(totalPastDue, 1)) * 28);
  return {
    overlockedUnits,
    totalBalance,
    avgDaysLate,
    bucketShare: [
      { label: '0-10', percent: 28 },
      { label: '11-30', percent: 33 },
      { label: '31-60', percent: 24 },
      { label: '61+', percent: 15 },
    ],
  };
};

const buildPlaceholder = (range: RangeKey): HistoricalPlaceholderData => {
  const months = buildMonths(RANGE_MONTHS[range]);
  const arAging = buildArAging(months);
  const pricing = buildPricing(months);
  const demand = buildDemand(months);
  const concessions = buildConcessions(months);
  const autopay = buildAutopay(months);
  const inventory = buildInventory(months);
  const overlockRisk = buildOverlockRisk(arAging);
  const staleRentCount = STALE_RENT_EXPOSURE.reduce((sum, row) => sum + row.count, 0);

  return {
    series: { arAging, pricing, demand, concessions, autopay, inventory },
    tables: {
      topDelinquencies: TOP_DELINQUENCIES,
      staleRentExposure: STALE_RENT_EXPOSURE,
      vacantUnits: VACANT_UNITS,
    },
    metrics: { overlockRisk, staleRentCount },
  };
};

const PLACEHOLDER_BY_RANGE: Record<RangeKey, HistoricalPlaceholderData> = {
  '3M': buildPlaceholder('3M'),
  '6M': buildPlaceholder('6M'),
  '1Y': buildPlaceholder('1Y'),
  '2Y': buildPlaceholder('2Y'),
};

export const getHistoricalPlaceholder = (range: RangeKey): HistoricalPlaceholderData =>
  PLACEHOLDER_BY_RANGE[range] ?? PLACEHOLDER_BY_RANGE['1Y'];
