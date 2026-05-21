import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";
import * as XLSX from "xlsx";

export type ExrHummingbirdInput = {
  siteInfo: Buffer;
  siteUnits: Buffer;
  accounts: Buffer;
  notes: Buffer;
  pcd: Buffer;
  dispositionReport: Buffer;
};

export type ExrHummingbirdSummary = {
  siteNumber: string;
  siteName: string;
  sourceUnitCount: number;
  includedUnitCount: number;
  excludedUnitCount: number;
  occupiedCount: number;
  vacantCount: number;
  promotionUnitCount: number;
  prepaidTenantCount: number;
  warningCount: number;
  warnings: string[];
};

export type ExrHummingbirdExport = {
  artifactName: string;
  artifactMimeType: string;
  artifactBuffer: Buffer;
  summary: ExrHummingbirdSummary;
};

export type ExrHummingbirdBuildOptions = {
  templatePath?: string;
  outputDate?: Date;
};

type CsvRow = Record<string, string>;

type SiteInfo = {
  siteName: string;
  siteNumber: string;
  siteAddress: string;
};

type SiteUnitRow = {
  commonKey: string;
  rentalUnitKey: string;
  unitNumber: string;
  siteId: string;
  dimensions: string;
  attributes: string;
  attributesMeaning: string;
  status: string;
  statusMeaning: string;
  rentRate: number | null;
  streetRate: number | null;
  rateEffectiveDate: string;
};

type AccountRow = {
  refKey: string;
  siteId: string;
  commonKey: string;
  contactKey: string;
  rentalUnitKey: string;
  unitNumber: string;
  accountName: string;
  accountClass: string;
  accountClassMeaning: string;
  primaryFirstName: string;
  primaryLastName: string;
  primaryAddressLine1: string;
  primaryAddressLine2: string;
  primaryCity: string;
  primaryState: string;
  primaryCountry: string;
  primaryPostalCode: string;
  primaryEmail: string;
  primaryPhoneTypeMeaning: string;
  primaryPhoneNumber: string;
  secondaryPhoneTypeMeaning: string;
  secondaryPhoneNumber: string;
  identificationNo: string;
  driversLicenseState: string;
  identificationExp: string;
  dateOfBirth: string;
  gatePin: string;
  gate24Hr: string;
  easyPay: string;
  rentalStartDate: Date | null;
  moveOutDate: Date | null;
  statusMeaning: string;
  paidThroughDate: Date | null;
  insuranceStartDate: Date | null;
  insuranceType: string;
  insurancePrice: number | null;
  insuranceCoverage: string;
  alternateFirstName: string;
  alternateLastName: string;
  alternateEmail: string;
  alternatePhoneTypeMeaning: string;
  alternatePhoneNumber: string;
  securityDeposit: number | null;
  feesBalance: number | null;
  creditsBalance: number | null;
};

type MergedAccount = AccountRow & {
  alternateAddressLine1: string;
  alternateAddressLine2: string;
  alternateCity: string;
  alternateState: string;
  alternatePostalCode: string;
};

type WalkThruUnit = {
  unitNumber: string;
  status: string;
  dimensions: string;
  typeCode: string;
};

type PromotionRow = {
  unitNumber: string;
  date: Date | null;
  discountCode: string;
  description: string;
  accountName: string;
  primaryContact: string;
  military: string;
  amount: number | null;
};

type DispositionReport = {
  migrationDate: Date;
  walkThruByUnit: Map<string, WalkThruUnit>;
  promotionsByUnit: Map<string, PromotionRow>;
};

type NormalizedUnit = {
  unitNumber: string;
  status: "Occupied" | "Vacant";
  width: number;
  length: number;
  height: number;
  rate: number;
  webRate: number;
  squareFeet: number;
  spaceSizeReview: string;
  spaceSizeFinal: string;
  spaceCategory: string;
  spaceType: "Storage" | "Parking";
  floor: string;
  sourceStatusMeaning: string;
  account: MergedAccount | null;
  promotion: PromotionRow | null;
  payment: PaymentFields | null;
};

type PaymentFields = {
  rent: number;
  moveInDate: Date | null;
  moveOutDate: Date | null;
  originalPaidThroughDate: Date | null;
  importPaidThroughDate: Date | null;
  paidDate: Date | null;
  billDay: number | null;
  prepaidRent: number | null;
  prepaidPremium: number | null;
  insuranceProviderReview: string;
  insuranceProviderMig: string;
  insuranceCoverage: string;
  additionalRent: number | null;
  rentBalance: number | null;
  feesBalance: number | null;
  protectionBalance: number | null;
};

type ParsedBundle = {
  siteInfo: SiteInfo;
  siteUnits: SiteUnitRow[];
  accountsByUnit: Map<string, MergedAccount>;
  notesWithLienOrMilitaryTerms: number;
  activePcdRows: number;
  disposition: DispositionReport;
};

type ExcelJSImport = typeof import("exceljs") extends { default: infer T }
  ? T
  : typeof import("exceljs");

type CellLike = {
  value: unknown;
  numFmt?: string;
  alignment?: Record<string, unknown>;
  font?: Record<string, unknown>;
  fill?: Record<string, unknown>;
};

type WorksheetLike = {
  name: string;
  getCell: (row: number | string, column?: number) => CellLike;
  columns: Array<{ width?: number }>;
};

type ExcelWorkbook = {
  xlsx: {
    load: (data: Buffer) => Promise<ExcelWorkbook>;
    writeBuffer: () => Promise<ArrayBuffer | Buffer>;
  };
  getWorksheet: (name: string) => WorksheetLike | undefined;
};

const DEFAULT_TEMPLATE_PATH = path.join(process.cwd(), "templates", "hummingbird-unit-tenant-mix-template.xlsx");
const XLSX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const SITE_UNIT_HEADERS = [
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
] as const;

const ACCOUNT_HEADERS = [
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
] as const;

const NOTES_HEADERS = ["COMMON_KEY", "SITE_ID", "SYS_NOTE", "NOTE", "CREATED"] as const;

const PCD_HEADERS = [
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
] as const;

const FINAL_SHEET_HEADERS = [
  "Owner",
  "Name",
  "Building",
  "Occupied or Vacant",
  "Space",
  "Width",
  "Length",
  "Height",
  "Rate",
  "Web Rate (not there on app right now)",
  "Space Size ",
  "Space Category",
  "Space Type",
  "Door Width",
  "Door Height",
  "Amenities",
  "Sq. Ft.",
  "Floor",
  "First Name",
  "Last Name",
  "Middle Name",
  "Account Code",
  "Address",
  "City",
  "State",
  "ZIP",
  "Country",
  "Email",
  "Cell Phone ",
  "Home Phone",
  "Work Phone",
  "Access Code",
  "DOB",
  "Gender",
  "Active Military",
  "DL Id",
  "DL State",
  "DL City",
  "DL Exp Date",
  "Rent",
  "Last Rent Change Date",
  "Move In Date",
  "Move Out Date",
  "Paid Date",
  "Bill Day",
  "Paid Through Date",
  "Alt First Name",
  "Alt Last Name",
  "Alt Middle Name",
  "Alt Address",
  "Alt City",
  "Alt State",
  "Alt ZIP",
  "Alt Email",
  "Alt Home Phone",
  "Alt Work Phone",
  "Alt Cell Phone",
  "Security Deposit ",
  "Security Deposit Balance",
  "Rent Balance",
  "Fees Balance",
  "Protection/Insurance Balance",
  "Merchandise Balance",
  "Late Fees Balance",
  "Lien Fees Balance",
  "Tax Balance",
  "Prepaid Rent",
  "Prepaid Additional Rent/Premium",
  "Prepaid Tax",
  "Protection/Insurance Provider",
  "Protection/Insurance Coverage",
  "Additional Rent/Premium",
  "Delinquency Status",
  "Lien Status",
  "Lien Posted Date",
  "Promotion",
  "Promotion Type",
  "Promotion Value",
  "Promotion Start",
  "Promotion Length",
  "Discount",
  "Discount Type",
  "Discount Value",
  "Commanding Officer First Name",
  "Commanding Officer Last Name",
  "Commanding Officer Phone",
  "Commanding Officer Email",
  "Rank",
  "Military Serial Number",
  "Military Email",
  "Service Member DOB",
  "Expiration Term of Service",
  "Military Branch",
  "Military Unit Name",
  "Military Unit Phone",
  "Military Unit Address 1",
  "Military Unit Address 2",
  "Military City",
  "Military Unit State ",
  "Military Unit Zipcode",
  "Lien Holder First Name",
  "Lien Holder Last Name",
  "Lien Holder Email",
  "Lien Holder Phone",
  "Lien Holder Address 1",
  "Lien Holder Address 2",
  "Lien Holder City",
  "Lien Holder State",
  "Lien Holder Zipcode",
] as const;

