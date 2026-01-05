import { NextRequest, NextResponse } from "next/server";
import { getJob } from "../jobStore";

export const runtime = "nodejs";

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
  if (!job.downloadReady || !job.outputBuffer) {
    return NextResponse.json({ error: "File not ready" }, { status: 409 });
  }

  const filename = job.outputFilename || "yardi_import.xlsx";
  const outputView = new Uint8Array(job.outputBuffer);
  const blob = new Blob([outputView]);

  return new NextResponse(blob, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
