import { NextRequest, NextResponse } from "next/server";
import PizZip from "pizzip";
import { getJob, SOURCE_KEYS, type SourceKey } from "../jobStore";

export const runtime = "nodejs";

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
  if (sourceParam) {
    if (!SOURCE_KEYS.includes(sourceParam as SourceKey)) {
      return NextResponse.json({ error: "Invalid source" }, { status: 400 });
    }
    const source = job.sources[sourceParam as SourceKey];
    if (!source || !source.downloadReady || !source.outputBuffer) {
      return NextResponse.json({ error: "File not ready" }, { status: 409 });
    }
    const filename = source.outputFilename || `yardi_import_${sourceParam}_${job.exportTimestamp ?? Date.now()}.xlsx`;
    const outputView = new Uint8Array(source.outputBuffer);
    const blob = new Blob([outputView]);

    return new NextResponse(blob, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  }

  const allReady = SOURCE_KEYS.every(
    (key) => job.sources[key].downloadReady && job.sources[key].outputBuffer,
  );
  if (!allReady) {
    return NextResponse.json({ error: "File not ready" }, { status: 409 });
  }

  const zip = new PizZip();
  SOURCE_KEYS.forEach((key) => {
    const source = job.sources[key];
    const filename =
      source.outputFilename || `yardi_import_${key === "otherBank" ? "otherbank" : key}_${job.exportTimestamp ?? Date.now()}.xlsx`;
    if (source.outputBuffer) {
      zip.file(filename, source.outputBuffer);
    }
  });
  const buffer = zip.generate({ type: "nodebuffer" }) as Buffer;
  const filename = job.outputFilename || `yardi_import_${job.exportTimestamp ?? Date.now()}.zip`;
  const outputView = new Uint8Array(buffer);
  const blob = new Blob([outputView]);

  return new NextResponse(blob, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