const MIG_HEADERS = [
  "Owner",
  "Name",
  "Status",
  "Space",
  "Width",
  "Length",
  "Height",
  "Rate",
  "Web_Rate",
  "Space_Size",
  "Space_Category",
  "Space_Type",
  "Door_Width",
  "Door_Height",
  "Amenities",
  "Sq_Ft",
  "Floor",
  "First_Name",
  "Last_Name",
  "Middle_Name",
  "Account_Code",
  "Address",
  "Address2",
  "City",
  "State",
  "ZIP",
  "country",
  "Email",
  "Cell_Phone",
  "Home_Phone",
  "Work_Phone",
  "Access_Code",
  "DOB",
  "Active_military",
  "DL_ID",
  "DL_State",
  "Rent",
  "Last_Rent_Change_Date",
  "Last_rent_amt",
  "Scheduled_Rent_Change_Date",
  "Scheduled_Rent",
  "Scheduled_Rent_Notification",
  "Move_In_Date",
  "Move_Out_Date",
  "Paid_date",
  "Bill_Day",
  "Paid_Through_Date",
  "Alt_First_Name",
  "Alt_Last_Name",
  "Alt_Middle_Name",
  "Alt_Address",
  "Alt_Address2",
  "Alt_City",
  "Alt_State",
  "Alt_ZIP",
  "Alt_Email",
  "Alt_Home_Phone",
  "Alt_Work_Phone",
  "Alt_Cell_Phone",
  "Security_Deposit",
  "Security_Deposit_Balance",
  "Rent_Balance",
  "Fees_Balance",
  "Protection_Plan_Balance",
  "Merchandise_Balance",
  "Late_Fees_Balance",
  "Tax_Balance",
  "Prepaid_Rent",
  "Protection_Provider",
  "Protection_start_date",
  "Protection_end_date",
  "Protection_Coverage",
  "Additional_Rent",
  "Promotion",
  "Promotion_Type",
  "Promotion_Value",
  "Promotion_Start",
  "Promotion_End",
  "Promotion_Length",
  "Discount",
  "Discount_Type",
  "Discount_Value",
  "Alarm_Enabled",
  "Twenty_Four_Hour_Access",
  "payment_cycle",
  "IsBusinessLease",
  "start_date",
  "company_name",
  "company_address",
  "company_address2",
  "company_city",
  "company_state",
  "company_zip",
  "company_phone",
  "company_email",
] as const;

function getRuntimeRequire(): (id: string) => unknown {
  const moduleBuiltin = typeof process.getBuiltinModule === "function"
    ? (process.getBuiltinModule("node:module") as { createRequire?: typeof createRequire } | undefined)
    : undefined;
  const candidate = moduleBuiltin?.createRequire
    ? moduleBuiltin.createRequire(path.join(process.cwd(), "package.json"))
    : createRequire(path.join(process.cwd(), "package.json"));
  if (typeof candidate !== "function") {
    throw new Error("Node require loader is unavailable in this runtime.");
  }
  return candidate as (id: string) => unknown;
}

function loadExcelJS(): ExcelJSImport {
  const mod = getRuntimeRequire()("exceljs") as ExcelJSImport | { default: ExcelJSImport };
  return ((mod as { default?: ExcelJSImport }).default ?? mod) as ExcelJSImport;
}

function toBuffer(input: ArrayBuffer | Buffer): Buffer {
  return Buffer.isBuffer(input) ? input : Buffer.from(input);
}

function normalizeHeader(value: string): string {
  return value.trim().replace(/^\uFEFF/, "");
}

function normalizeSpaces(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function text(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return formatReviewDate(value);
  return String(value).trim();
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const raw = text(value);
  if (!raw) return null;
  const cleaned = raw
    .replace(/\$/g, "")
    .replace(/,/g, "")
    .replace(/%/g, "")
    .replace(/\(([^)]+)\)/g, "-$1")
    .trim();
  if (!/^[-+]?\d*\.?\d+$/.test(cleaned)) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseDate(value: unknown): Date | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return startOfDay(value);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) {
      return startOfDay(new Date(parsed.y, parsed.m - 1, parsed.d));
    }
  }
  const raw = text(value);
  if (!raw) return null;
  const usMatch = raw.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/);
  if (usMatch) {
    const yearValue = Number(usMatch[3]);
    const year = yearValue < 100 ? 2000 + yearValue : yearValue;
    return startOfDay(new Date(year, Number(usMatch[1]) - 1, Number(usMatch[2])));
  }
  const isoMatch = raw.match(/\b(20\d{2}|19\d{2})-(\d{1,2})-(\d{1,2})\b/);
  if (isoMatch) {
    return startOfDay(new Date(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3])));
  }
  const parsed = new Date(raw);
  if (!Number.isFinite(parsed.getTime())) return null;
  return startOfDay(parsed);
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addMonthsClamped(date: Date, months: number): Date {
  const target = new Date(date.getFullYear(), date.getMonth() + months, 1);
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(date.getDate(), last));
  return startOfDay(target);
}

function compareDates(left: Date, right: Date): number {
  return startOfDay(left).getTime() - startOfDay(right).getTime();
}

