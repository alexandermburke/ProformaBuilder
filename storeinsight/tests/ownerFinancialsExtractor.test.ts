import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateSqFt,
  cleanLabel,
  formatDate,
  guessPropertyName,
  isDateValue,
  isZeroRow,
  labelMatches,
  makeSafeFilename,
  parseDateString,
  pyFloat,
  pyFormatPercent0,
  pyRound,
  pyStr,
  pySum,
} from "../src/lib/finance/ownerFinancials/pythonCompat";
import { sequenceMatcherRatio } from "../src/lib/finance/ownerFinancials/difflib";
import { CoaMapper, normalizeLabel } from "../src/lib/finance/ownerFinancials/coaMapper";
import {
  cellToValue,
  loadExcelJS,
} from "../src/lib/finance/ownerFinancials/readWorkbook";
import {
  calculateRentRollAnalytics,
  extractOpsSum,
  extractPropertyNumber,
  extractRentRoll,
  extractRollingIs,
  extractUnitRate,
} from "../src/lib/finance/ownerFinancials/extractExtraSpace";
import {
  extractPsPropertyNumber,
  extractPsRentRollOccupancy,
  extractPsRollingIs,
} from "../src/lib/finance/ownerFinancials/extractPublicStorage";
import {
  calculateCubeSqFt,
  extractCsOpsSum,
  extractCsPropertyNumber,
  extractCsRentRoll,
  extractCsRollingIs,
  extractCsUnitRate,
} from "../src/lib/finance/ownerFinancials/extractCubeSmart";
import type { CellValue, SheetGrid } from "../src/lib/finance/ownerFinancials/types";

/**
 * This workflow is a port of the etlpipelines Python extractor, so the expected
 * values below are the values CPython 3.13 / openpyxl 3.1.5 actually produce -
 * captured by running difflib, round(), format(x, '.0%'), sum(), and
 * datetime.strptime against the same inputs. Changing one of these assertions
 * means the port has drifted from the tool it replaces.
 */

/* -------------------------------- pythonCompat ---------------------------- */

test("guessPropertyName strips the extension and takes the trailing segment", () => {
  assert.equal(
    guessPropertyName("Feb__2026_Owner_Financials_-_EXR_Chattanooga.xlsx"),
    "EXR Chattanooga",
  );
  // en dash separator
  assert.equal(guessPropertyName("Owner Financials – Wentworth.xlsx"), "Wentworth");
  // no separator at all
  assert.equal(guessPropertyName("VacavilleHistoricalsJan26.xlsx"), "VacavilleHistoricalsJan26");
  // splitext only removes the last extension
  assert.equal(guessPropertyName("a.b.xlsx"), "a.b");
  // multiple separators: the last one wins
  assert.equal(guessPropertyName("A - B - C.xlsx"), "C");
});

test("makeSafeFilename mirrors the Windows-safe name the CLI writes", () => {
  assert.equal(makeSafeFilename("Synthetic / EXR: Test*"), "Synthetic_EXR_Test");
  assert.equal(makeSafeFilename("  spaced  out  "), "spaced_out");
  assert.equal(makeSafeFilename('a\\b/c:d*e?f"g<h>i|j'), "abcdefghij");
});

test("pyStr renders values the way CPython str() does", () => {
  assert.equal(pyStr(null), "None");
  assert.equal(pyStr(true), "True");
  assert.equal(pyStr(false), "False");
  assert.equal(pyStr(7214), "7214");
  assert.equal(pyStr(0.5), "0.5");
  assert.equal(pyStr(new Date(Date.UTC(2025, 1, 1))), "2025-02-01 00:00:00");
});

test("isDateValue accepts the three manager date shapes and nothing else", () => {
  assert.equal(isDateValue(new Date(Date.UTC(2025, 1, 1))), true);
  assert.equal(isDateValue("Feb 2025"), true); // EXR
  assert.equal(isDateValue("Feb-2025"), true); // PS
  assert.equal(isDateValue("Feb-26"), true); // CS
  assert.equal(isDateValue("YTD"), false);
  assert.equal(isDateValue("12 Month Total"), false);
  assert.equal(isDateValue("FEB 2025"), false); // case-sensitive, as in Python
  assert.equal(isDateValue("Feb-265"), false);
  assert.equal(isDateValue(45689), false);
  assert.equal(isDateValue(null), false);
});

test("formatDate normalizes to 'Mon YYYY'", () => {
  assert.equal(formatDate(new Date(Date.UTC(2025, 1, 1))), "Feb 2025");
  assert.equal(formatDate("Feb-2025"), "Feb 2025");
  assert.equal(formatDate("Feb-26"), "Feb 2026");
  assert.equal(formatDate("Feb 2025"), "Feb 2025");
  assert.equal(formatDate(null), "");
});

test("formatDate reads a workbook date in UTC so the month never slips", () => {
  // ExcelJS builds dates at UTC midnight. A local-time accessor would report
  // January here for anyone west of UTC.
  assert.equal(formatDate(new Date(Date.UTC(2026, 0, 1))), "Jan 2026");
  assert.equal(formatDate(new Date(Date.UTC(2026, 11, 1))), "Dec 2026");
});

