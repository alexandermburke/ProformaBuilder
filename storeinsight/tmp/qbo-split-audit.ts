/** Read-only: has any invoice ever been split across ready and review in one property? */
import path from "node:path";
import dotenv from "dotenv";
dotenv.config({ path: path.join(process.cwd(), ".env.local") });

const main = async () => {
  const { firestore, storage } = await import("../src/server/firebaseAdmin");
  const { reviewInvoiceCsv } = await import("../src/lib/accounting/faciliqInvoiceImport/reviewInvoices");
  const snap = await firestore!.collection("faciliqInvoiceExports").get();
  let checked = 0;
  let splits = 0;

  for (const doc of snap.docs) {
    const r = doc.data();
    if (r.status !== "parsed" || !r.storagePath) continue;
    const [buf] = await storage!.file(r.storagePath).download();
    const report = reviewInvoiceCsv(new TextDecoder("utf-8").decode(buf), {
      sourceFilename: r.attachmentName ?? "export.csv",
      asOfIso: r.asOfIso ?? new Date(r.receivedAt).toISOString().slice(0, 10),
    });
    if (!report.ok) continue;
    checked += 1;

    for (const b of report.properties) {
      const norm = (v: string) => v.trim().toUpperCase().replace(/\s+/g, " ");
      const ready = new Map<string, number>();
      for (const row of b.readyRows) {
        ready.set(norm(row.fields.invoiceNumber), (ready.get(norm(row.fields.invoiceNumber)) ?? 0) + (row.amount ?? 0));
      }
      for (const row of b.reviewRows) {
        const key = norm(row.fields.invoiceNumber);
        if (!ready.has(key)) continue;
        splits += 1;
        console.log(
          `!! SPLIT  ${r.attachmentName}  ${b.code}  inv=${key}  posted=$${ready.get(key)}  withheld=$${row.amount}  reason=${row.flags.map((f: { code: string }) => f.code).join(",")}`,
        );
      }
    }
  }
  console.log(`\nexports checked: ${checked}`);
  console.log(`split invoices found: ${splits}`);
};
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
