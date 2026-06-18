export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { extractBudgetTableFields } from "@/lib/extractBudget";
import fs from "node:fs/promises";
import path from "node:path";

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const budget = form.get("budget");
  const budgetFormat = form.get("budgetFormat") === "l001" ? "l001" : "standard";
  const budgetBuffer =
    budget instanceof Blob
      ? Buffer.from(await budget.arrayBuffer())
      : await (async () => {
          try {
            return await fs.readFile(path.join(process.cwd(), "public", "Budget.xlsx"));
          } catch {
            return null;
          }
        })();

  if (!budgetBuffer) {
    return NextResponse.json({ error: "Upload an .xlsx file as 'budget'." }, { status: 400 });
  }

  try {
    const result = await extractBudgetTableFields(budgetBuffer, undefined, budgetFormat);
    return NextResponse.json({
      tokens: result.tokens,
      count: result.count,
      details: result.details,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unable to parse the budget workbook.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
