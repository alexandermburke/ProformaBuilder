import type { HistoricalPlaceholderData } from '@/lib/historical/placeholder';

export const getEmptyHistoricalData = (): HistoricalPlaceholderData => ({
  series: {
    arAging: [],
    pricing: [],
    demand: [],
    concessions: [],
    autopay: [],
    inventory: [],
  },
  tables: {
    topDelinquencies: [],
    staleRentExposure: [],
    vacantUnits: [],
  },
  metrics: {
    overlockRisk: {
      overlockedUnits: 0,
      totalBalance: 0,
      avgDaysLate: 0,
      bucketShare: [],
    },
    staleRentCount: 0,
  },
});
