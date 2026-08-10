import assert from "node:assert/strict";
import test from "node:test";
import { parseCsv, toCsvLine } from "../src/lib/accounting/faciliqInvoiceImport/csv";
import {
  buildPropertyFiles,
  buildReviewFile,
} from "../src/lib/accounting/faciliqInvoiceImport/buildSplitFiles";
import {
  reviewInvoiceCsv,
  collectFlaggedRows,
  type FaciliqInvoiceReport,
  type InvoiceFlagCode,
} from "../src/lib/accounting/faciliqInvoiceImport/reviewInvoices";
import { parseCsvAmount, parseCsvDate } from "../src/lib/accounting/faciliqInvoiceImport/values";

/**
 * The header and first data row are taken verbatim from the real weekly export
 * store-quickbooks-2026-07-28-to-2026-08-03.csv.
 */
const HEADER_CELLS = [
  "*InvoiceNo",
  "*Customer",
  "*InvoiceDate",
  "*DueDate",
  "Terms",
  "Location",
  "Memo",
  "Item(Product/Service)",
  "ItemDescription",
  "ItemQuantity",
  "ItemRate",
  "*ItemAmount",
  "Service Date",
  "PropertyName",
  "GLCode",
];

const SOURCE_FILENAME = "store-quickbooks-2026-07-28-to-2026-08-03.csv";
const AS_OF = "2026-08-06";

type RowOverrides = {
  invoiceNo?: string;
  customer?: string;
  invoiceDate?: string;
  dueDate?: string;
  item?: string;
  description?: string;
  quantity?: string;
  rate?: string;
  amount?: string;
  serviceDate?: string;
  property?: string;
  glCode?: string;
};

const rowCells = (overrides: RowOverrides = {}): string[] => [
  overrides.invoiceNo ?? "RNM-48217",
  overrides.customer ?? "Willow River Company",
  overrides.invoiceDate ?? "7/31/2026",
  overrides.dueDate ?? "7/31/2026",
  "",
  "15755 32nd Ave. N Plymouth, MN 55447",
  "",
  overrides.item ?? "Site-Grounds (Incl. Storm Drains, Ponds, Landscaping)",
  overrides.description ?? "Mowing - Biweekly, Fertilizer Program",
  overrides.quantity ?? "1",
  overrides.rate ?? "325.58",
  overrides.amount ?? "325.58",
  overrides.serviceDate ?? "7/27/2026",
  overrides.property ?? "P006 - STORE on Vicksburg",
  overrides.glCode ?? "5100-1110",
];

const buildFile = (rows: string[][], header: string[] = HEADER_CELLS): string =>
  [header, ...rows].map(toCsvLine).join("\r\n");

const review = (rows: string[][], header?: string[]): FaciliqInvoiceReport =>
  reviewInvoiceCsv(buildFile(rows, header), {
    sourceFilename: SOURCE_FILENAME,
    asOfIso: AS_OF,
  });

const codesOf = (flags: readonly { code: InvoiceFlagCode }[]): InvoiceFlagCode[] =>
  flags.map((flag) => flag.code).sort();

const bucket = (report: FaciliqInvoiceReport, code: string) => {
  const found = report.properties.find((entry) => entry.code === code);
  assert.ok(found, `expected a ${code} bucket`);
  return found;
};

// --- CSV reader ------------------------------------------------------------

test("parseCsv keeps quoted commas inside one cell", () => {
  const records = parseCsv('a,"one, two",c');
  assert.deepEqual(records[0].cells, ["a", "one, two", "c"]);
});

test("parseCsv reads CRLF rows and a file with no trailing newline", () => {
  const records = parseCsv("h1,h2\r\nv1,v2\r\nv3,v4");
  assert.equal(records.length, 3);
  assert.deepEqual(records[2].cells, ["v3", "v4"]);
  assert.equal(records[2].line, 3);
});