test("parseDateString matches strptime('%b %Y') exactly", () => {
  assert.deepEqual(parseDateString("Feb 2025"), {
    month: 2,
    year: 2025,
    periodDate: new Date(Date.UTC(2025, 1, 1)),
  });
  // strptime is case-insensitive and collapses whitespace
  assert.equal(parseDateString("feb 2025").month, 2);
  assert.equal(parseDateString("Feb  2025").month, 2);
  // ...but rejects a 2-digit year, a full month name, and leading whitespace
  for (const bad of ["Feb 25", "February 2025", " Feb 2025", "", "Foo 2025"]) {
    assert.deepEqual(
      parseDateString(bad),
      { month: null, year: null, periodDate: null },
      `expected ${JSON.stringify(bad)} to fail`,
    );
  }
});

test("pyFloat follows CPython float() coercion rules", () => {
  assert.equal(pyFloat(5), 5);
  assert.equal(pyFloat("5"), 5);
  assert.equal(pyFloat(" 3.5 "), 3.5);
  assert.equal(pyFloat("1e3"), 1000);
  assert.equal(pyFloat(true), 1);
  assert.equal(pyFloat(false), 0);
  // Python raises for these, and every call site treats the raise as "skip"
  assert.equal(pyFloat(""), null);
  assert.equal(pyFloat("abc"), null);
  assert.equal(pyFloat("1,234.50"), null);
  assert.equal(pyFloat("$5"), null);
  assert.equal(pyFloat(new Date()), null);
  assert.equal(pyFloat(null), null);
});

test("isZeroRow skips uncoercible values instead of treating them as zero", () => {
  assert.equal(isZeroRow([null, 0, 0]), true);
  assert.equal(isZeroRow([]), true);
  assert.equal(isZeroRow(["text", null, new Date()]), true);
  assert.equal(isZeroRow([0, 0, 1]), false);
  // a numeric string counts, which is why a row of "7" survives the filter
  assert.equal(isZeroRow(["7"]), false);
  assert.equal(isZeroRow(["0"]), true);
  assert.equal(isZeroRow([-0.0]), true);
});

test("calculateSqFt multiplies the two size dimensions", () => {
  assert.equal(calculateSqFt("10X13"), 130);
  assert.equal(calculateSqFt("5x10"), 50);
  assert.equal(calculateSqFt(" 10 X 13 climate"), 130);
  assert.equal(calculateSqFt("bad size"), null);
  assert.equal(calculateSqFt(null), null);
});

test("cleanLabel and labelMatches compare case-insensitively by prefix", () => {
  assert.equal(cleanLabel("  Net Operating Income  "), "net operating income");
  assert.equal(cleanLabel(null), "");
  // the CS stop label matches by prefix, which is how "(Loss)" still stops it
  assert.equal(labelMatches("Net Operating Income (Loss)", "Net Operating Income"), true);
  assert.equal(labelMatches("Operating Income", "Net Operating Income"), false);
});

test("pyRound rounds half to even like CPython round()", () => {
  assert.equal(pyRound(0.625, 0), 1);
  assert.equal(pyRound(12.5, 0), 12); // exact tie -> down to even
  assert.equal(pyRound(2.5, 0), 2); // exact tie -> down to even
  assert.equal(pyRound(-2.5, 0), -2);
  assert.equal(pyRound(0.845, 0), 1);
  assert.equal(pyRound(1.005, 2), 1);
  assert.equal(pyRound(0.12345, 4), 0.1235);
  assert.equal(pyRound(0.98765432, 4), 0.9877);
});

test("pyFormatPercent0 matches format(x, '.0%')", () => {
  assert.equal(pyFormatPercent0(0.625), "62%"); // 62.5 is an exact tie
  assert.equal(pyFormatPercent0(0.125), "12%");
  assert.equal(pyFormatPercent0(0.845), "84%"); // 0.845 is really 0.84499...
  assert.equal(pyFormatPercent0(0.8571428571428571), "86%");
  assert.equal(pyFormatPercent0(0.8181818181818182), "82%");
  assert.equal(pyFormatPercent0(0.5), "50%");
  assert.equal(pyFormatPercent0(1.0), "100%");
});

test("pySum reproduces CPython's compensated float sum", () => {
  // naive left-to-right addition gives 0.9999999999999999 here
  assert.equal(pySum([0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1]), 1.0);
  // naive addition loses the first 1.0 entirely
  assert.equal(pySum([1e16, 1.0, -1e16, 1.0]), 2.0);
  assert.equal(pySum([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]), 4.5);
  assert.equal(pySum([]), 0);
});

/* ---------------------------------- difflib ------------------------------- */

