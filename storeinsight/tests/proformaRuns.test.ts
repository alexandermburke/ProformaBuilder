import assert from "node:assert/strict";
import test from "node:test";
import PizZip from "pizzip";
import * as XLSX from "xlsx";
import {
  buildPublicProformaWorkbookExport,
  PROFORMA_RUN_ID_PLACEHOLDER,
} from "../src/lib/proformaWorkbook";
import {
  detectProformaWorkbookFamily,
  parseProformaWorkbookPreview,
} from "../src/lib/proformaRuns";

function buildPublicWorkbookBuffer(): Buffer {
  const workbook = XLSX.utils.book_new();
  const inputs = XLSX.utils.aoa_to_sheet([["Inputs"]]);
  XLSX.utils.sheet_add_aoa(inputs, [["Gilbert Property"]], { origin: "E5" });
  XLSX.utils.sheet_add_aoa(inputs, [["Storage"]], { origin: "E6" });
  XLSX.utils.sheet_add_aoa(inputs, [["1161 S Higley Rd, Gilbert, AZ, 85296"]], { origin: "E7" });
  XLSX.utils.sheet_add_aoa(inputs, [[706]], { origin: "E8" });
  XLSX.utils.sheet_add_aoa(inputs, [[614]], { origin: "E9" });
  XLSX.utils.sheet_add_aoa(inputs, [[69945]], { origin: "E10" });
  XLSX.utils.sheet_add_aoa(inputs, [["2026-03-01"]], { origin: "E12" });
  XLSX.utils.sheet_add_aoa(inputs, [[5]], { origin: "E13" });
  XLSX.utils.sheet_add_aoa(inputs, [[12000000]], { origin: "E14" });
  XLSX.utils.sheet_add_aoa(inputs, [[0.01]], { origin: "E15" });
  XLSX.utils.sheet_add_aoa(inputs, [[0.55]], { origin: "I13" });
  XLSX.utils.sheet_add_aoa(inputs, [[0.043]], { origin: "I14" });
  XLSX.utils.sheet_add_aoa(inputs, [[0.022]], { origin: "I15" });
  XLSX.utils.sheet_add_aoa(inputs, [[0.065]], { origin: "I16" });
  XLSX.utils.sheet_add_aoa(inputs, [[0.0625]], { origin: "I28" });

  const dataDrop = XLSX.utils.aoa_to_sheet([
    ["Actual/Budget", "Entity", "Account", "Month", "Year", "Period", "Amount ($)", "COA"],
    ["Actual", "A-Gilbert", "Rental Income", 2, 2025, "2025-02-01", 59340.66, "Rental Income"],
    ["Actual", "A-Gilbert", "Discounts", 2, 2025, "2025-02-01", -1200, "Discounts"],
  ]);

  const coa = XLSX.utils.aoa_to_sheet([
    ["Account", "COA", "Top Tier", "Header", "Type"],
    ["Rental Income", "Rental Income", "Net Rental Income", "", "Income"],
    ["Discounts", "Discounts", "", "", "Expense"],
  ]);

  XLSX.utils.book_append_sheet(workbook, inputs, "Inputs & Drivers");
  XLSX.utils.book_append_sheet(workbook, dataDrop, "Data Drop");
  XLSX.utils.book_append_sheet(workbook, coa, "COA Translation");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

function buildExtraWorkbookBuffer(): Buffer {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      [""],
      [""],
      ["", "Rolling 13 Month Income Statement For 8938 - North Charleston - Ashley Phosphate"],
      ["", "Reporting Period: March 2025", "Jan 2025", "Feb 2025", "Mar 2025"],
      [""],
      [""],
      [""],
      [""],
      [""],
      [""],
      ["", "Rental Income (4000)", 100000, 101000, 102000],
      ["", "Discounts Charged (4250)", -1200, -1100, -1000],
      ["", "Manager Payroll (5000)", 9000, 9100, 9200],
    ]),
    "Rolling IS 8938",
  );

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ["Ops Summary Report For 8938 - North Charleston - Ashley Phosphate"],
      ["", "Reporting Period: March 2025"],
      [""],
      ["Metrics", "Jan 2025", "Feb 2025", "Mar 2025"],
      ["Total Units Available", 590, 590, 592],
      ["Total Occupancy %", "95.0%", "95.5%", "96.0%"],
    ]),
    "Ops Sum 8938",
  );

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      [""],
      [""],
      ["", "", "", "Unit Rate Report For 8938 - North Charleston - Ashley Phosphate"],
      ["", "Units Available", "", 592],
      ["", "Units Rented", "", 563],
      ["", "Sq Ft Available", "", 72323],
    ]),
    "Unit Rate 8938",
  );

  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