test("parseCsv unescapes doubled quotes and keeps newlines inside a quoted cell", () => {
  const records = parseCsv('a,"say ""hi""",c\r\nd,"line1\nline2",f\r\ng,h,i');
  assert.deepEqual(records[0].cells, ["a", 'say "hi"', "c"]);
  assert.deepEqual(records[1].cells, ["d", "line1\nline2", "f"]);
  // The embedded newline must not shift the reported line number of the next row.
  assert.equal(records[2].line, 4);
});

test("parseCsv strips a UTF-8 BOM from the first header cell", () => {
  const records = parseCsv("﻿*InvoiceNo,*Customer");
  assert.deepEqual(records[0].cells, ["*InvoiceNo", "*Customer"]);
});

test("parseCsv ignores a trailing newline instead of inventing a row", () => {
  assert.equal(parseCsv("a,b\r\nc,d\r\n").length, 2);
});

// --- Value parsers ---------------------------------------------------------

test("parseCsvDate reads the M/D/YYYY form FacilIQ sends and rejects impossible dates", () => {
  assert.equal(parseCsvDate("7/31/2026")?.iso, "2026-07-31");
  assert.equal(parseCsvDate("2026-07-31")?.iso, "2026-07-31");
  assert.equal(parseCsvDate("7/31/26")?.iso, "2026-07-31");
  assert.equal(parseCsvDate("2/30/2026"), null);
  assert.equal(parseCsvDate("13/1/2026"), null);
  assert.equal(parseCsvDate("2/29/2028")?.iso, "2028-02-29");
  assert.equal(parseCsvDate("July 31 2026"), null);
});

test("parseCsvAmount handles currency formatting and accounting negatives", () => {
  assert.deepEqual(parseCsvAmount("325.58"), { value: 325.58, hadFormatting: false });
  assert.equal(parseCsvAmount("$1,234.56")?.value, 1234.56);
  assert.equal(parseCsvAmount("$1,234.56")?.hadFormatting, true);
  assert.equal(parseCsvAmount("(50.00)")?.value, -50);
  assert.equal(parseCsvAmount("50.00-")?.value, -50);
  assert.equal(parseCsvAmount("abc"), null);
  assert.equal(parseCsvAmount("1.2.3"), null);
  assert.equal(parseCsvAmount(""), null);
});

// --- The real export row ---------------------------------------------------

test("the real weekly row is held back for exactly one reason: a blank invoice number", () => {
  const report = review([rowCells({ invoiceNo: "" })]);

  assert.equal(report.ok, true);
  assert.equal(report.totals.dataRows, 1);
  assert.equal(report.totals.readyRows, 0);
  assert.equal(report.totals.flaggedRows, 1);

  const flagged = collectFlaggedRows(report);
  assert.equal(flagged.length, 1);
  assert.deepEqual(codesOf(flagged[0].flags), ["missing-invoice-number"]);
  assert.equal(flagged[0].propertyCode, "P006");
  assert.equal(flagged[0].amount, 325.58);
  assert.equal(flagged[0].invoiceDateIso, "2026-07-31");
  assert.equal(flagged[0].sourceLine, 2);
  assert.equal(flagged[0].severity, "error");
});

test("the same row with an invoice number passes every check", () => {
  const report = review([rowCells()]);

  assert.equal(report.totals.readyRows, 1);
  assert.equal(report.totals.flaggedRows, 0);
  assert.equal(report.totals.reconciles, true);
  assert.equal(report.totals.sourceAmount, 325.58);

  const p006 = bucket(report, "P006");
  assert.equal(p006.readyRows.length, 1);
  assert.equal(p006.readyAmount, 325.58);
  assert.deepEqual(p006.readyRows[0].flags, []);
});

test("the export window is read from the filename", () => {
  const report = review([rowCells()]);
  assert.deepEqual(report.window, { startIso: "2026-07-28", endIso: "2026-08-03" });
});

// --- Header resolution -----------------------------------------------------

test("required fields report the exact header they were read from", () => {
  const report = review([rowCells()]);
  const byKey = new Map(report.columns.map((column) => [column.key, column]));

  assert.equal(byKey.get("invoiceNumber")?.header, "*InvoiceNo");
  assert.equal(byKey.get("vendor")?.header, "*Customer");
  assert.equal(byKey.get("amount")?.header, "*ItemAmount");
  assert.equal(byKey.get("invoiceDate")?.header, "*InvoiceDate");
  assert.equal(byKey.get("property")?.header, "PropertyName");
  assert.equal(byKey.get("glCode")?.header, "GLCode");
});