test("sequenceMatcherRatio matches difflib.SequenceMatcher(None, a, b).ratio()", () => {
  const cases: Array<[string, string, number]> = [
    ["electricty", "electricity", 0.9523809523809523],
    ["rental income", "rental income - parking", 0.7222222222222222],
    ["", "abc", 0.0],
    ["abc", "abc", 1.0],
    ["zzzqqq unknown account", "other income", 0.23529411764705882],
    ["management fee - esmi", "management fees", 0.8333333333333334],
    ["payroll tax", "payroll", 0.7777777777777778],
    ["net operating income (loss)", "net operating income", 0.851063829787234],
    ["bank fees", "bank charges", 0.6666666666666666],
  ];
  for (const [a, b, expected] of cases) {
    assert.equal(sequenceMatcherRatio(a, b), expected, `${a} | ${b}`);
  }
  // both empty is defined as a perfect match
  assert.equal(sequenceMatcherRatio("", ""), 1.0);
});

/* --------------------------------- coaMapper ------------------------------ */

test("normalizeLabel strips GL account codes from either end", () => {
  assert.equal(normalizeLabel("Rental Income (4000)"), "rental income");
  assert.equal(normalizeLabel("Payroll Tax (5090/5091)"), "payroll tax");
  assert.equal(normalizeLabel("  Late   Fees  "), "late fees");
  // CubeSmart puts the code in front of the name instead
  assert.equal(normalizeLabel("6184 Electric"), "electric");
  assert.equal(normalizeLabel("4700 Discounts Charged - Rent"), "discounts charged - rent");
  // a name that merely starts with digits keeps them - no space after the digits
  assert.equal(normalizeLabel("401K Match (5035)"), "401k match");
  // fewer than four digits is a quantity, not an account code
  assert.equal(normalizeLabel("13 Month Free"), "13 month free");
  // a parenthetical that is not a GL code is left alone
  assert.equal(normalizeLabel("Net Operating Income (Loss)"), "net operating income (loss)");
  assert.equal(normalizeLabel(null), "");
});

test("COA mapper step 1: exact approved match", () => {
  const result = new CoaMapper("exr").map("Rental Income (4000)");
  assert.equal(result.matchMethod, "exact_approved");
  assert.equal(result.confidence, 1);
  assert.equal(result.coa, "Rental Income");
  assert.equal(result.accountType, "Income");
  assert.equal(result.reviewRequired, false);
});

test("COA mapper step 2: normalized match explains itself in the notes", () => {
  const result = new CoaMapper("exr").map("rental income (4000)");
  assert.equal(result.matchMethod, "normalized");
  assert.equal(result.confidence, 0.95);
  assert.equal(result.reviewRequired, false);
  assert.ok(result.notes.startsWith("Normalized match for 'Rental Income (4000)'"));
});

test("COA mapper step 3: alias match", () => {
  const result = new CoaMapper("exr").map("Mgmt Fee");
  assert.equal(result.matchMethod, "alias");
  assert.equal(result.confidence, 0.85);
  assert.equal(result.coa, "Current Mgmt. Fee");
  assert.equal(result.reviewRequired, false);
  assert.ok(result.notes.startsWith("Alias match: 'Mgmt Fee' -> 'Management Fee - ESMI (5100)'"));
});

test("COA mapper step 4: fuzzy match is always flagged and scored at 0.9x", () => {
  const result = new CoaMapper("exr").map("Electricty (5300)");
  assert.equal(result.matchMethod, "fuzzy");
  assert.equal(result.coa, "Utilities");
  assert.equal(result.confidence, 0.8571); // round(0.9523809523809523 * 0.9, 4)
  assert.equal(result.reviewRequired, true); // flagged despite clearing 0.85
  assert.equal(
    result.notes,
    "Fuzzy match (95% similarity) against 'Electricity (5300)' — confirm this is correct",
  );
});

test("COA mapper step 5: no match", () => {
  const result = new CoaMapper("exr").map("Zzzqqq Unknown Account");
  assert.equal(result.matchMethod, "no_match");
  assert.equal(result.confidence, 0);
  assert.equal(result.coa, "");
  assert.equal(result.reviewRequired, true);
  assert.ok(result.notes.startsWith("No mapping found"));
});

test("COA mapper flags EXR_Rollup rows but not PS_Rollup rows", () => {
  const exrRollup = new CoaMapper("exr").map("Payroll");
  assert.equal(exrRollup.accountType, "EXR_Rollup");
  assert.equal(exrRollup.confidence, 1);
  assert.equal(exrRollup.reviewRequired, true);
  assert.ok(exrRollup.notes.includes("do not aggregate"));

  // The rollup check tests for EXR_ROLLUP specifically, so a PS subtotal is
  // auto-accepted. Preserved deliberately: it is what the source tool does.
  const psRollup = new CoaMapper("ps").map("Total Revenue");
  assert.equal(psRollup.accountType, "PS_Rollup");
  assert.equal(psRollup.reviewRequired, false);
});

test("COA mapper only sees the table for its own manager", () => {
  // "Tenant Insurance RMASA Fee" is a PS label; EXR has to fall through to fuzzy
  assert.equal(new CoaMapper("ps").map("Tenant Insurance RMASA Fee").matchMethod, "exact_approved");
  assert.notEqual(
    new CoaMapper("exr").map("Tenant Insurance RMASA Fee").matchMethod,
    "exact_approved",
  );
  // "6184 Electric" is a CS label; EXR has no entry that matches it exactly
  assert.equal(new CoaMapper("cs").loaded, true);
  assert.equal(new CoaMapper("cs").map("6184 Electric").matchMethod, "exact_approved");
  assert.notEqual(new CoaMapper("exr").map("6184 Electric").matchMethod, "exact_approved");
});

