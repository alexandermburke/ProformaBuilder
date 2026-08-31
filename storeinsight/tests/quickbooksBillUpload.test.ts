import assert from "node:assert/strict";
import test from "node:test";

// The OAuth state signer and the token cipher both derive their key from this.
process.env.AUTH_SECRET = process.env.AUTH_SECRET || "test-secret-for-quickbooks-unit-tests";

import { reviewInvoiceCsv } from "../src/lib/accounting/faciliqInvoiceImport/reviewInvoices";
import {
  QBO_DOC_NUMBER_MAX,
  billKeyFor,
  buildBillDrafts,
  buildBillPayload,
} from "../src/lib/accounting/quickbooks/buildBills";
import { deriveExportUploadStatus } from "../src/lib/accounting/quickbooks/uploadFaciliqBills";
import { emptyBillCounts } from "../src/lib/accounting/quickbooks/billRecords";
import { escapeQueryValue, normalizeRefKey } from "../src/lib/accounting/quickbooks/resolveRefs";
import { decryptToken, encryptToken } from "../src/lib/accounting/quickbooks/tokenCrypto";
import { signOAuthState, verifyOAuthState } from "../src/lib/accounting/quickbooks/oauth";
import { isAccessTokenFresh } from "../src/lib/accounting/quickbooks/client";
import {
  readConnectionTokens,
  refreshedConnectionFields,
  type StoredQuickBooksConnection,
} from "../src/lib/accounting/quickbooks/connections";

/** Header taken verbatim from the real weekly export. */
const HEADER = [
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

const SOURCE_FILENAME = "store-quickbooks-2026-08-03-to-2026-08-09.csv";
const AS_OF = "2026-08-12";

type RowInput = {
  invoiceNo: string;
  customer: string;
  invoiceDate: string;
  dueDate: string;
  memo?: string;
  item: string;
  description: string;
  rate: string;
  amount: string;
  property: string;
  glCode: string;
};

const row = (input: RowInput): string[] => [
  input.invoiceNo,
  input.customer,
  input.invoiceDate,
  input.dueDate,
  "",
  "1351 Baseline Rd. Roseville, CA 95747",
  input.memo ?? "",
  input.item,
  input.description,
  "1",
  input.rate,
  input.amount,
  input.invoiceDate,
  input.property,
  input.glCode,
];

const quote = (cell: string): string =>
  /[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;

const buildCsv = (rows: string[][]): string =>
  [HEADER, ...rows].map((cells) => cells.map(quote).join(",")).join("\r\n") + "\r\n";

const W003_LINE_A = row({
  invoiceNo: "INV5001",
  customer: "FM irrigation",
  invoiceDate: "8/4/2026",
  dueDate: "8/4/2026",
  item: "Site-Grounds",
  description: "Replace 8 nozzles in zone 1",
  rate: "100",
  amount: "100",
  property: "W003 - STORE on Baseline",
  glCode: "5100-1110",
});

const W003_LINE_B = row({
  invoiceNo: "INV5001",
  customer: "FM irrigation",
  invoiceDate: "8/4/2026",
  dueDate: "8/4/2026",
  item: "Site-Lighting",
  description: "Replace two bollard fixtures",
  rate: "50",
  amount: "50",
  property: "W003 - STORE on Baseline",
  glCode: "5100-1120",
});

const P006_LINE = row({
  invoiceNo: "INV5002",
  customer: "Acme Plumbing",
  invoiceDate: "8/5/2026",
  dueDate: "8/12/2026",
  item: "Plumbing",
  description: "Clear main line",
  rate: "250",
  amount: "250",
  property: "P006 - STORE on Vicksburg",
  glCode: "5200-1110",
});

const reportFor = (rows: string[][]) =>
  reviewInvoiceCsv(buildCsv(rows), { sourceFilename: SOURCE_FILENAME, asOfIso: AS_OF });

test("two rows sharing an invoice number become one bill with two lines", () => {
  const drafts = buildBillDrafts(reportFor([W003_LINE_A, W003_LINE_B]));

  assert.equal(drafts.length, 1);
  const [draft] = drafts;
  assert.equal(draft.propertyCode, "W003");
  assert.equal(draft.invoiceNumber, "INV5001");
  assert.equal(draft.vendorName, "FM irrigation");
  assert.equal(draft.amount, 150);
  assert.equal(draft.lines.length, 2);
  assert.deepEqual(
    draft.lines.map((line) => line.glCode),
    ["5100-1110", "5100-1120"],
  );
  assert.equal(draft.invoiceDateIso, "2026-08-04");
  assert.equal(draft.dueDateIso, "2026-08-04");
});

test("bills are split per property, because each property is its own QuickBooks company", () => {
  const drafts = buildBillDrafts(reportFor([W003_LINE_A, W003_LINE_B, P006_LINE]));

  assert.equal(drafts.length, 2);
  assert.deepEqual(
    drafts.map((draft) => `${draft.propertyCode}:${draft.invoiceNumber}`).sort(),
    ["P006:INV5002", "W003:INV5001"],
  );
});

test("rows the converter held back are never turned into bills", () => {
  // A blank GL code is an error flag, so the row is held for review, not imported.
  const heldBack = row({
    invoiceNo: "INV5003",
    customer: "FM irrigation",
    invoiceDate: "8/6/2026",
    dueDate: "8/6/2026",
    item: "Site-Grounds",
    description: "No GL code on this one",
    rate: "75",
    amount: "75",
    property: "W003 - STORE on Baseline",
    glCode: "",
  });

  const drafts = buildBillDrafts(reportFor([W003_LINE_A, W003_LINE_B, heldBack]));
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].invoiceNumber, "INV5001");
});

