import assert from "node:assert/strict";
import test from "node:test";
import XLSX from "xlsx";
import { buildLsaWorkbookBuffer, parseLsaStatementText } from "../src/lib/lsaAutomation";

const SAMPLE_LSA_TEXT = `Page 1 of 2
Statement
To
Manager Manager
STORE Management, LLC
4250 E Camelback Rd
Phoenix, AZ 85018-2718
United States
..............................................................	540-938-6939
..............................................................	5841-8232-1754-4619
..............................................................	3204-4207-8140
..............................................................	Mar 31, 2026
Details
Account ID
Payments account ID
Payments profile ID
Statement issue date
$455.93
$899.26
-$955.93
$399.26
Google Ads
Summary for Mar 1, 2026–Mar 31, 2026
Starting balance
Total new activity
Total payments received
Ending balance in USD
This is not a bill.
This is a summary of billing activity for the time period stated above.

-- 1 of 2 --

Statement
Page 2 of 2
$899.26
$0.00
$899.26
Subtotal in USD
Tax (0%)
Total in USD
-$955.93	Total payments received in USD
Account: LSA: The Grove
Account ID: 540-938-6939
Mar 1, 2026 - Mar 31, 2026
Description 	Quantity Units 	Amount($)
LocalServicesCampaign:SystemGenerated:000634f312950348 	17 Leads 	969.06
Invalid activity - Original Month of Service: Feb 2026, Campaign Name: GHS_001:000000028a9adaec 	-69.80
PAYMENTS RECEIVED
Date 	Description 	Amount($)
Mar 1 	Monthly charge: American Express • • • • 1003. A9950324397872919 	-455.93
Mar 11 	Threshold charge: American Express • • • • 1003. A15C0FSL 	-500.00

-- 2 of 2 --`;

test("parseLsaStatementText parses summary and table rows", () => {
  const statement = parseLsaStatementText(SAMPLE_LSA_TEXT, "03-2026 L001 LSA.pdf");

  assert.equal(statement.accountId, "540-938-6939");
  assert.equal(statement.accountName, "LSA: The Grove");
  assert.equal(statement.totalNewActivity, "$899.26");
  assert.equal(statement.totalPaymentsReceived, "-$955.93");
  assert.equal(statement.charges.length, 2);
  assert.equal(statement.charges[0]?.quantity, "17");
  assert.equal(statement.charges[0]?.units, "Leads");
  assert.equal(statement.payments.length, 2);
  assert.equal(statement.payments[1]?.amount, "-500.00");
});

test("buildLsaWorkbookBuffer creates a table-style workbook", async () => {
  const statement = parseLsaStatementText(SAMPLE_LSA_TEXT, "03-2026 L001 LSA.pdf");
  const buffer = await buildLsaWorkbookBuffer(statement);
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const rows = XLSX.utils.sheet_to_json<string[]>(workbook.Sheets["Table 1"], { header: 1, raw: false });

  assert.equal(rows[0]?.[0], "Statement\nTo\nManager Manager\nSTORE Management, LLC\n4250 E Camelback Rd\nPhoenix, AZ 85018-2718\nUnited States");
  assert.equal(rows[5]?.[0], "Account: LSA: The Grove Account ID: 540-938-6939\nMar 1, 2026 - Mar 31, 2026");
  assert.equal(rows[7]?.[0], "LocalServicesCampaign:SystemGenerated:000634f312950348");
  assert.equal(rows[7]?.[5], "17");
  assert.equal(rows[7]?.[7], "Leads");
  assert.equal(rows[7]?.[9], "969.06");
});
