import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import PizZip from "pizzip";
import * as XLSX from "xlsx";
import {
  buildPackageFileName,
  parsePropertyAnalysisWorkbook,
  renderPropertyAnalysisPackage,
  scanPackageTemplateTokens,
} from "../src/lib/propertyAnalysisPackage";

function buildWentworthWorkbookBuffer(): Buffer {
  const workbook = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      [""],
      ["", "Wentworth"],
      ["", "1351 Baseline Road, Roseville, CA 95747"],
      ["", "Deal No:", "", "10064-51018"],
      ["", "Property Type:", "Occupied"],
      [""],
      ["", "Storage/Mini"],
      ["", "Number of units", "", "688", "", "", "Monthly market rate (Per sq ft)", "", "$1.36"],
      ["", "Net rentable square feet", "", "96,755", "", "", "Monthly projected rate (Per sq ft)", "", "$1.18"],
      ["", "Current sq ft occupancy", "", "97.30%", "", "", "Projected market rent growth (Annually)", "", "6%"],
      [""],
      ["", "Revenues/Fees"],
      ["", "Tenant Insurance revenue per occupied unit on the last day of the month (only for mini and locker units)", "", "", "", "", "", "", "$4"],
    ]),
    "Property Data",
  );

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ["", "", "Year 1", "Year 2", "Year 3", "Year 4", "Year 5"],
      ["", "Year-end projected sq ft occupancy", "97%", "97%", "97%", "97%", "97%"],
      ["", "Total Revenue", "1,373,860", "1,545,366", "1,678,020", "1,815,014", "1,923,253"],
    ]),
    "5 Year Summary",
  );

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ["", "Month 1", "Month 2", "Month 3", "Month 4", "Month 5", "Month 6", "Month 7", "Month 8", "Month 9", "Month 10", "Month 11", "Month 12"],
      ["", "Projected sq ft occupancy", "97.3%", "97.3%", "97.3%", "97.3%", "97.3%", "97.3%", "97.3%", "97.3%", "97.3%", "97.3%", "97.3%", "97.3%"],
      ["", "Total Revenue", "106,738", "107,792", "108,817", "109,816", "110,791", "111,743", "117,549", "118,426", "119,288", "120,136", "121,001", "121,900"],
    ]),
    "5 Year Model",
  );

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ["", "Wentworth"],
      ["", "1351 Baseline Road, Roseville, CA 95747"],
      ["", "Annual estimated stabilized results under Public Storage"],
      ["", "Revenue"],
      ["", "Total Revenue", "1,465,318"],
    ]),
    "Stabilized Results",
  );

  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

