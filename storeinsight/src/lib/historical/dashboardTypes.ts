export type HistoricalSnapshotRangeKey = '3M' | '6M' | '12M' | '24M' | '36M' | 'ALL';

export type HistoricalSnapshotRangeOption = {
  key: HistoricalSnapshotRangeKey;
  label: string;
  months: number | null;
};

export type HistoricalPropertyOption = {
  id: string;
  label: string;
  city: string;
  enabled: boolean;
  aliases: string[];
  propertyId?: string;
  tenantPropertyId?: string;
  propertyCode?: string;
};

export type MsrSnapshot = {
  monthIso?: string;
  month?: string;
  reportMonth?: string;
  reportDate?: string;
  asOfDate?: string | Date | { toDate?: () => Date };
  propertyName?: string;
  occupancy?: {
    rsfOccPct?: number;
    totalRsf?: number;
    occupiedRsf?: number;
    occupiedCount?: number;
    totalCount?: number;
  };
  revenue?: {
    economicOccupancy?: number;
    netRevenueMtd?: number;
    grossPotentialRevenue?: number;
    totalOperatingExpense?: number;
    totalOperatingExpenseMtd?: number;
    operatingExpenseMtd?: number;
    expensesMtd?: number;
    noi?: number;
    noiMtd?: number;
    netOperatingIncome?: number;
    netOperatingIncomeMtd?: number;
    occupiedRateVariancePct?: number;
    occupiedRateVarianceAmount?: number;
  };
  financials?: {
    expenses?: number;
    expensesMtd?: number;
    totalOperatingExpense?: number;
    totalOperatingExpenseMtd?: number;
    noi?: number;
    noiMtd?: number;
    netOperatingIncome?: number;
    netOperatingIncomeMtd?: number;
  };
  rentals?: {
    moveInsMtd?: number;
    moveOutsMtd?: number;
    netMtd?: number;
  };
  ar?: {
    totalPastDue?: number;
    pastDue61Plus?: number;
    delinquentTenantCount?: number;
    overlockedUnitCount?: number;
    overlockTotalBalance?: number;
    overlockAvgDaysLate?: number;
    agingBuckets?: {
      days0to10?: number;
      days11to30?: number;
      days31to60?: number;
      days61plus?: number;
    };
    aging?: {
      days0to10?: number;
      days11to30?: number;
      days31to60?: number;
      days61plus?: number;
    };
    overlockBucketShare?: Array<{ label: string; percent: number }>;
    bucketShare?: Array<{ label: string; percent: number }>;
    topDelinquencies?: Array<{
      tenant?: string;
      unit?: string;
      daysLate?: number;
      balance?: number;
      startDate?: string;
    }>;
  };
  leads?: {
    totalMtd?: number;
    byChannelMtd?: {
      web?: number;
      phone?: number;
      walkIn?: number;
      other?: number;
    };
  };
  concessions?: {
    promosDiscountsMtd?: number;
    creditsAdjustmentsMtd?: number;
    refundsWriteoffsMtd?: number;
  };
  autopay?: {
    autopayPct?: number;
    autopayCount?: number;
  };
  coverage?: {
    enrolledPct?: number;
    enrolledCount?: number;
    premiumMtd?: number;
  };
  pricing?: {
    avgSellRateOccupied?: number;
    avgCurrentRentOccupied?: number;
    avgSellRatePerSqftOccupied?: number;
    avgCurrentRentPerSqftOccupied?: number;
    occupiedRateVariancePct?: number;
    occupiedRateVariance?: number;
    occupiedRateVarianceAmount?: number;
    rentChangeCountMtd?: number;
    rentChangeCount?: number;
    avgRentChangePct?: number;
    noRentChange12MoCount?: number;
    noRentChange12MoByType?: Record<string, number>;
    occupiedActualAvg?: number;
    occupiedTargetAvg?: number;
  };
  unitMix?: {
    occupiedRsfByType?: Record<string, number>;
    totalOccupiedRsf?: number;
    totalRsf?: number;
  };
  topDelinquencies?: Array<{
    tenant?: string;
    unit?: string;
    daysLate?: number;
    balance?: number;
    startDate?: string;
  }>;
};
