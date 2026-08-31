/**
 * Read-only: show what a property's QuickBooks company actually holds, so a "missing"
 * vendor or account can be told apart from one that exists under a slightly different name.
 *
 *   npx tsx tmp/qbo-find.ts W002 EVID
 *   npx tsx tmp/qbo-find.ts W002 6800
 */
import path from "node:path";
import dotenv from "dotenv";

dotenv.config({ path: path.join(process.cwd(), ".env.local") });

type Vendor = { Id?: string; DisplayName?: string; CompanyName?: string; Active?: boolean };
type Account = { Id?: string; Name?: string; AcctNum?: string; AccountType?: string; Active?: boolean };

const main = async (): Promise<void> => {
  const [property, needle = ""] = process.argv.slice(2);
  if (!property) throw new Error("Usage: npx tsx tmp/qbo-find.ts <PROPERTY> [search]");

  const { getQuickBooksClient } = await import("../src/lib/accounting/quickbooks/client");
  const { normalizeRefKey } = await import("../src/lib/accounting/quickbooks/resolveRefs");

  const client = await getQuickBooksClient(property as never);
  console.log(`${property} -> ${client.companyName} (realm ${client.realmId})\n`);

  const key = normalizeRefKey(needle);
  const hit = (...values: Array<string | undefined>) =>
    !needle || values.some((v) => (v ?? "").toLowerCase().includes(needle.toLowerCase()));

  const vendors = await client.query<Vendor>(
    "Vendor",
    "SELECT Id, DisplayName, CompanyName, Active FROM Vendor MAXRESULTS 1000",
  );
  console.log(`VENDORS matching "${needle}" (of ${vendors.length} active):`);
  for (const v of vendors.filter((v) => hit(v.DisplayName, v.CompanyName))) {
    const k = normalizeRefKey(v.DisplayName ?? "");
    console.log(
      `  "${v.DisplayName}"  company="${v.CompanyName ?? ""}"  key=${k}${k === key ? "   <-- EXACT MATCH" : ""}`,
    );
  }

  const accounts = await client.query<Account>(
    "Account",
    "SELECT Id, Name, AcctNum, AccountType, Active FROM Account WHERE Active = true MAXRESULTS 1000",
  );
  console.log(`\nACCOUNTS matching "${needle}" (of ${accounts.length} active):`);
  for (const a of accounts.filter((a) => hit(a.Name, a.AcctNum))) {
    const numKey = normalizeRefKey(a.AcctNum ?? "");
    const nameKey = normalizeRefKey(a.Name ?? "");
    const exact = numKey === key || nameKey === key;
    console.log(
      `  num="${a.AcctNum ?? ""}"  name="${a.Name}"  type=${a.AccountType}${exact ? "   <-- EXACT MATCH" : ""}`,
    );
  }

  const withNumbers = accounts.filter((a) => (a.AcctNum ?? "").trim()).length;
  console.log(
    `\n${withNumbers} of ${accounts.length} active accounts have an account number set.`,
  );
};

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