function buildPublicTemplateWorkbookBuffer(options?: { includeProforma?: boolean; includeExitCap?: boolean }): Buffer {
  const workbook = XLSX.utils.book_new();
  const includeProforma = options?.includeProforma ?? true;
  const includeExitCap = options?.includeExitCap ?? true;

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ["Name", "Abernathey Holdings - Gilbert Property"],
      ["Type", "Climate Controlled"],
      ["Location", "1161 S Higley Rd, Gilbert, AZ, 85296"],
      ["Units Available", "706"],
      ["Units Occupied", "614"],
      ["NRSF", "69945"],
      ["Purchase Price", "$12,000,000"],
      ["Loan-to-Cost (LTC)", "55.00%"],
      ["Loan Amount", "$6,679,750"],
      ["All-In Rate", "6.50%"],
      ["Total CapEx", "$1,500,000"],
      ...(includeExitCap ? [["Exit Cap Rate", "6.25%"]] : []),
    ]),
    "Inputs & Drivers",
  );

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ["", "Year 1", "Year 2", "Year 3", "Year 4", "Year 5"],
      ["Rental Income", "1,000,000", "1,050,000", "1,100,000", "1,150,000", "1,200,000"],
      ["Total Operating Income", "1,250,000", "1,310,000", "1,375,000", "1,430,000", "1,500,000"],
      ["Expenses", "400,000", "410,000", "420,000", "435,000", "450,000"],
    ]),
    "5 Year Proforma",
  );

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ["", "Month 0", "Month 1", "Month 2", "Month 3", "Month 4", "Month 5", "Month 6", "Month 7", "Month 8", "Month 9", "Month 10", "Month 11"],
      ["Projected Rate ($/sqft)", "$16.80", "$16.90", "$17.00", "$17.10", "$17.20", "$17.30", "$17.40", "$17.50", "$17.60", "$17.70", "$17.80", "$17.90"],
      ["Occupied Units", "600", "610", "615", "620", "625", "630", "635", "640", "645", "650", "655", "660"],
      ["Physical Occupancy", "85.0%", "86.0%", "87.0%", "87.8%", "88.5%", "89.2%", "90.0%", "90.6%", "91.4%", "92.1%", "92.8%", "93.5%"],
      ["Net Rental Income", "90,000", "92,000", "94,000", "95,500", "97,000", "98,500", "100,000", "101,500", "103,000", "104,500", "106,000", "107,500"],
    ]),
    "Model2.0",
  );

  const valuationRows: string[][] = Array.from({ length: 48 }, () => []);
  valuationRows[0] = ["Valuation Summary"];
  valuationRows[1] = ["Purchase Price", "$12,000,000"];
  valuationRows[2] = ["Going-In Cap Rate", "5.25%"];
  valuationRows[3] = ["All-In Interest Rate (SOFR+220bps)", "6.50%"];
  valuationRows[4] = ["LTC", "55.00%"];
  valuationRows[5] = ["Loan Amount", "$6,679,750"];
  valuationRows[6] = ["Equity Required", "$5,320,250"];
  valuationRows[7] = ["Total CapEx", "$1,500,000"];
  valuationRows[8] = ["NRSF", "69945"];
  valuationRows[9] = ["Price / SqFt", "$171.57"];
  valuationRows[10] = ["Asset Mgmt Fee", "2.00%"];
  valuationRows[35] = ["", "3-Year Hold", "5-Year Hold", "7-Year Hold"];
  valuationRows[39] = ["Gross Sale Price / Price Per Square Foot", "$13,149,782 / $188", "$13,632,399 / $195", "$14,183,148 / $203"];
  valuationRows[46] = ["Levered IRR", "8.7%", "8.7%", "9.0%"];
  valuationRows[47] = ["Equity Multiple", "1.28x", "1.49x", "1.77x"];

  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(valuationRows), "Valuation Sheet");

  if (includeProforma) {
    const proformaRows: string[][] = Array.from({ length: 48 }, () => []);
    proformaRows[7] = ["", "", "", "Income", "T-12 Avg", "T-12", "Apr-26", "May-26", "Jun-26", "Jul-26", "Aug-26", "Sep-26", "Oct-26", "Nov-26", "Dec-26", "Jan-27", "Feb-27", "Mar-27", "", "Current Mgmt", "IMPACT TO N.O.I", "", "", ""];
    proformaRows[20] = ["", "", "", "Total Operating Income", "$70,392", "$844,708", "$73,068", "$74,288", "$75,180", "$79,732", "$84,336", "$88,992", "$91,436", "$93,908", "$96,407", "$98,935", "$101,364", "$103,821", "$1,061,466", "$968,421", "$93,045", "9.61%"];
    proformaRows[44] = ["", "", "", "Total Operating Expense", "$29,675", "$356,103", "$29,725", "$29,770", "$29,802", "$29,979", "$30,159", "$30,341", "$30,435", "$30,529", "$30,625", "$30,721", "$30,819", "$30,917", "$363,822", "$376,649", "$12,827", "3.41%"];
    proformaRows[46] = ["", "", "", "Net Operating Income", "$40,717", "$488,605", "$43,342", "$44,518", "$45,378", "$49,752", "$54,176", "$58,651", "$61,001", "$63,379", "$65,783", "$68,214", "$70,545", "$72,904", "$697,644", "$591,772", "$105,871", "17.89%"];
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(proformaRows), "Proforma");
  }

  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

function buildTemplateBuffer(): Buffer {
  const zip = new PizZip();
  zip.file("ppt/slides/slide1.xml", "<a:t>{{PUBLISHMONTHYEAR}}</a:t>");
  zip.file(
    "ppt/slides/slide2.xml",
    "<a:t>{{3YIRR}}</a:t><a:t>{{3YMUL}}</a:t><a:t>{{5YIRR}}</a:t><a:t>{{5YMUL}}</a:t><a:t>{{7YIRR}}</a:t><a:t>{{7YMUL}}</a:t><a:t>{{ASSETVALUE}}</a:t><a:t>{{NOIPERCENT}}</a:t><a:t>{{EXPREDPERC}}</a:t><a:t>{{REVENUELIFT}}</a:t>",
  );
  zip.file(
    "ppt/slides/slide3.xml",
    "<a:t>{{OCCPER}}</a:t><a:t>{{RENTSQFT}}</a:t><a:t>{{UNITS}}</a:t><a:t>{{RATING}}</a:t><a:t>{{REVIEWS}}</a:t><a:t>{{SNAPSHOTDESCRIPTION}}</a:t>",
  );
  return Buffer.from(zip.generate({ type: "uint8array" }));
}

