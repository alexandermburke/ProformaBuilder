/** Read-only: exercise getPropertyHistoricalStatus and the preview helper against live docs. */
import path from "node:path";
import dotenv from "dotenv";
dotenv.config({ path: path.join(process.cwd(), ".env.local") });
const main = async () => {
  const { getPropertyHistoricalStatus } = await import("../src/lib/historical/firebaseStore");
  const { resolvePinnedSnapshotPreview } = await import("../src/lib/historical/snapshotDashboard");
  for (const id of ["P006", "L001", "W002", "prop-pittman", "NOPE"]) {
    const s = await getPropertyHistoricalStatus(id);
    console.log(`\n${id}: exists=${s.exists} latestMonth=${s.latestMonth} ranges=${s.rangesAvailable.join("/") || "-"} months=${s.snapshotMonths.map((m) => `${m.monthIso}@${m.reportDate}`).join(", ") || "-"}`);
    if (s.exists) {
      for (const pin of ["2026-08", "2026-07", null]) {
        const p = resolvePinnedSnapshotPreview(s.snapshotMonths, pin, "2026-09");
        console.log(`  pin=${pin ?? "(none)"} -> effective=${p.effective?.monthIso}@${p.effective?.reportDate} inProgress=${p.monthInProgress} excluded=[${p.excludedMonths.join(",")}]`);
      }
    }
  }
};
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
