/** Read-only: replay the token page's pin filter against the live property_historical doc. */
import path from "node:path";
import dotenv from "dotenv";
dotenv.config({ path: path.join(process.cwd(), ".env.local") });

const main = async () => {
  const { firestore } = await import("../src/server/firebaseAdmin");
  const { filterSnapshotsByPinnedMonth } = await import("../src/lib/historical/snapshotDashboardServer");
  const { normalizeHistoricalSnapshots, getSnapshotArray } = await import("../src/lib/historical/snapshotDashboard");
  if (!firestore) throw new Error("no firestore");

  for (const propertyId of ["P006", "L001"]) {
    const doc = await firestore.collection("property_historical").doc(propertyId).get();
    const snapshots = normalizeHistoricalSnapshots(getSnapshotArray((doc.data() ?? {}) as Record<string, unknown>));
    console.log(`\n### ${propertyId}: stored months -> ${snapshots.map((s) => `${s.monthIso}@${s.reportDate}`).join(", ")}`);
    for (const pin of ["2026-08-01", "2026-08-07", "2026-08-15", "2026-08-30", "2026-08-31", "2026-09-01", null]) {
      const visible = filterSnapshotsByPinnedMonth(snapshots, pin ? pin.slice(0, 7) : null, pin);
      const latest = visible[visible.length - 1];
      console.log(`pin=${pin ?? "(none)"} -> visible=${visible.length}, latest month=${latest?.monthIso} reportDate=${latest?.reportDate}`);
    }
  }
};
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