test("COA mapper resolves a CubeSmart account after its GL code is renumbered", () => {
  const renumbered = new CoaMapper("cs").map("6185 Water/Sewer");
  assert.equal(renumbered.matchMethod, "normalized");
  assert.equal(renumbered.confidence, 0.95);
  assert.equal(renumbered.coa, "Utilities");
  assert.equal(renumbered.reviewRequired, false);

  // a chart that drops the code altogether lands on the same row
  assert.equal(new CoaMapper("cs").map("Water/Sewer").coa, "Utilities");
  // and an ampersand respaced between store charts resolves through the aliases
  const alias = new CoaMapper("cs").map("R&M Doors");
  assert.equal(alias.matchMethod, "alias");
  assert.equal(alias.coa, "Repairs & Maintenance");
});

test("COA mapper flags CubeSmart subtotals for review", () => {
  const rollup = new CoaMapper("cs").map("Net Operating Income (Loss)");
  assert.equal(rollup.accountType, "CS_Rollup");
  assert.equal(rollup.coa, "Net Operating Income");
  assert.equal(rollup.confidence, 1);
  assert.equal(rollup.reviewRequired, true);
  // its own note already says it, so the EXR-worded suffix is not appended
  assert.ok(rollup.notes.includes("do not aggregate"));
  assert.ok(!rollup.notes.includes("EXR-calculated"));

  // a subtotal whose group spans several COA lines carries no COA at all
  const mixed = new CoaMapper("cs").map("Total Fees");
  assert.equal(mixed.coa, "");
  assert.equal(mixed.reviewRequired, true);
});

test("COA mapper maps unique labels in first-appearance order", () => {
  const lookup = new CoaMapper("exr").mapUniqueFromRows([
    { label: "Late Fees (4300)", values: [] },
    { label: "Rental Income (4000)", values: [] },
    { label: "Late Fees (4300)", values: [] },
    { label: "", values: [] },
  ]);
  assert.deepEqual([...lookup.keys()], ["Late Fees (4300)", "Rental Income (4000)"]);
});

/* ------------------------------- cell coercion ---------------------------- */

test("cellToValue reduces ExcelJS values to what data_only=True returns", () => {
  assert.equal(cellToValue(null), null);
  assert.equal(cellToValue(undefined), null);
  assert.equal(cellToValue(5), 5);
  assert.equal(cellToValue("x"), "x");
  // a formula resolves to its cached result
  assert.equal(cellToValue({ formula: "SUM(A1:A2)", result: 12 }), 12);
  assert.equal(cellToValue({ sharedFormula: "A1", result: "ok" }), "ok");
  // no cached result means openpyxl would have returned None
  assert.equal(cellToValue({ formula: "SUM(A1:A2)" }), null);
  // a cached error surfaces as its literal code
  assert.equal(cellToValue({ formula: "1/0", result: { error: "#DIV/0!" } }), "#DIV/0!");
  assert.equal(cellToValue({ richText: [{ text: "a" }, { text: "b" }] }), "ab");
  assert.equal(cellToValue({ text: "label", hyperlink: "https://example.com" }), "label");
});

test("loadExcelJS resolves the packaged ExcelJS module", () => {
  assert.equal(typeof loadExcelJS().Workbook, "function");
});

/* ------------------------------ EXR extractors ---------------------------- */

const EXR_DATES: CellValue[] = [
  new Date(Date.UTC(2025, 0, 1)),
  new Date(Date.UTC(2025, 1, 1)),
  new Date(Date.UTC(2025, 2, 1)),
  new Date(Date.UTC(2025, 3, 1)),
  new Date(Date.UTC(2025, 4, 1)),
  new Date(Date.UTC(2025, 5, 1)),
];

function exrRollingIsGrid(): SheetGrid {
  return [
    ["Owner Financials", null, null, null, null, null, null, null],
    [null, null, ...EXR_DATES, "YTD"],
    [null, "Average Sq. Ft. Occupancy (9992)", 0.8, 0.8, 0.8, 0.8, 0.8, 0.8, 4.8],
    [null, null, null, null, null, null, null, null, null],
    [null, "Rental Income (4000)", 100, 100, 100, 100, 100, 100, 600],
    [null, "Late Fees (4300)", 0, 0, 0, 0, 0, 0, 0],
    [null, "Other Fees (4305)", "7", "7", "7", "7", "7", "7", "42"],
    [null, "Net Operating Income", 50, 50, 50, 50, 50, 50, 300],
    [null, "Below The Line", 999, 999, 999, 999, 999, 999, 5994],
  ];
}

