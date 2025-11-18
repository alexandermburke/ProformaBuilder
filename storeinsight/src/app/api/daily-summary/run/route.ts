import { NextRequest, NextResponse } from "next/server";
import { listProperties, updateRunStatus } from "@/app/api/daily-summary/store";

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const propertyId = String(form.get("propertyId") ?? "");
  const asOfDate = String(form.get("asOfDate") ?? "");
  const file = form.get("managementSummaryFile");
  const hasUploadField = String(form.get("hasUpload") ?? "");
  const hasUpload = hasUploadField === "true" || hasUploadField === "1" || file instanceof Blob;

  if (!propertyId) {
    return NextResponse.json({ error: "propertyId is required" }, { status: 400 });
  }

  const properties = await listProperties();
  const knownProperty = properties.find((p) => p.id === propertyId);
  if (!knownProperty) {
    return NextResponse.json({ error: "Unknown property" }, { status: 404 });
  }

  console.info("[daily-summary] run requested", {
    propertyId,
    asOfDate,
    hasUpload,
    uploadProvided: file instanceof Blob,
  });

  await new Promise((resolve) => setTimeout(resolve, 350));

  const status = updateRunStatus(propertyId, "success");

  return NextResponse.json({
    status: "success",
    runStatus: status,
  });
}