test("the duplicate key is stable across runs and reacts to what identifies a bill", () => {
  const base = {
    propertyCode: "W003" as const,
    vendorName: "FM irrigation",
    invoiceNumber: "INV5001",
    amount: 150,
  };

  assert.equal(billKeyFor(base), billKeyFor(base));
  // Formatting differences in the source text must not create a second bill.
  assert.equal(billKeyFor(base), billKeyFor({ ...base, vendorName: "  FM  Irrigation " }));
  assert.equal(billKeyFor(base), billKeyFor({ ...base, amount: 150.004 }));

  assert.notEqual(billKeyFor(base), billKeyFor({ ...base, propertyCode: "W002" }));
  assert.notEqual(billKeyFor(base), billKeyFor({ ...base, invoiceNumber: "INV5002" }));
  assert.notEqual(billKeyFor(base), billKeyFor({ ...base, amount: 150.5 }));
  assert.notEqual(billKeyFor(base), billKeyFor({ ...base, vendorName: "Acme Plumbing" }));
});

test("the same invoice in two weekly exports produces one key, so it uploads once", () => {
  const first = buildBillDrafts(reportFor([W003_LINE_A, W003_LINE_B]))[0];
  // Same invoice, re-sent inside a differently named export file.
  const resent = reviewInvoiceCsv(buildCsv([W003_LINE_A, W003_LINE_B]), {
    sourceFilename: "store-quickbooks-2026-08-04-to-2026-08-10.csv",
    asOfIso: "2026-08-20",
  });
  const second = buildBillDrafts(resent)[0];

  assert.equal(first.billKey, second.billKey);
});

