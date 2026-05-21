import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import * as XLSX from "xlsx";
import {
  buildExrHummingbirdWorkbookBuffer,
  __internal,
  type ExrHummingbirdInput,
} from "../src/lib/exrHummingbird";

const CSV_HEADERS = {
  units: [
    "COMMON_KEY",
    "RENTAL_UNIT_KEY",
    "UNIT_NUMBER",
    "SITE_ID",
    "DIMENSIONS",
    "ATTRIBUTES",
    "ATTRIBUTES_MEANING",
    "STATUS",
    "STATUS_MEANING",
    "RENT_RATE",
    "STREET_RATE",
    "RATE_EFF_DATE",
  ],
  accounts: [
    "REF_KEY",
    "SITE_ID",
    "COMMONKEY",
    "CONTACT_KEY",
    "RENTAL_UNIT_KEY",
    "UNIT_NUMBER",
    "ACCOUNT_NAME",
    "ACCOUNT_CLASS",
    "ACCOUNT_CLASS_MEANING",
    "PRIMARY_FIRST_NAME",
    "PRIMARY_LAST_NAME",
    "PRIMARY_ADDRESS_LINE1",
    "PRIMARY_ADDRESS_LINE2",
    "PRIMARY_ADDRESS_CITY",
    "PRIMARY_ADDRESS_STATE",
    "PRIMARY_ADDRESS_COUNTRY",
    "PRIMARY_ADDRESS_POSTAL_CODE",
    "PRIMARY_EMAIL_ADDRESS",
    "PRIMARY_PHONE_TYPE_MEANING",
    "PRIMARY_PHONE_NUMBER",
    "SECONDARY_PHONE_TYPE_MEANING",
    "SECONDARY_PHONE_NUMBER",
    "IDENTIFICATION_NO",
    "DRIVERS_LICENSE_STATE",
    "IDENTIFICATION_EXP",
    "DATE_OF_BIRTH",
    "GATE_PIN",
    "GATE24HR",
    "EASYPAY",
    "RENTAL_START_DATE",
    "MOVE_OUT_DATE",
    "STATUS_MEANING",
    "PAID_THRU_DATE",
    "INSURANCE_START_DATE",
    "INSURANCE_TYPE",
    "INSURANCE_PRICE",
    "INSURANCE_COVERAGE",
    "ALTERNATE_FIRST_NAME",
    "ALTERNATE_LAST_NAME",
    "ALTERNATE_EMAIL_ADDRESS",
    "ALTERNATE_PHONE_TYPE_MEANING",
    "ALTERNATE_PRIMARY_PHONE_NUMBER",
    "SECURITY_DEPOSIT",
    "FEES_BALANCE",
    "CREDITS_BALANCE",
  ],
  notes: ["COMMON_KEY", "SITE_ID", "SYS_NOTE", "NOTE", "CREATED"],
  pcd: [
    "COMMONKEY",
    "RENTAL_UNIT_KEY",
    "GIVEN_DATE",
    "EFF_DATE",
    "END_DATE",
    "STATUS",
    "DISC_PERC",
    "DISC_AMT",
    "REASON_CODE",
    "REASON_DESC",
    "REV_CAT",
    "REFILLS",
  ],
} as const;