test("extractRollingIs finds the header, drops zero rows, and stops at NOI", () => {
  const { dates, rows } = extractRollingIs(exrRollingIsGrid());
  assert.deepEqual(dates, ["Jan 2025", "Feb 2025", "Mar 2025", "Apr 2025", "May 2025", "Jun 2025"]);
  assert.ok(rows);
  // starts at the occupancy row, drops the all-zero Late Fees row, keeps the
  // numeric-string row, and never reaches "Below The Line"
  assert.deepEqual(rows.map((row) => row.label), [
    "Average Sq. Ft. Occupancy (9992)",
    "Rental Income (4000)",
    "Other Fees (4305)",
    "Net Operating Income",
  ]);
  // the trailing YTD column is excluded from the monthly values
  assert.deepEqual(rows[1].values, [100, 100, 100, 100, 100, 100]);
});

test("extractRollingIs reports the header without rows when the start label is absent", () => {
  const grid = exrRollingIsGrid();
  grid[2][1] = "Something Else";
  const { dates, rows } = extractRollingIs(grid);
  assert.deepEqual(dates?.length, 6);
  assert.equal(rows, null);
});

test("extractRollingIs needs five dates in a row to call it a header", () => {
  const grid: SheetGrid = [
    [null, null, ...EXR_DATES.slice(0, 4)],
    [null, "Average Sq. Ft. Occupancy (9992)", 1, 1, 1, 1],
  ];
  assert.deepEqual(extractRollingIs(grid), { dates: null, rows: null });
});

test("extractPropertyNumber pulls the digits out of the sheet name", () => {
  assert.equal(extractPropertyNumber("Rolling IS 7214", "Rolling IS"), "7214");
  assert.equal(extractPropertyNumber("Rent Roll 7214 (b)", "Rent Roll"), "7214");
  assert.equal(extractPropertyNumber("Ops Sum", "Ops Sum"), "UNKNOWN");
});

test("extractUnitRate reads the first numeric cell to the right of each label", () => {
  const metrics = extractUnitRate([
    [null, "Units Available", 500, null],
    [null, "Sq Ft Rented", "n/a", 41250],
    [null, "Sq Ft Available", null, null, null, null, null, 60000],
    [null, "Unrelated", 1],
  ]);
  // Sq Ft Available's value sits more than four columns away, so it is not found
  assert.deepEqual(metrics, { "Units Available": 500, "Sq Ft Rented": 41250 });
});

test("extractOpsSum keeps only known labels and stores the canonical spelling", () => {
  const { dates, rows } = extractOpsSum([
    ["Ops Summary"],
    [null, null, "Jan 2025", "Feb 2025", "Mar 2025", "Apr 2025", "May 2025"],
    ["rentals during month", null, 1, 2, 3, 4, 5],
    ["Something Else", null, 9, 9, 9, 9, 9],
    ["NET RENTALS", null, 6, 7, 8, 9, 10],
  ]);
  assert.deepEqual(dates, ["Jan 2025", "Feb 2025", "Mar 2025", "Apr 2025", "May 2025"]);
  assert.deepEqual(rows?.map((row) => row.label), ["Rentals During Month", "Net Rentals"]);
  assert.deepEqual(rows?.[0].values, [1, 2, 3, 4, 5]);
});

function rentRollGrid(): SheetGrid {
  return [
    ["Rent Roll Detail", null, null, null, null, null, null, null],
    [
      "Tenant Account",
      "Unit #",
      "Move-In Date",
      "Rent Rate",
      "Street Rate",
      "Paid-Thru Date",
      "Status",
      "Size",
      "Type",
    ],
    ["T1", "A101", new Date(Date.UTC(2024, 2, 15)), 120, 130, new Date(Date.UTC(2026, 2, 1)), "Current", "10X13", "SS"],
    ["T2", "A102", new Date(Date.UTC(2024, 4, 1)), 100, 100, new Date(Date.UTC(2026, 2, 1)), "Current", "10X10", "SS"],
    ["T3", "A103", null, null, null, null, "Available", "10X10", "SS"],
    ["T4", "A104", null, 80, 90, null, "Company Use", "10X10", "SS"],
    ["T5", "A105", null, 60, 90, null, "Delinquent", "bad", "SS"],
    [null, null, null, null, null, null, null, null, null],
    ["T6", "A106", null, 1, 2, null, "Current", "10X10", "SS"],
  ];
}

test("extractRentRoll detects the header, skips vacant units, and appends Sq Ft", () => {
  const { headers, dataRows } = extractRentRoll(rentRollGrid());
  assert.deepEqual(headers, [
    "Tenant Account",
    "Unit #",
    "Move-In Date",
    "Rent Rate",
    "Street Rate",
    "Paid-Thru Date",
    "Status",
    "Size",
    "Type",
    "Sq Ft",
  ]);
  assert.ok(dataRows);
  // Available and Company Use are dropped; the blank row ends the table before T6
  assert.deepEqual(dataRows.map((row) => row[0]), ["T1", "T2", "T5"]);
  assert.equal(dataRows[0][9], 130); // 10X13
  assert.equal(dataRows[2][9], null); // unparseable size
});

