import { NextRequest, NextResponse } from "next/server";
import { extractMsrFlashTokens } from "@/lib/extractMsrFlashTokens";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: "Upload an .xlsx file as 'file'." }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  try {
    const tokens = await extractMsrFlashTokens(buffer);
    return NextResponse.json({ tokens });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unable to parse the MSR workbook.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
