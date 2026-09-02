/** Does the partial-hold rule change any export already processed? Read-only. */
import path from "node:path";
import dotenv from "dotenv";
dotenv.config({ path: path.join(process.cwd(), ".env.local") });

const main = async () => {
  const { firestore, storage } = await import("../src/server/firebaseAdmin");
  const { reviewInvoiceCsv } = await import("../src/lib/accounting/faciliqInvoiceImport/reviewInvoices");
  const snap = await firestore!.collection("faciliqInvoiceExports").get();
  let changed = 0;
  for (const doc of snap.docs) {
    const r = doc.data();
    if (r.status !== "parsed" || !r.storagePath || !r.totals) continue;
    const [buf] = await storage!.file(r.storagePath).download();
    const report = reviewInvoiceCsv(new TextDecoder("utf-8").decode(buf), {
      sourceFilename: r.attachmentName ?? "export.csv",
      asOfIso: r.asOfIso ?? new Date(r.receivedAt).toISOString().slice(0, 10),
    });
    if (!report.ok) continue;
    const before = r.totals;
    const now = report.totals;
    const same = before.readyRows === now.readyRows && Math.abs(before.readyAmount - now.readyAmount) < 0.005;
    if (!same) changed += 1;
    console.log(
      `${same ? "same " : "CHANGED"}  ${r.attachmentName}  ready ${before.readyRows}/$${before.readyAmount} -> ${now.readyRows}/$${now.readyAmount}`,
    );
  }
  console.log(`\nexports whose outcome changed: ${changed}`);
};
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
