/**
 * Check a QuickBooks connection before any bill is created.
 *
 * Answers the three questions that actually block a first upload:
 *   1. Is the connection alive, and WHICH company is on the other end of it?
 *   2. What vendors and accounts does that company actually have?
 *   3. For a real FacilIQ export, which vendor names and GL codes resolve, and which
 *      do not? The ones that do not are exactly what has to be created in QuickBooks
 *      before an upload will do anything.
 *
 * Read-only. This never creates, updates, or deletes anything in QuickBooks.
 *
 * Usage:
 *   npx tsx scripts/quickbooksPreflight.ts                      every connected property
 *   npx tsx scripts/quickbooksPreflight.ts --property W003      one property
 *   npx tsx scripts/quickbooksPreflight.ts --export <messageId> check against one export
 *   npm run qbo:preflight -- --property W003
 *
 * Exit codes: 0 = everything resolves, 1 = something needs creating or mapping,
 * 2 = no usable connection.
 */
import path from "node:path";
import dotenv from "dotenv";
// Type-only, so it is erased and does not load the module before dotenv runs.
import type { QuickBooksPropertyCode } from "../src/lib/accounting/faciliqInvoiceImport/properties";

dotenv.config({ path: path.join(process.cwd(), ".env.local") });

const main = async (): Promise<number> => {
  // Imported after dotenv so the Firebase and QuickBooks modules see the env.
  const { reviewInvoiceCsv } = await import(
    "../src/lib/accounting/faciliqInvoiceImport/reviewInvoices"
  );
  const { hasQuickBooksCredentials, isLiveCreateEnabled, resolveEnvironment } = await import(
    "../src/lib/accounting/quickbooks/config"
  );
  const { getQuickBooksClient } = await import("../src/lib/accounting/quickbooks/client");
  const { listConnections } = await import("../src/lib/accounting/quickbooks/connections");
  const { createRefResolver } = await import("../src/lib/accounting/quickbooks/resolveRefs");
  const { buildBillDrafts } = await import("../src/lib/accounting/quickbooks/buildBills");
  const { getIntakeRecord, listParsedExports } = await import(
    "../src/lib/accounting/faciliqInvoiceIntake/records"
  );
  const { storage } = await import("../src/server/firebaseAdmin");

  const args = process.argv.slice(2);
  const argValue = (flag: string): string | null => {
    const index = args.indexOf(flag);
    return index !== -1 ? (args[index + 1] ?? null) : null;
  };

  const requestedProperty = argValue("--property");
  const requestedExport = argValue("--export");

  console.log("QuickBooks preflight");
  console.log("--------------------");
  console.log(`  Environment          ${resolveEnvironment()}`);
  console.log(`  Credentials set      ${hasQuickBooksCredentials() ? "yes" : "NO"}`);
  console.log(`  Bill creation        ${isLiveCreateEnabled() ? "ENABLED" : "off (dry run only)"}`);
  console.log(`  Redirect URI         ${process.env.QUICKBOOKS_REDIRECT_URI ?? "(unset)"}`);
  console.log("");

  const connections = await listConnections();
  if (connections.length === 0) {
    console.log("No property is connected to a QuickBooks company yet.");
    console.log("Connect one at /accounting/quickbooks, then run this again.");
    return 2;
  }

  const targets = connections
    .filter((connection) => !requestedProperty || connection.propertyCode === requestedProperty)
    .map((connection) => connection.propertyCode);

  if (targets.length === 0) {
    console.log(
      `"${requestedProperty}" is not connected. Connected: ${connections
        .map((connection) => connection.propertyCode)
        .join(", ")}.`,
    );
    return 2;
  }

  // The export supplies the real vendor names and GL codes to test resolution against.
  let exportRecord = requestedExport ? await getIntakeRecord(requestedExport) : null;
  if (!exportRecord && !requestedExport) {
    // Prefer the newest export that actually has clean rows. The newest export overall can
    // legitimately have none, and checking against it would report "nothing to do" when
    // there is plenty to check.
    const parsed = await listParsedExports(25);
    exportRecord =
      parsed.find((record) => (record.totals?.readyRows ?? 0) > 0) ?? parsed[0] ?? null;
  }
  if (requestedExport && !exportRecord) {
    console.log(`No intake record for message ${requestedExport}.`);
    return 2;
  }

  let drafts: ReturnType<typeof buildBillDrafts> = [];
  if (exportRecord?.storagePath && storage) {
    const [buffer] = await storage.file(exportRecord.storagePath).download();
    const report = reviewInvoiceCsv(new TextDecoder("utf-8").decode(buffer), {
      sourceFilename: exportRecord.attachmentName ?? "export.csv",
      asOfIso: exportRecord.asOfIso ?? new Date().toISOString().slice(0, 10),
    });
    if (report.ok) drafts = buildBillDrafts(report);
    console.log(`Checking against export ${exportRecord.attachmentName ?? exportRecord.messageId}`);
    console.log(`  ${drafts.length} bill(s) across ${new Set(drafts.map((d) => d.propertyCode)).size} property(ies)`);
    console.log("");
  } else if (exportRecord) {
    console.log("That export has no archived CSV, so only the connection is checked.\n");
  } else {
    console.log("No parsed export found, so only the connection is checked.\n");
  }

  let unresolved = 0;
  let checked = 0;

  for (const propertyCode of targets as QuickBooksPropertyCode[]) {
    console.log(`${propertyCode}`);
    console.log("".padEnd(propertyCode.length, "="));

    let client;
    try {
      client = await getQuickBooksClient(propertyCode);
    } catch (err) {
      console.log(`  NOT USABLE: ${err instanceof Error ? err.message : String(err)}`);
      console.log("");
      unresolved += 1;
      continue;
    }

    console.log(`  Company              ${client.companyName || "(unnamed)"}`);
    console.log(`  Realm                ${client.realmId}`);
    console.log(`  API environment      ${client.environment}`);

    const resolver = await createRefResolver(client);
    const propertyDrafts = drafts.filter((draft) => draft.propertyCode === propertyCode);

    if (propertyDrafts.length === 0) {
      console.log("  No bills in the export for this property.");
      console.log("");
      continue;
    }

    const vendorNames = [...new Set(propertyDrafts.map((draft) => draft.vendorName))];
    const glCodes = [
      ...new Set(propertyDrafts.flatMap((draft) => draft.lines.map((line) => line.glCode))),
    ];

    console.log("");
    console.log("  Vendors this export needs");
    for (const name of vendorNames) {
      const result = await resolver.resolveVendor(name);
      checked += 1;
      if (result.resolved) {
        console.log(`    OK       ${name}  ->  ${result.ref.label} (id ${result.ref.id})`);
      } else {
        unresolved += 1;
        console.log(`    MISSING  ${name}`);
        if (result.candidates.length > 0) {
          console.log(`             close in QuickBooks: ${result.candidates.join(", ")}`);
        }
      }
    }

    console.log("");
    console.log("  Accounts this export needs");
    for (const code of glCodes) {
      const result = await resolver.resolveAccount(code);
      checked += 1;
      if (result.resolved) {
        console.log(`    OK       ${code}  ->  ${result.ref.label} (id ${result.ref.id})`);
      } else {
        unresolved += 1;
        console.log(`    MISSING  ${code}`);
        if (result.candidates.length > 0) {
          console.log(`             close in QuickBooks: ${result.candidates.join(", ")}`);
        }
      }
    }
    console.log("");
  }

  if (checked === 0) {
    console.log("Nothing was checked: no export in the ledger has clean rows for these properties.");
    return 1;
  }

  if (unresolved > 0) {
    console.log(
      `${unresolved} item(s) do not resolve. Create them in QuickBooks (or save a manual mapping), then run this again.`,
    );
    console.log("Until they resolve, those bills stop at needs_mapping and nothing is posted.");
    return 1;
  }

  console.log("Everything resolves. A dry run should produce a complete payload for every bill.");
  return 0;
};

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error("Preflight failed:", err);
    process.exit(2);
  });
