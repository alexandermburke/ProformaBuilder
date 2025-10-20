// src/lib/types.ts
export type SnapshotId = string;

export type LineSeriesByLabel = Record<string, number[]>;

export type SnapshotRowLite = {
  id: SnapshotId;
  facility: string;
  period: string;
  noi: number;
  createdBy: string;
  createdAt: string;
};

export type ParsedSheet = {
  name: string;
  headers: string[];
  rows: Record<string, unknown>[]; // row objects (legacy)
  matrix: (string | number | null)[][]; // raw 2D grid for AI/layout work
};

export type UploadParseResult = {
  fileName: string;
  sheets: ParsedSheet[];
};

export type HeaderMapping = Record<string, string>;
export type WizardStep = 0 | 1 | 2 | 3 | 4;

export type ProformaTotals = {
  totalOperatingIncome: number; // TOI
  totalOperatingExpense: number; // TOE
  noi: number; // TOI - TOE
};

export type SnapshotDetail = {
  id: SnapshotId;
  facility: string;
  period: string;
  createdBy: string;
  createdAt: string;
  sourceFile: string;
  mapping: HeaderMapping;
  extracted: {
    fromSheet: string;
    sampleCount: number;
  };
  totals: ProformaTotals;

  // NEW: what we will export (filled from AI normalization or assumptions)
  monthBand?: string[]; // 12 month labels selected from the vendor sheet
  seriesByLabel?: LineSeriesByLabel; // strict COA -> 12 numbers each
};