export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { extractBudgetTableFields } from "@/lib/extractBudget";

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const budget = form.get("budget");
  if (!(budget instanceof Blob)) {
    return NextResponse.json({ error: "Upload an .xlsx file as 'budget'." }, { status: 400 });
  }

  const budgetBuffer = Buffer.from(await budget.arrayBuffer());

  try {
    const result = await extractBudgetTableFields(budgetBuffer, undefined);
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