test("a dropped required column stops the run instead of reading rows", () => {
  const header = HEADER_CELLS.map((cell) => (cell === "GLCode" ? "SomethingElse" : cell));
  const report = review([rowCells()], header);

  assert.equal(report.ok, false);
  assert.match(report.headerError ?? "", /GL code/);
  assert.deepEqual(report.missingRequiredColumns, ["GL code"]);
  assert.equal(report.totals.dataRows, 0);
});

test("a dedicated Vendor column wins over *Customer if FacilIQ adds one", () => {
  const header = [...HEADER_CELLS, "Vendor"];
  const cells = [...rowCells(), "Rainbow Landscaping"];
  const report = reviewInvoiceCsv(buildFile([cells], header), {
    sourceFilename: SOURCE_FILENAME,
    asOfIso: AS_OF,
  });

  const vendorColumn = report.columns.find((column) => column.key === "vendor");
  assert.equal(vendorColumn?.header, "Vendor");
  assert.equal(bucket(report, "P006").readyRows[0].fields.vendor, "Rainbow Landscaping");
});

test("the Location address column is never mistaken for the property", () => {
  const report = review([rowCells()]);
  const propertyColumn = report.columns.find((column) => column.key === "property");
  assert.equal(propertyColumn?.header, "PropertyName");
});

// --- Required field checks -------------------------------------------------

test("each missing required field is flagged as an error on its own row", () => {
  const report = review([
    rowCells({ invoiceNo: "" }),
    rowCells({ invoiceNo: "A2", customer: "" }),
    rowCells({ invoiceNo: "A3", amount: "" }),
    rowCells({ invoiceNo: "A4", invoiceDate: "" }),
    rowCells({ invoiceNo: "A5", property: "" }),
    rowCells({ invoiceNo: "A6", glCode: "" }),
  ]);

  const flagged = collectFlaggedRows(report);
  assert.equal(flagged.length, 6);
  assert.deepEqual(
    flagged.flatMap((row) => codesOf(row.flags)).sort(),
    [
      "missing-amount",
      "missing-gl-code",
      "missing-invoice-date",
      "missing-invoice-number",
      "missing-property",
      "missing-vendor",
    ],
  );
  assert.equal(report.totals.readyRows, 0);
  for (const row of flagged) assert.equal(row.severity, "error");
});

test("an unreadable amount is an error and a negative amount is a warning", () => {
  const report = review([
    rowCells({ invoiceNo: "A1", amount: "n/a", quantity: "", rate: "" }),
    rowCells({ invoiceNo: "A2", amount: "(50.00)", quantity: "1", rate: "-50.00" }),
  ]);

  const flagged = collectFlaggedRows(report);
  assert.deepEqual(codesOf(flagged[0].flags), ["unreadable-amount"]);
  assert.deepEqual(codesOf(flagged[1].flags), ["negative-amount"]);
  assert.equal(flagged[1].severity, "warning");
  assert.equal(report.totals.unreadableAmountRows, 1);
});

test("quantity times rate is checked against the line amount", () => {
  const report = review([rowCells({ quantity: "2", rate: "325.58", amount: "325.58" })]);
  const flagged = collectFlaggedRows(report);
  assert.deepEqual(codesOf(flagged[0].flags), ["amount-line-mismatch"]);
  assert.match(flagged[0].flags[0].detail, /651\.16/);
});

test("a GL code outside the shapes STORE uses is flagged but not rejected outright", () => {
  // Distinct services, so the GL-consistency rule has nothing to say about either row.
  const report = review([
    rowCells({ invoiceNo: "A1", item: "Mowing", glCode: "5120-100" }),
    rowCells({ invoiceNo: "A2", item: "Snow removal", glCode: "MISC" }),
  ]);

  assert.equal(report.totals.readyRows, 1);
  const flagged = collectFlaggedRows(report);
  assert.deepEqual(codesOf(flagged[0].flags), ["gl-code-format"]);
  assert.equal(flagged[0].severity, "warning");
});