test("extractRentRoll leaves a null placeholder for a column the file omits", () => {
  const grid = rentRollGrid();
  grid[1] = grid[1].filter((header) => header !== "Street Rate");
  for (let row = 2; row < grid.length; row += 1) {
    grid[row] = grid[row].filter((_, index) => index !== 4);
  }
  const { headers, dataRows } = extractRentRoll(grid);
  assert.equal(headers?.length, 10);
  assert.ok(dataRows);
  // Street Rate keeps its position in the output, filled with null
  assert.equal(dataRows[0][4], null);
});

test("calculateRentRollAnalytics derives PSF, deltas, and the summary block", () => {
  const { headers, dataRows } = extractRentRoll(rentRollGrid());
  assert.ok(headers && dataRows);
  const analytics = calculateRentRollAnalytics(headers, dataRows);
  assert.deepEqual(analytics.headers.slice(-5), [
    "Rent Rate PSF",
    "Street Rate PSF",
    "Delta to Street Rate",
    "Delta PSF",
    "Below Street Rate",
  ]);

  // T1: 120/130 sq ft, street 130
  const t1 = analytics.dataRows[0];
  assert.equal(t1[10], 120 / 130);
  assert.equal(t1[12], 10); // delta to street
  assert.equal(t1[14], 1); // below street flag
  // T2 is at street rate
  assert.equal(analytics.dataRows[1][14], 0);
  // T5 has an unparseable size, so PSF is undefined but the dollar delta is not
  const t5 = analytics.dataRows[2];
  assert.equal(t5[10], null);
  assert.equal(t5[12], 30);

  // Occupied counts Status = Current only (T1, T2); below-street counts T1 and T5
  assert.equal(analytics.summary.occupiedCount, 2);
  assert.equal(analytics.summary.belowStreetCount, 2);
  assert.equal(analytics.summary.pctBelowStreet, 1);
  assert.equal(analytics.summary.totalPositiveDelta, 40);
  assert.equal(analytics.summary.avgPositiveDelta, 20);
  assert.equal(analytics.summary.avgStreetPsf, pySum([1, 1]) / 2);
});

test("calculateRentRollAnalytics leaves ratios null when there is nothing to divide", () => {
  const analytics = calculateRentRollAnalytics(["Rent Rate", "Street Rate", "Sq Ft", "Status"], []);
  assert.equal(analytics.summary.occupiedCount, 0);
  assert.equal(analytics.summary.pctBelowStreet, null);
  assert.equal(analytics.summary.totalPositiveDelta, 0);
  assert.equal(analytics.summary.avgPositiveDelta, null);
  assert.equal(analytics.summary.avgRentPsf, null);
  assert.equal(analytics.summary.avgStreetPsf, null);
});

/* ------------------------------- PS extractors ---------------------------- */

test("extractPsPropertyNumber reads the leading digits of B3", () => {
  const grid: SheetGrid = [[], [], [null, "77712 - Wentworth (Vacaville, CA)"]];
  assert.equal(extractPsPropertyNumber(grid), "77712");
  assert.equal(extractPsPropertyNumber([[], [], [null, "Wentworth"]]), "");
  assert.equal(extractPsPropertyNumber([[], [], []]), "");
});

test("extractPsRollingIs skips section headers and stops at NOI", () => {
  const grid: SheetGrid = [
    [], [], [null, "77712 - Wentworth"], [], [], [],
    [null, null, "Jan-2025", "Feb-2025", "Mar-2025", "Apr-2025", "May-2025", "YTD"],
    [],
    [null, "Revenue", null, null, null, null, null, null],
    [null, "Rental Income", 100, 100, 100, 100, 100, 500],
    [null, "Other Expenses", null, null, null, null, null, null],
    [null, "Bank Charges", 0, 0, 0, 0, 0, 0],
    [null, "Net Operating Income", 90, 90, 90, 90, 90, 450],
    [null, "Other items", 5, 5, 5, 5, 5, 25],
  ];
  const { dates, rows } = extractPsRollingIs(grid);
  assert.deepEqual(dates, ["Jan 2025", "Feb 2025", "Mar 2025", "Apr 2025", "May 2025"]);
  assert.deepEqual(rows?.map((row) => row.label), ["Rental Income", "Net Operating Income"]);
});

test("extractPsRentRollOccupancy counts column C from row 8 to the first gap", () => {
  const grid: SheetGrid = [];
  for (let row = 0; row < 7; row += 1) grid.push([null, null, null]);
  grid.push([null, null, 10000]);
  grid.push([null, null, 10001]);
  grid.push([null, null, 10002]);
  grid.push([null, null, null]);
  grid.push([null, null, 99999]); // past the gap - must not be counted
  assert.equal(extractPsRentRollOccupancy(grid), 3);
});

test("extractPsRentRollOccupancy returns null when column C is empty", () => {
  // The real PS export merges Unit # across B:C, so column C holds nothing and
  // the source tool logs a warning rather than inventing an occupancy.
  const grid: SheetGrid = [];
  for (let row = 0; row < 12; row += 1) grid.push([null, `A10${row}`, null]);
  assert.equal(extractPsRentRollOccupancy(grid), null);
  assert.equal(extractPsRentRollOccupancy([]), null);
});

/* ------------------------------- CS extractors ---------------------------- */

