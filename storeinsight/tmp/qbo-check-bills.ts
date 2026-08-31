/**
 * Read-only: ask each connected QuickBooks company whether the FacilIQ bills the ledger
 * claims are actually there. Creates nothing.
 *
 *   npx tsx tmp/qbo-check-bills.ts
 */
import path from "node:path";
import dotenv from "dotenv";

dotenv.config({ path: path.join(process.cwd(), ".env.local") });

type QboBill = {
  Id?: string;
  DocNumber?: string;
  TotalAmt?: number;
  TxnDate?: string;
  VendorRef?: { value?: string; name?: string };
};

const main = async (): Promise<void> => {
  const { getQuickBooksClient } = await import("../src/lib/accounting/quickbooks/client");
  const { listConnections } = await import("../src/lib/accounting/quickbooks/connections");
  const { resolveEnvironment, isLiveCreateEnabled } = await import(
    "../src/lib/accounting/quickbooks/config"
  );
  const { firestore } = await import("../src/server/firebaseAdmin");

  console.log(`environment=${resolveEnvironment()}  liveCreate=${isLiveCreateEnabled()}`);

  const bills = await firestore!.collection("faciliqInvoiceBills").get();
  const byProperty = new Map<string, Array<Record<string, unknown>>>();
  for (const doc of bills.docs) {
    const b = doc.data();
    const list = byProperty.get(b.propertyCode as string) ?? [];
    list.push(b);
    byProperty.set(b.propertyCode as string, list);
  }

  for (const connection of await listConnections()) {
    const rows = byProperty.get(connection.propertyCode) ?? [];
    console.log(
      `\n=== ${connection.propertyCode}  ${connection.companyName}  status=${connection.status}  ledger bills=${rows.length}`,
    );
    if (connection.status !== "connected") {
      console.log("  not connected; reconnect at /accounting/quickbooks first");
      continue;
    }

    const client = await getQuickBooksClient(connection.propertyCode);
    for (const b of rows) {
      const docNumber = String(b.invoiceNumber);
      const found = await client.query<QboBill>(
        "Bill",
        `SELECT Id, DocNumber, TotalAmt, TxnDate, VendorRef FROM Bill WHERE DocNumber = '${docNumber.replace(/'/g, "\\'")}'`,
      );
      const ledgerId = (b.quickBooksBillId as string | null) ?? "-";
      console.log(
        `  inv ${docNumber}  ${b.vendorName}  $${b.amount}  ledger=${String(b.status)}/id ${ledgerId}`,
      );
      if (found.length === 0) {
        console.log("    QuickBooks: NOT PRESENT");
      } else {
        for (const bill of found) {
          console.log(
            `    QuickBooks: bill ${bill.Id}  $${bill.TotalAmt}  ${bill.TxnDate}  vendor ${bill.VendorRef?.name ?? bill.VendorRef?.value}`,
          );
        }
      }
    }
  }
};

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
