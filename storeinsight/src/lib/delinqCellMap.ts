export const DELINQUENCY_BUCKET_KEYS = [
  "0_10",
  "11_30",
  "31_60",
  "61_90",
  "91_120",
  "121_180",
  "181_360",
  "361_PLUS",
] as const;

export type DelinquencyBucketKey = (typeof DELINQUENCY_BUCKET_KEYS)[number];

export type DelinquencyCellKind = "dollars" | "units" | "percent";

const ROW_BY_BUCKET: Record<DelinquencyBucketKey, number> = {
  "0_10": 31,
  "11_30": 32,
  "31_60": 33,
  "61_90": 34,
  "91_120": 35,
  "121_180": 36,
  "181_360": 37,
  "361_PLUS": 38,
};

const COLUMN_BY_KIND: Record<DelinquencyCellKind, string> = {
  dollars: "L",
  units: "M",
  percent: "N",
};

export type DelinquencyCellMap = Record<
  DelinquencyBucketKey,
  Record<DelinquencyCellKind, string>
>;

const buildCellMap = (): DelinquencyCellMap => {
  const map = {} as DelinquencyCellMap;
  for (const bucket of DELINQUENCY_BUCKET_KEYS) {
    const row = ROW_BY_BUCKET[bucket];
    map[bucket] = {
      dollars: `${COLUMN_BY_KIND.dollars}${row}`,
      units: `${COLUMN_BY_KIND.units}${row}`,
      percent: `${COLUMN_BY_KIND.percent}${row}`,
    };
  }
  return map;
};

export const DELINQ_CELL_MAP = buildCellMap();

export const DELINQ_SHEET_CANDIDATES = ["ESR", "Executive Summary Report"];

export const DELINQ_BUCKET_KEYS = DELINQUENCY_BUCKET_KEYS;
