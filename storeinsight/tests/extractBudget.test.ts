import assert from "node:assert/strict";
import test from "node:test";
import * as XLSX from "xlsx";
import { extractBudgetTableFields } from "../src/lib/extractBudget";

// QuickBooks has shipped several header wordings for the Budget vs. Actuals
// export, and the "Variance" column's sign convention differs between files.
// These synthetic workbooks pin every known flavor so a new wording or sign
// flip can never silently zero out an owner report again.

type Cell = string | number | null;

const buildWorkbook = (rows: Cell[][]): Buffer => {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Budget vs. Actual");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
};

// One month group (Jul 2026) + a Total group. Values are chosen so that
// Actual - Budget is unambiguous: RENTINC +10 for the month, +100 for YTD.
const qbFamilyRows = (opts: {
  varianceHeader: string;
  percentHeader: string;
  labels: "qbo" | "desktop";
  // What the file's variance column claims (per flavor / sign convention).
  monthVariance: number;
  totalVariance: number;
}): Cell[][] => {
  const label = (qbo: string, desktop: string) => (opts.labels === "qbo" ? qbo : desktop);
  const dataRow = (name: string, actual: number, budget: number, variance: number): Cell[] => [
    name,
    actual,
    budget,
    variance,
    0.5,
    actual * 10,
    budget * 10,
    variance * 10,
    0.5,
  ];
  return [
    ["W999 - Synthetic Property"],
    ["Budget vs. Actual"],
    ["January-July, 2026"],
    [],
    [null, "Jul 2026", null, null, null, "Total"],
    [
      null,
      "Actual",
      "Budget",
      opts.varianceHeader,
      opts.percentHeader,
      "Actual",
      "Budget",
      opts.varianceHeader,
      opts.percentHeader,
    ],
    ["Income"],
    dataRow("4100 Tenant Rental Income", 100, 90, opts.monthVariance),
    dataRow("4150 Discounts", -20, -30, -opts.monthVariance),
    dataRow(label("Total for Income", "Total Income"), 80, 60, opts.monthVariance),
    ["Expenses"],
    dataRow("6800 Repairs & Maintenance", 40, 50, -opts.monthVariance),
    dataRow(label("Total for Expenses", "Total Expenses"), 40, 50, -opts.monthVariance),
    dataRow(label("Total for Other Expenses", "Total Other Expenses"), 5, 5, 0),
    dataRow("Net Income", 35, 5, opts.monthVariance * 3),
  ];
};

test("fast - QBO old flavor (Over budget by / % of budget) ingests the variance column", async () => {
  const buffer = buildWorkbook(
    qbFamilyRows({
      varianceHeader: "Over budget by",
      percentHeader: "% of budget",
      labels: "qbo",
      monthVariance: 10, // Actual - Budget, trustworthy in this flavor
      totalVariance: 100,
    }),
  );
  const result = await extractBudgetTableFields(buffer);
  assert.ok(result.count > 0, "old QBO flavor must never yield zero tokens");
  assert.equal(result.tokens.RENTINCCM, 100);
  assert.equal(result.tokens.RENTINCPTD, 90);
  assert.equal(result.tokens.RENTINCVAR, 10);
  assert.equal(result.tokens.TOTALINCCM, 80);
  assert.equal(result.tokens.TOTALPROPCM, 40);
  // TOTEXP = Total Operating + Total Other Expenses.
  assert.equal(result.tokens.TOTEXPCM, 45);
});

test("fast - QBO new flavor (Variance / Variance %) recomputes variance from Actual - Budget", async () => {
  // The July 2026 W002 export: same layout, renamed headers, and a variance
  // column whose signs are NOT consistent (some rows Budget - Actual). The
  // parser must ignore the column entirely and compute Actual - Budget.
  const buffer = buildWorkbook(
    qbFamilyRows({
      varianceHeader: "Variance",
      percentHeader: "Variance %",
      labels: "qbo",
      monthVariance: -999, // deliberately wrong: must never be ingested
      totalVariance: -999,
    }),
  );
  const result = await extractBudgetTableFields(buffer);
  assert.ok(result.count > 0, "new QBO flavor must never yield zero tokens");
  assert.equal(result.tokens.RENTINCVAR, 10); // 100 - 90, not -999
  assert.equal(result.tokens.RENTINCYTDVAR, 100); // 1000 - 900
  assert.equal(result.tokens.DISCVAR, 10); // -20 - (-30)
  assert.equal(result.tokens.RENTINCVARPER, 11.11); // 10 / 90
});

test("fast - L001 desktop labels with % Variance headers parse via the L001 dialect", async () => {
  const buffer = buildWorkbook(
    qbFamilyRows({
      varianceHeader: "Variance",
      percentHeader: "% Variance",
      labels: "desktop",
      monthVariance: -10, // L001's export stored Budget - Actual
      totalVariance: -100,
    }),
  );
  const result = await extractBudgetTableFields(buffer);
  assert.ok(result.count > 0, "L001 new flavor must never yield zero tokens");
  assert.equal(result.tokens.RENTINCVAR, 10); // computed, not the flipped -10
  // Desktop "Total Income" maps to TOTALINC (not clobbering RENTINC).
  assert.equal(result.tokens.TOTALINCCM, 80);
  assert.equal(result.tokens.RENTINCCM, 100);
  // Forcing the l001 format gives the same result as auto-detection.
  const forced = await extractBudgetTableFields(buffer, undefined, "l001");
  assert.deepEqual(forced.tokens, result.tokens);
});