function csvLine(values: readonly string[]): string {
  return values
    .map((value) => {
      if (!/[",\n]/.test(value)) return value;
      return `"${value.replace(/"/g, '""')}"`;
    })
    .join(",");
}

function makeCsv(headers: readonly string[], rows: Array<Record<string, string>>): Buffer {
  const lines = [csvLine(headers)];
  for (const row of rows) {
    lines.push(csvLine(headers.map((header) => row[header] ?? "")));
  }
  return Buffer.from(lines.join("\n"), "utf8");
}

function buildDispositionWorkbook(): Buffer {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      [],
      ["", "", "", "", "", "", "", "", "Walk Thru List"],
      [],
      ["", "", "", "", "", "", "", "9001 - Test Site"],
      [],
      [],
      ["", "", "", "Unit", "Merge With", "Status", "", "", "", "DIM", "Type"],
      ["", "", "", "101", "", "Rented", "", "", "", "05X10", "CDN"],
      ["", "", "", "102", "", "Available", "", "", "", "10X10", "CON"],
      ["", "", "", "103", "", "Rented", "", "", "", "05X05", "CEN"],
    ]),
    "9001 Walk Thru",
  );
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      [],
      ["", "", "", "", "", "Rent Roll"],
      [],
      [],
      ["", "", "", "", "", "", "", "9001 - Test Site on 5/13/2026 9:00:00 AM"],
    ]),
    "9001 Rent Roll",
  );
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      [],
      ["", "", "", "", "", "Promotion Usage"],
      [],
      [],
      ["", "", "", "", "", "9001 - Test Site from 4/28/2026 to 5/12/2026"],
      [],
      [],
      [],
      ["Date", "", "", "Discount", "", "", "Description", "", "Account", "Primary Contact", "Military", "Unit", "Amount"],
      ["5/1/2026", "", "", "MLS-Senior-5% Ongoing", "", "", "Senior Discount - 5%", "", "Jane Tenant", "Jane Tenant", "No", "101", "$$5.00"],
      ["5/1/2026", "", "", "MLS-Senior-5% Ongoing", "", "", "Senior Discount - 5%", "", "Jane Tenant", "Jane Tenant", "No", "101", "$$5.00"],
      ["5/2/2026", "", "", "CBB-First Month Free", "", "", "First Month Free", "", "Pat Tenant", "Pat Tenant", "No", "103", "$$100.00"],
    ]),
    "9001 Promo Usage",
  );
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

