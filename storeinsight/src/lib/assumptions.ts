// src/lib/assumptions.ts
// Methods: Latest, T12Avg, PercentOfRevenue, Growth%
// No "any"; logs included for traceability.

export type Method = 'Latest' | 'T12Avg' | 'PercentOfRevenue' | 'Growth';

export type LineAssumption = {
  method: Method;
  /** For PercentOfRevenue: 0.05 means 5% of revenue */
  percent?: number;
  /** Monthly growth rate: 0.01 means +1% per month */
  growthPct?: number;
};

export type Assumptions = {
  rentalIncome: LineAssumption;
  discounts: LineAssumption;
  badDebt: LineAssumption;
  mgmtFee: LineAssumption;
  opExTotal: LineAssumption;
};

export type HistoryContext = {
  /** Last 12 months for the driver "revenue" (usually Rental Income), oldest→newest */
  revenueT12: number[];
  /** Optional history for specific lines (if available), oldest→newest */
  lineT12?: Record<string, number[]>;
};

function latest(arr: number[]): number {
  return arr.length ? arr[arr.length - 1] : 0;
}
function avg(arr: number[]): number {
  if (!arr.length) return 0;
  let s = 0;
  for (const v of arr) s += v;
  return s / arr.length;
}

export function seedFromAssumption(as: LineAssumption, ctx: HistoryContext, key: string): number {
  switch (as.method) {
    case 'Latest': {
      const src = ctx.lineT12?.[key] ?? ctx.revenueT12;
      const v = latest(src);
      console.log('[assump] seed Latest', { key, v });
      return v;
    }
    case 'T12Avg': {
      const src = ctx.lineT12?.[key] ?? ctx.revenueT12;
      const v = avg(src);
      console.log('[assump] seed T12Avg', { key, v });
      return v;
    }
    case 'PercentOfRevenue': {
      const pct = as.percent ?? 0;
      const v = latest(ctx.revenueT12) * pct;
      console.log('[assump] seed % of revenue', { key, pct, v });
      return v;
    }
    case 'Growth': {
      const base = latest(ctx.lineT12?.[key] ?? ctx.revenueT12);
      console.log('[assump] seed Growth (base)', { key, base });
      return base;
    }
    default:
      return 0;
  }
}

/** Build a 12-month forward series from a seed, growth rate, and optional % of revenue driver */
export function buildSeries(
  key: string,
  as: LineAssumption,
  ctx: HistoryContext,
  revenueForward?: number[]
): number[] {
  const out: number[] = new Array(12).fill(0);
  const g = as.growthPct ?? 0;

  if (as.method === 'PercentOfRevenue') {
    const pct = as.percent ?? 0;
    const driver = revenueForward ?? new Array(12).fill(latest(ctx.revenueT12));
    for (let i = 0; i < 12; i++) {
      out[i] = driver[i] * pct;
      if (g) out[i] = out[i] * Math.pow(1 + g, i);
    }
    console.log('[assump] series % of revenue', { key, pct, growth: g });
    return out;
  }

  // For Latest / T12Avg / Growth on own line
  let base = seedFromAssumption(as, ctx, key);
  for (let i = 0; i < 12; i++) {
    out[i] = base * Math.pow(1 + g, i);
  }
  console.log('[assump] series built', { key, method: as.method, growth: g });
  return out;
}

/** Compute the five MVP lines and also roll up TOI/TOE/NOI arrays */
export function computeSeriesFromAssumptions(
  assumptions: Assumptions,
  ctx: HistoryContext
): {
  rentalIncome: number[];
  discounts: number[];
  badDebt: number[];
  mgmtFee: number[];
  opExTotal: number[];
  toi: number[];
  toe: number[];
  noi: number[];
} {
  // Driver first: rental income
  const rental = buildSeries('rentalIncome', assumptions.rentalIncome, ctx);
  // Lines that may depend on revenue series
  const disc = buildSeries('discounts', assumptions.discounts, ctx, rental);
  const bd = buildSeries('badDebt', assumptions.badDebt, ctx, rental);
  const mgmt = buildSeries('mgmtFee', assumptions.mgmtFee, ctx, rental);
  const opEx = buildSeries('opExTotal', assumptions.opExTotal, ctx, rental);

  const toi: number[] = [];
  const toe: number[] = [];
  const noi: number[] = [];
  for (let i = 0; i < 12; i++) {
    const income = rental[i] + disc[i] + bd[i]; // note: discounts/bad debt are negative in many models—set percent negative in UI if needed
    const expense = mgmt[i] + opEx[i];
    toi.push(income);
    toe.push(expense);
    noi.push(income - expense);
  }

  console.log('[assump] rollups', {
    toiLast: toi[11], toeLast: toe[11], noiLast: noi[11]
  });

  return { rentalIncome: rental, discounts: disc, badDebt: bd, mgmtFee: mgmt, opExTotal: opEx, toi, toe, noi };
}