function formatReviewDate(date: Date | null): string {
  if (!date) return "";
  return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`;
}

function formatIsoDate(date: Date | null): string {
  if (!date) return "";
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function phoneDigits(value: string): string {
  return value.replace(/\D/g, "");
}

function lastFourPhone(value: string, fallback: string): string {
  const digits = phoneDigits(value);
  if (digits.length >= 4) return digits.slice(-4);
  const fallbackDigits = phoneDigits(fallback);
  return fallbackDigits.length >= 4 ? fallbackDigits.slice(-4) : fallbackDigits;
}

function countryForMig(value: string): string {
  return value.trim().toUpperCase() === "USA" ? "United States" : value.trim();
}

function readCsvRows(buffer: Buffer, label: string): CsvRow[] {
  const workbook = XLSX.read(buffer, { type: "buffer", raw: false });
  const sheetName = workbook.SheetNames[0];
  const sheet = sheetName ? workbook.Sheets[sheetName] : undefined;
  if (!sheet) {
    throw new Error(`${label} does not contain a readable table.`);
  }
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: "",
    raw: false,
    blankrows: false,
  });
  return rawRows.map((row) => {
    const normalized: CsvRow = {};
    for (const [key, value] of Object.entries(row)) {
      normalized[normalizeHeader(key)] = text(value);
    }
    return normalized;
  });
}

function requireHeaders(rows: CsvRow[], headers: readonly string[], label: string): void {
  const present = new Set<string>();
  for (const row of rows.slice(0, 1)) {
    for (const key of Object.keys(row)) present.add(normalizeHeader(key));
  }
  const missing = headers.filter((header) => !present.has(header));
  if (missing.length > 0) {
    throw new Error(`${label} is missing required column(s): ${missing.join(", ")}.`);
  }
}

function parseSiteInfo(buffer: Buffer): SiteInfo {
  const raw = buffer.toString("utf8").replace(/^\uFEFF/, "");
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const pairs = new Map<string, string>();
  for (const line of lines) {
    const match = line.match(/^([^:]+):\s*(.+)$/);
    if (match) {
      pairs.set(normalizeSpaces(match[1]).toLowerCase(), normalizeSpaces(match[2]));
    }
  }
  const siteName = pairs.get("site name") ?? "";
  const siteNumber = pairs.get("site number") ?? "";
  const siteAddress = pairs.get("site address") ?? "";
  if (!siteName || !siteNumber || !siteAddress) {
    throw new Error("Site Info.txt must include Site Name, Site Number, and Site Address.");
  }
  return { siteName, siteNumber, siteAddress };
}

function parseSiteUnits(buffer: Buffer): SiteUnitRow[] {
  const rows = readCsvRows(buffer, "stage_op_site_units.csv");
  requireHeaders(rows, SITE_UNIT_HEADERS, "stage_op_site_units.csv");
  return rows.map((row) => ({
    commonKey: row.COMMON_KEY,
    rentalUnitKey: row.RENTAL_UNIT_KEY,
    unitNumber: row.UNIT_NUMBER,
    siteId: row.SITE_ID,
    dimensions: row.DIMENSIONS,
    attributes: row.ATTRIBUTES,
    attributesMeaning: row.ATTRIBUTES_MEANING,
    status: row.STATUS,
    statusMeaning: row.STATUS_MEANING,
    rentRate: numberOrNull(row.RENT_RATE),
    streetRate: numberOrNull(row.STREET_RATE),
    rateEffectiveDate: row.RATE_EFF_DATE,
  }));
}

function parseAccounts(buffer: Buffer): AccountRow[] {
  const rows = readCsvRows(buffer, "stage_op_accounts.csv");
  requireHeaders(rows, ACCOUNT_HEADERS, "stage_op_accounts.csv");
  return rows.map((row) => ({
    refKey: row.REF_KEY,
    siteId: row.SITE_ID,
    commonKey: row.COMMONKEY,
    contactKey: row.CONTACT_KEY,
    rentalUnitKey: row.RENTAL_UNIT_KEY,
    unitNumber: row.UNIT_NUMBER,
    accountName: row.ACCOUNT_NAME,
    accountClass: row.ACCOUNT_CLASS,
    accountClassMeaning: row.ACCOUNT_CLASS_MEANING,
    primaryFirstName: row.PRIMARY_FIRST_NAME,
    primaryLastName: row.PRIMARY_LAST_NAME,
    primaryAddressLine1: row.PRIMARY_ADDRESS_LINE1,
    primaryAddressLine2: row.PRIMARY_ADDRESS_LINE2,
    primaryCity: row.PRIMARY_ADDRESS_CITY,
    primaryState: row.PRIMARY_ADDRESS_STATE,
    primaryCountry: row.PRIMARY_ADDRESS_COUNTRY,
    primaryPostalCode: row.PRIMARY_ADDRESS_POSTAL_CODE,
    primaryEmail: row.PRIMARY_EMAIL_ADDRESS,
    primaryPhoneTypeMeaning: row.PRIMARY_PHONE_TYPE_MEANING,
    primaryPhoneNumber: row.PRIMARY_PHONE_NUMBER,
    secondaryPhoneTypeMeaning: row.SECONDARY_PHONE_TYPE_MEANING,
    secondaryPhoneNumber: row.SECONDARY_PHONE_NUMBER,
    identificationNo: row.IDENTIFICATION_NO,
    driversLicenseState: row.DRIVERS_LICENSE_STATE,
    identificationExp: row.IDENTIFICATION_EXP,
    dateOfBirth: row.DATE_OF_BIRTH,
    gatePin: row.GATE_PIN,
    gate24Hr: row.GATE24HR,
    easyPay: row.EASYPAY,
    rentalStartDate: parseDate(row.RENTAL_START_DATE),
    moveOutDate: parseDate(row.MOVE_OUT_DATE),
    statusMeaning: row.STATUS_MEANING,
    paidThroughDate: parseDate(row.PAID_THRU_DATE),
    insuranceStartDate: parseDate(row.INSURANCE_START_DATE),
    insuranceType: row.INSURANCE_TYPE,
    insurancePrice: numberOrNull(row.INSURANCE_PRICE),
    insuranceCoverage: row.INSURANCE_COVERAGE,
    alternateFirstName: row.ALTERNATE_FIRST_NAME,
    alternateLastName: row.ALTERNATE_LAST_NAME,
    alternateEmail: row.ALTERNATE_EMAIL_ADDRESS,
    alternatePhoneTypeMeaning: row.ALTERNATE_PHONE_TYPE_MEANING,
    alternatePhoneNumber: row.ALTERNATE_PRIMARY_PHONE_NUMBER,
    securityDeposit: numberOrNull(row.SECURITY_DEPOSIT),
    feesBalance: numberOrNull(row.FEES_BALANCE),
    creditsBalance: numberOrNull(row.CREDITS_BALANCE),
  }));
}

function mergeAccountsByUnit(rows: AccountRow[]): Map<string, MergedAccount> {
  const grouped = new Map<string, AccountRow[]>();
  for (const row of rows) {
    const unitNumber = row.unitNumber.trim();
    if (!unitNumber) continue;
    const existing = grouped.get(unitNumber) ?? [];
    existing.push(row);
    grouped.set(unitNumber, existing);
  }

  const merged = new Map<string, MergedAccount>();
  for (const [unitNumber, group] of grouped.entries()) {
    const primary = group.find((row) => row.primaryFirstName || row.primaryLastName) ?? group[0];
    if (!primary) continue;
    const alternate = group.find((row) => row.alternateFirstName || row.alternateLastName || row.alternateEmail);
    merged.set(unitNumber, {
      ...primary,
      alternateFirstName: alternate?.alternateFirstName ?? primary.alternateFirstName,
      alternateLastName: alternate?.alternateLastName ?? primary.alternateLastName,
      alternateEmail: alternate?.alternateEmail ?? primary.alternateEmail,
      alternatePhoneTypeMeaning: alternate?.alternatePhoneTypeMeaning ?? primary.alternatePhoneTypeMeaning,
      alternatePhoneNumber: alternate?.alternatePhoneNumber ?? primary.alternatePhoneNumber,
      alternateAddressLine1: "",
      alternateAddressLine2: "",
      alternateCity: "",
      alternateState: "",
      alternatePostalCode: "",
    });
  }
  return merged;
}

function parseNotes(buffer: Buffer): { lienOrMilitaryTerms: number } {
  const rows = readCsvRows(buffer, "stage_op_notes.csv");
  requireHeaders(rows, NOTES_HEADERS, "stage_op_notes.csv");
  const lienOrMilitaryTerms = rows.filter((row) => /\b(lien|military|active duty|service member|armed forces)\b/i.test(`${row.SYS_NOTE} ${row.NOTE}`)).length;
  return { lienOrMilitaryTerms };
}

function parsePcd(buffer: Buffer): { activeRows: number } {
  const rows = readCsvRows(buffer, "stage_op_pcd.csv");
  requireHeaders(rows, PCD_HEADERS, "stage_op_pcd.csv");
  return {
    activeRows: rows.filter((row) => row.STATUS.trim().toLowerCase() === "active").length,
  };
}

function readWorkbookGrid(buffer: Buffer, sheetName: string): unknown[][] {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new Error(`Disposition workbook is missing sheet "${sheetName}".`);
  return XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: false,
    defval: "",
    blankrows: false,
  }) as unknown[][];
}

function readDispositionWorkbook(buffer: Buffer): XLSX.WorkBook {
  return XLSX.read(buffer, { type: "buffer", cellDates: true });
}

function findSheetName(workbook: XLSX.WorkBook, pattern: RegExp, label: string): string {
  const sheetName = workbook.SheetNames.find((name) => pattern.test(name));
  if (!sheetName) throw new Error(`Disposition workbook is missing a ${label} sheet.`);
  return sheetName;
}

function findHeaderIndex(row: unknown[], candidates: readonly string[]): number {
  const lowered = candidates.map((candidate) => candidate.toLowerCase());
  return row.findIndex((value) => lowered.includes(normalizeSpaces(text(value)).toLowerCase()));
}

function parseWalkThruRows(grid: unknown[][]): Map<string, WalkThruUnit> {
  const headerIndex = grid.findIndex((row) =>
    findHeaderIndex(row, ["Unit"]) >= 0 &&
    findHeaderIndex(row, ["Status"]) >= 0 &&
    findHeaderIndex(row, ["DIM"]) >= 0 &&
    findHeaderIndex(row, ["Type"]) >= 0
  );
  if (headerIndex < 0) {
    throw new Error("Unable to locate the Walk Thru List header row in the disposition workbook.");
  }
  const header = grid[headerIndex] ?? [];
  const unitCol = findHeaderIndex(header, ["Unit"]);
  const statusCol = findHeaderIndex(header, ["Status"]);
  const dimCol = findHeaderIndex(header, ["DIM"]);
  const typeCol = findHeaderIndex(header, ["Type"]);
  const map = new Map<string, WalkThruUnit>();
  for (const row of grid.slice(headerIndex + 1)) {
    const unitNumber = text(row[unitCol]);
    if (!/^[A-Za-z0-9-]+$/.test(unitNumber)) continue;
    map.set(unitNumber, {
      unitNumber,
      status: text(row[statusCol]),
      dimensions: text(row[dimCol]),
      typeCode: text(row[typeCol]).toUpperCase(),
    });
  }
  return map;
}

function parseMoneyLike(value: unknown): number | null {
  return numberOrNull(text(value).replace(/\$\$/g, "$"));
}

function parsePromotionRows(grid: unknown[][]): Map<string, PromotionRow> {
  const headerIndex = grid.findIndex((row) =>
    findHeaderIndex(row, ["Date"]) >= 0 &&
    findHeaderIndex(row, ["Discount"]) >= 0 &&
    findHeaderIndex(row, ["Description"]) >= 0 &&
    findHeaderIndex(row, ["Unit"]) >= 0 &&
    findHeaderIndex(row, ["Amount"]) >= 0
  );
  if (headerIndex < 0) {
    throw new Error("Unable to locate the Promotion Usage header row in the disposition workbook.");
  }
  const header = grid[headerIndex] ?? [];
  const dateCol = findHeaderIndex(header, ["Date"]);
  const discountCol = findHeaderIndex(header, ["Discount"]);
  const descriptionCol = findHeaderIndex(header, ["Description"]);
  const accountCol = findHeaderIndex(header, ["Account"]);
  const primaryContactCol = findHeaderIndex(header, ["Primary Contact"]);
  const militaryCol = findHeaderIndex(header, ["Military"]);
  const unitCol = findHeaderIndex(header, ["Unit"]);
  const amountCol = findHeaderIndex(header, ["Amount"]);
  const byUniqueKey = new Map<string, PromotionRow>();
  for (const row of grid.slice(headerIndex + 1)) {
    const unitNumber = text(row[unitCol]);
    const date = parseDate(row[dateCol]);
    const discountCode = text(row[discountCol]);
    const description = text(row[descriptionCol]);
    if (!unitNumber || !/^\d/.test(unitNumber) || !discountCode || !description) continue;
    const promo: PromotionRow = {
      unitNumber,
      date,
      discountCode,
      description,
      accountName: accountCol >= 0 ? text(row[accountCol]) : "",
      primaryContact: primaryContactCol >= 0 ? text(row[primaryContactCol]) : "",
      military: militaryCol >= 0 ? text(row[militaryCol]) : "",
      amount: parseMoneyLike(row[amountCol]),
    };
    const key = [
      promo.unitNumber,
      formatIsoDate(promo.date),
      promo.discountCode,
      promo.description,
      promo.amount ?? "",
    ].join("|");
    byUniqueKey.set(key, promo);
  }

  const byUnit = new Map<string, PromotionRow>();
  for (const promo of byUniqueKey.values()) {
    const existing = byUnit.get(promo.unitNumber);
    if (!existing) {
      byUnit.set(promo.unitNumber, promo);
      continue;
    }
    const existingTime = existing.date?.getTime() ?? 0;
    const promoTime = promo.date?.getTime() ?? 0;
    if (promoTime >= existingTime) byUnit.set(promo.unitNumber, promo);
  }
  return byUnit;
}

function extractMigrationDate(workbook: XLSX.WorkBook, promoRows: Map<string, PromotionRow>): Date {
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      raw: false,
      defval: "",
      blankrows: false,
    }) as unknown[][];
    for (const row of grid.slice(0, 15)) {
      for (const value of row) {
        const cellText = text(value);
        if (/\b(on|as of)\b/i.test(cellText)) {
          const found = parseDate(cellText);
          if (found) return found;
        }
      }
    }
  }

  const promoDates = Array.from(promoRows.values()).map((row) => row.date).filter((date): date is Date => Boolean(date));
  const latestPromoDate = promoDates.sort((a, b) => b.getTime() - a.getTime())[0];
  if (latestPromoDate) return latestPromoDate;

  throw new Error("Unable to determine migration/as-of date from the disposition workbook.");
}

function parseDispositionReport(buffer: Buffer): DispositionReport {
  const workbook = readDispositionWorkbook(buffer);
  const walkThruSheet = findSheetName(workbook, /walk\s*thru/i, "Walk Thru List");
  const promoSheet = findSheetName(workbook, /promo/i, "Promotion Usage");
  const walkThruByUnit = parseWalkThruRows(readWorkbookGrid(buffer, walkThruSheet));
  const promotionsByUnit = parsePromotionRows(readWorkbookGrid(buffer, promoSheet));
  const migrationDate = extractMigrationDate(workbook, promotionsByUnit);
  return {
    migrationDate,
    walkThruByUnit,
    promotionsByUnit,
  };
}

export function parseExrHummingbirdBundle(input: ExrHummingbirdInput): ParsedBundle {
  const siteInfo = parseSiteInfo(input.siteInfo);
  const siteUnits = parseSiteUnits(input.siteUnits);
  const accountsByUnit = mergeAccountsByUnit(parseAccounts(input.accounts));
  const notes = parseNotes(input.notes);
  const pcd = parsePcd(input.pcd);
  const disposition = parseDispositionReport(input.dispositionReport);
  return {
    siteInfo,
    siteUnits,
    accountsByUnit,
    notesWithLienOrMilitaryTerms: notes.lienOrMilitaryTerms,
    activePcdRows: pcd.activeRows,
    disposition,
  };
}

function parseDimensions(dimensions: string): { width: number; length: number; squareFeet: number } {
  const match = dimensions.match(/(\d+(?:\.\d+)?)\s*[xX]\s*(\d+(?:\.\d+)?)/);
  if (!match) {
    throw new Error(`Unable to parse unit dimensions "${dimensions}".`);
  }
  const sourceFirst = Number(match[1]);
  const sourceSecond = Number(match[2]);
  return {
    width: sourceSecond,
    length: sourceFirst,
    squareFeet: sourceFirst * sourceSecond,
  };
}

function includeUnit(row: SiteUnitRow): boolean {
  return ["available", "rented", "company use"].includes(row.statusMeaning.trim().toLowerCase());
}

function normalizeUnitStatus(row: SiteUnitRow): "Occupied" | "Vacant" {
  return row.statusMeaning.trim().toLowerCase() === "rented" ? "Occupied" : "Vacant";
}

function inferFloor(unitNumber: string): string {
  if (unitNumber.startsWith("3")) return "3";
  if (unitNumber.startsWith("2")) return "2";
  return "1";
}

function classifySpace(walkThru: WalkThruUnit | undefined, unitNumber: string): { category: string; floor: string; type: "Storage" | "Parking" } {
  const code = walkThru?.typeCode.trim().toUpperCase() ?? "";
  if (["CIN", "CON"].includes(code)) {
    return { category: "Drive Up Climate Controlled", floor: "0", type: "Storage" };
  }
  if (["CDN", "CDP", "CDNM"].includes(code)) {
    return { category: "Climate Controlled", floor: "1", type: "Storage" };
  }
  if (code === "CEP") {
    return { category: "Climate Controlled", floor: "2", type: "Storage" };
  }
  if (code === "CENM") {
    return { category: "Climate Controlled", floor: "3", type: "Storage" };
  }
  if (code === "CEN") {
    return { category: "Climate Controlled", floor: inferFloor(unitNumber), type: "Storage" };
  }
  return { category: "Climate Controlled", floor: inferFloor(unitNumber), type: "Storage" };
}

function computeCycleEndContaining(migrationDate: Date, billDay: number): Date {
  const normalizedBillDay = Math.max(1, Math.min(30, billDay));
  const candidateStart = new Date(
    migrationDate.getFullYear(),
    migrationDate.getMonth(),
    Math.min(normalizedBillDay, new Date(migrationDate.getFullYear(), migrationDate.getMonth() + 1, 0).getDate()),
  );
  const start = compareDates(candidateStart, migrationDate) <= 0 ? candidateStart : addMonthsClamped(candidateStart, -1);
  return startOfDay(new Date(addMonthsClamped(start, 1).getTime() - 24 * 60 * 60 * 1000));
}

function nextCycleEnd(currentEnd: Date): Date {
  return addMonthsClamped(currentEnd, 1);
}

function countPrepaidPeriods(importPaidThroughDate: Date | null, originalPaidThroughDate: Date | null): number {
  if (!importPaidThroughDate || !originalPaidThroughDate) return 0;
  let count = 0;
  let cursor = nextCycleEnd(importPaidThroughDate);
  while (compareDates(cursor, originalPaidThroughDate) <= 0 && count < 120) {
    count += 1;
    cursor = nextCycleEnd(cursor);
  }
  return count;
}

function computePaymentFields(unit: SiteUnitRow, account: MergedAccount | null, migrationDate: Date): PaymentFields | null {
  if (!account) return null;
  const rent = unit.rentRate ?? 0;
  const originalPaidThroughDate = account.paidThroughDate;
  const paidDate = originalPaidThroughDate ? addMonthsClamped(originalPaidThroughDate, -1) : null;
  const billDay = originalPaidThroughDate ? Math.min(originalPaidThroughDate.getDate() + 1, 30) : null;
  const cycleCap = billDay ? computeCycleEndContaining(migrationDate, billDay) : null;
  const preliminaryImportPaidThroughDate =
    originalPaidThroughDate && cycleCap && compareDates(originalPaidThroughDate, cycleCap) > 0
      ? cycleCap
      : originalPaidThroughDate;
  const prepaidPeriods = countPrepaidPeriods(preliminaryImportPaidThroughDate, originalPaidThroughDate);
  const importPaidThroughDate = prepaidPeriods > 0 ? preliminaryImportPaidThroughDate : originalPaidThroughDate;
  const insurancePrice = account.insurancePrice && account.insurancePrice > 0 ? account.insurancePrice : null;
  const hasInsurance = account.insuranceType.trim().toLowerCase() === "insured" && Boolean(insurancePrice);
  return {
    rent,
    moveInDate: account.rentalStartDate,
    moveOutDate: account.moveOutDate,
    originalPaidThroughDate,
    importPaidThroughDate,
    paidDate,
    billDay,
    prepaidRent: prepaidPeriods > 0 && rent > 0 ? rent * prepaidPeriods : null,
    prepaidPremium: prepaidPeriods > 0 && insurancePrice ? insurancePrice * prepaidPeriods : null,
    insuranceProviderReview: hasInsurance ? "EXR CPP" : "",
    insuranceProviderMig: hasInsurance ? `EXR CPP-${insurancePrice}` : "",
    insuranceCoverage: hasInsurance ? account.insuranceCoverage : "",
    additionalRent: hasInsurance ? insurancePrice : null,
    rentBalance: null,
    feesBalance: account.feesBalance,
    protectionBalance: null,
  };
}

function buildNormalizedUnits(parsed: ParsedBundle): { units: NormalizedUnit[]; warnings: string[] } {
  const warnings: string[] = [];
  if (parsed.notesWithLienOrMilitaryTerms > 0) {
    warnings.push(`${parsed.notesWithLienOrMilitaryTerms} note row(s) mention lien or military terms; no direct template fields were populated from notes.`);
  }
  if (parsed.activePcdRows > 0 && parsed.disposition.promotionsByUnit.size === 0) {
    warnings.push(`${parsed.activePcdRows} active PCD row(s) were present, but the disposition Promotion Usage sheet did not expose import-ready promo rows.`);
  }

  const includedRows = parsed.siteUnits.filter(includeUnit).sort((a, b) => a.unitNumber.localeCompare(b.unitNumber, undefined, { numeric: true }));
  const units = includedRows.map((row) => {
    const dimensions = parseDimensions(row.dimensions);
    const walkThru = parsed.disposition.walkThruByUnit.get(row.unitNumber);
    if (!walkThru) {
      warnings.push(`Unit ${row.unitNumber} was not found in the disposition Walk Thru sheet; defaulted to climate controlled storage.`);
    }
    const classification = classifySpace(walkThru, row.unitNumber);
    const account = parsed.accountsByUnit.get(row.unitNumber) ?? null;
    if (normalizeUnitStatus(row) === "Occupied" && !account) {
      warnings.push(`Occupied unit ${row.unitNumber} did not have an account row.`);
    }
    return {
      unitNumber: row.unitNumber,
      status: normalizeUnitStatus(row),
      width: dimensions.width,
      length: dimensions.length,
      height: 10,
      rate: row.rentRate ?? 0,
      webRate: row.streetRate ?? row.rentRate ?? 0,
      squareFeet: dimensions.squareFeet,
      spaceSizeReview: `[${formatNumber(dimensions.width)} X ${formatNumber(dimensions.length)}]`,
      spaceSizeFinal: `${formatNumber(dimensions.width)} X ${formatNumber(dimensions.length)}`,
      spaceCategory: classification.category,
      spaceType: classification.type,
      floor: classification.floor,
      sourceStatusMeaning: row.statusMeaning,
      account,
      promotion: parsed.disposition.promotionsByUnit.get(row.unitNumber) ?? null,
      payment: computePaymentFields(row, account, parsed.disposition.migrationDate),
    } satisfies NormalizedUnit;
  });
  return { units, warnings };
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(value);
}

function moneyOrBlank(value: number | null | undefined): number | "" {
  return value === null || value === undefined ? "" : value;
}

function dateOrBlank(value: Date | null | undefined, variant: "review" | "iso" = "review"): string {
  if (!value) return "";
  return variant === "iso" ? formatIsoDate(value) : formatReviewDate(value);
}

function getPhoneForKind(account: MergedAccount | null, kind: "cell" | "home" | "work"): string {
  if (!account) return "";
  const type = account.primaryPhoneTypeMeaning.toLowerCase();
  if (kind === "cell" && (type.includes("mobile") || type.includes("cell"))) return account.primaryPhoneNumber;
  if (kind === "home" && type.includes("home")) return account.primaryPhoneNumber;
  if (kind === "work" && type.includes("work")) return account.primaryPhoneNumber;
  return "";
}

function getAltPhoneForKind(account: MergedAccount | null, kind: "cell" | "home" | "work"): string {
  if (!account) return "";
  const type = account.alternatePhoneTypeMeaning.toLowerCase();
  if (kind === "cell" && (type.includes("mobile") || type.includes("cell"))) return account.alternatePhoneNumber;
  if (kind === "home" && type.includes("home")) return account.alternatePhoneNumber;
  if (kind === "work" && type.includes("work")) return account.alternatePhoneNumber;
  return "";
}

function extractDiscountPercent(promotion: PromotionRow | null): number | null {
  if (!promotion) return null;
  const match = `${promotion.description} ${promotion.discountCode}`.match(/(\d+(?:\.\d+)?)\s*%/);
  if (!match) return null;
  if (!/ongoing|senior|discount/i.test(`${promotion.description} ${promotion.discountCode}`)) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function spaceMixRow(unit: NormalizedUnit): Array<string | number> {
  return [
    unit.unitNumber,
    unit.status,
    unit.spaceType,
    unit.width,
    unit.length,
    unit.height,
    unit.rate,
    unit.spaceCategory,
    unit.floor,
    "",
    "",
    unit.spaceSizeReview,
    unit.squareFeet,
  ];
}

function tenantInfoRow(unit: NormalizedUnit): Array<string | number> {
  const account = unit.account;
  return [
    unit.unitNumber,
    unit.status,
    account?.primaryFirstName ?? "",
    account?.primaryLastName ?? "",
    "",
    unit.rate,
    dateOrBlank(account?.rentalStartDate),
    "",
    account?.gatePin ?? "",
    account?.primaryAddressLine1 ?? "",
    account?.primaryCity ?? "",
    account?.primaryState ?? "",
    account?.primaryPostalCode ?? "",
    account?.primaryCountry || "USA",
    account?.primaryEmail ?? "",
    getPhoneForKind(account, "cell"),
    getPhoneForKind(account, "home"),
    getPhoneForKind(account, "work"),
    account?.gatePin ?? "",
    account?.identificationNo ?? "",
    account?.driversLicenseState ?? "",
    "",
    account?.identificationExp ?? "",
    account?.alternateFirstName ?? "",
    account?.alternateLastName ?? "",
    "",
    account?.alternateAddressLine1 ?? "",
    account?.alternateCity ?? "",
    account?.alternateState ?? "",
    account?.alternatePostalCode ?? "",
    account?.alternateEmail ?? "",
    getAltPhoneForKind(account, "home"),
    getAltPhoneForKind(account, "work"),
    getAltPhoneForKind(account, "cell"),
  ];
}

function lienRow(unit: NormalizedUnit): Array<string | number> {
  const account = unit.account;
  return [
    unit.unitNumber,
    unit.status,
    account?.primaryFirstName ?? "",
    account?.primaryLastName ?? "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
  ];
}

function militaryRow(unit: NormalizedUnit): Array<string | number> {
  const account = unit.account;
  return [
    unit.unitNumber,
    unit.status,
    "",
    account?.primaryFirstName ?? "",
    account?.primaryLastName ?? "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
  ];
}

function tenantPaymentRow(unit: NormalizedUnit): Array<string | number> {
  const account = unit.account;
  const payment = unit.payment;
  return [
    unit.unitNumber,
    unit.status,
    account?.primaryFirstName ?? "",
    account?.primaryLastName ?? "",
    unit.rate,
    "",
    dateOrBlank(payment?.moveInDate),
    dateOrBlank(payment?.paidDate),
    payment?.billDay ?? "",
    dateOrBlank(payment?.importPaidThroughDate),
    "",
    "",
    "",
    "",
    "",
    moneyOrBlank(payment?.feesBalance),
    moneyOrBlank(payment?.prepaidRent),
    moneyOrBlank(payment?.prepaidPremium),
    "",
    "",
    moneyOrBlank(account?.securityDeposit),
    "",
    "",
    payment?.insuranceProviderReview ?? "",
    payment?.insuranceCoverage ?? "",
    moneyOrBlank(payment?.additionalRent),
    "",
  ];
}

function promotionReviewRow(unit: NormalizedUnit): Array<string | number> {
  const account = unit.account;
  const promotion = unit.promotion;
  return [
    unit.unitNumber,
    account?.primaryFirstName ?? "",
    account?.primaryLastName ?? "",
    promotion?.description ?? "",
    promotion?.discountCode ?? "",
    moneyOrBlank(promotion?.amount),
    dateOrBlank(promotion?.date),
    "",
    "",
    "",
    "",
  ];
}

function finalSheetRow(unit: NormalizedUnit): Record<string, string | number> {
  const account = unit.account;
  const payment = unit.payment;
  const promotion = unit.promotion;
  return {
    "Owner": "",
    "Name": "",
    "Building": "",
    "Occupied or Vacant": unit.status,
    "Space": unit.unitNumber,
    "Width": unit.width,
    "Length": unit.length,
    "Height": unit.height,
    "Rate": unit.rate,
    "Web Rate (not there on app right now)": unit.webRate,
    "Space Size ": unit.spaceSizeReview,
    "Space Category": unit.spaceCategory,
    "Space Type": unit.spaceType,
    "Door Width": "",
    "Door Height": "",
    "Amenities": "",
    "Sq. Ft.": unit.squareFeet,
    "Floor": unit.floor,
    "First Name": account?.primaryFirstName ?? "",
    "Last Name": account?.primaryLastName ?? "",
    "Middle Name": "",
    "Account Code": account?.gatePin ?? "",
    "Address": account?.primaryAddressLine1 ?? "",
    "City": account?.primaryCity ?? "",
    "State": account?.primaryState ?? "",
    "ZIP": account?.primaryPostalCode ?? "",
    "Country": account?.primaryCountry || "USA",
    "Email": account?.primaryEmail ?? "",
    "Cell Phone ": getPhoneForKind(account, "cell"),
    "Home Phone": getPhoneForKind(account, "home"),
    "Work Phone": getPhoneForKind(account, "work"),
    "Access Code": account?.gatePin ?? "",
    "DOB": account?.dateOfBirth ? formatReviewDate(parseDate(account.dateOfBirth)) : "",
    "Gender": "",
    "Active Military": "",
    "DL Id": account?.identificationNo ?? "",
    "DL State": account?.driversLicenseState ?? "",
    "DL City": "",
    "DL Exp Date": account?.identificationExp ?? "",
    "Rent": unit.rate,
    "Last Rent Change Date": "",
    "Move In Date": dateOrBlank(payment?.moveInDate),
    "Move Out Date": dateOrBlank(payment?.moveOutDate),
    "Paid Date": dateOrBlank(payment?.paidDate),
    "Bill Day": payment?.billDay ?? "",
    "Paid Through Date": dateOrBlank(payment?.importPaidThroughDate),
    "Alt First Name": account?.alternateFirstName ?? "",
    "Alt Last Name": account?.alternateLastName ?? "",
    "Alt Middle Name": "",
    "Alt Address": account?.alternateAddressLine1 ?? "",
    "Alt City": account?.alternateCity ?? "",
    "Alt State": account?.alternateState ?? "",
    "Alt ZIP": account?.alternatePostalCode ?? "",
    "Alt Email": account?.alternateEmail ?? "",
    "Alt Home Phone": getAltPhoneForKind(account, "home"),
    "Alt Work Phone": getAltPhoneForKind(account, "work"),
    "Alt Cell Phone": getAltPhoneForKind(account, "cell"),
    "Security Deposit ": moneyOrBlank(account?.securityDeposit),
    "Security Deposit Balance": "",
    "Rent Balance": "",
    "Fees Balance": moneyOrBlank(payment?.feesBalance),
    "Protection/Insurance Balance": "",
    "Merchandise Balance": "",
    "Late Fees Balance": "",
    "Lien Fees Balance": "",
    "Tax Balance": "",
    "Prepaid Rent": moneyOrBlank(payment?.prepaidRent),
    "Prepaid Additional Rent/Premium": moneyOrBlank(payment?.prepaidPremium),
    "Prepaid Tax": "",
    "Protection/Insurance Provider": payment?.insuranceProviderReview ?? "",
    "Protection/Insurance Coverage": payment?.insuranceCoverage ?? "",
    "Additional Rent/Premium": moneyOrBlank(payment?.additionalRent),
    "Delinquency Status": account?.statusMeaning === "Delinquent" ? "Delinquent" : "",
    "Lien Status": "",
    "Lien Posted Date": "",
    "Promotion": promotion?.description ?? "",
    "Promotion Type": promotion?.discountCode ?? "",
    "Promotion Value": moneyOrBlank(promotion?.amount),
    "Promotion Start": dateOrBlank(promotion?.date),
    "Promotion Length": "",
    "Discount": "",
    "Discount Type": "",
    "Discount Value": "",
    "Commanding Officer First Name": "",
    "Commanding Officer Last Name": "",
    "Commanding Officer Phone": "",
    "Commanding Officer Email": "",
    "Rank": "",
    "Military Serial Number": "",
    "Military Email": "",
    "Service Member DOB": "",
    "Expiration Term of Service": "",
    "Military Branch": "",
    "Military Unit Name": "",
    "Military Unit Phone": "",
    "Military Unit Address 1": "",
    "Military Unit Address 2": "",
    "Military City": "",
    "Military Unit State ": "",
    "Military Unit Zipcode": "",
    "Lien Holder First Name": "",
    "Lien Holder Last Name": "",
    "Lien Holder Email": "",
    "Lien Holder Phone": "",
    "Lien Holder Address 1": "",
    "Lien Holder Address 2": "",
    "Lien Holder City": "",
    "Lien Holder State": "",
    "Lien Holder Zipcode": "",
  };
}

function migFinalRow(unit: NormalizedUnit): Record<string, string | number> {
  const account = unit.account;
  const payment = unit.payment;
  const discountPercent = extractDiscountPercent(unit.promotion);
  const isBusiness = account?.accountClass.trim().toUpperCase() === "B";
  return {
    "Owner": "",
    "Name": "",
    "Status": unit.status,
    "Space": unit.unitNumber,
    "Width": unit.width,
    "Length": unit.length,
    "Height": unit.height,
    "Rate": unit.rate,
    "Web_Rate": unit.webRate,
    "Space_Size": unit.spaceSizeFinal,
    "Space_Category": unit.spaceCategory,
    "Space_Type": unit.spaceType,
    "Door_Width": "",
    "Door_Height": "",
    "Amenities": "",
    "Sq_Ft": unit.squareFeet,
    "Floor": unit.floor,
    "First_Name": account?.primaryFirstName ?? "",
    "Last_Name": account?.primaryLastName ?? "",
    "Middle_Name": "",
    "Account_Code": account ? lastFourPhone(account.primaryPhoneNumber, account.gatePin) : "",
    "Address": account?.primaryAddressLine1 ?? "",
    "Address2": account?.primaryAddressLine2 ?? "",
    "City": account?.primaryCity ?? "",
    "State": account?.primaryState ?? "",
    "ZIP": account?.primaryPostalCode ?? "",
    "country": account ? countryForMig(account.primaryCountry || "USA") : "",
    "Email": account?.primaryEmail ?? "",
    "Cell_Phone": phoneDigits(getPhoneForKind(account, "cell")),
    "Home_Phone": phoneDigits(getPhoneForKind(account, "home")),
    "Work_Phone": phoneDigits(getPhoneForKind(account, "work")),
    "Access_Code": account ? lastFourPhone(account.primaryPhoneNumber, account.gatePin) : "",
    "DOB": account?.dateOfBirth ? formatIsoDate(parseDate(account.dateOfBirth)) : "",
    "Active_military": "",
    "DL_ID": account?.identificationNo ?? "",
    "DL_State": account?.driversLicenseState ?? "",
    "Rent": unit.rate,
    "Last_Rent_Change_Date": "",
    "Last_rent_amt": "",
    "Scheduled_Rent_Change_Date": "",
    "Scheduled_Rent": "",
    "Scheduled_Rent_Notification": "",
    "Move_In_Date": dateOrBlank(payment?.moveInDate, "iso"),
    "Move_Out_Date": dateOrBlank(payment?.moveOutDate, "iso"),
    "Paid_date": dateOrBlank(payment?.paidDate, "iso"),
    "Bill_Day": payment?.billDay ?? "",
    "Paid_Through_Date": dateOrBlank(payment?.importPaidThroughDate, "iso"),
    "Alt_First_Name": account?.alternateFirstName ?? "",
    "Alt_Last_Name": account?.alternateLastName ?? "",
    "Alt_Middle_Name": "",
    "Alt_Address": account?.alternateAddressLine1 ?? "",
    "Alt_Address2": account?.alternateAddressLine2 ?? "",
    "Alt_City": account?.alternateCity ?? "",
    "Alt_State": account?.alternateState ?? "",
    "Alt_ZIP": account?.alternatePostalCode ?? "",
    "Alt_Email": account?.alternateEmail ?? "",
    "Alt_Home_Phone": phoneDigits(getAltPhoneForKind(account, "home")),
    "Alt_Work_Phone": phoneDigits(getAltPhoneForKind(account, "work")),
    "Alt_Cell_Phone": phoneDigits(getAltPhoneForKind(account, "cell")),
    "Security_Deposit": moneyOrBlank(account?.securityDeposit),
    "Security_Deposit_Balance": "",
    "Rent_Balance": "",
    "Fees_Balance": moneyOrBlank(payment?.feesBalance),
    "Protection_Plan_Balance": "",
    "Merchandise_Balance": "",
    "Late_Fees_Balance": "",
    "Tax_Balance": "",
    "Prepaid_Rent": moneyOrBlank(payment?.prepaidRent),
    "Protection_Provider": payment?.insuranceProviderMig ?? "",
    "Protection_start_date": "",
    "Protection_end_date": "",
    "Protection_Coverage": payment?.insuranceCoverage ?? "",
    "Additional_Rent": moneyOrBlank(payment?.additionalRent),
    "Promotion": "",
    "Promotion_Type": "",
    "Promotion_Value": "",
    "Promotion_Start": "",
    "Promotion_End": "",
    "Promotion_Length": "",
    "Discount": discountPercent !== null ? unit.promotion?.description ?? "" : "",
    "Discount_Type": discountPercent !== null ? "Percentage" : "",
    "Discount_Value": discountPercent ?? "",
    "Alarm_Enabled": "",
    "Twenty_Four_Hour_Access": account?.gate24Hr === "1" ? "Y" : "N",
    "payment_cycle": "",
    "IsBusinessLease": isBusiness ? "Y" : "N",
    "start_date": "",
    "company_name": isBusiness ? account?.accountName ?? "" : "",
    "company_address": isBusiness ? account?.primaryAddressLine1 ?? "" : "",
    "company_address2": isBusiness ? account?.primaryAddressLine2 ?? "" : "",
    "company_city": isBusiness ? account?.primaryCity ?? "" : "",
    "company_state": isBusiness ? account?.primaryState ?? "" : "",
    "company_zip": isBusiness ? account?.primaryPostalCode ?? "" : "",
    "company_phone": isBusiness ? phoneDigits(account?.primaryPhoneNumber ?? "") : "",
    "company_email": isBusiness ? account?.primaryEmail ?? "" : "",
  };
}

function clearRange(worksheet: WorksheetLike, startRow: number, rowCount: number, colCount: number): void {
  for (let row = startRow; row < startRow + rowCount; row += 1) {
    for (let col = 1; col <= colCount; col += 1) {
      worksheet.getCell(row, col).value = null;
    }
  }
}

function writeMatrix(worksheet: WorksheetLike, startRow: number, startCol: number, rows: Array<Array<string | number>>): void {
  rows.forEach((row, rowIndex) => {
    row.forEach((value, colIndex) => {
      worksheet.getCell(startRow + rowIndex, startCol + colIndex).value = value;
    });
  });
}

function writeObjectRows(
  worksheet: WorksheetLike,
  startRow: number,
  headers: readonly string[],
  rows: Array<Record<string, string | number>>,
): void {
  rows.forEach((row, rowIndex) => {
    headers.forEach((header, colIndex) => {
      worksheet.getCell(startRow + rowIndex, colIndex + 1).value = row[header] ?? "";
    });
  });
}

function worksheetOrThrow(workbook: ExcelWorkbook, name: string): WorksheetLike {
  const worksheet = workbook.getWorksheet(name);
  if (!worksheet) throw new Error(`Template workbook is missing sheet "${name}".`);
  return worksheet;
}

function setStandardColumnWidths(workbook: ExcelWorkbook): void {
  const spaceMix = worksheetOrThrow(workbook, "Space mix");
  spaceMix.columns = [12, 15, 12, 10, 10, 10, 10, 24, 10, 12, 12, 16, 12].map((width) => ({ width }));
  const tenantInfo = worksheetOrThrow(workbook, "Tenant Info");
  tenantInfo.columns = Array.from({ length: 34 }, (_, index) => ({ width: index < 2 ? 12 : 18 }));
  const paymentInfo = worksheetOrThrow(workbook, "Tenant Payment info");
  paymentInfo.columns = Array.from({ length: 27 }, (_, index) => ({ width: index < 5 ? 14 : 18 }));
  const promo = worksheetOrThrow(workbook, "PromotionsDiscounts");
  promo.columns = Array.from({ length: 11 }, () => ({ width: 18 }));
  const finalSheet = worksheetOrThrow(workbook, "Final Sheet (View Only)");
  finalSheet.columns = Array.from({ length: FINAL_SHEET_HEADERS.length }, (_, index) => ({ width: index < 5 ? 14 : 18 }));
  const mig = worksheetOrThrow(workbook, "MIG Team Final Sheet");
  mig.columns = Array.from({ length: MIG_HEADERS.length }, (_, index) => ({ width: index < 5 ? 14 : 18 }));
}

function setNumberFormats(workbook: ExcelWorkbook, unitCount: number): void {
  const rowEnd = Math.max(unitCount + 3, 10);
  const payment = worksheetOrThrow(workbook, "Tenant Payment info");
  for (let row = 3; row <= rowEnd; row += 1) {
    for (const col of [5, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 26, 27]) {
      payment.getCell(row, col).numFmt = "$#,##0.00";
    }
  }
  const finalSheet = worksheetOrThrow(workbook, "Final Sheet (View Only)");
  for (let row = 2; row <= unitCount + 1; row += 1) {
    for (const col of [9, 10, 40, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 72, 79, 82]) {
      finalSheet.getCell(row, col).numFmt = "$#,##0.00";
    }
  }
}

export async function buildExrHummingbirdWorkbookBuffer(
  input: ExrHummingbirdInput,
  options: ExrHummingbirdBuildOptions = {},
): Promise<{ buffer: Buffer; summary: ExrHummingbirdSummary }> {
  const parsed = parseExrHummingbirdBundle(input);
  const normalized = buildNormalizedUnits(parsed);
  const units = normalized.units;
  const sourceUnitCount = parsed.siteUnits.length;
  const includedUnitCount = units.length;
  const occupiedCount = units.filter((unit) => unit.status === "Occupied").length;
  const vacantCount = units.filter((unit) => unit.status === "Vacant").length;
  const promotionUnitCount = units.filter((unit) => unit.promotion).length;
  const prepaidTenantCount = units.filter((unit) => (unit.payment?.prepaidRent ?? 0) > 0 || (unit.payment?.prepaidPremium ?? 0) > 0).length;
  const warnings = Array.from(new Set(normalized.warnings));
  const templatePath = options.templatePath ?? DEFAULT_TEMPLATE_PATH;

  const ExcelJS = loadExcelJS();
  const workbook = new ExcelJS.Workbook() as unknown as ExcelWorkbook;
  await workbook.xlsx.load(toBuffer(await fs.readFile(templatePath)));

  clearRange(worksheetOrThrow(workbook, "Space mix"), 3, 2500, 13);
  clearRange(worksheetOrThrow(workbook, "Tenant Info"), 3, 2500, 34);
  clearRange(worksheetOrThrow(workbook, "Tenants Lien Holder Information"), 3, 2500, 13);
  clearRange(worksheetOrThrow(workbook, "Tenants Military Information"), 3, 2500, 22);
  clearRange(worksheetOrThrow(workbook, "Tenant Payment info"), 3, 2500, 27);
  clearRange(worksheetOrThrow(workbook, "PromotionsDiscounts"), 3, 2500, 11);
  clearRange(worksheetOrThrow(workbook, "Final Sheet (View Only)"), 2, 2500, FINAL_SHEET_HEADERS.length);
  clearRange(worksheetOrThrow(workbook, "MIG Team Final Sheet"), 2, 2500, MIG_HEADERS.length);

  writeMatrix(worksheetOrThrow(workbook, "Space mix"), 3, 1, units.map(spaceMixRow));
  writeMatrix(worksheetOrThrow(workbook, "Tenant Info"), 3, 1, units.map(tenantInfoRow));
  writeMatrix(worksheetOrThrow(workbook, "Tenants Lien Holder Information"), 3, 1, units.map(lienRow));
  writeMatrix(worksheetOrThrow(workbook, "Tenants Military Information"), 3, 1, units.map(militaryRow));
  writeMatrix(worksheetOrThrow(workbook, "Tenant Payment info"), 3, 1, units.map(tenantPaymentRow));
  writeMatrix(worksheetOrThrow(workbook, "PromotionsDiscounts"), 3, 1, units.map(promotionReviewRow));
  writeObjectRows(worksheetOrThrow(workbook, "Final Sheet (View Only)"), 2, FINAL_SHEET_HEADERS, units.map(finalSheetRow));
  writeObjectRows(worksheetOrThrow(workbook, "MIG Team Final Sheet"), 2, MIG_HEADERS, units.map(migFinalRow));

  setStandardColumnWidths(workbook);
  setNumberFormats(workbook, units.length);

  const outputBuffer = toBuffer((await workbook.xlsx.writeBuffer()) as ArrayBuffer | Buffer);
  return {
    buffer: outputBuffer,
    summary: {
      siteNumber: parsed.siteInfo.siteNumber,
      siteName: parsed.siteInfo.siteName,
      sourceUnitCount,
      includedUnitCount,
      excludedUnitCount: sourceUnitCount - includedUnitCount,
      occupiedCount,
      vacantCount,
      promotionUnitCount,
      prepaidTenantCount,
      warningCount: warnings.length,
      warnings,
    },
  };
}

function safeFilenamePart(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "site";
}

export async function buildExrHummingbirdExport(
  input: ExrHummingbirdInput,
  options: ExrHummingbirdBuildOptions = {},
): Promise<ExrHummingbirdExport> {
  const built = await buildExrHummingbirdWorkbookBuffer(input, options);
  const date = options.outputDate ?? new Date();
  const datePart = formatIsoDate(date);
  const namePart = safeFilenamePart(`${built.summary.siteNumber}-${built.summary.siteName}`);
  return {
    artifactName: `exr-hummingbird-${namePart}-${datePart}.xlsx`,
    artifactMimeType: XLSX_MIME_TYPE,
    artifactBuffer: built.buffer,
    summary: built.summary,
  };
}

export const __internal = {
  parseSiteInfo,
  parseSiteUnits,
  parseAccounts,
  parseNotes,
  parsePcd,
  parseDispositionReport,
  parseExrHummingbirdBundle,
  buildNormalizedUnits,
  computeCycleEndContaining,
  countPrepaidPeriods,
};
