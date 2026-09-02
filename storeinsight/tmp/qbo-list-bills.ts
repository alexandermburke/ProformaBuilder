/** Read-only: every bill in one property's QuickBooks company. */
import path from "node:path";
import dotenv from "dotenv";
dotenv.config({ path: path.join(process.cwd(), ".env.local") });
type Bill = { Id?: string; DocNumber?: string; TotalAmt?: number; Balance?: number; TxnDate?: string; DueDate?: string; VendorRef?: { name?: string } };
const main = async () => {
  const property = process.argv[2] ?? "L001";
  const { getQuickBooksClient } = await import("../src/lib/accounting/quickbooks/client");
  const client = await getQuickBooksClient(property as never);
  console.log(`${property} -> ${client.companyName} (realm ${client.realmId})\n`);
  const bills = await client.query<Bill>("Bill", "SELECT * FROM Bill ORDER BY TxnDate MAXRESULTS 100");
  console.log(`${bills.length} bill(s) total:\n`);
  for (const b of bills) {
    console.log(
      `  id ${String(b.Id).padEnd(4)} doc ${String(b.DocNumber ?? "-").padEnd(12)} ${b.TxnDate}  due ${b.DueDate}  $${String(b.TotalAmt).padEnd(9)} bal $${String(b.Balance).padEnd(9)} ${b.VendorRef?.name}`,
    );
  }
};
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