function buildTemplateWorkbook(): Buffer {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ["Space", "", "Space Type", "Width", "Length", "Height", "Rate", "Space Category", "Floor", "Door Width", "Door Height", "Space Size ", "Sq. Ft."],
      ["101 or A-101", "Occupied or Vacant", "Storage or Parking"],
    ]),
    "Space mix",
  );
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ["Space", "", "First Name", "Last Name", "Middle Name", "Rent", "Move In Date", "Active Military", "Account Code", "Address", "City", "State", "ZIP", "Country", "Email", "Cell Phone ", "Home Phone", "Work Phone", "Access Code", "DL Id", "DL State", "DL City", "DL Exp Date", "Alt First Name", "Alt Last Name", "Alt Middle Name", "Alt Address", "Alt City", "Alt State", "Alt ZIP", "Alt Email", "Alt Home Phone", "Alt Work Phone", "Alt Cell Phone"],
      ["101 or A-101", "Occupied or Vacant"],
    ]),
    "Tenant Info",
  );
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ["Space", "", "First Name", "Last Name", "Lien Holder First Name", "Lien Holder Last Name", "Lien Holder Email", "Lien Holder Phone", "Lien Holder Address 1", "Lien Holder Address 2", "Lien Holder City", "Lien Holder State", "Lien Holder Zipcode"],
      ["101 or A-101", "Occupied or Vacant"],
    ]),
    "Tenants Lien Holder Information",
  );
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ["Space", "", "Active Military", "First Name", "Last Name", "Commanding Officer First Name", "Commanding Officer Last Name", "Commanding Officer Phone", "Commanding Officer Email", "Rank", "Military Serial Number", "Military Email", "Service Member DOB", "Expiration Term of Service", "Military Branch", "Military Unit Name", "Military Unit Phone", "Military Unit Address 1", "Military Unit Address 2", "Military City", "Military Unit State ", "Military Unit Zipcode"],
      ["101 or A-101", "Occupied or Vacant"],
    ]),
    "Tenants Military Information",
  );
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ["Space", "", "First Name", "Last Name", "Rent", "Last Rent Change Date", "Move In Date", "Paid Date", "Bill Day", "Paid Through Date", "Validation FOM Only (Please see comment for instructions) ", "", "Rent Balance", "Late Fees Balance", "Lien Fees Balance", "Fees Balance", "Prepaid Rent", "Prepaid Additional Rent/Premium", "Tax Balance", "Prepaid Tax", "Security Deposit ", "Security Deposit Balance", "Protection/Insurance Balance", "Protection/Insurance Provider", "Protection/Insurance Coverage", "Additional Rent/Premium", "Merchandise Balance"],
      ["101 or A-101", "Occupied or Vacant"],
    ]),
    "Tenant Payment info",
  );
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ["Space", "First Name", "Last Name", "Promotion", "Promotion Type", "Promotion Value", "Promotion Start", "Promotion Length", "Discount", "Discount Type", "Discount Value"],
      ["101", "Joe", "Doe"],
    ]),
    "PromotionsDiscounts",
  );
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([[
      "Owner", "Name", "Building", "Occupied or Vacant", "Space", "Width", "Length", "Height", "Rate", "Web Rate (not there on app right now)", "Space Size ", "Space Category", "Space Type", "Door Width", "Door Height", "Amenities", "Sq. Ft.", "Floor", "First Name", "Last Name", "Middle Name", "Account Code", "Address", "City", "State", "ZIP", "Country", "Email", "Cell Phone ", "Home Phone", "Work Phone", "Access Code", "DOB", "Gender", "Active Military", "DL Id", "DL State", "DL City", "DL Exp Date", "Rent", "Last Rent Change Date", "Move In Date", "Move Out Date", "Paid Date", "Bill Day", "Paid Through Date", "Alt First Name", "Alt Last Name", "Alt Middle Name", "Alt Address", "Alt City", "Alt State", "Alt ZIP", "Alt Email", "Alt Home Phone", "Alt Work Phone", "Alt Cell Phone", "Security Deposit ", "Security Deposit Balance", "Rent Balance", "Fees Balance", "Protection/Insurance Balance", "Merchandise Balance", "Late Fees Balance", "Lien Fees Balance", "Tax Balance", "Prepaid Rent", "Prepaid Additional Rent/Premium", "Prepaid Tax", "Protection/Insurance Provider", "Protection/Insurance Coverage", "Additional Rent/Premium", "Delinquency Status", "Lien Status", "Lien Posted Date", "Promotion", "Promotion Type", "Promotion Value", "Promotion Start", "Promotion Length", "Discount", "Discount Type", "Discount Value", "Commanding Officer First Name", "Commanding Officer Last Name", "Commanding Officer Phone", "Commanding Officer Email", "Rank", "Military Serial Number", "Military Email", "Service Member DOB", "Expiration Term of Service", "Military Branch", "Military Unit Name", "Military Unit Phone", "Military Unit Address 1", "Military Unit Address 2", "Military City", "Military Unit State ", "Military Unit Zipcode", "Lien Holder First Name", "Lien Holder Last Name", "Lien Holder Email", "Lien Holder Phone", "Lien Holder Address 1", "Lien Holder Address 2", "Lien Holder City", "Lien Holder State", "Lien Holder Zipcode",
    ]]),
    "Final Sheet (View Only)",
  );
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([[
      "Owner", "Name", "Status", "Space", "Width", "Length", "Height", "Rate", "Web_Rate", "Space_Size", "Space_Category", "Space_Type", "Door_Width", "Door_Height", "Amenities", "Sq_Ft", "Floor", "First_Name", "Last_Name", "Middle_Name", "Account_Code", "Address", "Address2", "City", "State", "ZIP", "country", "Email", "Cell_Phone", "Home_Phone", "Work_Phone", "Access_Code", "DOB", "Active_military", "DL_ID", "DL_State", "Rent", "Last_Rent_Change_Date", "Last_rent_amt", "Scheduled_Rent_Change_Date", "Scheduled_Rent", "Scheduled_Rent_Notification", "Move_In_Date", "Move_Out_Date", "Paid_date", "Bill_Day", "Paid_Through_Date", "Alt_First_Name", "Alt_Last_Name", "Alt_Middle_Name", "Alt_Address", "Alt_Address2", "Alt_City", "Alt_State", "Alt_ZIP", "Alt_Email", "Alt_Home_Phone", "Alt_Work_Phone", "Alt_Cell_Phone", "Security_Deposit", "Security_Deposit_Balance", "Rent_Balance", "Fees_Balance", "Protection_Plan_Balance", "Merchandise_Balance", "Late_Fees_Balance", "Tax_Balance", "Prepaid_Rent", "Protection_Provider", "Protection_start_date", "Protection_end_date", "Protection_Coverage", "Additional_Rent", "Promotion", "Promotion_Type", "Promotion_Value", "Promotion_Start", "Promotion_End", "Promotion_Length", "Discount", "Discount_Type", "Discount_Value", "Alarm_Enabled", "Twenty_Four_Hour_Access", "payment_cycle", "IsBusinessLease", "start_date", "company_name", "company_address", "company_address2", "company_city", "company_state", "company_zip", "company_phone", "company_email",
    ]]),
    "MIG Team Final Sheet",
  );
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

