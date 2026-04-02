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
      ["Inputs"],
      ["Property Overview"],
      ["Name", "", "", "Abernathey Holdings - Gilbert Property"],
      ["Type", "", "", "Climate Controlled"],
      ["Location", "", "", "1161 S Higley Rd, Gilbert, AZ, 85296"],
      ["Units Available", "", "", "706"],
      ["Units Occupied", "", "", "614"],
      ["NRSF", "", "", "69945"],
      ["Acquisition Assumptions", "", "", "", "", "Financing"],
      ["Purchase Price", "", "", "$12,000,000", "", "SOFR Rate", "", "4.30%"],
      ["Loan-to-Cost (LTC)", "", "", "55.00%", "", "Spread (bps)", "", "2.20%"],
      ["Loan Amount", "", "", "$6,679,750", "", "All-In Rate", "", "6.50%"],
      ["Total CapEx", "", "", "$1,500,000"],
      ...(includeExitCap ? [["", "", "", "", "", "Exit Cap Rate", "", "6.25%"]] : []),
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

  const valuationRows: string[][] = Array.from({ length: 176 }, () => []);
  valuationRows[0] = ["Valuation Summary"];
  valuationRows[3] = ["", "", "", "", "", "Purchase Price", "$12,000,000"];
  valuationRows[4] = ["Senior Debt", "$6,679,750", "Purchase Price", "$12,000,000", "", "Going-In Cap Rate", "5.25%"];
  valuationRows[5] = ["Equity", "$5,320,250", "Closing Costs", "$120,000", "", "All-In Interest Rate (SOFR+220bps)", "6.50%"];
  valuationRows[6] = ["", "", "", "", "", "LTC", "55.00%"];
  valuationRows[7] = ["", "", "Upfront CapEx", "$25,000", "", "Loan Amount", "$6,679,750"];
  valuationRows[8] = ["", "", "", "", "", "Equity Required", "$5,320,250"];
  valuationRows[9] = ["", "", "", "", "", "Total CapEx", "$25,000"];
  valuationRows[10] = ["", "", "", "", "", "NRSF", "69945"];
  valuationRows[11] = ["Total Sources", "$12,000,000", "Total Uses", "$12,145,000", "", "Price / SqFt", "$171.57"];
  valuationRows[12] = ["", "", "", "", "", "Asset Mgmt Fee", "$75,000"];
  valuationRows[15] = ["Beginning Balance", "$6,679,750", "$6,569,461", "$6,451,785", "$6,326,229", "$6,192,263"];
  valuationRows[16] = ["Annual Debt Service", "$541,226", "$541,226", "$541,226", "$541,226", "$541,226"];
  valuationRows[17] = ["Interest Portion", "$430,937", "$423,550", "$415,669", "$407,261", "$398,289"];
  valuationRows[18] = ["Principal Portion", "$110,289", "$117,676", "$125,557", "$133,965", "$142,937"];
  valuationRows[19] = ["DSCR", "1.29x", "1.42x", "1.49x", "1.52x", "1.54x"];
  valuationRows[20] = ["Ending Balance", "$6,569,461", "$6,451,785", "$6,326,229", "$6,192,263", "$6,049,326"];
  valuationRows[24] = ["Net Operating Income", "$697,644", "$770,697", "$805,746", "$820,087", "$835,319"];
  valuationRows[25] = ["Less: CapEx", "-", "-", "-", "-", "-"];
  valuationRows[26] = ["Less: Debt Service", "($541,226)", "($541,226)", "($541,226)", "($541,226)", "($541,226)"];
  valuationRows[27] = ["Less: Asset Mgmt Fee", "($75,000)", "($75,000)", "($75,000)", "($75,000)", "($75,000)"];
  valuationRows[28] = ["Levered Cash Flow", "$81,418", "$154,471", "$189,521", "$203,861", "$219,093"];
  valuationRows[30] = ["Cash-on-Cash Return", "1.5%", "2.8%", "3.5%", "3.7%", "4.0%"];
  valuationRows[31] = ["Yield on Cost", "5.7%", "6.3%", "6.6%", "6.8%", "6.9%"];
  valuationRows[35] = ["", "3-Year Hold", "5-Year Hold", "7-Year Hold"];
  valuationRows[37] = ["Exit Year NOI", "$805,746", "$835,319", "$869,065"];
  valuationRows[38] = ["Forward NOI (exit + 1 yr)", "$821,861", "$852,025", "$886,447"];
  valuationRows[39] = ["Gross Sale Price / Price Per Square Foot", "$13,149,782 / $188", "$13,632,399 / $195", "$14,183,148 / $203"];
  valuationRows[40] = ["Disposition Costs", "($262,996)", "($272,648)", "($283,663)"];
  valuationRows[41] = ["Net Sale Price", "$12,886,787", "$13,359,751", "$13,899,485"];
  valuationRows[42] = ["Loan Balance at Exit", "$6,326,229", "$6,049,326", "$5,734,092"];
  valuationRows[43] = ["Net Equity Proceeds", "$6,560,558", "$7,310,425", "$8,165,393"];
  valuationRows[46] = ["Levered IRR", "8.7%", "8.7%", "9.0%"];
  valuationRows[47] = ["Equity Multiple", "1.28x", "1.49x", "1.77x"];
  valuationRows[73] = ["Cap Rate Sensitivity — Implied Value at Exit (Year 5 NOI)"];
  valuationRows[75] = ["5.50%", "$15,491,363", "$15,181,535", "$9,132,209", "1.83x", "13.3%"];
  valuationRows[76] = ["5.75%", "$14,817,825", "$14,521,469", "$8,472,143", "1.71x", "11.7%"];
  valuationRows[77] = ["6.00%", "$14,200,416", "$13,916,407", "$7,867,081", "1.59x", "10.2%"];
  valuationRows[78] = ["6.50%", "$13,108,076", "$12,845,915", "$6,796,588", "1.40x", "7.2%"];
  valuationRows[79] = ["7.00%", "$12,171,785", "$11,928,349", "$5,879,023", "1.23x", "4.4%"];
  valuationRows[80] = ["7.50%", "$11,360,333", "$11,133,126", "$5,083,800", "1.09x", "1.7%"];
  valuationRows[81] = ["8.00%", "$10,650,312", "$10,437,306", "$4,387,979", "0.96x", "-0.9%"];
  valuationRows[82] = ["8.50%", "$10,023,823", "$9,823,346", "$3,774,020", "0.85x", "-3.5%"];
  valuationRows[84] = ["Interest Rate Sensitivity — Levered IRR (Exit Cap × All-In Rate)"];
  valuationRows[86] = ["Exit Cap \\ All-In Rate", "5.30%", "5.80%", "6.30%", "6.80%", "7.30%"];
  valuationRows[87] = ["5.50%", "14.4%", "13.9%", "13.4%", "13.0%", "12.5%"];
  valuationRows[88] = ["6.00%", "11.4%", "10.9%", "10.4%", "9.9%", "9.4%"];
  valuationRows[89] = ["6.50%", "8.5%", "8.0%", "7.5%", "6.9%", "6.4%"];
  valuationRows[90] = ["7.00%", "5.8%", "5.2%", "4.7%", "4.1%", "3.5%"];
  valuationRows[91] = ["7.50%", "3.2%", "2.6%", "2.0%", "1.4%", "0.7%"];

  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(valuationRows), "Valuation Sheet");

  if (includeProforma) {
    const proformaRows: string[][] = Array.from({ length: 96 }, () => []);
    proformaRows[7] = ["", "", "", "Income", "T-12 Avg", "T-12", "Apr-26", "May-26", "Jun-26", "Jul-26", "Aug-26", "Sep-26", "Oct-26", "Nov-26", "Dec-26", "Jan-27", "Feb-27", "Mar-27", "", "Current Mgmt", "IMPACT TO N.O.I", "", "", ""];
    proformaRows[8] = ["", "", "", "Rental Income", "$62,854", "$754,243", "$70,502", "$71,320", "$72,147", "$72,983", "$73,828", "$74,682", "$75,545", "$76,417", "$77,298", "$78,189", "$79,089", "$79,999", "$902,000", "$939,261", "$(37,262)", ""];
    proformaRows[10] = ["", "", "", "Discounts", "$-", "$-", "$(4,916)", "$(4,616)", "$(4,655)", "$(4,693)", "$(4,733)", "$(4,772)", "$(4,812)", "$(4,852)", "$(4,892)", "$(4,933)", "$(4,974)", "$(5,016)", "$(57,863)", "$(57,863)", "$-", ""];
    proformaRows[20] = ["", "", "", "Total Operating Income", "$70,392", "$844,708", "$73,068", "$74,288", "$75,180", "$79,732", "$84,336", "$88,992", "$91,436", "$93,908", "$96,407", "$98,935", "$101,364", "$103,821", "$1,061,466", "$968,421", "$93,045", "9.61%"];
    proformaRows[23] = ["", "", "", "Advertising & Marketing", "$1,655", "$19,862", "$2,000", "$2,000", "$2,000", "$2,000", "$2,000", "$2,000", "$2,000", "$2,000", "$2,000", "$2,000", "$2,000", "$2,000", "$24,000", "$24,000", "$-", ""];
    proformaRows[44] = ["", "", "", "Total Operating Expense", "$29,675", "$356,103", "$29,725", "$29,770", "$29,802", "$29,979", "$30,159", "$30,341", "$30,435", "$30,529", "$30,625", "$30,721", "$30,819", "$30,917", "$363,822", "$376,649", "$12,827", "3.41%"];
    proformaRows[46] = ["", "", "", "Net Operating Income", "$40,717", "$488,605", "$43,342", "$44,518", "$45,378", "$49,752", "$54,176", "$58,651", "$61,001", "$63,379", "$65,783", "$68,214", "$70,545", "$72,904", "$697,644", "$591,772", "$105,871", "17.89%"];
    proformaRows[85] = ["", "", "", "Projected Rate", "", "", "$1.16", "$1.16", "$1.17", "$1.18", "$1.19", "$1.20", "$1.21", "$1.22", "$1.23", "$1.24", "$1.26", "$1.27"];
    proformaRows[86] = ["", "", "", "General Vacancy", "", "", "12.75%", "12.46%", "12.18%", "11.90%", "11.61%", "11.33%", "11.05%", "10.76%", "10.48%", "10.20%", "9.92%", "9.63%"];
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(proformaRows), "Proforma");
  }

  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

