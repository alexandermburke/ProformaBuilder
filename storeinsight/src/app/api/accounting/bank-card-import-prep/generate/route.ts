import { NextRequest, NextResponse } from "next/server";
import { buildWorkbook } from "@/lib/accounting/bankCardImportPrep/buildWorkbook";
import { getJob, updateJob, SOURCE_KEYS, type SourceKey } from "../jobStore";

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
  let body: { jobId?: string; source?: SourceKey; updates?: ReviewUpdate[] };
  try {
    body = (await req.json()) as { jobId?: string; source?: SourceKey; updates?: ReviewUpdate[] };
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const { jobId, updates, source } = body ?? {};
  if (!jobId) {
    return NextResponse.json({ error: "jobId is required" }, { status: 400 });
  }
  if (!Array.isArray(updates)) {
    return NextResponse.json({ error: "updates array is required" }, { status: 400 });
  }
  if (!source || !SOURCE_KEYS.includes(source)) {
    return NextResponse.json({ error: "source is required (bank, card, otherBank)" }, { status: 400 });
  }

  const job = getJob(jobId);
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }
  const sourceState = job.sources[source];
  if (!sourceState || !sourceState.rows || sourceState.rows.length === 0) {
    return NextResponse.json({ error: "Job rows not available" }, { status: 409 });
  }

  const updatedRows = sourceState.rows.map((row) => ({ ...row }));

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
    const review = {
      missingAccount: updatedRows.filter((row) => !row.Account || !row.Account.trim()).length,
      missingProperty: updatedRows.filter((row) => !row.Property_Name || !row.Property_Name.trim()).length,
      invalidAccount: updatedRows.filter((row) => row.Account && !DIGITS_ONLY.test(row.Account.trim())).length,
      unmapped: unmappedCount,
    };
    const updatedSource = {
      ...sourceState,
      rows: updatedRows,
      review,
      needsReview: true,
      downloadReady: false,
      outputBuffer: undefined,
      outputFilename: undefined,
    };
    const updatedSources = { ...job.sources, [source]: updatedSource };
    const totalUnmapped = SOURCE_KEYS.reduce((total, key) => total + updatedSources[key].review.unmapped, 0);
    updateJob(jobId, {
      sources: updatedSources,
      needsReview: true,
      unmappedCount: totalUnmapped,
      downloadReady: false,
      outputBuffer: undefined,
      outputFilename: undefined,
    });
    return NextResponse.json(
      { error: "Missing required Property_Name or Account", needsReview: true, unmappedCount },
      { status: 400 },
    );
  }

  const cashAccount = job.cashAccount || job.templateCashAccount || "";
  if (!cashAccount) {
    return NextResponse.json({ error: "Missing cash account" }, { status: 400 });
  }

  const exportTimestamp = job.exportTimestamp ?? Date.now();
  const filename = `yardi_import_${source === "otherBank" ? "otherbank" : source}_${exportTimestamp}.xlsx`;
  const { buffer, emitted } = buildWorkbook(updatedRows, { cashAccount, filename });
  const updatedSource = {
    ...sourceState,
    rows: updatedRows,
    downloadReady: true,
    outputBuffer: buffer,
    outputFilename: filename,
    needsReview: false,
    review: {
      missingAccount: 0,
      missingProperty: 0,
      invalidAccount: 0,
      unmapped: 0,
    },
    counts: {
      ...sourceState.counts,
      output: emitted,
    },
  };
  const updatedSources = { ...job.sources, [source]: updatedSource };
  const allReady = SOURCE_KEYS.every((key) => updatedSources[key].downloadReady);
  const totalOutput = SOURCE_KEYS.reduce((total, key) => total + updatedSources[key].counts.output, 0);
  const totalTransactions = SOURCE_KEYS.reduce((total, key) => total + updatedSources[key].counts.transactions, 0);
  const totalUnmapped = SOURCE_KEYS.reduce((total, key) => total + updatedSources[key].review.unmapped, 0);
  const zipName = `yardi_import_${exportTimestamp}.zip`;

  updateJob(jobId, {
    sources: updatedSources,
    downloadReady: allReady,
    outputFilename: allReady ? zipName : job.outputFilename,
    status: "done",
    step: "Complete",
    percent: 100,
    needsReview: totalUnmapped > 0,
    unmappedCount: totalUnmapped,
    logs: [
      ...job.logs,
      `[build] ${source.toUpperCase()} emitted ${emitted} journal rows (cash + offset)`,
      `[build] ${source.toUpperCase()} workbook ready (${filename})`,
    ],
    counts: {
      ...job.counts,
      output: totalOutput,
      transactions: totalTransactions,
    },
  });

  return NextResponse.json({
    downloadReady: allReady,
    filename,
    needsReview: totalUnmapped > 0,
    unmappedCount: totalUnmapped,
    source,
  });
}