function buildInput(): ExrHummingbirdInput {
  const units = makeCsv(CSV_HEADERS.units, [
    { COMMON_KEY: "0", RENTAL_UNIT_KEY: "u101", UNIT_NUMBER: "101", SITE_ID: "9001", DIMENSIONS: "5X10", ATTRIBUTES: "4", STATUS: "R", STATUS_MEANING: "Rented", RENT_RATE: "100", STREET_RATE: "120", RATE_EFF_DATE: "5/1/2026" },
    { COMMON_KEY: "0", RENTAL_UNIT_KEY: "u102", UNIT_NUMBER: "102", SITE_ID: "9001", DIMENSIONS: "10X10", ATTRIBUTES: "28", STATUS: "A", STATUS_MEANING: "Available", RENT_RATE: "80", STREET_RATE: "80", RATE_EFF_DATE: "5/1/2026" },
    { COMMON_KEY: "0", RENTAL_UNIT_KEY: "u103", UNIT_NUMBER: "103", SITE_ID: "9001", DIMENSIONS: "5X5", ATTRIBUTES: "18", STATUS: "R", STATUS_MEANING: "Rented", RENT_RATE: "50", STREET_RATE: "60", RATE_EFF_DATE: "5/1/2026" },
    { COMMON_KEY: "0", RENTAL_UNIT_KEY: "u104", UNIT_NUMBER: "104", SITE_ID: "9001", DIMENSIONS: "5X5", ATTRIBUTES: "18", STATUS: "X", STATUS_MEANING: "Unavailable Merged", RENT_RATE: "50", STREET_RATE: "60", RATE_EFF_DATE: "5/1/2026" },
  ]);
  const accounts = makeCsv(CSV_HEADERS.accounts, [
    {
      REF_KEY: "r101", SITE_ID: "9001", COMMONKEY: "c101", CONTACT_KEY: "ct101", RENTAL_UNIT_KEY: "u101", UNIT_NUMBER: "101", ACCOUNT_NAME: "Jane Tenant", ACCOUNT_CLASS: "P", ACCOUNT_CLASS_MEANING: "Personal", PRIMARY_FIRST_NAME: "Jane", PRIMARY_LAST_NAME: "Tenant", PRIMARY_ADDRESS_LINE1: "1 Main St", PRIMARY_ADDRESS_CITY: "Phoenix", PRIMARY_ADDRESS_STATE: "AZ", PRIMARY_ADDRESS_COUNTRY: "USA", PRIMARY_ADDRESS_POSTAL_CODE: "85018", PRIMARY_EMAIL_ADDRESS: "jane@example.com", PRIMARY_PHONE_TYPE_MEANING: "Mobile", PRIMARY_PHONE_NUMBER: "(602) 555-1212", GATE_PIN: "12345678", GATE24HR: "0", EASYPAY: "Y", RENTAL_START_DATE: "1/1/2026 0:00", STATUS_MEANING: "Paid", PAID_THRU_DATE: "8/15/2026 0:00", INSURANCE_START_DATE: "1/1/2026 0:00", INSURANCE_TYPE: "Insured", INSURANCE_PRICE: "10", INSURANCE_COVERAGE: "2000",
    },
    {
      REF_KEY: "r103", SITE_ID: "9001", COMMONKEY: "c103", CONTACT_KEY: "ct103", RENTAL_UNIT_KEY: "u103", UNIT_NUMBER: "103", ACCOUNT_NAME: "Pat Tenant", ACCOUNT_CLASS: "B", ACCOUNT_CLASS_MEANING: "Business", PRIMARY_FIRST_NAME: "Pat", PRIMARY_LAST_NAME: "Tenant", PRIMARY_ADDRESS_LINE1: "2 Main St", PRIMARY_ADDRESS_CITY: "Tempe", PRIMARY_ADDRESS_STATE: "AZ", PRIMARY_ADDRESS_COUNTRY: "USA", PRIMARY_ADDRESS_POSTAL_CODE: "85281", PRIMARY_EMAIL_ADDRESS: "pat@example.com", PRIMARY_PHONE_TYPE_MEANING: "Mobile", PRIMARY_PHONE_NUMBER: "(602) 555-3434", GATE_PIN: "87654321", GATE24HR: "1", EASYPAY: "N", RENTAL_START_DATE: "2/1/2026 0:00", STATUS_MEANING: "Paid", PAID_THRU_DATE: "5/31/2026 0:00", INSURANCE_TYPE: "Uninsured", INSURANCE_PRICE: "0", INSURANCE_COVERAGE: "0",
    },
  ]);
  return {
    siteInfo: Buffer.from("Site Name: 9001 - Test Site\nSite Number: 9001\nSite Address: 1 Test Way Phoenix, AZ 85018\n", "utf8"),
    siteUnits: units,
    accounts,
    notes: makeCsv(CSV_HEADERS.notes, [{ COMMON_KEY: "c101", SITE_ID: "9001", SYS_NOTE: "General", NOTE: "No special handling", CREATED: "1-Jan-2026" }]),
    pcd: makeCsv(CSV_HEADERS.pcd, [{ COMMONKEY: "c101", RENTAL_UNIT_KEY: "u101", GIVEN_DATE: "5/1/2026", EFF_DATE: "5/1/2026", STATUS: "Active", DISC_PERC: "True", DISC_AMT: "5.00000000", REASON_DESC: "MLS-Senior-5% Ongoing", REV_CAT: "150002", REFILLS: "0" }]),
    dispositionReport: buildDispositionWorkbook(),
  };
}

