export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { buildOwnerPptx } from "@/lib/buildOwnerPptx";
import { extractOwnerFields } from "@/lib/extractOwnerFields";
import type { OwnerFields } from "@/types/ownerReport";

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const file = form.get("file");
  const overrides = form.get("overrides");

  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: "Upload an .xlsx file as 'file'." }, { status: 400 });
  }

  const blobWithName = file as Blob & { name?: string };
  const filename = typeof blobWithName.name === "string" ? blobWithName.name : "report.xlsx";
  const buffer = Buffer.from(await file.arrayBuffer());
  const auto = extractOwnerFields(buffer, filename);

  let data: OwnerFields = auto;
  if (typeof overrides === "string" && overrides.trim()) {
    data = { ...auto, ...(JSON.parse(overrides) as Partial<OwnerFields>) } as OwnerFields;
  }

  const pptx = await buildOwnerPptx(data);
  const outName = `Owner-Report-${data.CURRENTDATE || "report"}.pptx`;

  return new NextResponse(pptx, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "Content-Disposition": `attachment; filename="${outName}"`,
      "Cache-Control": "no-store",
    },
  });
}
