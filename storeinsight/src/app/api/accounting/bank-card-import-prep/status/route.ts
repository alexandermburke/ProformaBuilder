import { NextRequest, NextResponse } from "next/server";
import { getJob, SOURCE_KEYS } from "../jobStore";

export const runtime = "nodejs";
const SOURCE_LABELS = {
  bank: "Bank",
  card: "Credit Card",
  otherBank: "Other Bank Activity",
} as const;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const jobId = searchParams.get("jobId");
  if (!jobId) {
    return NextResponse.json({ error: "jobId is required" }, { status: 400 });
  }
  const job = getJob(jobId);
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  const sources = Object.fromEntries(
    SOURCE_KEYS.map((key) => {
      const source = job.sources[key];
      return [
        key,
        {
          key,
          label: SOURCE_LABELS[key],
          downloadReady: source.downloadReady,
          outputFilename: source.outputFilename,
          counts: source.counts,
          review: source.review,
          needsReview: source.needsReview,
        },
      ];
    }),
  );

  return NextResponse.json({
    status: job.status,
    percent: job.percent,
    step: job.step,
    logs: job.logs,
    warnings: job.warnings,
    downloadReady: job.downloadReady,
    counts: job.counts,
    sources,
    errorMessage: job.errorMessage,
    outputFilename: job.outputFilename,
    createdAt: job.createdAt,
    needsReview: job.needsReview,
    unmappedCount: job.unmappedCount,
    templateCashAccount: job.templateCashAccount,
    templateTxCount: job.templateTxCount,
    matchedTxCount: job.matchedTxCount,
    unmatchedSamples: job.unmatchedSamples,
    strictTemplate: job.strictTemplate,
    missingCashAccount: job.missingCashAccount,
  });
}
