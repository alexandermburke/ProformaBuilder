import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import PizZip from "pizzip";
import * as XLSX from "xlsx";
import {
  buildFinalTokenMap,
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

type LegacyProformaRowInput = {
  label: string;
  t12Avg: string;
  t12: string;
  months: string[];
  store: string;
  currentMgmt: string;
  impact: string;
  impactPercent?: string;
};

function buildLegacyProformaRow(input: LegacyProformaRowInput): string[] {
  const row = Array.from({ length: 24 }, () => "");
  row[3] = input.label;
  row[4] = input.t12Avg;
  row[5] = input.t12;
  input.months.forEach((value, index) => {
    row[6 + index] = value;
  });
  row[18] = input.store;
  row[19] = input.currentMgmt;
  row[20] = input.impact;
  if (input.impactPercent) {
    row[21] = input.impactPercent;
  }
  return row;
}

function buildExpandedLegacyPublicTemplateWorkbookBuffer(): Buffer {
  const workbook = XLSX.read(buildPublicTemplateWorkbookBuffer(), { type: "buffer" });
  const proformaRows = XLSX.utils.sheet_to_json(workbook.Sheets["Proforma"], {
    header: 1,
    raw: false,
    defval: "",
  }) as string[][];

  const setRow = (rowIndex: number, input: LegacyProformaRowInput): void => {
    proformaRows[rowIndex] = buildLegacyProformaRow(input);
  };

  setRow(9, {
    label: "STORE Rate Mgmt. Rev",
    t12Avg: "$-",
    t12: "$-",
    months: ["$-", "$-", "$-", "$4,468", "$7,293", "$9,578", "$11,889", "$14,226", "$16,590", "$18,981", "$21,398", "$23,843"],
    store: "$128,266",
    currentMgmt: "$-",
    impact: "$128,266",
  });
  setRow(13, {
    label: "Admin Fee Income",
    t12Avg: "$1,136",
    t12: "$13,630",
    months: ["$1,160", "$1,160", "$1,160", "$1,160", "$1,160", "$1,160", "$1,160", "$1,160", "$1,160", "$1,160", "$1,160", "$1,160"],
    store: "$13,920",
    currentMgmt: "$13,920",
    impact: "$-",
  });
  setRow(14, {
    label: "Late Fee Income",
    t12Avg: "$2,198",
    t12: "$26,377",
    months: ["$2,371", "$2,324", "$2,277", "$2,232", "$2,187", "$2,143", "$2,100", "$2,058", "$2,017", "$1,977", "$1,937", "$1,898"],
    store: "$25,521",
    currentMgmt: "$25,521",
    impact: "$-",
  });
  setRow(15, {
    label: "Current Tenant Protection Split",
    t12Avg: "$-",
    t12: "$-",
    months: ["$-", "$-", "$-", "$-", "$-", "$-", "$-", "$-", "$-", "$-", "$-", "$-"],
    store: "$-",
    currentMgmt: "$-",
    impact: "$-",
  });
  setRow(16, {
    label: "STORE Tenant Protection Split",
    t12Avg: "$-",
    t12: "$-",
    months: ["$3,074", "$3,182", "$3,292", "$3,402", "$3,512", "$3,623", "$3,735", "$3,847", "$3,960", "$4,074", "$4,086", "$4,098"],
    store: "$43,886",
    currentMgmt: "$-",
    impact: "$43,886",
  });
  setRow(17, {
    label: "Other Tenant Income",
    t12Avg: "$49",
    t12: "$583",
    months: ["$49", "$49", "$49", "$49", "$49", "$49", "$49", "$49", "$49", "$50", "$50", "$50"],
    store: "$590",
    currentMgmt: "$590",
    impact: "$-",
  });
  setRow(23, {
    label: "Advertising & Marketing",
    t12Avg: "$2,757",
    t12: "$33,082",
    months: ["$3,000", "$3,000", "$3,000", "$3,000", "$3,000", "$3,000", "$3,000", "$3,000", "$3,000", "$3,000", "$3,000", "$3,000"],
    store: "$36,000",
    currentMgmt: "$33,412",
    impact: "$(2,588)",
  });
  setRow(24, {
    label: "Current Payment Processing Fees",
    t12Avg: "$2,020",
    t12: "$24,242",
    months: ["$2,193", "$2,218", "$2,243", "$2,354", "$2,435", "$2,505", "$2,575", "$2,647", "$2,720", "$2,793", "$2,865", "$2,938"],
    store: "$-",
    currentMgmt: "$30,485",
    impact: "$-",
  });
  setRow(25, {
    label: "STORE Payment Processing Fees",
    t12Avg: "$-",
    t12: "$-",
    months: ["$-", "$-", "$-", "$-", "$-", "$-", "$-", "$-", "$-", "$-", "$-", "$-"],
    store: "$-",
    currentMgmt: "$-",
    impact: "$30,485",
  });
  setRow(26, {
    label: "Fire Prevention",
    t12Avg: "$21",
    t12: "$253",
    months: ["$21", "$21", "$21", "$21", "$21", "$21", "$21", "$21", "$21", "$21", "$21", "$21"],
    store: "$253",
    currentMgmt: "$253",
    impact: "$-",
  });
  setRow(27, {
    label: "Licenses & Permits",
    t12Avg: "$-",
    t12: "$-",
    months: ["$-", "$-", "$-", "$-", "$-", "$-", "$-", "$-", "$-", "$-", "$-", "$-"],
    store: "$-",
    currentMgmt: "$-",
    impact: "$-",
  });
  setRow(28, {
    label: "Current Mgmt. Fee",
    t12Avg: "$5,212",
    t12: "$62,539",
    months: ["$5,289", "$5,350", "$5,411", "$5,696", "$5,900", "$6,077", "$6,257", "$6,438", "$6,622", "$6,807", "$6,995", "$7,184"],
    store: "$-",
    currentMgmt: "$74,026",
    impact: "$-",
  });
  setRow(29, {
    label: "STORE Mgmt. Fee",
    t12Avg: "$-",
    t12: "$-",
    months: ["$4,230", "$4,278", "$4,327", "$4,555", "$4,718", "$4,860", "$5,003", "$5,149", "$5,295", "$5,444", "$5,593", "$5,745"],
    store: "$59,197",
    currentMgmt: "$-",
    impact: "$14,829",
  });
  setRow(30, {
    label: "Payroll",
    t12Avg: "$8,785",
    t12: "$105,423",
    months: ["$9,027", "$9,027", "$9,027", "$9,027", "$9,027", "$9,027", "$9,027", "$9,027", "$9,027", "$9,027", "$9,027", "$9,027"],
    store: "$108,324",
    currentMgmt: "$106,477",
    impact: "$(1,847)",
  });
  setRow(31, {
    label: "Office Supplies",
    t12Avg: "$196",
    t12: "$2,352",
    months: ["$196", "$196", "$196", "$196", "$196", "$196", "$196", "$196", "$196", "$196", "$196", "$196"],
    store: "$2,352",
    currentMgmt: "$2,352",
    impact: "$-",
  });
  setRow(32, {
    label: "Repairs & Maintenance",
    t12Avg: "$1,158",
    t12: "$13,898",
    months: ["$1,158", "$1,158", "$1,158", "$1,158", "$1,158", "$1,158", "$1,158", "$1,158", "$1,158", "$1,158", "$1,158", "$1,158"],
    store: "$13,898",
    currentMgmt: "$13,898",
    impact: "$-",
  });
  setRow(33, {
    label: "Security",
    t12Avg: "$219",
    t12: "$2,624",
    months: ["$220", "$220", "$220", "$220", "$220", "$220", "$220", "$220", "$220", "$220", "$220", "$220"],
    store: "$2,640",
    currentMgmt: "$2,640",
    impact: "$-",
  });
  setRow(37, {
    label: "Bank Charges",
    t12Avg: "$-",
    t12: "$-",
    months: ["$-", "$-", "$-", "$-", "$-", "$-", "$-", "$-", "$-", "$-", "$-", "$-"],
    store: "$-",
    currentMgmt: "$-",
    impact: "$-",
  });
  setRow(42, {
    label: "Other Expense",
    t12Avg: "$-",
    t12: "$-",
    months: ["$-", "$-", "$-", "$-", "$-", "$-", "$-", "$-", "$-", "$-", "$-", "$-"],
    store: "$-",
    currentMgmt: "$-",
    impact: "$-",
  });

  workbook.Sheets["Proforma"] = XLSX.utils.aoa_to_sheet(proformaRows);
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

function buildNewLayoutPublicTemplateWorkbookBuffer(): Buffer {
  const workbook = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ["", "DEAL INPUT CONTROL PANEL"],
      ["", "1. Property Overview"],
      ["", "Name", "", "", "Charleston Ashley Phosphate"],
      ["", "Type", "", "", "Storage"],
      ["", "Location", "", "", "5146 Ashley Phosphate Rd, North Charleston, SC 29418"],
      ["", "Units Available", "", "", "592"],
      ["", "Units Occupied", "", "", "563"],
      ["", "NRSF", "", "", "72323"],
      ["", "2. Financing"],
      ["", "SOFR Rate", "", "", "4.30%"],
      ["", "Spread", "", "", "2.20%"],
      ["", "All-In Rate", "", "", "6.50%"],
      ["", "Loan Amount", "", "", "$9,207,250"],
      ["", "3. Capital Expenditures"],
      ["", "Total CapEx", "", "", "$25,000"],
      ["", "4. Exit Assumptions"],
      ["", "Exit Cap Rate", "", "", "6.00%"],
      ["", "Purchase Price", "", "", "$14,000,000"],
    ]),
    "Inputs & Drivers",
  );

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ["", "Year 1", "Year 2", "Year 3", "Year 4", "Year 5"],
      ["Rental Income", "1,457,831", "1,651,842", "1,736,353", "1,825,188", "1,918,568"],
      ["Total Operating Income", "1,502,256", "1,685,253", "1,756,166", "1,833,507", "1,916,996"],
      ["Expenses", "444,262", "474,096", "484,464", "495,149", "506,164"],
    ]),
    "5 Year Proforma",
  );

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ["", "Month 0", "Month 1", "Month 2", "Month 3", "Month 4", "Month 5", "Month 6", "Month 7", "Month 8", "Month 9", "Month 10", "Month 11"],
      ["Projected Rate ($/sqft)", "$1.58", "$1.59", "$1.61", "$1.62", "$1.63", "$1.65", "$1.66", "$1.68", "$1.69", "$1.70", "$1.72", "$1.73"],
      ["Occupied Units", "563", "565", "567", "569", "571", "573", "575", "577", "579", "581", "583", "585"],
      ["Physical Occupancy", "95.1%", "95.4%", "95.6%", "95.9%", "96.1%", "96.4%", "96.6%", "96.9%", "97.1%", "97.4%", "97.6%", "97.9%"],
      ["Net Rental Income", "104,476", "103,504", "104,986", "110,186", "113,651", "116,946", "118,358", "116,548", "120,116", "121,976", "126,056", "128,851"],
    ]),
    "Model2.0",
  );

  const valuationRows: string[][] = Array.from({ length: 176 }, () => []);
  valuationRows[0] = ["Charleston Ashley Phosphate - Acquisition & Returns Analysis"];
  valuationRows[3] = ["Sources & Uses", "", "", "", "", "Purchase Price", "$14,000,000"];
  valuationRows[4] = ["Senior Debt", "$9,207,250", "Purchase Price", "$14,000,000", "", "Going-In Cap Rate", "6.05%"];
  valuationRows[5] = ["Equity", "$4,957,750", "Closing Costs", "$140,000", "", "All-In Interest Rate (SOFR+220bps)", "6.50%"];
  valuationRows[6] = ["", "", "", "", "", "LTC", "65.0%"];
  valuationRows[7] = ["", "", "Upfront CapEx", "$25,000", "", "Loan Amount", "$9,207,250"];
  valuationRows[8] = ["", "", "", "", "", "Equity Required", "$4,957,750"];
  valuationRows[9] = ["", "", "", "", "", "Total CapEx", "$25,000"];
  valuationRows[10] = ["", "", "", "", "", "NRSF", "72,323"];
  valuationRows[11] = ["Total Sources", "$14,165,000", "Total Uses", "$14,165,000", "", "Price / SqFt", "$195.86"];
  valuationRows[12] = ["", "", "", "", "", "Asset Mgmt Fee", "$75,000"];
  valuationRows[15] = ["Beginning Balance", "$9,207,250", "$9,207,250", "$9,132,471", "$8,975,442", "$8,807,897"];
  valuationRows[16] = ["Annual Debt Service", "$598,471", "$672,244", "$746,016", "$746,016", "$746,016"];
  valuationRows[17] = ["Interest Portion", "$598,471", "$597,465", "$588,987", "$578,471", "$567,250"];
  valuationRows[18] = ["Principal Portion", "$0", "$74,779", "$157,029", "$167,545", "$178,766"];
  valuationRows[19] = ["DSCR", "1.77x", "1.80x", "1.70x", "1.79x", "1.89x"];
  valuationRows[20] = ["Ending Balance", "$9,207,250", "$9,132,471", "$8,975,442", "$8,807,897", "$8,629,131"];
  valuationRows[24] = ["Net Operating Income", "$1,057,993", "$1,211,157", "$1,271,702", "$1,338,358", "$1,410,832"];
  valuationRows[25] = ["Less: CapEx", "-", "-", "-", "-", "-"];
  valuationRows[26] = ["Less: Debt Service", "($598,471)", "($672,244)", "($746,016)", "($746,016)", "($746,016)"];
  valuationRows[27] = ["Less: Asset Mgmt Fee", "($75,000)", "($75,000)", "($75,000)", "($75,000)", "($75,000)"];
  valuationRows[28] = ["Levered Cash Flow", "$384,522", "$463,913", "$450,686", "$517,342", "$589,816"];
  valuationRows[30] = ["Cash-on-Cash Return", "7.8%", "9.4%", "9.1%", "10.4%", "11.9%"];
  valuationRows[31] = ["Yield on Cost", "7.5%", "8.6%", "9.0%", "9.4%", "10.0%"];
  valuationRows[35] = ["", "3-Year Hold", "5-Year Hold", "7-Year Hold"];
  valuationRows[37] = ["Exit Year NOI", "$1,271,702", "$1,410,832", "$1,555,442"];
  valuationRows[38] = ["Forward NOI (exit + 1 yr)", "$1,335,287", "$1,481,374", "$1,633,215"];
  valuationRows[39] = ["Gross Sale Price / Price Per Square Foot", "$22,254,787 / $308", "$24,689,563 / $341", "$27,220,243 / $376"];
  valuationRows[40] = ["Disposition Costs", "($445,096)", "($493,791)", "($544,405)"];
  valuationRows[41] = ["Net Sale Price", "$21,809,691", "$24,195,772", "$26,675,839"];
  valuationRows[42] = ["Loan Balance at Exit", "$8,975,442", "$8,629,131", "$8,234,880"];
  valuationRows[43] = ["Net Equity Proceeds", "$12,834,249", "$15,566,641", "$18,440,959"];
  valuationRows[46] = ["Levered IRR", "43.8%", "32.0%", "27.3%"];
  valuationRows[47] = ["Equity Multiple", "2.85x", "3.63x", "4.58x"];
  valuationRows[73] = ["Cap Rate Sensitivity — Implied Value at Exit (Year 5 NOI)"];
  valuationRows[74] = ["Exit Cap Rate", "Gross Sale", "Net Proceeds", "Equity Proceeds", "Equity Multiple", "Levered IRR"];
  valuationRows[75] = ["5.00%", "$29,627,476", "$29,034,926", "$20,405,796", "4.60x", "38.4%"];
  valuationRows[76] = ["5.25%", "$28,216,644", "$27,652,311", "$19,023,180", "4.32x", "36.7%"];
  valuationRows[77] = ["5.50%", "$26,934,069", "$26,395,388", "$17,766,257", "4.07x", "35.1%"];
  valuationRows[78] = ["5.75%", "$25,763,022", "$25,247,762", "$16,618,631", "3.84x", "33.5%"];
  valuationRows[79] = ["6.00%", "$24,689,563", "$24,195,772", "$15,566,641", "3.63x", "32.0%"];
  valuationRows[80] = ["6.25%", "$23,701,981", "$23,227,941", "$14,598,810", "3.43x", "30.5%"];
  valuationRows[81] = ["6.50%", "$22,790,366", "$22,334,559", "$13,705,428", "3.25x", "29.1%"];
  valuationRows[82] = ["6.75%", "$21,946,278", "$21,507,353", "$12,878,222", "3.08x", "27.7%"];
  valuationRows[84] = ["Interest Rate Sensitivity — Levered IRR (Exit Cap × All-In Rate)"];
  valuationRows[86] = ["Exit Cap \\ All-In Rate", "5.30%", "5.80%", "6.50%", "7.00%", "7.50%"];
  valuationRows[87] = ["5.00%", "39.8%", "39.2%", "38.4%", "37.9%", "37.3%"];
  valuationRows[88] = ["5.50%", "36.5%", "35.9%", "35.1%", "34.5%", "33.9%"];
  valuationRows[89] = ["6.00%", "33.4%", "32.8%", "32.0%", "31.4%", "30.8%"];
  valuationRows[90] = ["6.50%", "30.6%", "30.0%", "29.1%", "28.5%", "27.8%"];
  valuationRows[91] = ["7.00%", "28.0%", "27.3%", "26.4%", "25.7%", "25.1%"];

  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(valuationRows), "Valuation Sheet");

  const proformaRows: string[][] = Array.from({ length: 60 }, () => []);
  proformaRows[7] = ["", "", "", "", "", "Income", "T-12 Avg", "T-12", "Jun-26", "Jul-26", "Aug-26", "Sep-26", "Oct-26", "Nov-26", "Dec-26", "Jan-27", "Feb-27", "Mar-27", "Apr-27", "May-27", "", "Current Mgmt", "IMPACT TO N.O.I"];
  proformaRows[8] = ["", "", "", "", "", "Rental Income", "$104,643", "$1,255,711", "$108,741", "$109,648", "$110,561", "$111,483", "$112,412", "$113,349", "$114,293", "$115,246", "$116,206", "$117,174", "$118,151", "$119,135", "$1,366,399", "$1,343,610", "$22,788"];
  proformaRows[9] = ["", "", "", "", "", "STORE Rate Mgmt. Rev", "$-", "$-", "$-", "$-", "$-", "$5,574", "$6,698", "$7,832", "$8,975", "$10,127", "$11,289", "$12,461", "$13,642", "$14,834", "$91,432", "$-", "$91,432"];
  proformaRows[10] = ["", "", "", "", "", "Discounts", "$(2,572)", "$(30,859)", "$(4,265)", "$(6,144)", "$(5,575)", "$(6,871)", "$(5,459)", "$(4,234)", "$(4,910)", "$(8,825)", "$(7,379)", "$(7,660)", "$(5,737)", "$(5,118)", "$(72,176)", "$(72,176)", ""];
  proformaRows[11] = ["", "", "", "", "", "Net Rental Income", "$102,071", "$1,224,852", "$104,476", "$103,504", "$104,986", "$110,186", "$113,651", "$116,946", "$118,358", "$116,548", "$120,116", "$121,976", "$126,056", "$128,851", "$1,385,655", "$1,271,434", "$114,220"];
  proformaRows[13] = ["", "", "", "", "", "Admin Fee Income", "$798", "$9,570", "$609", "$870", "$783", "$957", "$754", "$580", "$667", "$1,189", "$986", "$1,015", "$754", "$667", "$9,831", "$9,831", ""];
  proformaRows[14] = ["", "", "", "", "", "Late Fee Income", "$5,385", "$64,625", "$5,824", "$5,707", "$5,593", "$5,481", "$5,372", "$5,264", "$5,159", "$5,056", "$4,955", "$4,856", "$4,759", "$4,663", "$62,690", "$62,690", ""];
  proformaRows[15] = ["", "", "", "", "", "Current Tenant Protection Split", "$-", "$-", "$-", "$-", "$-", "$-", "$-", "$-", "$-", "$-", "$-", "$-", "$-", "$-", "$-", "$-", ""];
  proformaRows[16] = ["", "$15.00", "", "", "", "STORE Tenant Protection Split", "$-", "$-", "$2,618", "$2,702", "$2,787", "$2,871", "$2,956", "$3,040", "$3,125", "$3,209", "$3,294", "$3,378", "$3,378", "$3,378", "$36,736", "$-", "$36,736"];
  proformaRows[17] = ["", "", "", "", "", "Retail Sales Income", "$520", "$6,245", "$441", "$630", "$567", "$693", "$546", "$420", "$483", "$861", "$714", "$735", "$546", "$483", "$7,119", "$6,308", "$811"];
  proformaRows[20] = ["", "", "", "", "", "Total Operating Income", "$108,793", "$1,305,515", "$113,987", "$113,433", "$114,735", "$120,207", "$123,298", "$126,270", "$127,811", "$126,882", "$130,083", "$131,978", "$135,511", "$138,062", "$1,502,256", "$1,350,488", "$151,767"];
  proformaRows[22] = ["", "", "", "", "", "Expenses"];
  proformaRows[23] = ["", "", "", "", "", "Advertising & Marketing", "$1,417", "$17,009", "$2,000", "$2,000", "$2,000", "$2,000", "$2,000", "$2,000", "$2,000", "$2,000", "$2,000", "$2,000", "$2,000", "$2,000", "$24,000", "$24,000", ""];
  proformaRows[24] = ["", "1.40%", "", "", "", "Current Payment Processing Fees", "$1,496", "$17,957", "$1,592", "$1,585", "$1,603", "$1,679", "$1,723", "$1,764", "$1,786", "$1,773", "$1,817", "$1,844", "$1,893", "$1,929", "$-", "$20,988", ""];
  proformaRows[25] = ["", "", "", "", "", "STORE Payment Processing Fees", "$-", "$-", "$-", "$-", "$-", "$-", "$-", "$-", "$-", "$-", "$-", "$-", "$-", "$-", "$-", "$-", "$20,988"];
  proformaRows[28] = ["", "", "", "", "", "Current Mgmt. Fee", "$6,366", "$76,394", "$6,195", "$6,138", "$6,225", "$6,534", "$6,739", "$6,935", "$7,018", "$6,911", "$7,123", "$7,233", "$7,475", "$7,641", "$-", "$82,166", ""];
  proformaRows[29] = ["", "", "", "", "", "STORE Mgmt. Fee", "$-", "$-", "$4,179", "$4,140", "$4,199", "$4,407", "$4,546", "$4,678", "$4,734", "$4,662", "$4,805", "$4,879", "$5,042", "$5,154", "$55,426", "$-", "$26,740"];
  proformaRows[30] = ["", "54Hrs/Wk @ $22 + Burden Rate", "", "", "", "Payroll", "$6,126", "$73,516", "$6,987", "$6,987", "$6,987", "$6,987", "$6,987", "$6,987", "$6,987", "$6,987", "$6,987", "$6,987", "$6,987", "$6,987", "$83,842", "$78,164", "$(5,679)"];
  proformaRows[31] = ["", "", "", "", "", "Office Supplies", "$166", "$1,989", "$166", "$166", "$166", "$166", "$166", "$166", "$166", "$166", "$166", "$166", "$166", "$166", "$1,989", "$1,989", ""];
  proformaRows[32] = ["", "", "", "", "", "Repairs & Maintenance", "$2,083", "$25,002", "$2,083", "$2,083", "$2,083", "$2,083", "$2,083", "$2,083", "$2,083", "$2,083", "$2,083", "$2,083", "$2,083", "$2,083", "$25,002", "$25,002", ""];
  proformaRows[33] = ["", "", "", "", "", "Security", "$130", "$1,555", "$162", "$162", "$162", "$162", "$162", "$162", "$162", "$162", "$162", "$162", "$162", "$162", "$1,944", "$1,944", ""];
  proformaRows[34] = ["", "", "", "", "", "Retail Products", "$210", "$2,515", "$210", "$210", "$210", "$210", "$210", "$210", "$210", "$210", "$210", "$210", "$210", "$210", "$2,515", "$2,515", ""];
  proformaRows[35] = ["", "", "", "", "", "Telephone & Internet", "$398", "$4,771", "$398", "$398", "$398", "$398", "$398", "$398", "$398", "$398", "$398", "$398", "$398", "$398", "$4,771", "$4,771", ""];
  proformaRows[36] = ["", "", "", "", "", "Software", "$1,302", "$15,627", "$1,850", "$1,850", "$1,850", "$1,850", "$1,850", "$1,850", "$1,850", "$1,850", "$1,850", "$1,850", "$1,850", "$1,850", "$22,200", "$15,440", "$(6,760)"];
  proformaRows[38] = ["", "", "", "", "", "Prof Fees - Legal/Acctg", "$618", "$7,418", "$618", "$618", "$618", "$618", "$618", "$618", "$618", "$618", "$618", "$618", "$618", "$618", "$7,418", "$7,418", ""];
  proformaRows[39] = ["", "", "", "", "", "Utilities", "$2,680", "$32,156", "$2,680", "$2,680", "$2,680", "$2,680", "$2,680", "$2,680", "$2,680", "$2,680", "$2,680", "$2,680", "$2,680", "$2,680", "$32,156", "$32,156", ""];
  proformaRows[40] = ["", "", "", "", "", "Insurance", "$3,000", "$36,000", "$3,000", "$3,000", "$3,000", "$3,000", "$3,000", "$3,000", "$3,000", "$3,000", "$3,000", "$3,000", "$3,000", "$3,000", "$36,000", "$36,000", ""];
  proformaRows[41] = ["", "", "", "", "", "Property Taxes", "$12,083", "$145,000", "$12,083", "$12,083", "$12,083", "$12,083", "$12,083", "$12,083", "$12,083", "$12,083", "$12,083", "$12,083", "$12,083", "$12,083", "$145,000", "$145,000", ""];
  proformaRows[44] = ["", "", "", "", "", "Total Operating Expense", "$38,242", "$458,909", "$36,582", "$36,543", "$36,602", "$36,810", "$36,949", "$37,081", "$37,137", "$37,065", "$37,208", "$37,282", "$37,445", "$37,557", "$444,262", "$479,552", "$35,289"];
  proformaRows[46] = ["", "", "", "", "", "Net Operating Income", "$70,550", "$846,606", "$77,405", "$76,889", "$78,132", "$83,397", "$86,349", "$89,189", "$90,673", "$89,817", "$92,875", "$94,696", "$98,066", "$100,505", "$1,057,993", "$870,937", "$187,057"];
  proformaRows[3] = ["", "", "", "", "", "Projected Rate", "", "", "$1.58", "$1.59", "$1.61", "$1.62", "$1.63", "$1.65", "$1.66", "$1.68", "$1.69", "$1.70", "$1.72", "$1.73"];
  proformaRows[4] = ["", "", "", "", "", "General Vacancy", "", "", "4.90%", "4.90%", "4.90%", "4.90%", "4.90%", "4.90%", "4.90%", "4.90%", "4.90%", "4.90%", "4.90%", "4.90%"];
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(proformaRows), "Proforma");

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
    "<a:t>{{CELL0003}}</a:t><a:t>{{CELL0031}}</a:t><a:t>{{CELL0171}}</a:t><a:t>{{CELL0175}}</a:t><a:t>{{CELL0187}}</a:t>",
  );
  zip.file(
    "ppt/slides/slide5.xml",
    "<a:t>{{CELL0201}}</a:t><a:t>{{CELL0438}}</a:t><a:t>{{CELL0452}}</a:t><a:t>{{CELL0454}}</a:t><a:t>{{CELL0473}}</a:t><a:t>{{CELL0487}}</a:t>",
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
    "CELL0171",
    "CELL0175",
    "CELL0187",
    "CELL0201",
    "CELL0438",
    "CELL0452",
    "CELL0454",
    "CELL0473",
    "CELL0487",
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
  const totalOperatingIncomeYear1 = parsed.tokenFields.find((field) => field.token === "CELL0171");
  const totalOperatingExpenseYear1 = parsed.tokenFields.find((field) => field.token === "CELL0452");
  const netOperatingIncomeYear1 = parsed.tokenFields.find((field) => field.token === "CELL0487");
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
  assert.equal(assetValue?.defaultValue, "3.3M");
  assert.equal(assetValue?.source, "derived");
  assert.equal(expenseReduction?.defaultValue, "2%");
  assert.equal(expenseReduction?.source, "derived");
  assert.equal(noiIncrease?.defaultValue, "43");
  assert.equal(noiIncrease?.source, "derived");
  assert.equal(revenueLift?.defaultValue, "217");
  assert.equal(revenueLift?.source, "derived");
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
  assert.equal(totalOperatingIncomeYear1?.defaultValue, "$1,061,466");
  assert.equal(totalOperatingExpenseYear1?.defaultValue, "$363,822");
  assert.equal(netOperatingIncomeYear1?.defaultValue, "$697,644");
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

test("parsePropertyAnalysisWorkbook adapts to newer public-template layouts dynamically", async () => {
  await fs.mkdir(path.dirname(TEST_TEMPLATE_PATH), { recursive: true });
  await fs.writeFile(TEST_TEMPLATE_PATH, buildTemplateBuffer());

  const parsed = await parsePropertyAnalysisWorkbook(buildNewLayoutPublicTemplateWorkbookBuffer(), "CharlestonProformaApr.9.26.xlsx", {
    templatePath: TEST_TEMPLATE_PATH,
  });
  const rentalIncomeT12Avg = parsed.tokenFields.find((field) => field.token === "CELL0003");
  const totalOperatingIncomeYear1 = parsed.tokenFields.find((field) => field.token === "CELL0171");
  const projectedRateMonth1 = parsed.tokenFields.find((field) => field.token === "CELL0175");
  const vacancyMonth1 = parsed.tokenFields.find((field) => field.token === "CELL0187");
  const spreadBps = parsed.tokenFields.find((field) => field.token === "CELL0492");
  const interestSensitivity = parsed.tokenFields.find((field) => field.token === "CELL0621");
  const sensitivityYear = parsed.tokenFields.find((field) => field.token === "CELL0650");
  const capRateNetProceeds = parsed.tokenFields.find((field) => field.token === "CELL0656");
  const capRateMultiple = parsed.tokenFields.find((field) => field.token === "CELL0658");
  const warningsText = parsed.warnings.join(" ");

  assert.equal(parsed.metadata.workbookType, "public-proforma-template");
  assert.equal(rentalIncomeT12Avg?.defaultValue, "$104,643");
  assert.equal(totalOperatingIncomeYear1?.defaultValue, "$1,502,256");
  assert.equal(projectedRateMonth1?.defaultValue, "$1.58");
  assert.equal(vacancyMonth1?.defaultValue, "4.90%");
  assert.equal(spreadBps?.defaultValue, "220");
  assert.equal(interestSensitivity?.defaultValue, "39.8%");
  assert.equal(sensitivityYear?.defaultValue, "5");
  assert.equal(capRateNetProceeds?.defaultValue, "$29,034,926");
  assert.equal(capRateMultiple?.defaultValue, "4.60");
  assert.doesNotMatch(warningsText, /Total Operating Income summary row/i);
  assert.doesNotMatch(warningsText, /unable to locate row "Rental Income"/i);
  assert.doesNotMatch(warningsText, /unable to locate "Spread \(bps\)"/i);
  assert.doesNotMatch(warningsText, /interest sensitivity row/i);
  assert.doesNotMatch(warningsText, /cap rate sensitivity row/i);
});

test("parsePropertyAnalysisWorkbook resolves expanded slide 4 and 5 package-table tokens", async () => {
  const templatePath = path.join(process.cwd(), "public", "PackageTemplate.pptx");
  const parsed = await parsePropertyAnalysisWorkbook(
    buildExpandedLegacyPublicTemplateWorkbookBuffer(),
    "ABQYaleProformaApr26.xlsx",
    { templatePath },
  );

  const storeRateMgmtT12Avg = parsed.tokenFields.find((field) => field.token === "CELL1000");
  const storeRateMgmtCurrent = parsed.tokenFields.find((field) => field.token === "CELL1005");
  const discountImpact = parsed.tokenFields.find((field) => field.token === "CELL1008");
  const adminFeeImpact = parsed.tokenFields.find((field) => field.token === "CELL1011");
  const storeTenantProtectionCurrent = parsed.tokenFields.find((field) => field.token === "CELL1014");
  const otherTenantT12Avg = parsed.tokenFields.find((field) => field.token === "CELL1015");
  const advertisingImpact = parsed.tokenFields.find((field) => field.token === "CELL1030");
  const currentPaymentProcessingStore = parsed.tokenFields.find((field) => field.token === "CELL1063");
  const storeMgmtT12Avg = parsed.tokenFields.find((field) => field.token === "CELL1098");
  const securityT12Avg = parsed.tokenFields.find((field) => field.token === "CELL1100");
  const bankChargesT12Avg = parsed.tokenFields.find((field) => field.token === "CELL1102");
  const otherExpenseT12Avg = parsed.tokenFields.find((field) => field.token === "CELL1135");

  assert.equal(storeRateMgmtT12Avg?.defaultValue, "$-");
  assert.equal(storeRateMgmtCurrent?.defaultValue, "$-");
  assert.equal(discountImpact?.defaultValue, "$-");
  assert.equal(adminFeeImpact?.defaultValue, "$-");
  assert.equal(storeTenantProtectionCurrent?.defaultValue, "$-");
  assert.equal(otherTenantT12Avg?.defaultValue, "$49");
  assert.equal(advertisingImpact?.defaultValue, "$(2,588)");
  assert.equal(currentPaymentProcessingStore?.defaultValue, "$-");
  assert.equal(storeMgmtT12Avg?.defaultValue, "$-");
  assert.equal(securityT12Avg?.defaultValue, "$219");
  assert.equal(bankChargesT12Avg?.defaultValue, "$-");
  assert.equal(otherExpenseT12Avg?.defaultValue, "$-");
});

test("parsePropertyAnalysisWorkbook derives slide 2 callouts from T-12 and STORE values instead of comparison columns", async () => {
  await fs.mkdir(path.dirname(TEST_TEMPLATE_PATH), { recursive: true });
  await fs.writeFile(TEST_TEMPLATE_PATH, buildTemplateBuffer());

  const parsed = await parsePropertyAnalysisWorkbook(buildPublicTemplateWorkbookBuffer(), "PublicProformaTemplate3.18.xlsx", {
    templatePath: TEST_TEMPLATE_PATH,
  });

  const revenueLift = parsed.tokenFields.find((field) => field.token === "REVENUELIFT");
  const expenseReduction = parsed.tokenFields.find((field) => field.token === "EXPREDPERC");
  const noiIncrease = parsed.tokenFields.find((field) => field.token === "NOIPERCENT");
  const assetValue = parsed.tokenFields.find((field) => field.token === "ASSETVALUE");
  const totalOperatingIncomeYear1 = parsed.tokenFields.find((field) => field.token === "CELL0171");
  const totalOperatingExpenseYear1 = parsed.tokenFields.find((field) => field.token === "CELL0452");
  const netOperatingIncomeYear1 = parsed.tokenFields.find((field) => field.token === "CELL0487");

  assert.equal(totalOperatingIncomeYear1?.defaultValue, "$1,061,466");
  assert.equal(totalOperatingExpenseYear1?.defaultValue, "$363,822");
  assert.equal(netOperatingIncomeYear1?.defaultValue, "$697,644");
  assert.equal(revenueLift?.defaultValue, "217");
  assert.equal(expenseReduction?.defaultValue, "2%");
  assert.equal(noiIncrease?.defaultValue, "43");
  assert.equal(assetValue?.defaultValue, "3.3M");
  assert.notEqual(revenueLift?.defaultValue, "93");
  assert.notEqual(expenseReduction?.defaultValue, "3%");
  assert.notEqual(noiIncrease?.defaultValue, "18");
  assert.notEqual(assetValue?.defaultValue, "1.7M");
});

test("parsePropertyAnalysisWorkbook leaves comparison callouts manual and warns when Public workbook proforma data is missing", async () => {
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
  assert.match(parsed.warnings.join(" "), /proforma sheet is missing/i);
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

test("real workbook and managed template reconcile slide 2 and slide 4/5 values to the same proforma source of truth", async () => {
  const workbookBuffer = await fs.readFile(path.join(process.cwd(), "templates", "PublicProformaTemplate3.18.xlsx"));
  const templatePath = path.join(process.cwd(), "public", "PackageTemplate.pptx");
  const parsed = await parsePropertyAnalysisWorkbook(workbookBuffer, "PublicProformaTemplate3.18.xlsx", {
    templatePath,
  });
  const rendered = await renderPropertyAnalysisPackage(buildFinalTokenMap(parsed, {}), { templatePath });
  const zip = new PizZip(rendered);
  const slide2Xml = zip.file("ppt/slides/slide2.xml")?.asText() ?? "";
  const slide4Xml = zip.file("ppt/slides/slide4.xml")?.asText() ?? "";
  const slide5Xml = zip.file("ppt/slides/slide5.xml")?.asText() ?? "";

  assert.match(slide2Xml, /43%/);
  assert.match(slide2Xml, /2%/);
  assert.match(slide2Xml, /\$217K\+/);
  assert.match(slide2Xml, /\$3\.3M/);
  assert.match(slide4Xml, /\$844,708/);
  assert.match(slide4Xml, /\$1,061,466/);
  assert.match(slide5Xml, /\$356,103/);
  assert.match(slide5Xml, /\$363,822/);
  assert.match(slide5Xml, /\$488,605/);
  assert.match(slide5Xml, /\$697,644/);
  assert.doesNotMatch(slide2Xml, /\$93K\+/);
  assert.doesNotMatch(slide2Xml, /18% NOI Increase/);
  assert.doesNotMatch(slide2Xml, /3% Expense Reduction/);
  assert.doesNotMatch(slide2Xml, /\$1\.7M/);
});

test("buildPackageFileName creates a stable export name", () => {
  const fileName = buildPackageFileName("Roseville CA (Baseline Rd)", new Date("2026-03-25T12:00:00Z"));
  assert.equal(fileName, "Property_Analysis_Package - Roseville_CA_Baseline_Rd_2026-03-25.pptx");
});
