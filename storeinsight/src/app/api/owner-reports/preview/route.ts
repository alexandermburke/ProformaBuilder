export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { extractOwnerFields } from "@/lib/extractOwnerFields";

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: "Upload an .xlsx file as 'file'." }, { status: 400 });
  }
  const blobWithName = file as Blob & { name?: string };
  const filename = typeof blobWithName.name === "string" ? blobWithName.name : "report.xlsx";
  const buffer = Buffer.from(await file.arrayBuffer());

  const fields = extractOwnerFields(buffer, filename);
  return NextResponse.json({ fields });
}