test("validates required CSV headers", () => {
  assert.throws(
    () => __internal.parseSiteUnits(Buffer.from("UNIT_NUMBER\n101\n", "utf8")),
    /missing required column/i,
  );
});

test("normalizes EXR records into included units, dimensions, floor/category, payment, and promo fields", () => {
  const parsed = __internal.parseExrHummingbirdBundle(buildInput());
  const normalized = __internal.buildNormalizedUnits(parsed);
  assert.equal(normalized.units.length, 3);

  const unit101 = normalized.units.find((unit) => unit.unitNumber === "101");
  assert.ok(unit101);
  assert.equal(unit101.status, "Occupied");
  assert.equal(unit101.width, 10);
  assert.equal(unit101.length, 5);
  assert.equal(unit101.spaceCategory, "Climate Controlled");
  assert.equal(unit101.floor, "1");
  assert.equal(unit101.payment?.prepaidRent, 300);
  assert.equal(unit101.payment?.prepaidPremium, 30);
  assert.equal(unit101.promotion?.description, "Senior Discount - 5%");

  const unit102 = normalized.units.find((unit) => unit.unitNumber === "102");
  assert.equal(unit102?.status, "Vacant");
  assert.equal(unit102?.spaceCategory, "Drive Up Climate Controlled");
  assert.equal(unit102?.floor, "0");

  const unit103 = normalized.units.find((unit) => unit.unitNumber === "103");
  assert.equal(unit103?.payment?.importPaidThroughDate?.toISOString().slice(0, 10), "2026-05-31");
});

