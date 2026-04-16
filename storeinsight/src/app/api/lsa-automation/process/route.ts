export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { buildLsaAutomationExport } from "@/lib/lsaAutomation";

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const uploads = form.getAll("files");

  if (uploads.length === 0) {
    return NextResponse.json({ error: "Upload a ZIP or at least one PDF statement." }, { status: 400 });
  }

  const namedBuffers: Array<{ name: string; buffer: Buffer }> = [];
  for (const upload of uploads) {
    if (!(upload instanceof Blob)) {
      continue;
    }
    const blobWithName = upload as Blob & { name?: string };
    const name = typeof blobWithName.name === "string" ? blobWithName.name : "upload.bin";
    namedBuffers.push({
      name,
      buffer: Buffer.from(await upload.arrayBuffer()),
    });
  }

  try {
    const output = await buildLsaAutomationExport(namedBuffers);
    return NextResponse.json({
      artifactName: output.artifactName,
      artifactMimeType: output.artifactMimeType,
      artifactBase64: output.artifactBuffer.toString("base64"),
      results: output.results,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to process the uploaded statements.",
      },
      { status: 400 },
    );
  }
}
