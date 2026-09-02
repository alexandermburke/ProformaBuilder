/** Read-only: print an archived FacilIQ export so a split invoice can be spotted. */
import path from "node:path";
import dotenv from "dotenv";
dotenv.config({ path: path.join(process.cwd(), ".env.local") });

const main = async () => {
  const needle = process.argv[2] ?? "2026-08-03";
  const { firestore, storage } = await import("../src/server/firebaseAdmin");
  const snap = await firestore!.collection("faciliqInvoiceExports").get();
  for (const doc of snap.docs) {
    const r = doc.data();
    if (r.status !== "parsed" || !r.storagePath || !String(r.attachmentName ?? "").includes(needle)) continue;
    console.log(`\n=== ${r.attachmentName}  (${r.periodStartIso} .. ${r.periodEndIso})`);
    const [buf] = await storage!.file(r.storagePath).download();
    const text = new TextDecoder("utf-8").decode(buf);
    const { reviewInvoiceCsv } = await import("../src/lib/accounting/faciliqInvoiceImport/reviewInvoices");
    const report = reviewInvoiceCsv(text, {
      sourceFilename: r.attachmentName, asOfIso: r.asOfIso ?? "2026-08-13",
    });
    if (!report.ok) { console.log("  unreadable"); continue; }
    for (const b of report.properties) {
      for (const row of [...b.readyRows, ...b.reviewRows]) {
        console.log(
          `  ${b.code}  ${row.status.toUpperCase().padEnd(6)} inv=${row.fields.invoiceNumber.padEnd(10)} $${String(row.amount).padEnd(9)} vendor=${row.fields.vendor.slice(0, 28).padEnd(28)} flags=${row.flags.map((f: { code: string }) => f.code).join(",") || "-"}`,
        );
      }
    }
  }
};
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
