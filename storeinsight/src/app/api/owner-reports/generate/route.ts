export const runtime = "nodejs";

import fs from "node:fs/promises";
import path from "node:path";
import PizZip from "pizzip";
import { NextRequest, NextResponse } from "next/server";
import { buildOwnerPptx } from "@/lib/buildOwnerPptx";
import { extractOwnerFields } from "@/lib/extractOwnerFields";
import { toNumber } from "@/lib/compute";
import { extractBudgetTableFields, type BudgetTokenDetail } from "@/lib/extractBudget";
import type { OwnerFields } from "@/types/ownerReport";

function listPptxTokens(buf: Buffer): string[] {
  try {
    const zip = new PizZip(buf);
    const files = Object.keys(zip.files).filter(
      (name) => name.startsWith("ppt/slides/slide") && name.endsWith(".xml"),
    );
    const tokens = new Set<string>();
    for (const file of files) {
      const xml = zip.file(file)?.asText() ?? "";
      for (const match of xml.matchAll(/\{\{([A-Z0-9_]+)\}\}/g)) {
        tokens.add(match[1]);
      }
    }
    return Array.from(tokens);
  } catch {
    return [];
  }
}

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const file = form.get("file");
  const overrides = form.get("overrides");
  const budget = form.get("budget");
  const financial = form.get("financial");
  const budgetTokensRaw = form.get("budgetTokens");
  const budgetOverridesRaw = form.get("budgetOverrides");

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

  let budgetBuffer: Buffer | undefined;
  if (budget instanceof Blob) {
    budgetBuffer = Buffer.from(await budget.arrayBuffer());
  }
  let financialBuffer: Buffer | undefined;
  if (financial instanceof Blob) {
    financialBuffer = Buffer.from(await financial.arrayBuffer());
  }

  let budgetTokens: Record<string, number> | undefined;
  if (typeof budgetTokensRaw === "string" && budgetTokensRaw.trim()) {
    try {
      const parsed = JSON.parse(budgetTokensRaw) as Record<string, unknown>;
      const normalized: Record<string, number> = {};
      if (parsed && typeof parsed === "object") {
        for (const [token, value] of Object.entries(parsed)) {
          const numeric = toNumber(value);
          if (Number.isFinite(numeric)) {
            normalized[token] = numeric;
          }
        }
      }
      if (Object.keys(normalized).length > 0) {
        budgetTokens = normalized;
      }
    } catch (err) {
      console.error("[owner-reports] Unable to parse budget tokens", err);
    }
  }

  let budgetOverrides: Record<string, number> | undefined;
  if (typeof budgetOverridesRaw === "string" && budgetOverridesRaw.trim()) {
    try {
      const parsed = JSON.parse(budgetOverridesRaw) as Record<string, string>;
      const normalized: Record<string, number> = {};
      for (const [token, value] of Object.entries(parsed)) {
        const numeric = toNumber(value);
        if (Number.isFinite(numeric)) {
          normalized[token] = numeric;
        }
      }
      if (Object.keys(normalized).length > 0) {
        budgetOverrides = normalized;
      }
    } catch (err) {
      console.error("[owner-reports] Unable to parse budget overrides", err);
    }
  }

  const templatePath = path.join(process.cwd(), "public", "XRAYTEMPLATE.pptx");
  const templateBuffer = await fs.readFile(templatePath);
  const templateTokens = listPptxTokens(templateBuffer);

  let budgetDetails: Record<string, BudgetTokenDetail> | undefined;
  if (budgetBuffer) {
    try {
      const extraction = await extractBudgetTableFields(
        budgetBuffer,
        financialBuffer ?? undefined,
      );
      budgetTokens = extraction.tokens;
      budgetDetails = extraction.details;
    } catch (err) {
      console.error("[owner-reports] Unable to re-parse budget workbook on server", err);
    }
  }

  const budgetTokensNumeric = budgetTokens ?? {};
  console.log("[budget] detected", Object.keys(budgetTokensNumeric).length, "numeric tokens");

  const pptx = await buildOwnerPptx({
    templateBuffer,
    ownerValues: data,
    budgetTokensNumeric,
    budgetDetails,
    budgetOverrides,
    templateTokens,
    budgetBuffer: budgetBuffer ?? null,
    financialBuffer: financialBuffer ?? null,
  });
  const outName = `Owner-Report-${data.CURRENTDATE || "report"}.pptx`;

  return new NextResponse(pptx, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "Content-Disposition": `attachment; filename="${outName}"`,
      "Cache-Control": "no-store",
    },
  });
}
