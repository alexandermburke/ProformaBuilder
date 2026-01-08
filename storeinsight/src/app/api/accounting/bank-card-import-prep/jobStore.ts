import { randomUUID } from "node:crypto";
import type { ValidatedRow } from "@/lib/accounting/bankCardImportPrep/validate";

export type JobStatus = "queued" | "running" | "done" | "error";

export const SOURCE_KEYS = ["bank", "card", "otherBank"] as const;
export type SourceKey = (typeof SOURCE_KEYS)[number];

export type SourceReviewCounts = {
  missingAccount: number;
  missingProperty: number;
  invalidAccount: number;
  unmapped: number;
};

export type SourceSummary = {
  key: SourceKey;
  rows: ValidatedRow[];
  downloadReady: boolean;
  outputFilename?: string;
  outputBuffer?: Buffer;
  counts: {
    input: number;
    output: number;
    transactions: number;
    passthrough: number;
  };
  review: SourceReviewCounts;
  needsReview: boolean;
};

export type PrepJob = {
  id: string;
  status: JobStatus;
  percent: number;
  step: string;
  logs: string[];
  warnings: string[];
  downloadReady: boolean;
  outputFilename?: string;
  outputBuffer?: Buffer;
  sources: Record<SourceKey, SourceSummary>;
  counts: {
    bank: number;
    card: number;
    otherBank: number;
    output: number;
    transactions: number;
  };
  needsReview: boolean;
  unmappedCount: number;
  defaultProperty: string;
  cashAccount: string;
  templateCashAccount?: string;
  templateTxCount?: number;
  matchedTxCount?: number;
  unmatchedSamples?: Array<{ journalDate: string | null; amount: number; notes: string | null }>;
  strictTemplate?: boolean;
  missingCashAccount?: boolean;
  errorMessage?: string;
  createdAt: number;
  exportTimestamp?: number;
};

// Share job store across route handlers (process/status/download) even when Next.js
// bundles them separately. Using globalThis avoids per-bundle maps that lose jobs.
type GlobalWithJobs = typeof globalThis & { __bankCardJobs?: Map<string, PrepJob> };
const globalWithJobs = globalThis as GlobalWithJobs;

const jobs: Map<string, PrepJob> =
  globalWithJobs.__bankCardJobs ?? (globalWithJobs.__bankCardJobs = new Map<string, PrepJob>());

const THIRTY_MIN_MS = 30 * 60 * 1000;

export function createJob(): PrepJob {
  const id = randomUUID();
  const emptySource = (key: SourceKey): SourceSummary => ({
    key,
    rows: [],
    downloadReady: false,
    counts: { input: 0, output: 0, transactions: 0, passthrough: 0 },
    review: { missingAccount: 0, missingProperty: 0, invalidAccount: 0, unmapped: 0 },
    needsReview: false,
  });
  const job: PrepJob = {
    id,
    status: "queued",
    percent: 0,
    step: "Queued",
    logs: [],
    warnings: [],
    downloadReady: false,
    sources: {
      bank: emptySource("bank"),
      card: emptySource("card"),
      otherBank: emptySource("otherBank"),
    },
    needsReview: false,
    unmappedCount: 0,
    defaultProperty: "",
    cashAccount: "",
    counts: { bank: 0, card: 0, otherBank: 0, output: 0, transactions: 0 },
    createdAt: Date.now(),
    missingCashAccount: false,
    exportTimestamp: Date.now(),
  };
  jobs.set(id, job);
  return job;
}

export function getJob(jobId: string): PrepJob | undefined {
  return jobs.get(jobId);
}

export function updateJob(jobId: string, data: Partial<PrepJob>): PrepJob | undefined {
  const existing = jobs.get(jobId);
  if (!existing) return undefined;
  const next = { ...existing, ...data, id: jobId };
  jobs.set(jobId, next);
  return next;
}

export function dropJob(jobId: string): void {
  jobs.delete(jobId);
}

function pruneOldJobs() {
  const now = Date.now();
  for (const [key, job] of jobs.entries()) {
    if (now - job.createdAt > THIRTY_MIN_MS) {
      jobs.delete(key);
    }
  }
}

// Only attach one interval across module reloads.
if (!(globalWithJobs as { __bankCardJobsPruner?: boolean }).__bankCardJobsPruner) {
  (globalWithJobs as { __bankCardJobsPruner?: boolean }).__bankCardJobsPruner = true;
  setInterval(pruneOldJobs, 60_000).unref();
}
