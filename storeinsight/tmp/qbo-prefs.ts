/** Read-only: does this company have account numbers turned on, and what plan is it on? */
import path from "node:path";
import dotenv from "dotenv";
dotenv.config({ path: path.join(process.cwd(), ".env.local") });

const main = async () => {
  const { getQuickBooksClient } = await import("../src/lib/accounting/quickbooks/client");
  for (const property of ["W003", "W002", "L001"]) {
    const client = await getQuickBooksClient(property as never);
    const prefs = await client.query<Record<string, unknown>>(
      "Preferences",
      "SELECT * FROM Preferences",
    );
    const acct = (prefs[0]?.AccountingInfoPrefs ?? {}) as Record<string, unknown>;
    const info = await client.query<Record<string, unknown>>(
      "CompanyInfo",
      "SELECT * FROM CompanyInfo",
    );
    const pairs = (info[0]?.NameValue ?? []) as Array<{ Name?: string; Value?: string }>;
    const sku = pairs.find((p) => /sku|offering|subscription/i.test(p.Name ?? ""));
    console.log(`\n${property}  ${client.companyName}`);
    console.log(`  UseAccountNumbers    ${String(acct.UseAccountNumbers)}`);
    console.log(`  ClassTrackingPerTxn  ${String(acct.ClassTrackingPerTxn)}`);
    console.log(`  plan/sku             ${sku ? `${sku.Name}=${sku.Value}` : "(not reported)"}`);
  }
};
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
