export type MoMSeries = {
  months: string[];
  grossAccruedRent: number[];
  occupiedPct: number[];
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

const monthToIndex = (value: string): number | null => {
  const match = /^(\d{4})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return null;
  return year * 12 + (month - 1);
};

const normalizeMonthOverrides = (months: string[] | undefined, size: number): string[] | null => {
  if (!Array.isArray(months) || months.length === 0) return null;
  const normalized = months
    .map((month) => String(month ?? "").trim())
    .filter((month) => /^\d{4}-\d{2}$/.test(month));
  if (normalized.length === 0) return null;
  if (normalized.length >= size) return normalized.slice(0, size);
  return normalized.concat(buildPlaceholderMonths(size - normalized.length));
};

const rollSeriesToCurrentMonth = (
  months: string[],
  grossAccruedRent: number[],
  occupiedPct: number[],
): { months: string[]; grossAccruedRent: number[]; occupiedPct: number[] } => {
  if (!months.length) return { months, grossAccruedRent, occupiedPct };
  const latestTarget = buildPlaceholderMonths(1)[0];
  const latestIndex = monthToIndex(months[0]);
  const targetIndex = monthToIndex(latestTarget);
  if (latestIndex == null || targetIndex == null || latestIndex >= targetIndex) {
    return { months, grossAccruedRent, occupiedPct };
  }

  let nextMonths = [...months];
  let nextGross = [...grossAccruedRent];
  let nextOccupied = [...occupiedPct];

  while (nextMonths.length > 0) {
    const currentIndex = monthToIndex(nextMonths[0]);
    if (currentIndex == null || currentIndex >= targetIndex) break;
    const [yearStr, monthStr] = nextMonths[0].split("-");
    const currentYear = Number(yearStr);
    const currentMonth = Number(monthStr);
    const nextMonthDate = new Date(Date.UTC(currentYear, currentMonth, 1));
    const y = nextMonthDate.getUTCFullYear();
    const m = String(nextMonthDate.getUTCMonth() + 1).padStart(2, "0");
    nextMonths = [`${y}-${m}`, ...nextMonths].slice(0, months.length);
    nextGross = [0, ...nextGross].slice(0, grossAccruedRent.length);
    nextOccupied = [0, ...nextOccupied].slice(0, occupiedPct.length);
  }

  return { months: nextMonths, grossAccruedRent: nextGross, occupiedPct: nextOccupied };
};

const normalizeSeriesValues = (values: number[] | undefined, targetLength: number): number[] => {
  const normalized = Array.isArray(values)
    ? values
        .map((value) => (typeof value === "number" ? value : Number(value)))
        .filter((value) => Number.isFinite(value))
    : [];
  if (normalized.length >= targetLength) {
    return normalized.slice(0, targetLength);
  }
  if (normalized.length === 0) {
    return new Array(targetLength).fill(0);
  }
  return normalized.concat(new Array(targetLength - normalized.length).fill(0));
};

export const buildPlaceholderMoMSeries = (
  monthCount = 12,
  overrides?: { months?: string[]; grossAccruedRent?: number[]; occupiedPct?: number[] },
): MoMSeries => {
  const hasExplicitMonths = Array.isArray(overrides?.months) && overrides.months.length > 0;
  const months = normalizeMonthOverrides(overrides?.months, monthCount) ?? buildPlaceholderMonths(monthCount);
  const size = months.length;
  const base = {
    months,
    grossAccruedRent: normalizeSeriesValues(overrides?.grossAccruedRent, size),
    occupiedPct: normalizeSeriesValues(overrides?.occupiedPct, size),
  };
  // Respect explicit month configuration from Firebase/UI exactly as entered.
  if (hasExplicitMonths) {
    return base;
  }
  return rollSeriesToCurrentMonth(base.months, base.grossAccruedRent, base.occupiedPct);
};