function buildTemplateBuffer(): Buffer {
  const zip = new PizZip();
  zip.file("ppt/slides/slide1.xml", "<a:t>{{PUBLISHMONTHYEAR}}</a:t>");
  zip.file(
    "ppt/slides/slide2.xml",
    "<a:t>{{3YIRR}}</a:t><a:t>{{3YMUL}}</a:t><a:t>{{5YIRR}}</a:t><a:t>{{5YMUL}}</a:t><a:t>{{7YIRR}}</a:t><a:t>{{7YMUL}}</a:t><a:t>{{ASSETVALUE}}</a:t><a:t>{{NOIPERCENT}}</a:t><a:t>{{EXPREDPERC}}</a:t><a:t>{{REVENUELIFT}}</a:t><a:t>{{REGION}}</a:t>",
  );
  zip.file(
    "ppt/slides/slide3.xml",
    "<a:t>{{OCCPER}}</a:t><a:t>{{RENTSQFT}}</a:t><a:t>{{UNITS}}</a:t><a:t>{{RATING}}</a:t><a:t>{{REVIEWS}}</a:t><a:t>{{SNAPSHOTDESCRIPTION}}</a:t>",
  );
  zip.file(
    "ppt/slides/slide4.xml",
    "<a:t>{{CELL0003}}</a:t><a:t>{{CELL0031}}</a:t><a:t>{{CELL0175}}</a:t><a:t>{{CELL0187}}</a:t>",
  );
  zip.file(
    "ppt/slides/slide5.xml",
    "<a:t>{{CELL0201}}</a:t><a:t>{{CELL0438}}</a:t><a:t>{{CELL0454}}</a:t><a:t>{{CELL0473}}</a:t>",
  );
  zip.file(
    "ppt/slides/slide6.xml",
    "<a:t>{{CELL0490}}</a:t><a:t>{{CELL0492}}</a:t><a:t>{{CELL0506}}</a:t><a:t>({{CELL0551}})</a:t><a:t>{{CELL0568}}</a:t>",
  );
  zip.file(
    "ppt/slides/slide7.xml",
    "<a:t>{{CELL0578}}</a:t><a:t>{{CELL0604}}</a:t><a:t>{{CELL0621}}</a:t><a:t>{{CELL0650}}</a:t><a:t>{{CELL0656}}</a:t><a:t>{{CELL0658}}x</a:t>",
  );
  return Buffer.from(zip.generate({ type: "uint8array" }));
}