function buildCubeWorkbookBuffer(): Buffer {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      [""],
      [""],
      [""],
      [""],
      ["Rolling Income Statement"],
      [""],
      [""],
      ["", "Jan-25", "Feb-25", "Mar-25"],
      ["Rental Income", 0, 10046, 26782],
      ["4700 Discounts Charged", -100, -215, -893],
      ["6100 Payroll", 2500, 2600, 2700],
    ]),
    "Rolling Details",
  );

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ["Summary of Rental Experience"],
      [""],
      [""],
      [""],
      [""],
      [""],
      [""],
      [""],
      [""],
      ["", "Jan-2025", "Feb-2025", "Mar-2025"],
      ["Total Cubes Available", 497, 497, 497],
      ["Cubes Occupied at EOM", 320, 314, 308],
      ["SqFt Occupancy", "79.0%", "77.8%", "76.6%"],
    ]),
    "Summary of Rental Experience",
  );

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ["Cube Mix"],
      [""],
      [""],
      [""],
      [""],
      [""],
      [""],
      ["Store", "Cube Dimensions", "Cube Attribute", "Cube SqFt", "Total Cubes", "Total SqFt", "Vacant Cubes", "Reserved Cubes", "Occupied Cubes"],
      [5773, "05X10", "NON", 50, 158, 7900, 64, 1, 71],
      [5773, "10X10", "NON", 100, 113, 11300, 21, 0, 86],
    ]),
    "Cube Mix",
  );

  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

test("detectProformaWorkbookFamily identifies the supported workbook families", () => {
  assert.equal(detectProformaWorkbookFamily(XLSX.read(buildPublicWorkbookBuffer(), { type: "buffer" })), "public");
  assert.equal(detectProformaWorkbookFamily(XLSX.read(buildExtraWorkbookBuffer(), { type: "buffer" })), "extra-space");
  assert.equal(detectProformaWorkbookFamily(XLSX.read(buildCubeWorkbookBuffer(), { type: "buffer" })), "cubesmart");
});

test("parseProformaWorkbookPreview parses Public workbook inputs and fact rows", async () => {
  const parsed = await parseProformaWorkbookPreview({
    buffer: buildPublicWorkbookBuffer(),
    fileName: "PublicProformaTemplate3.18.xlsx",
  });

  assert.equal(parsed.operatorType, "public");
  assert.equal(parsed.propertyName, "Gilbert Property");
  assert.equal(parsed.factRows.length, 2);
  assert.equal(parsed.factRows[0]?.standardizedCoaName, "Rental Income");
  assert.equal(parsed.propertyInputs.find((input) => input.key === "UNITS_AVAILABLE")?.displayValue, "706");
});

test("parseProformaWorkbookPreview parses Extra Space workbooks into normalized rows", async () => {
  const parsed = await parseProformaWorkbookPreview({
    buffer: buildExtraWorkbookBuffer(),
    fileName: "Extra8938 Owner Financials.xlsx",
  });

  assert.equal(parsed.operatorType, "extra-space");
  assert.equal(parsed.propertyName, "North Charleston - Ashley Phosphate");
  assert.equal(parsed.factRows.length, 9);
  assert.equal(parsed.propertyInputs.find((input) => input.key === "NRSF")?.displayValue, "72323");
  assert.equal(parsed.factRows.find((row) => row.operatorAccount.includes("Rental Income"))?.standardizedCoaName, "Rental Income");
  assert.equal(parsed.warnings[0]?.code, "property-address-missing");
});

test("parseProformaWorkbookPreview parses CubeSmart workbooks into normalized rows", async () => {
  const parsed = await parseProformaWorkbookPreview({
    buffer: buildCubeWorkbookBuffer(),
    fileName: "CUBE5773 Financials December 2025.xlsx",
  });

  assert.equal(parsed.operatorType, "cubesmart");
  assert.equal(parsed.propertyName, "CubeSmart 5773");
  assert.equal(parsed.factRows.length, 9);
  assert.equal(parsed.propertyInputs.find((input) => input.key === "UNITS_AVAILABLE")?.displayValue, "497");
  assert.equal(parsed.propertyInputs.find((input) => input.key === "NRSF")?.displayValue, "19200");
  assert.equal(parsed.warnings[0]?.code, "property-address-missing");
});

test("buildPublicProformaWorkbookExport stamps the hidden run id placeholder", async () => {
  const runId = "run-123";
  const { buffer, fileName } = await buildPublicProformaWorkbookExport(runId, "Gilbert Property");
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const zip = new PizZip(buffer);

  assert.match(fileName, /Gilbert_Property_run-123\.xlsx$/);
  assert.equal(workbook.Sheets["DB Config"]?.B2?.v, runId);
  assert.ok(zip.file("xl/workbook.xml")?.asText().includes("proforma_run_id"));
  assert.ok(!zip.file("xl/sharedStrings.xml")?.asText().includes(PROFORMA_RUN_ID_PLACEHOLDER));
});