test("dates are checked against the window, today, and each other", () => {
  const report = review([
    rowCells({ invoiceNo: "A1", invoiceDate: "2/30/2026" }),
    rowCells({ invoiceNo: "A2", invoiceDate: "9/15/2026", dueDate: "9/15/2026", serviceDate: "" }),
    rowCells({ invoiceNo: "A3", dueDate: "7/20/2026" }),
    rowCells({ invoiceNo: "A4", serviceDate: "8/2/2026" }),
  ]);

  const flagged = collectFlaggedRows(report);
  assert.deepEqual(codesOf(flagged[0].flags), ["unreadable-invoice-date"]);
  assert.deepEqual(codesOf(flagged[1].flags), [
    "invoice-date-future",
    "invoice-date-outside-window",
  ]);
  assert.deepEqual(codesOf(flagged[2].flags), ["due-before-invoice-date"]);
  assert.deepEqual(codesOf(flagged[3].flags), ["service-date-after-invoice-date"]);
});

test("a service date before the invoice date is normal and is not flagged", () => {
  const report = review([rowCells({ serviceDate: "7/27/2026", invoiceDate: "7/31/2026" })]);
  assert.equal(report.totals.flaggedRows, 0);
});

// --- Property routing ------------------------------------------------------

test("all four QuickBooks properties resolve from their export labels", () => {
  const report = review([
    rowCells({ invoiceNo: "A1", property: "L001 - STORE at the Grove" }),
    rowCells({ invoiceNo: "A2", property: "P006 - STORE on Vicksburg" }),
    rowCells({ invoiceNo: "A3", property: "W002 - STORE on Pittman" }),
    rowCells({ invoiceNo: "A4", property: "W003 - STORE on Baseline" }),
  ]);

  assert.equal(report.totals.readyRows, 4);
  for (const code of ["L001", "P006", "W002", "W003"]) {
    assert.equal(bucket(report, code).readyRows.length, 1, `${code} should hold one row`);
  }
});

test("a property with no QuickBooks company of its own is held as unresolved", () => {
  const report = review([rowCells({ property: "W005 - STORE somewhere else" })]);

  assert.equal(report.unresolvedRows.length, 1);
  assert.equal(report.unresolvedRows[0].propertyCode, null);
  assert.deepEqual(codesOf(report.unresolvedRows[0].flags), ["unknown-property"]);
  assert.match(report.unresolvedRows[0].flags[0].detail, /W005/);
  assert.equal(report.totals.unresolvedAmount, 325.58);
});

test("a property label without its code still resolves by name", () => {
  const report = review([rowCells({ property: "STORE in Plymouth" })]);
  assert.equal(bucket(report, "P006").readyRows.length, 1);
});

// --- Cross-row checks ------------------------------------------------------

test("one invoice number split across two properties is an error on both rows", () => {
  const report = review([
    rowCells({ invoiceNo: "RNM-500", property: "P006 - STORE on Vicksburg" }),
    rowCells({ invoiceNo: "RNM-500", property: "W002 - STORE on Pittman" }),
  ]);

  const flagged = collectFlaggedRows(report);
  assert.equal(flagged.length, 2);
  for (const row of flagged) {
    assert.ok(codesOf(row.flags).includes("invoice-spans-properties"));
    assert.equal(row.severity, "error");
  }
  assert.match(flagged[0].flags[0].detail, /P006 and W002/);
  assert.equal(report.totals.readyRows, 0);
});

test("a multi-line invoice at one property is fine", () => {
  const report = review([
    rowCells({ invoiceNo: "RNM-501", item: "Mowing", amount: "100.00", rate: "100.00" }),
    rowCells({ invoiceNo: "RNM-501", item: "Fertilizer", amount: "225.58", rate: "225.58" }),
  ]);

  assert.equal(report.totals.flaggedRows, 0);
  assert.equal(bucket(report, "P006").readyRows.length, 2);
  assert.equal(bucket(report, "P006").readyAmount, 325.58);
});