test("extractCsPropertyNumber reads the leading digits of O1", () => {
  const row: CellValue[] = new Array<CellValue>(15).fill(null);
  row[14] = "3534 CUBESMART AR LITTLE ROCK PRATT RD";
  assert.equal(extractCsPropertyNumber([row]), "3534");
});

test("extractCsRollingIs normalizes 2-digit years and drops zero-NOI months", () => {
  const grid: SheetGrid = [
    [null, null, "Jan-26", "Feb-26", "Mar-26", "Apr-26", "May-26", "Jun-26", "12 Month Total"],
    [],
    [null, "Rental Income", 10, 20, 30, 40, 0, 0, 100],
    [null, "Discounts Charged", 0, 0, 0, 0, 0, 0, 0],
    [null, "Net Operating Income (Loss)", 5, 6, 7, 8, 0, 0, 26],
    [null, "Below The Line", 1, 1, 1, 1, 1, 1, 6],
  ];
  const { dates, rows } = extractCsRollingIs(grid);
  // May and Jun have zero NOI, so those columns leave both the dates and the rows
  assert.deepEqual(dates, ["Jan 2026", "Feb 2026", "Mar 2026", "Apr 2026"]);
  assert.deepEqual(rows?.map((row) => row.label), [
    "Rental Income",
    "Net Operating Income (Loss)",
  ]);
  assert.deepEqual(rows?.[0].values, [10, 20, 30, 40]);
});

test("extractCsRollingIs keeps every month when the NOI row is fully populated", () => {
  const grid: SheetGrid = [
    [null, null, "Jan-26", "Feb-26", "Mar-26", "Apr-26", "May-26", "Jun-26"],
    [null, "Rental Income", 10, 20, 30, 40, 50, 60],
    [null, "Net Operating Income (Loss)", 1, 2, 3, 4, 5, 6],
  ];
  const { dates, rows } = extractCsRollingIs(grid);
  assert.equal(dates?.length, 6);
  assert.equal(rows?.[0].values.length, 6);
});

test("extractCsPropertyNumber falls back to the banner column the sheet actually uses", () => {
  // K1 on the Rent Roll, not O1
  const row: CellValue[] = new Array<CellValue>(11).fill(null);
  row[10] = "6935 CUBESMART MI DEARBORN S COMMERCE DRIVE";
  assert.equal(extractCsPropertyNumber([row]), "6935");
  // a bare number is not a store banner - it needs a name after it
  assert.equal(extractCsPropertyNumber([[null, 6935]]), "");
  assert.equal(extractCsPropertyNumber([]), "");
});

test("calculateCubeSqFt handles zero-padded and half-foot cube dimensions", () => {
  assert.equal(calculateCubeSqFt("05X05"), 25);
  assert.equal(calculateCubeSqFt("10X15"), 150);
  assert.equal(calculateCubeSqFt("7.5X10"), 75); // calculateSqFt rejects this one
  assert.equal(calculateSqFt("7.5X10"), null);
  assert.equal(calculateCubeSqFt("Parking"), null);
  assert.equal(calculateCubeSqFt(null), null);
});

test("extractCsUnitRate reads the Cube Mix totals row", () => {
  const grid: SheetGrid = [
    ["Store", "Cube Dimensions", "Cube SqFt", "Total Cubes", "Total SqFt", "Occupied Cubes", "Occupied SqFt "],
    ["6935", "05X05", "25", 26, 650, 14, 350],
    ["6935", "10X10", "100", 33, 3300, 24, 2400],
    ["Total", null, null, 59, 3950, 38, 2750],
  ];
  assert.deepEqual(extractCsUnitRate(grid), {
    "Units Available": 59,
    "Sq Ft Available": 3950,
    "Units Rented": 38,
    "Sq Ft Rented": 2750,
  });
});

test("extractCsUnitRate sums the cube types when the totals row is missing", () => {
  const grid: SheetGrid = [
    ["Store", "Total Cubes", "Total SqFt", "Occupied Cubes", "Occupied SqFt"],
    ["6935", 26, 650, 14, 350],
    ["6935", 33, 3300, 24, 2400],
  ];
  assert.deepEqual(extractCsUnitRate(grid), {
    "Units Available": 59,
    "Sq Ft Available": 3950,
    "Units Rented": 38,
    "Sq Ft Rented": 2750,
  });
  assert.deepEqual(extractCsUnitRate([]), {});
});

test("extractCsUnitRate never folds a totals row into the summed fallback", () => {
  // "Grand Total" is not the exact word the totals-row lookup reads, and summing
  // it alongside the rows it totals would double every count
  const grid: SheetGrid = [
    ["Store", "Total Cubes", "Total SqFt", "Occupied Cubes", "Occupied SqFt"],
    ["6935", 26, 650, 14, 350],
    ["6935", 33, 3300, 24, 2400],
    ["Grand Total", 59, 3950, 38, 2750],
  ];
  assert.deepEqual(extractCsUnitRate(grid), {
    "Units Available": 59,
    "Sq Ft Available": 3950,
    "Units Rented": 38,
    "Sq Ft Rented": 2750,
  });
});

