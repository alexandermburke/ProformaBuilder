import { randomUUID } from "node:crypto";
import type { ValidatedRow } from "@/lib/accounting/bankCardImportPrep/validate";

export type JobStatus = "queued" | "running" | "done" | "error";

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
  counts: {
    bank: number;
    card: number;
    otherBank: number;
    output: number;
  };
  rows: ValidatedRow[];
  needsReview: boolean;
  unmappedCount: number;
  defaultProperty: string;
  errorMessage?: string;
  createdAt: number;
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
  const job: PrepJob = {
    id,
    status: "queued",
    percent: 0,
    step: "Queued",
    logs: [],
    warnings: [],
    downloadReady: false,
    rows: [],
    needsReview: false,
    unmappedCount: 0,
    defaultProperty: "",
    counts: { bank: 0, card: 0, otherBank: 0, output: 0 },
    createdAt: Date.now(),
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