test("one invoice number with two vendors or two dates is flagged", () => {
  const report = review([
    rowCells({ invoiceNo: "RNM-502", customer: "Willow River Company", item: "A" }),
    rowCells({ invoiceNo: "RNM-502", customer: "Someone Else", item: "B" }),
    rowCells({ invoiceNo: "RNM-503", invoiceDate: "7/30/2026", item: "C" }),
    rowCells({ invoiceNo: "RNM-503", invoiceDate: "7/31/2026", item: "D" }),
  ]);

  const flagged = collectFlaggedRows(report);
  assert.equal(flagged.length, 4);
  assert.ok(codesOf(flagged[0].flags).includes("invoice-conflicting-vendor"));
  assert.ok(codesOf(flagged[2].flags).includes("invoice-conflicting-date"));
});

test("an identical repeated line is flagged on both copies with the other row number", () => {
  const report = review([rowCells({ invoiceNo: "RNM-504" }), rowCells({ invoiceNo: "RNM-504" })]);

  const flagged = collectFlaggedRows(report);
  assert.equal(flagged.length, 2);
  for (const row of flagged) assert.ok(codesOf(row.flags).includes("duplicate-line"));
  assert.match(flagged[0].flags[0].detail, /row 3/);
  assert.match(flagged[1].flags[0].detail, /row 2/);
});

test("one service coded two ways at the same property is flagged", () => {
  const report = review([
    rowCells({ invoiceNo: "A1", item: "Mowing", glCode: "5100-1110" }),
    rowCells({ invoiceNo: "A2", item: "Mowing", glCode: "5100-2220" }),
  ]);

  const flagged = collectFlaggedRows(report);
  assert.equal(flagged.length, 2);
  for (const row of flagged) {
    assert.ok(codesOf(row.flags).includes("gl-code-conflict-at-property"));
  }
});

test("one service coded differently between properties is a note, not a held row", () => {
  const report = review([
    rowCells({ invoiceNo: "A1", item: "Mowing", glCode: "5100-1110", property: "P006 - STORE on Vicksburg" }),
    rowCells({ invoiceNo: "A2", item: "Mowing", glCode: "5100-2220", property: "W002 - STORE on Pittman" }),
  ]);

  assert.equal(report.totals.flaggedRows, 0);
  assert.equal(report.totals.readyRows, 2);
  assert.ok(report.notes.some((note) => /different GL codes at different properties/.test(note)));
});

// --- Row bookkeeping -------------------------------------------------------

test("blank rows are skipped and counted, not treated as invoices", () => {
  const text = [
    HEADER_CELLS.map(() => "").length ? toCsvLine(HEADER_CELLS) : "",
    toCsvLine(rowCells()),
    toCsvLine(HEADER_CELLS.map(() => "")),
    toCsvLine(rowCells({ invoiceNo: "RNM-2", item: "Other" })),
  ].join("\r\n");

  const report = reviewInvoiceCsv(text, { sourceFilename: SOURCE_FILENAME, asOfIso: AS_OF });
  assert.equal(report.totals.dataRows, 2);
  assert.equal(report.totals.blankRowsSkipped, 1);
  assert.ok(report.notes.some((note) => /Skipped 1 blank row/.test(note)));
});

test("a row with the wrong column count is an error and reports both widths", () => {
  const text = [toCsvLine(HEADER_CELLS), toCsvLine(rowCells().slice(0, 10))].join("\r\n");
  const report = reviewInvoiceCsv(text, { sourceFilename: SOURCE_FILENAME, asOfIso: AS_OF });

  const flagged = collectFlaggedRows(report);
  assert.ok(codesOf(flagged[0].flags).includes("column-count-mismatch"));
  assert.match(flagged[0].flags[0].detail, /10 column\(s\), header has 15/);
});