test("fast - L001 desktop labels with old over Budget headers still ingest variance", async () => {
  const buffer = buildWorkbook(
    qbFamilyRows({
      varianceHeader: "over Budget",
      percentHeader: "% of Budget",
      labels: "desktop",
      monthVariance: 10, // Actual - Budget, trustworthy
      totalVariance: 100,
    }),
  );
  const result = await extractBudgetTableFields(buffer, undefined, "l001");
  assert.ok(result.count > 0);
  assert.equal(result.tokens.RENTINCVAR, 10);
  assert.equal(result.tokens.RENTINCYTDVAR, 100);
});

test("fast - mixed wordings in one header row (P006 style) parse with labels in column 0", async () => {
  // P006's July 2026 export: Jan-Jun groups say "Money remaining"/"Percent
  // remaining" while the Jul and Total groups say "Variance"/"Variance %".
  // Detection must anchor on the Actual/Budget pairs (not the comparison-column
  // wording) and must find the labels in column 0, not next to the first
  // recognized group. Values are numeric strings, as QBO exports them.
  const money = (actual: number, budget: number): Cell[] => [
    String(actual),
    String(budget),
    String(budget - actual), // "Money remaining" = Budget - Actual in this file
    "0.5",
  ];
  const variance = (actual: number, budget: number): Cell[] => [
    String(actual),
    String(budget),
    String(actual - budget), // "Variance" = Actual - Budget in this file
    "0.5",
  ];
  const dataRow = (name: string, jun: Cell[], jul: Cell[], total: Cell[]): Cell[] => [
    name,
    ...jun,
    ...jul,
    ...total,
  ];
  const buffer = buildWorkbook([
    ["P999 - Synthetic Property"],
    ["Budget vs. Actuals"],
    ["January-July, 2026"],
    [],
    [null, "Jun 2026", null, null, null, "Jul 2026", null, null, null, "Total"],
    [
      null,
      "Actual",
      "Budget",
      "Money remaining",
      "Percent remaining",
      "Actual",
      "Budget",
      "Variance",
      "Variance %",
      "Actual",
      "Budget",
      "Variance",
      "Variance %",
    ],
    ["Income"],
    dataRow("4100 Tenant Rental Income", money(95, 90), variance(100, 90), variance(1000, 900)),
    dataRow("4150 Discounts", money(-25, -35), variance(-20, -30), variance(-200, -300)),
    dataRow("Total for Income", money(70, 55), variance(80, 60), variance(800, 600)),
    ["Expenses"],
    dataRow("6800 Repairs & Maintenance", money(45, 55), variance(40, 50), variance(400, 500)),
    dataRow("Total for Expenses", money(45, 55), variance(40, 50), variance(400, 500)),
    dataRow("Total for Other Expenses", money(5, 5), variance(5, 5), variance(50, 50)),
    dataRow("Net Income", money(20, -5), variance(35, 5), variance(350, 50)),
  ]);
  const result = await extractBudgetTableFields(buffer);
  assert.ok(result.count > 0, "mixed-wording exports must never yield zero tokens");
  // CM comes from the LAST month group (Jul), not the Total group or June.
  assert.equal(result.tokens.RENTINCCM, 100);
  assert.equal(result.tokens.RENTINCPTD, 90);
  assert.equal(result.tokens.RENTINCVAR, 10); // computed Actual - Budget
  assert.equal(result.tokens.RENTINCYTD, 1000);
  assert.equal(result.tokens.RENTINCYTDVAR, 100);
  assert.equal(result.tokens.DISCVAR, 10); // -20 - (-30), computed
  assert.equal(result.tokens.TOTALINCCM, 80);
});

test("fast - legacy Yardi header layout still parses", async () => {
  const buffer = buildWorkbook([
    ["Owner = Synthetic Partners LLC"],
    [
      "Account",
      "PTD Actual",
      "PTD Budget",
      "Variance",
      "% Var",
      "YTD Actual",
      "YTD Budget",
      "Variance",
      "% Var",
    ],
    ["Rental Income", 100, 90, 10, 11.11, 1000, 900, 100, 11.11],
    ["Total Income", 80, 60, 20, 33.33, 800, 600, 200, 33.33],
  ]);
  const result = await extractBudgetTableFields(buffer);
  assert.ok(result.count > 0, "legacy Yardi layout must never yield zero tokens");
  assert.equal(result.tokens.RENTINCCM, 100);
  assert.equal(result.tokens.RENTINCVAR, 10);
  assert.equal(result.ownerGroup, "Synthetic Partners LLC");
});