const TEST_TEMPLATE_PATH = path.join(process.cwd(), "tmp", "property-analysis-package-test-template.pptx");

test("scanPackageTemplateTokens returns the 17-token contract", async () => {
  await fs.mkdir(path.dirname(TEST_TEMPLATE_PATH), { recursive: true });
  await fs.writeFile(TEST_TEMPLATE_PATH, buildTemplateBuffer());

  const tokens = await scanPackageTemplateTokens({ templatePath: TEST_TEMPLATE_PATH });

  assert.deepEqual(tokens, [
    "3YIRR",
    "3YMUL",
    "5YIRR",
    "5YMUL",
    "7YIRR",
    "7YMUL",
    "ASSETVALUE",
    "EXPREDPERC",
    "NOIPERCENT",
    "OCCPER",
    "PUBLISHMONTHYEAR",
    "RATING",
    "RENTSQFT",
    "REVENUELIFT",
    "REVIEWS",
    "SNAPSHOTDESCRIPTION",
    "UNITS",
  ]);
});

test("parsePropertyAnalysisWorkbook maps Wentworth workbooks to physical tokens and leaves return profile manual", async () => {
  await fs.mkdir(path.dirname(TEST_TEMPLATE_PATH), { recursive: true });
  await fs.writeFile(TEST_TEMPLATE_PATH, buildTemplateBuffer());

  const parsed = await parsePropertyAnalysisWorkbook(buildWentworthWorkbookBuffer(), "Wentworth.xlsx", {
    templatePath: TEST_TEMPLATE_PATH,
  });
  const publishMonth = parsed.tokenFields.find((field) => field.token === "PUBLISHMONTHYEAR");
  const occupancy = parsed.tokenFields.find((field) => field.token === "OCCPER");
  const rentableSqft = parsed.tokenFields.find((field) => field.token === "RENTSQFT");
  const totalUnits = parsed.tokenFields.find((field) => field.token === "UNITS");
  const threeYearIrr = parsed.tokenFields.find((field) => field.token === "3YIRR");

  assert.equal(parsed.metadata.workbookType, "wentworth-results");
  assert.equal(publishMonth?.source, "derived");
  assert.match(publishMonth?.defaultValue ?? "", /^[A-Z][a-z]+ \d{4}$/);
  assert.equal(occupancy?.defaultValue, "97.30%");
  assert.equal(rentableSqft?.defaultValue, "96,755");
  assert.equal(totalUnits?.defaultValue, "688");
  assert.equal(threeYearIrr?.source, "manual");
});

test("parsePropertyAnalysisWorkbook maps Public template workbooks to return-profile and physical tokens", async () => {
  await fs.mkdir(path.dirname(TEST_TEMPLATE_PATH), { recursive: true });
  await fs.writeFile(TEST_TEMPLATE_PATH, buildTemplateBuffer());

  const parsed = await parsePropertyAnalysisWorkbook(buildPublicTemplateWorkbookBuffer(), "PublicProformaTemplate3.18.xlsx", {
    templatePath: TEST_TEMPLATE_PATH,
  });
  const threeYearIrr = parsed.tokenFields.find((field) => field.token === "3YIRR");
  const fiveYearMultiple = parsed.tokenFields.find((field) => field.token === "5YMUL");
  const sevenYearIrr = parsed.tokenFields.find((field) => field.token === "7YIRR");
  const occupancy = parsed.tokenFields.find((field) => field.token === "OCCPER");
  const rentableSqft = parsed.tokenFields.find((field) => field.token === "RENTSQFT");
  const totalUnits = parsed.tokenFields.find((field) => field.token === "UNITS");
  const assetValue = parsed.tokenFields.find((field) => field.token === "ASSETVALUE");
  const expenseReduction = parsed.tokenFields.find((field) => field.token === "EXPREDPERC");
  const noiIncrease = parsed.tokenFields.find((field) => field.token === "NOIPERCENT");
  const revenueLift = parsed.tokenFields.find((field) => field.token === "REVENUELIFT");
  const rating = parsed.tokenFields.find((field) => field.token === "RATING");

  assert.equal(parsed.metadata.workbookType, "public-proforma-template");
  assert.equal(threeYearIrr?.defaultValue, "8.7%");
  assert.equal(fiveYearMultiple?.defaultValue, "1.49x");
  assert.equal(sevenYearIrr?.defaultValue, "9.0%");
  assert.equal(assetValue?.defaultValue, "1.7M");
  assert.equal(assetValue?.source, "derived");
  assert.equal(expenseReduction?.defaultValue, "3");
  assert.equal(expenseReduction?.source, "extracted");
  assert.equal(noiIncrease?.defaultValue, "18");
  assert.equal(noiIncrease?.source, "extracted");
  assert.equal(revenueLift?.defaultValue, "93");
  assert.equal(revenueLift?.source, "extracted");
  assert.equal(occupancy?.defaultValue, "86.97%");
  assert.equal(rentableSqft?.defaultValue, "69945");
  assert.equal(totalUnits?.defaultValue, "706");
  assert.equal(rating?.source, "manual");
});