test("buildExrHummingbirdWorkbookBuffer writes a reviewable workbook", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "exr-hummingbird-test-"));
  const templatePath = path.join(tempDir, "template.xlsx");
  await fs.writeFile(templatePath, buildTemplateWorkbook());

  const built = await buildExrHummingbirdWorkbookBuffer(buildInput(), { templatePath });
  assert.equal(built.summary.sourceUnitCount, 4);
  assert.equal(built.summary.includedUnitCount, 3);
  assert.equal(built.summary.excludedUnitCount, 1);
  assert.equal(built.summary.occupiedCount, 2);
  assert.equal(built.summary.vacantCount, 1);
  assert.equal(built.summary.promotionUnitCount, 2);
  assert.equal(built.summary.prepaidTenantCount, 1);

  const workbook = XLSX.read(built.buffer, { type: "buffer" });
  const spaceRows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets["Space mix"], { header: 1, raw: false, defval: "" });
  const paymentRows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets["Tenant Payment info"], { header: 1, raw: false, defval: "" });
  const migRows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets["MIG Team Final Sheet"], { header: 1, raw: false, defval: "" });

  assert.equal(spaceRows[2]?.[0], "101");
  assert.equal(spaceRows[2]?.[3], "10");
  assert.equal(spaceRows[2]?.[4], "5");
  assert.equal(paymentRows[2]?.[16], "300");
  assert.equal(paymentRows[2]?.[23], "EXR CPP");
  assert.equal(migRows[1]?.[20], "1212");
  assert.equal(migRows[1]?.[79], "Senior Discount - 5%");
  assert.equal(migRows[1]?.[80], "Percentage");
  assert.equal(migRows[2]?.[2], "Vacant");
});

test("local Plymouth validation fixture matches expected transfer counts when files are available", async (t) => {
  const desktop = "C:/Users/AlexBurke/Desktop";
  const paths = {
    siteInfo: path.join(desktop, "Site Info.txt"),
    siteUnits: path.join(desktop, "stage_op_site_units.csv"),
    accounts: path.join(desktop, "stage_op_accounts.csv"),
    notes: path.join(desktop, "stage_op_notes.csv"),
    pcd: path.join(desktop, "stage_op_pcd.csv"),
    dispositionReport: path.join(desktop, "6197 Plymouth - Disposition Final Reports.xlsx"),
  };
  const availability = await Promise.all(Object.values(paths).map(async (filePath) => fs.access(filePath).then(() => true).catch(() => false)));
  if (availability.some((exists) => !exists)) {
    t.skip("Local Plymouth desktop files are not available.");
    return;
  }

  const input: ExrHummingbirdInput = {
    siteInfo: await fs.readFile(paths.siteInfo),
    siteUnits: await fs.readFile(paths.siteUnits),
    accounts: await fs.readFile(paths.accounts),
    notes: await fs.readFile(paths.notes),
    pcd: await fs.readFile(paths.pcd),
    dispositionReport: await fs.readFile(paths.dispositionReport),
  };
  const parsed = __internal.parseExrHummingbirdBundle(input);
  const normalized = __internal.buildNormalizedUnits(parsed);

  assert.equal(parsed.siteUnits.length, 857);
  assert.equal(normalized.units.length, 830);
  assert.equal(normalized.units.filter((unit) => unit.status === "Occupied").length, 763);
  assert.equal(normalized.units.filter((unit) => unit.status === "Vacant").length, 67);
  assert.equal(normalized.units.filter((unit) => unit.promotion).length, 45);
});