test("the QuickBooks payload carries every field the export supplies", () => {
  const draft = buildBillDrafts(reportFor([W003_LINE_A, W003_LINE_B]))[0];
  const result = buildBillPayload({
    draft,
    vendorId: "42",
    accountIdBySourceLine: new Map([
      [draft.lines[0].sourceLine, "101"],
      [draft.lines[1].sourceLine, "102"],
    ]),
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  const { payload } = result;

  assert.deepEqual(payload.VendorRef, { value: "42" });
  assert.equal(payload.TxnDate, "2026-08-04");
  assert.equal(payload.DueDate, "2026-08-04");
  assert.equal(payload.DocNumber, "INV5001");
  assert.match(payload.PrivateNote ?? "", /store-quickbooks-2026-08-03-to-2026-08-09\.csv/);

  assert.equal(payload.Line.length, 2);
  assert.equal(payload.Line[0].Amount, 100);
  assert.equal(payload.Line[0].Description, "Replace 8 nozzles in zone 1");
  assert.equal(payload.Line[0].DetailType, "AccountBasedExpenseLineDetail");
  assert.deepEqual(payload.Line[0].AccountBasedExpenseLineDetail.AccountRef, { value: "101" });
  assert.equal(payload.Line[0].AccountBasedExpenseLineDetail.BillableStatus, "NotBillable");
  assert.deepEqual(payload.Line[1].AccountBasedExpenseLineDetail.AccountRef, { value: "102" });
});

test("a line with no resolved account stops the bill instead of posting a partial one", () => {
  const draft = buildBillDrafts(reportFor([W003_LINE_A, W003_LINE_B]))[0];
  const result = buildBillPayload({
    draft,
    vendorId: "42",
    accountIdBySourceLine: new Map([[draft.lines[0].sourceLine, "101"]]),
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.reason, /no resolved QuickBooks account/);
});

test("an over-length invoice number is refused rather than truncated", () => {
  const draft = buildBillDrafts(reportFor([W003_LINE_A]))[0];
  const tooLong = { ...draft, invoiceNumber: "X".repeat(QBO_DOC_NUMBER_MAX + 1) };
  const result = buildBillPayload({
    draft: tooLong,
    vendorId: "42",
    accountIdBySourceLine: new Map([[draft.lines[0].sourceLine, "101"]]),
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.reason, /QuickBooks allows 21/);
});

test("an export is only 'uploaded' when every bill is settled", () => {
  const counts = emptyBillCounts();
  assert.equal(deriveExportUploadStatus(counts), "not_started");

  assert.equal(deriveExportUploadStatus({ ...counts, uploaded: 3 }), "uploaded");
  assert.equal(deriveExportUploadStatus({ ...counts, uploaded: 2, duplicate: 1 }), "uploaded");

  // The case that must never read as a clean success.
  assert.equal(deriveExportUploadStatus({ ...counts, uploaded: 2, failed: 1 }), "partial");
  assert.equal(deriveExportUploadStatus({ ...counts, uploaded: 1, needs_mapping: 2 }), "partial");

  assert.equal(deriveExportUploadStatus({ ...counts, needs_mapping: 2 }), "needs_mapping");
  assert.equal(deriveExportUploadStatus({ ...counts, failed: 2 }), "upload_failed");
  assert.equal(deriveExportUploadStatus({ ...counts, pending: 2 }), "not_started");
});

test("reference keys ignore case, spacing, and punctuation but not identity", () => {
  assert.equal(normalizeRefKey("FM irrigation"), "fmirrigation");
  assert.equal(normalizeRefKey("F.M. Irrigation"), "fmirrigation");
  assert.equal(normalizeRefKey("5100-1110"), "51001110");
  assert.notEqual(normalizeRefKey("5100-1110"), normalizeRefKey("5100-1120"));
});

test("query values escape the quote that would otherwise break the statement", () => {
  assert.equal(escapeQueryValue("O'Brien Plumbing"), "O\\'Brien Plumbing");
  assert.equal(escapeQueryValue("INV5001"), "INV5001");
});

test("stored tokens round-trip and a tampered ciphertext fails closed", () => {
  const token = "refresh-token-value-abc123";
  const encrypted = encryptToken(token);

  assert.notEqual(encrypted, token);
  assert.equal(decryptToken(encrypted), token);
  // Same plaintext must not produce the same ciphertext twice.
  assert.notEqual(encryptToken(token), encrypted);

  const parts = encrypted.split(":");
  const tampered = [parts[0], parts[1], parts[2], Buffer.from("evil").toString("base64")].join(":");
  assert.throws(() => decryptToken(tampered));
});

test("the OAuth state round-trips the property and rejects tampering and expiry", () => {
  const state = signOAuthState("W003");
  const verified = verifyOAuthState(state);
  assert.equal(verified.ok, true);
  if (verified.ok) assert.equal(verified.propertyCode, "W003");

  // A forged property code cannot be swapped in without the signature failing.
  const [body, signature] = state.split(".");
  const forgedBody = Buffer.from(JSON.stringify({ propertyCode: "L001", nonce: "x", issuedAt: Date.now() }))
    .toString("base64")
    .replace(/=+$/, "");
  const forged = verifyOAuthState(`${forgedBody}.${signature}`);
  assert.equal(forged.ok, false);

  assert.equal(verifyOAuthState(null).ok, false);
  assert.equal(verifyOAuthState("nonsense").ok, false);
  assert.equal(verifyOAuthState(`${body}.${signature}`, Date.now() + 20 * 60 * 1000).ok, false);
});

// ---------------------------------------------------------------------------
// Token refresh. W002 and W003 both died in August 2026 one second after a
// refresh that worked: a spent refresh token got sent a second time, and Intuit
// answers that with 400 "Incorrect or invalid refresh token". The lease in
// connections.ts is the actual guarantee against it and needs a Firestore fake
// to test; what is unit-testable is the pair of values a refresh produces and
// the freshness predicate the whole path turns on.
// ---------------------------------------------------------------------------

const storedConnection = (input: {
  accessTokenExpiresAt: string;
  accessToken?: string;
  refreshToken?: string;
}): StoredQuickBooksConnection => ({
  propertyCode: "W003",
  realmId: "9341457708674385",
  environment: "sandbox",
  companyName: "IES Sandbox Company US 8a1b Parent",
  companyLegalName: "IES Sandbox Company US 8a1b Parent",
  companyNameVerified: false,
  status: "connected",
  accessTokenEnc: encryptToken(input.accessToken ?? "A1"),
  accessTokenExpiresAt: input.accessTokenExpiresAt,
  refreshTokenEnc: encryptToken(input.refreshToken ?? "R1"),
  refreshTokenExpiresAt: "2026-12-05T17:16:23.927Z",
  connectedBy: "alex@storestorage.com",
  connectedAt: "2026-08-24T22:44:59.408Z",
  lastRefreshedAt: null,
  lastError: null,
  refreshLeaseUntil: null,
});

test("a connection advanced by a refresh stops looking expired and stops holding the spent token", () => {
  // The state W003 was in at 17:16:24 on 2026-08-26: a token an hour past expiry.
  const before = storedConnection({
    accessToken: "A1",
    refreshToken: "R1",
    accessTokenExpiresAt: "2026-08-26T18:16:23.927Z",
  });
  const nowMs = Date.parse("2026-08-27T17:16:24.000Z");

  assert.equal(isAccessTokenFresh(before, nowMs), false);
  assert.equal(readConnectionTokens(before).refreshToken, "R1");

  const written = refreshedConnectionFields({
    accessToken: "A2",
    accessTokenExpiresAt: new Date(nowMs + 3600_000).toISOString(),
    refreshToken: "R2",
    refreshTokenExpiresAt: "2026-12-06T17:16:24.000Z",
    nowIso: new Date(nowMs).toISOString(),
  });
  const after: StoredQuickBooksConnection = { ...before, ...written };

  // The second request in the same run reads these. Both must have moved.
  assert.equal(isAccessTokenFresh(after, nowMs), true);
  assert.equal(readConnectionTokens(after).accessToken, "A2");
  assert.equal(
    readConnectionTokens(after).refreshToken,
    "R2",
    "an advanced snapshot must not carry the refresh token that was just spent",
  );
  assert.equal(after.status, "connected");
  assert.equal(after.lastError, null);
  // A completed refresh ends the lease, or every other actor waits it out for nothing.
  assert.equal(after.refreshLeaseUntil, null);
});

test("the refresh margin refuses a token inside the margin, or one with an unreadable expiry", () => {
  const nowMs = Date.parse("2026-08-27T17:16:24.000Z");
  const expiringAt = (accessTokenExpiresAt: string) => storedConnection({ accessTokenExpiresAt });

  assert.equal(isAccessTokenFresh(expiringAt(new Date(nowMs + 90_000).toISOString()), nowMs), false);
  assert.equal(isAccessTokenFresh(expiringAt(new Date(nowMs + 600_000).toISOString()), nowMs), true);
  // An unparseable expiry must read as expired, not as valid forever.
  assert.equal(isAccessTokenFresh(expiringAt("not a date"), nowMs), false);
});