test("parsePropertyAnalysisWorkbook leaves comparison callouts manual and warns when Public workbook comparison data is missing", async () => {
  await fs.mkdir(path.dirname(TEST_TEMPLATE_PATH), { recursive: true });
  await fs.writeFile(TEST_TEMPLATE_PATH, buildTemplateBuffer());

  const parsed = await parsePropertyAnalysisWorkbook(
    buildPublicTemplateWorkbookBuffer({ includeProforma: false, includeExitCap: false }),
    "PublicProformaTemplate3.18.xlsx",
    { templatePath: TEST_TEMPLATE_PATH },
  );
  const assetValue = parsed.tokenFields.find((field) => field.token === "ASSETVALUE");
  const expenseReduction = parsed.tokenFields.find((field) => field.token === "EXPREDPERC");
  const noiIncrease = parsed.tokenFields.find((field) => field.token === "NOIPERCENT");
  const revenueLift = parsed.tokenFields.find((field) => field.token === "REVENUELIFT");

  assert.equal(assetValue?.source, "manual");
  assert.equal(expenseReduction?.source, "manual");
  assert.equal(noiIncrease?.source, "manual");
  assert.equal(revenueLift?.source, "manual");
  assert.match(parsed.warnings.join(" "), /comparison rows/i);
});

test("parsePropertyAnalysisWorkbook rejects unsupported workbooks", async () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["Only one sheet"]]), "Sheet1");
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
  await assert.rejects(
    async () => {
      await parsePropertyAnalysisWorkbook(buffer, "invalid.xlsx");
    },
    /unsupported workbook format/i,
  );
});

test("renderPropertyAnalysisPackage replaces provided tokens and blanks missing ones", async () => {
  await fs.mkdir(path.dirname(TEST_TEMPLATE_PATH), { recursive: true });
  await fs.writeFile(TEST_TEMPLATE_PATH, buildTemplateBuffer());

  const rendered = await renderPropertyAnalysisPackage(
    {
      PUBLISHMONTHYEAR: "March 2026",
      "3YIRR": "26%",
      ASSETVALUE: "5.5M",
      NOIPERCENT: "20",
      EXPREDPERC: "8",
      REVENUELIFT: "178",
      OCCPER: "95%",
      UNITS: "592",
    },
    { templatePath: TEST_TEMPLATE_PATH },
  );
  const zip = new PizZip(rendered);
  const slide1Xml = zip.file("ppt/slides/slide1.xml")?.asText() ?? "";
  const slide2Xml = zip.file("ppt/slides/slide2.xml")?.asText() ?? "";
  const slide3Xml = zip.file("ppt/slides/slide3.xml")?.asText() ?? "";

  assert.match(slide1Xml, /March 2026/);
  assert.match(slide2Xml, /26%/);
  assert.match(slide2Xml, /5\.5M/);
  assert.match(slide2Xml, /20/);
  assert.match(slide2Xml, /8/);
  assert.match(slide2Xml, /178/);
  assert.match(slide3Xml, /95%/);
  assert.match(slide3Xml, /592/);
  assert.doesNotMatch(slide3Xml, /\{\{RATING\}\}/);
});

test("buildPackageFileName creates a stable export name", () => {
  const fileName = buildPackageFileName("Roseville CA (Baseline Rd)", new Date("2026-03-25T12:00:00Z"));
  assert.equal(fileName, "Property-Analysis-Package_Roseville_CA_Baseline_Rd_2026-03-25.pptx");
});
