export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { buildExrHummingbirdExport, type ExrHummingbirdInput } from "@/lib/exrHummingbird";

type RequiredUploadKey = keyof ExrHummingbirdInput;

const REQUIRED_UPLOADS: Array<{ key: RequiredUploadKey; label: string; pattern: RegExp }> = [
  { key: "siteInfo", label: "Site Info.txt", pattern: /\.txt$/i },
  { key: "siteUnits", label: "stage_op_site_units.csv", pattern: /\.csv$/i },
  { key: "accounts", label: "stage_op_accounts.csv", pattern: /\.csv$/i },
  { key: "notes", label: "stage_op_notes.csv", pattern: /\.csv$/i },
  { key: "pcd", label: "stage_op_pcd.csv", pattern: /\.csv$/i },
  { key: "dispositionReport", label: "EXR disposition final reports workbook", pattern: /\.xlsx$/i },
];

async function readRequiredFile(form: FormData, key: RequiredUploadKey, label: string, pattern: RegExp): Promise<Buffer> {
  const value = form.get(key);
  if (!(value instanceof Blob)) {
    throw new Error(`Upload ${label}.`);
  }
  const named = value as Blob & { name?: string };
  const filename = typeof named.name === "string" ? named.name : label;
  if (!pattern.test(filename)) {
    throw new Error(`${label} must be uploaded with the expected file type.`);
  }
  return Buffer.from(await value.arrayBuffer());
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const form = await request.formData();

  try {
    const inputEntries = await Promise.all(
      REQUIRED_UPLOADS.map(async ({ key, label, pattern }) => [
        key,
        await readRequiredFile(form, key, label, pattern),
      ] as const),
    );
    const input = Object.fromEntries(inputEntries) as ExrHummingbirdInput;
    const output = await buildExrHummingbirdExport(input);

    return NextResponse.json({
      artifactName: output.artifactName,
      artifactMimeType: output.artifactMimeType,
      artifactBase64: output.artifactBuffer.toString("base64"),
      summary: output.summary,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to process the EXR transfer bundle." },
      { status: 400 },
    );
  }
}
