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
  "0_10": 30,
  "11_30": 31,
  "31_60": 32,
  "61_90": 33,
  "91_120": 34,
  "121_180": 35,
  "181_360": 36,
  "361_PLUS": 37,
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
