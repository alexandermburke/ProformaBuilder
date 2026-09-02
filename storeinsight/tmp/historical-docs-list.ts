import path from "node:path";
import dotenv from "dotenv";
dotenv.config({ path: path.join(process.cwd(), ".env.local") });
const main = async () => {
  const { firestore } = await import("../src/server/firebaseAdmin");
  if (!firestore) throw new Error("no firestore");
  const all = await firestore.collection("property_historical").get();
  for (const d of all.docs) {
    const x = d.data();
    const snaps = Array.isArray(x.snapshots) ? (x.snapshots as Record<string, unknown>[]) : [];
    console.log(d.id, "->", snaps.map((s) => `${s.reportMonthIso ?? s.monthIso}@${s.reportDate ?? "?"}`).join(", ") || "(no snapshots)");
  }
};
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
