export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { processOccupancyWorkbook } from "@/lib/occupancy/lenderUnitMix";

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const uploads = form.getAll("files");

  if (uploads.length === 0) {
    return NextResponse.json(
      { error: "Upload an Occupancy Statistics Report XLSX first." },
      { status: 400 },
    );
  }

  const upload = uploads.find((entry) => entry instanceof Blob);
  if (!(upload instanceof Blob)) {
    return NextResponse.json({ error: "No valid file in upload." }, { status: 400 });
  }

  const blobWithName = upload as Blob & { name?: string };
  const sourceName = typeof blobWithName.name === "string" ? blobWithName.name : "occupancy-report.xlsx";

  if (!/\.xlsx$/i.test(sourceName)) {
    return NextResponse.json(
      { error: "Upload must be an .xlsx workbook from Tenant or Hummingbird." },
      { status: 400 },
    );
  }

  try {
    const arrayBuffer = await upload.arrayBuffer();
    const result = await processOccupancyWorkbook(arrayBuffer, sourceName);
    return NextResponse.json({
      artifactName: result.filename,
      artifactMimeType: result.mimeType,
      artifactBase64: result.base64,
      propertyName: result.propertyName,
      standardStorageRows: result.standardStorageRows,
      parkingRows: result.parkingRows,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to process the uploaded workbook." },
      { status: 400 },
    );
  }
}
