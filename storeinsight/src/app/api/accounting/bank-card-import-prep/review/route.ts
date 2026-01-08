import { NextRequest, NextResponse } from "next/server";
import { getJob, SOURCE_KEYS } from "../jobStore";

export const runtime = "nodejs";

const DIGITS_ONLY = /^\d+$/;
const isPropertyMissing = (value: string | null | undefined) => !value || !value.trim();
const isAccountInvalid = (value: string | null | undefined) => !value || !DIGITS_ONLY.test(value.trim());

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const jobId = searchParams.get("jobId");
  const sourceParam = searchParams.get("source");
  if (!jobId) {
    return NextResponse.json({ error: "jobId is required" }, { status: 400 });
  }

  const job = getJob(jobId);
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }
  const resolvedSource =
    SOURCE_KEYS.find((key) => key === sourceParam) ??
    SOURCE_KEYS.find((key) => job.sources[key].needsReview) ??
    SOURCE_KEYS[0];
  const source = job.sources[resolvedSource];
  if (!source || !source.rows || source.rows.length === 0) {
    return NextResponse.json({ error: "Job rows not available" }, { status: 409 });
  }

  const rowsNeedingReview = source.rows
    .map((row, idx) => ({
      rowNumber: row.Tran_Seq_Number ?? idx + 1,
      source: row.source,
      journalDate: row.JournalDate,
      notes: row.Notes,
      detailNotes: row.DetailNotes,
      debit: row.Debit,
      credit: row.Credit,
      propertyName: row.Property_Name,
      account: row.Account,
    }))
    .filter((row) => isPropertyMissing(row.propertyName) || isAccountInvalid(row.account));

  return NextResponse.json({
    source: resolvedSource,
    needsReview: source.needsReview,
    unmappedCount: source.review.unmapped ?? rowsNeedingReview.length,
    missingAccountCount: source.review.missingAccount,
    missingPropertyCount: source.review.missingProperty,
    invalidAccountCount: source.review.invalidAccount,
    rows: rowsNeedingReview,
  });
}
