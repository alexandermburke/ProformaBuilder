import { NextRequest, NextResponse } from "next/server";
import { buildWorkbook } from "@/lib/accounting/bankCardImportPrep/buildWorkbook";
import { getJob, updateJob } from "../jobStore";

export const runtime = "nodejs";

const DIGITS_ONLY = /^\d+$/;
const isPropertyMissing = (value: string | null | undefined) => !value || !value.trim();
const isAccountInvalid = (value: string | null | undefined) => !value || !DIGITS_ONLY.test(value.trim());
const clean = (value: unknown): string | null => {
  if (value == null) return null;
  const str = typeof value === "string" ? value : String(value);
  const trimmed = str.trim();
  return trimmed ? trimmed : null;
};

type ReviewUpdate = {
  rowNumber: number;
  propertyName?: string | null;
  account?: string | null;
};

export async function POST(req: NextRequest) {
  let body: { jobId?: string; updates?: ReviewUpdate[] };
  try {
    body = (await req.json()) as { jobId?: string; updates?: ReviewUpdate[] };
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const { jobId, updates } = body ?? {};
  if (!jobId) {
    return NextResponse.json({ error: "jobId is required" }, { status: 400 });
  }
  if (!Array.isArray(updates)) {
    return NextResponse.json({ error: "updates array is required" }, { status: 400 });
  }

  const job = getJob(jobId);
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }
  if (!job.rows || job.rows.length === 0) {
    return NextResponse.json({ error: "Job rows not available" }, { status: 409 });
  }
  if (!job.cashAccount) {
    return NextResponse.json({ error: "Missing cash account" }, { status: 400 });
  }

  const updatedRows = job.rows.map((row) => ({ ...row }));

  for (const update of updates) {
    const rowNumber = Number(update?.rowNumber);
    if (!Number.isInteger(rowNumber) || rowNumber < 1) continue;

    const idx = updatedRows.findIndex(
      (row, index) => (row.Tran_Seq_Number ?? index + 1) === rowNumber,
    );
    if (idx === -1) continue;

    const propertyName =
      update.propertyName !== undefined
        ? clean(update.propertyName) ?? job.defaultProperty
        : updatedRows[idx].Property_Name ?? job.defaultProperty;
    const account =
      update.account !== undefined ? clean(update.account) : updatedRows[idx].Account;

    updatedRows[idx] = {
      ...updatedRows[idx],
      Property_Name: propertyName,
      Account: account,
    };
  }

  const unmappedCount = updatedRows.reduce(
    (count, row) =>
      count +
      (isPropertyMissing(row.Property_Name) || isAccountInvalid(row.Account) ? 1 : 0),
    0,
  );

  if (unmappedCount > 0) {
    updateJob(jobId, {
      rows: updatedRows,
      needsReview: true,
      unmappedCount,
      downloadReady: false,
      outputBuffer: undefined,
      outputFilename: undefined,
    });
    return NextResponse.json(
      { error: "Missing required Property_Name or Account", needsReview: true, unmappedCount },
      { status: 400 },
    );
  }

  const { buffer, filename, emitted } = buildWorkbook(updatedRows, { cashAccount: job.cashAccount });
  updateJob(jobId, {
    rows: updatedRows,
    downloadReady: true,
    outputBuffer: buffer,
    outputFilename: filename,
    status: "done",
    step: "Complete",
    percent: 100,
    needsReview: false,
    unmappedCount: 0,
    logs: [...job.logs, `[build] emitted ${emitted} journal rows (cash + offset)`, `[build] workbook ready (${filename})`],
    counts: {
      ...job.counts,
      output: emitted,
    },
  });

  return NextResponse.json({
    downloadReady: true,
    filename,
    needsReview: false,
    unmappedCount: 0,
  });
}