test("every row lands in exactly one bucket and the dollars reconcile", () => {
  const report = review([
    rowCells({ invoiceNo: "A1", amount: "100.00", rate: "100.00" }),
    rowCells({ invoiceNo: "", amount: "200.00", rate: "200.00", item: "B" }),
    rowCells({ invoiceNo: "A3", amount: "300.00", rate: "300.00", property: "W005 - Elsewhere" }),
    rowCells({ invoiceNo: "A4", amount: "400.00", rate: "400.00", property: "L001 - STORE at the Grove" }),
  ]);

  const { totals } = report;
  assert.equal(totals.dataRows, 4);
  assert.equal(totals.readyRows + totals.reviewRows + totals.unresolvedRows, 4);
  assert.equal(totals.sourceAmount, 1000);
  assert.equal(totals.readyAmount, 500);
  assert.equal(totals.reviewAmount, 200);
  assert.equal(totals.unresolvedAmount, 300);
  assert.equal(totals.reconciles, true);
});

test("an empty file reports a header problem rather than zero clean rows", () => {
  const report = reviewInvoiceCsv("", { sourceFilename: SOURCE_FILENAME, asOfIso: AS_OF });
  assert.equal(report.ok, false);
  assert.match(report.headerError ?? "", /empty/);
});

// --- Split files -----------------------------------------------------------

test("property files keep the original header and carry only clean rows", () => {
  const report = review([
    rowCells({ invoiceNo: "A1", property: "P006 - STORE on Vicksburg" }),
    rowCells({ invoiceNo: "", property: "P006 - STORE on Vicksburg", item: "Held" }),
    rowCells({ invoiceNo: "A3", property: "L001 - STORE at the Grove" }),
  ]);

  const files = buildPropertyFiles(report);
  assert.deepEqual(
    files.map((file) => file.filename),
    [
      "faciliq-l001-2026-07-28-to-2026-08-03.csv",
      "faciliq-p006-2026-07-28-to-2026-08-03.csv",
    ],
  );

  const p006 = files.find((file) => file.propertyCode === "P006");
  assert.ok(p006);
  const lines = p006.csv.trimEnd().split("\r\n");
  assert.equal(lines.length, 2, "header plus the one clean P006 row");
  assert.equal(parseCsv(lines[0])[0].cells.join(","), HEADER_CELLS.join(","));
  assert.equal(parseCsv(lines[1])[0].cells[0], "A1");
  assert.equal(p006.rowCount, 1);
  assert.equal(p006.amount, 325.58);
});

test("no property file is produced for a property with nothing clean this week", () => {
  const report = review([rowCells({ invoiceNo: "" })]);
  assert.deepEqual(buildPropertyFiles(report), []);
});

test("the review file lists every held row with its property, severity, and reasons", () => {
  const report = review([
    rowCells({ invoiceNo: "A1" }),
    rowCells({ invoiceNo: "", item: "Held" }),
    rowCells({ invoiceNo: "A3", property: "W005 - Elsewhere" }),
  ]);

  const file = buildReviewFile(report);
  assert.ok(file);
  assert.equal(file.filename, "faciliq-needs-review-2026-07-28-to-2026-08-03.csv");
  assert.equal(file.rowCount, 2);

  const records = parseCsv(file.csv);
  assert.deepEqual(records[0].cells.slice(0, 4), [
    "Source Row",
    "Resolved Property",
    "Severity",
    "Flags",
  ]);
  assert.deepEqual(records[1].cells.slice(0, 3), ["3", "P006", "error"]);
  assert.match(records[1].cells[3], /Missing invoice number/);
  assert.deepEqual(records[2].cells.slice(0, 3), ["4", "unresolved", "error"]);
  // The original columns follow the four review columns, unchanged.
  assert.equal(records[2].cells[4], "A3");
});

test("a fully clean file produces no review file", () => {
  const report = review([rowCells()]);
  assert.equal(buildReviewFile(report), null);
});

test("filenames fall back to the invoice-date range when the filename has no window", () => {
  const report = reviewInvoiceCsv(buildFile([rowCells()]), {
    sourceFilename: "faciliq-export.csv",
    asOfIso: AS_OF,
  });
  assert.equal(report.window, null);
  assert.equal(
    buildPropertyFiles(report)[0].filename,
    "faciliq-p006-2026-07-31-to-2026-07-31.csv",
  );
});