test("extractCsUnitRate falls back to the cube types when the totals row is blank", () => {
  const grid: SheetGrid = [
    ["Store", "Total Cubes", "Total SqFt", "Occupied Cubes", "Occupied SqFt"],
    ["6935", 26, 650, 14, 350],
    ["Total", null, null, null, null],
  ];
  assert.deepEqual(extractCsUnitRate(grid), {
    "Units Available": 26,
    "Sq Ft Available": 650,
    "Units Rented": 14,
    "Sq Ft Rented": 350,
  });
});

test("extractCsOpsSum renames the rental activity rows and ignores later blocks", () => {
  const grid: SheetGrid = [
    ["RENTAL ACTIVITY"],
    [null, "Jan-2026", "Feb-2026", "Mar-2026", "Apr-2026", "May-2026", "Jun-2026"],
    ["Total Cubes Available", 913, 913, 897, 897, 889, 831],
    ["Rented During Month", 50, 53, 75, 66, 59, 35],
    ["Vacated During Month", 44, 40, 108, 37, 48, 47],
    ["Net Rentals", 6, 13, -33, 29, 11, -12],
    ["Cubes Occupied at EOM", 684, 697, 664, 693, 704, 692],
    ["Churn %", 0.065, 0.058, 0.155, 0.056, 0.069, 0.067],
    // a second block further down must not overwrite the values above
    ["Net Rentals", 1, 1, 1, 1, 1, 1],
  ];
  const { dates, rows } = extractCsOpsSum(grid);
  assert.deepEqual(dates, [
    "Jan 2026",
    "Feb 2026",
    "Mar 2026",
    "Apr 2026",
    "May 2026",
    "Jun 2026",
  ]);
  assert.deepEqual(rows?.map((row) => row.label), [
    "Total Cubes Available",
    "Rentals During Month",
    "Vacates During Month",
    "Net Rentals",
    "Cubes Occupied at EOM",
  ]);
  assert.deepEqual(rows?.[3].values, [6, 13, -33, 29, 11, -12]);
});

test("extractCsRentRoll renames the CubeSmart columns and derives Sq Ft", () => {
  const grid: SheetGrid = [
    [
      "Store",
      "Cube",
      "Cube Dimensions",
      "Cube Attribute",
      "Customer",
      "Move In Date",
      "Paid Thru Date",
      "Rent Rate",
      "Net Effective Rate",
      "Internet Rate",
      "Full Price",
    ],
    [6935, "11000", "7.5X10", "CDP", "YOLANDA DAVIS", "2025-02-23", "2026-06-30", 90, 57.05, 70.5, 141],
    [6935, "11001", "10X09", "CDN", "HANNA ALKHOLANY", "2025-02-22", "2026-06-30", 130, 74.82, 80, 160],
    [null, null, null, null, null, null, null, null, null, null, null],
    [6935, "11002", "05X05", "CDP", "NEVER REACHED", "2025-05-26", "2026-07-31", 106, 22.91, 28.5, 57],
  ];
  const { headers, dataRows } = extractCsRentRoll(grid);
  assert.deepEqual(headers, [
    "Tenant Account",
    "Unit #",
    "Move-In Date",
    "Rent Rate",
    "Street Rate",
    "Paid-Thru Date",
    "Status",
    "Size",
    "Type",
    "Sq Ft",
    "Net Effective Rate",
    "Internet Rate",
  ]);
  // the blank row ends the table, so the row after it is not read
  assert.equal(dataRows?.length, 2);
  assert.deepEqual(dataRows?.[0], [
    "YOLANDA DAVIS",
    "11000",
    "2025-02-23",
    90,
    141, // Street Rate comes from Full Price, not Internet Rate
    "2026-06-30",
    "Current",
    "7.5X10",
    "CDP",
    75,
    57.05,
    70.5,
  ]);

  // and the renamed columns feed the shared mark-to-market pass
  const analytics = calculateRentRollAnalytics(headers ?? [], dataRows ?? []);
  assert.equal(analytics.summary.occupiedCount, 2);
  assert.equal(analytics.summary.belowStreetCount, 2);
  assert.equal(analytics.summary.totalPositiveDelta, 81);
});

test("extractCsRentRoll skips a trailing totals row however it is spelled", () => {
  // Status is stamped on every surviving row, so a subtotal that slipped
  // through would be counted as an occupied tenant
  const grid: SheetGrid = [
    ["Store", "Cube", "Cube Dimensions", "Customer", "Rent Rate", "Full Price"],
    [6935, "11000", "05X05", "A TENANT", 30, 57],
    [null, "Totals", null, null, 30, 57],
    [null, "Grand Total", null, null, 30, 57],
  ];
  const { dataRows } = extractCsRentRoll(grid);
  assert.equal(dataRows?.length, 1);
  assert.equal(dataRows?.[0][0], "A TENANT");
});

test("extractCsRentRoll reports no header when the sheet is not a rent roll", () => {
  assert.deepEqual(extractCsRentRoll([["Store", "Cube Dimensions"]]), {
    headers: null,
    dataRows: null,
  });
  assert.deepEqual(extractCsRentRoll([]), { headers: null, dataRows: null });
});
