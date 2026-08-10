/**
 * Check the weekly FacilIQ QuickBooks invoice export and split it by property.
 *
 * Reads every invoice row, verifies the six required fields (invoice number, vendor,
 * amount, invoice date, property, GL code) plus the cross-row checks, writes one import
 * file per QuickBooks company (L001, P006, W002, W003), and writes everything flagged to
 * a single review file instead of importing it.
 *
 * Same library the /accounting/faciliq-invoice-import page uses, so the CLI and the page
 * can never disagree about what is clean.
 *
 * Usage:
 *   npx tsx scripts/checkFaciliqInvoices.ts <file.csv> [options]
 *   npm run invoices:check -- <file.csv> [options]
 *
 * Options:
 *   --out <dir>        where to write the split files (default: ./faciliq-split)
 *   --as-of <date>     yyyy-mm-dd treated as today for the future-date check
 *   --dry-run          report only, write nothing
 *
 * Exit codes: 0 = every row clean, 1 = something needs review, 2 = file unusable.
 */
import fs from "node:fs";
import path from "node:path";
import { buildOutputFiles } from "../src/lib/accounting/faciliqInvoiceImport/buildSplitFiles";
import {
  collectFlaggedRows,
  reviewInvoiceCsv,
  type FaciliqInvoiceReport,
} from "../src/lib/accounting/faciliqInvoiceImport/reviewInvoices";
import { formatIsoDateForDisplay } from "../src/lib/accounting/faciliqInvoiceImport/values";

type Options = {
  input: string;
  outDir: string;
  asOfIso: string;
  dryRun: boolean;
};

const usage = (): never => {
  console.error("Usage: npx tsx scripts/checkFaciliqInvoices.ts <file.csv> [--out <dir>] [--as-of yyyy-mm-dd] [--dry-run]");
  process.exit(2);
};

function parseArgs(argv: string[]): Options {
  let input = "";
  let outDir = "";
  let asOfIso = new Date().toISOString().slice(0, 10);
  let dryRun = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--out") {
      outDir = argv[i + 1] ?? "";
      i += 1;
    } else if (arg === "--as-of") {
      asOfIso = argv[i + 1] ?? asOfIso;
      i += 1;
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg.startsWith("--")) {
      console.error(`Unknown option: ${arg}`);
      usage();
    } else if (!input) {
      input = arg;
    } else {
      console.error(`Unexpected argument: ${arg}`);
      usage();
    }
  }

  if (!input) usage();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOfIso)) {
    console.error(`--as-of must be yyyy-mm-dd, got "${asOfIso}"`);
    process.exit(2);
  }

  return {
    input: path.resolve(input),
    outDir: path.resolve(outDir || "faciliq-split"),
    asOfIso,
    dryRun,
  };
}

const money = (value: number): string =>
  value.toLocaleString("en-US", { style: "currency", currency: "USD" });

const heading = (text: string): void => {
  console.log("");
  console.log(text);
  console.log("-".repeat(text.length));
};

function printReport(report: FaciliqInvoiceReport): void {
  heading(`FacilIQ invoice check - ${path.basename(report.sourceFilename)}`);

  if (report.window) {
    console.log(
      `Export window   ${formatIsoDateForDisplay(report.window.startIso)} to ${formatIsoDateForDisplay(report.window.endIso)} (from the filename)`,
    );
  }
  console.log(`Checked as of   ${formatIsoDateForDisplay(report.asOfIso)}`);

  if (!report.ok) {
    console.log("");
    console.log(`STOPPED: ${report.headerError}`);
    console.log(`Header read: ${report.header.join(" | ")}`);
    return;
  }

  heading("Column mapping");
  for (const binding of report.columns.filter((column) => column.required)) {
    console.log(`  ${binding.label.padEnd(16)} <- "${binding.header}" (column ${binding.index + 1})`);
  }

  const { totals } = report;
  heading("Totals");
  console.log(`  Invoice rows read     ${totals.dataRows}  ${money(totals.sourceAmount)}`);
  console.log(`  Ready to import       ${totals.readyRows}  ${money(totals.readyAmount)}`);
  console.log(`  Needs review          ${totals.reviewRows}  ${money(totals.reviewAmount)}`);
  console.log(`  Unresolved property   ${totals.unresolvedRows}  ${money(totals.unresolvedAmount)}`);
  console.log(`  Reconciles to source  ${totals.reconciles ? "yes" : "NO - investigate"}`);

  heading("By property");
  for (const bucket of report.properties) {
    console.log(
      `  ${bucket.code}  ${bucket.name.padEnd(20)} ready ${String(bucket.readyRows.length).padStart(4)}  ${money(bucket.readyAmount).padStart(12)}   review ${String(bucket.reviewRows.length).padStart(4)}`,
    );
  }

  if (report.flagSummary.length > 0) {
    heading("Flags");
    for (const entry of report.flagSummary) {
      console.log(`  [${entry.severity.padEnd(7)}] ${entry.label} - ${entry.rows} row(s)`);
    }
  }

  const flagged = collectFlaggedRows(report);
  if (flagged.length > 0) {
    heading(`Rows held back (${flagged.length})`);
    for (const row of flagged) {
      const invoice = row.fields.invoiceNumber || "(no invoice number)";
      const property = row.propertyCode ?? "unresolved";
      console.log(
        `  row ${String(row.sourceLine).padStart(4)}  ${property.padEnd(10)} ${invoice.padEnd(18)} ${row.fields.vendor || "(no vendor)"}`,
      );
      for (const flag of row.flags) {
        console.log(`        - ${flag.label}: ${flag.detail}`);
      }
    }
  }

  if (report.notes.length > 0) {
    heading("Notes");
    for (const note of report.notes) console.log(`  - ${note}`);
  }
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));

  if (!fs.existsSync(options.input)) {
    console.error(`File not found: ${options.input}`);
    process.exit(2);
  }

  const text = fs.readFileSync(options.input, "utf8");
  const report = reviewInvoiceCsv(text, {
    sourceFilename: path.basename(options.input),
    asOfIso: options.asOfIso,
  });

  printReport(report);

  if (!report.ok) process.exit(2);

  const files = buildOutputFiles(report);
  if (options.dryRun) {
    heading("Files (dry run, nothing written)");
    for (const file of files) console.log(`  ${file.filename}  ${file.rowCount} row(s)`);
  } else if (files.length === 0) {
    heading("Files");
    console.log("  Nothing to write: no clean rows and nothing flagged.");
  } else {
    fs.mkdirSync(options.outDir, { recursive: true });
    heading(`Files written to ${options.outDir}`);
    for (const file of files) {
      fs.writeFileSync(path.join(options.outDir, file.filename), file.csv, "utf8");
      console.log(`  ${file.filename}  ${file.rowCount} row(s)  ${money(file.amount)}`);
    }
  }

  console.log("");
  if (report.totals.flaggedRows > 0) {
    console.log(
      `${report.totals.flaggedRows} row(s) need review before import. Nothing was imported automatically.`,
    );
    process.exit(1);
  }
  console.log("Every row passed. The per-property files are ready for QuickBooks.");
}

main();