const TEST_TEMPLATE_PATH = path.join(process.cwd(), "tmp", "property-analysis-package-test-template.pptx");

test("scanPackageTemplateTokens returns the managed token set including direct slide 4-7 cells", async () => {
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
    "CELL0003",
    "CELL0031",
    "CELL0175",
    "CELL0187",
    "CELL0201",
    "CELL0438",
    "CELL0454",
    "CELL0473",
    "CELL0490",
    "CELL0492",
    "CELL0506",
    "CELL0551",
    "CELL0568",
    "CELL0578",
    "CELL0604",
    "CELL0621",
    "CELL0650",
    "CELL0656",
    "CELL0658",
    "EXPREDPERC",
    "NOIPERCENT",
    "OCCPER",
    "PUBLISHMONTHYEAR",
    "RATING",
    "REGION",
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
  const region = parsed.tokenFields.find((field) => field.token === "REGION");
  const totalUnits = parsed.tokenFields.find((field) => field.token === "UNITS");
  const threeYearIrr = parsed.tokenFields.find((field) => field.token === "3YIRR");
  const snapshotDescription = parsed.tokenFields.find((field) => field.token === "SNAPSHOTDESCRIPTION");

  assert.equal(parsed.metadata.workbookType, "wentworth-results");
  assert.equal(publishMonth?.source, "derived");
  assert.match(publishMonth?.defaultValue ?? "", /^[A-Z][a-z]+ \d{4}$/);
  assert.equal(occupancy?.defaultValue, "97.30%");
  assert.equal(rentableSqft?.defaultValue, "96,755");
  assert.equal(region?.defaultValue, "West Coast");
  assert.equal(region?.source, "derived");
  assert.equal(totalUnits?.defaultValue, "688");
  assert.equal(threeYearIrr?.source, "manual");
  assert.equal(snapshotDescription?.source, "derived");
  assert.equal(snapshotDescription?.defaultValue, "N/A ERROR");
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
  const region = parsed.tokenFields.find((field) => field.token === "REGION");
  const rentableSqft = parsed.tokenFields.find((field) => field.token === "RENTSQFT");
  const totalUnits = parsed.tokenFields.find((field) => field.token === "UNITS");
  const assetValue = parsed.tokenFields.find((field) => field.token === "ASSETVALUE");
  const expenseReduction = parsed.tokenFields.find((field) => field.token === "EXPREDPERC");
  const noiIncrease = parsed.tokenFields.find((field) => field.token === "NOIPERCENT");
  const revenueLift = parsed.tokenFields.find((field) => field.token === "REVENUELIFT");
  const rentalIncomeT12Avg = parsed.tokenFields.find((field) => field.token === "CELL0003");
  const discountsApr = parsed.tokenFields.find((field) => field.token === "CELL0031");
  const rentApr = parsed.tokenFields.find((field) => field.token === "CELL0175");
  const vacancyApr = parsed.tokenFields.find((field) => field.token === "CELL0187");
  const advertisingT12Avg = parsed.tokenFields.find((field) => field.token === "CELL0201");
  const totalOperatingExpenseT12Avg = parsed.tokenFields.find((field) => field.token === "CELL0438");
  const totalOperatingExpenseImpact = parsed.tokenFields.find((field) => field.token === "CELL0454");
  const netOperatingIncomeT12Avg = parsed.tokenFields.find((field) => field.token === "CELL0473");
  const purchasePriceMetric = parsed.tokenFields.find((field) => field.token === "CELL0490");
  const spreadBps = parsed.tokenFields.find((field) => field.token === "CELL0492");
  const debtBalanceYear1 = parsed.tokenFields.find((field) => field.token === "CELL0506");
  const debtServiceYear1 = parsed.tokenFields.find((field) => field.token === "CELL0551");
  const seniorDebt = parsed.tokenFields.find((field) => field.token === "CELL0568");
  const exitYearNoi3 = parsed.tokenFields.find((field) => field.token === "CELL0578");
  const threeYearIrrSlide7 = parsed.tokenFields.find((field) => field.token === "CELL0604");
  const interestSensitivity = parsed.tokenFields.find((field) => field.token === "CELL0621");
  const sensitivityYear = parsed.tokenFields.find((field) => field.token === "CELL0650");
  const capRateNetProceeds = parsed.tokenFields.find((field) => field.token === "CELL0656");
  const capRateMultiple = parsed.tokenFields.find((field) => field.token === "CELL0658");
  const rating = parsed.tokenFields.find((field) => field.token === "RATING");
  const reviews = parsed.tokenFields.find((field) => field.token === "REVIEWS");
  const snapshotDescription = parsed.tokenFields.find((field) => field.token === "SNAPSHOTDESCRIPTION");

  assert.equal(parsed.metadata.workbookType, "public-proforma-template");
  assert.equal(threeYearIrr?.defaultValue, "8.7%");
  assert.equal(fiveYearMultiple?.defaultValue, "1.49x");
  assert.equal(sevenYearIrr?.defaultValue, "9.0%");
  assert.equal(assetValue?.defaultValue, "1.7M");
  assert.equal(assetValue?.source, "derived");
  assert.equal(expenseReduction?.defaultValue, "3%");
  assert.equal(expenseReduction?.source, "extracted");
  assert.equal(noiIncrease?.defaultValue, "18");
  assert.equal(noiIncrease?.source, "extracted");
  assert.equal(revenueLift?.defaultValue, "93");
  assert.equal(revenueLift?.source, "extracted");
  assert.equal(occupancy?.defaultValue, "86.97%");
  assert.equal(region?.defaultValue, "Southwest");
  assert.equal(region?.source, "derived");
  assert.equal(rentableSqft?.defaultValue, "69945");
  assert.equal(totalUnits?.defaultValue, "706");
  assert.equal(rentalIncomeT12Avg?.defaultValue, "$62,854");
  assert.equal(rentalIncomeT12Avg?.section, "incomeProforma");
  assert.equal(discountsApr?.defaultValue, "(4,916)");
  assert.equal(rentApr?.defaultValue, "$1.16");
  assert.equal(vacancyApr?.defaultValue, "12.75%");
  assert.equal(advertisingT12Avg?.defaultValue, "$1,655");
  assert.equal(advertisingT12Avg?.section, "expenseProforma");
  assert.equal(totalOperatingExpenseT12Avg?.defaultValue, "$29,675");
  assert.equal(totalOperatingExpenseImpact?.defaultValue, "$12,827");
  assert.equal(netOperatingIncomeT12Avg?.defaultValue, "$40,717");
  assert.equal(purchasePriceMetric?.defaultValue, "$12,000,000");
  assert.equal(purchasePriceMetric?.section, "dealEconomics");
  assert.equal(spreadBps?.defaultValue, "220");
  assert.equal(debtBalanceYear1?.defaultValue, "$6,679,750");
  assert.equal(debtServiceYear1?.defaultValue, "$541,226");
  assert.equal(seniorDebt?.defaultValue, "$6,679,750");
  assert.equal(exitYearNoi3?.defaultValue, "$805,746");
  assert.equal(exitYearNoi3?.section, "exitSensitivity");
  assert.equal(threeYearIrrSlide7?.defaultValue, "8.7%");
  assert.equal(interestSensitivity?.defaultValue, "14.4%");
  assert.equal(sensitivityYear?.defaultValue, "5");
  assert.equal(capRateNetProceeds?.defaultValue, "$15,181,535");
  assert.equal(capRateMultiple?.defaultValue, "1.83");
  assert.equal(rating?.source, "manual");
  assert.equal(reviews?.source, "manual");
  assert.equal(snapshotDescription?.source, "derived");
  assert.equal(snapshotDescription?.defaultValue, "N/A ERROR");
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
      EXPREDPERC: "8%",
      REVENUELIFT: "178",
      REGION: "Carolinas",
      OCCPER: "95%",
      UNITS: "592",
      CELL0003: "$62,854",
      CELL0438: "$29,675",
      CELL0490: "$12,000,000",
      CELL0578: "$805,746",
    },
    { templatePath: TEST_TEMPLATE_PATH },
  );
  const zip = new PizZip(rendered);
  const slide1Xml = zip.file("ppt/slides/slide1.xml")?.asText() ?? "";
  const slide2Xml = zip.file("ppt/slides/slide2.xml")?.asText() ?? "";
  const slide3Xml = zip.file("ppt/slides/slide3.xml")?.asText() ?? "";
  const slide4Xml = zip.file("ppt/slides/slide4.xml")?.asText() ?? "";
  const slide5Xml = zip.file("ppt/slides/slide5.xml")?.asText() ?? "";
  const slide6Xml = zip.file("ppt/slides/slide6.xml")?.asText() ?? "";
  const slide7Xml = zip.file("ppt/slides/slide7.xml")?.asText() ?? "";

  assert.match(slide1Xml, /March 2026/);
  assert.match(slide2Xml, /26%/);
  assert.match(slide2Xml, /5\.5M/);
  assert.match(slide2Xml, /20/);
  assert.match(slide2Xml, /8%/);
  assert.match(slide2Xml, /178/);
  assert.match(slide2Xml, /Carolinas/);
  assert.match(slide3Xml, /95%/);
  assert.match(slide3Xml, /592/);
  assert.match(slide4Xml, /\$62,854/);
  assert.match(slide5Xml, /\$29,675/);
  assert.match(slide6Xml, /\$12,000,000/);
  assert.match(slide7Xml, /\$805,746/);
  assert.doesNotMatch(slide3Xml, /\{\{RATING\}\}/);
  assert.doesNotMatch(slide7Xml, /\{\{CELL0578\}\}/);
});

test("buildPackageFileName creates a stable export name", () => {
  const fileName = buildPackageFileName("Roseville CA (Baseline Rd)", new Date("2026-03-25T12:00:00Z"));
  assert.equal(fileName, "Property-Analysis-Package_Roseville_CA_Baseline_Rd_2026-03-25.pptx");
});
