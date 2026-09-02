/** Read-only probe: why do P006 / L001 investor dashboards cap in late July? */
import path from "node:path";
import dotenv from "dotenv";
dotenv.config({ path: path.join(process.cwd(), ".env.local") });

const TARGETS = (process.argv[2] ?? "P006,L001").split(",").map((s) => s.trim()).filter(Boolean);

const iso = (v: unknown): string | null => {
  if (!v) return null;
  if (typeof v === "string") return v;
  if (v instanceof Date) return v.toISOString();
  const td = (v as { toDate?: () => Date }).toDate;
  if (typeof td === "function") return td.call(v).toISOString();
  return String(v);
};

const main = async () => {
  const { firestore } = await import("../src/server/firebaseAdmin");
  if (!firestore) throw new Error("firestore not configured");

  console.log("=== dailySummaryProperties");
  const props = await firestore.collection("dailySummaryProperties").get();
  const propRows = props.docs.map((d) => {
    const x = d.data();
    return { id: d.id, propertyId: x.propertyId, tenantPropertyId: x.tenantPropertyId, propertyCode: x.propertyCode, name: x.name };
  });
  console.table(propRows);

  for (const target of TARGETS) {
    console.log(`\n\n################ ${target}`);
    const cfg = propRows.find(
      (r) => [r.id, r.propertyId, r.tenantPropertyId, r.propertyCode].map((v) => String(v ?? "").toLowerCase()).includes(target.toLowerCase()),
    );
    console.log("config:", cfg);
    const aliases = Array.from(
      new Set([target, cfg?.id, cfg?.propertyId, cfg?.tenantPropertyId, cfg?.propertyCode].filter((v): v is string => Boolean(v))),
    );

    for (const alias of aliases) {
      const doc = await firestore.collection("property_historical").doc(alias).get();
      if (!doc.exists) {
        console.log(`property_historical/${alias}: (missing)`);
        continue;
      }
      const data = doc.data() ?? {};
      console.log(`\nproperty_historical/${alias}:`, {
        updated_at: iso(data.updated_at),
        msr_updated_at: iso(data.msr_updated_at),
        financials_updated_at: iso(data.financials_updated_at),
        latest_msr_doc_id: data.latest_msr_doc_id ?? null,
        latest_msr_report_date: data.latest_msr_report_date ?? null,
        latest_msr_storage_path: data.latest_msr_storage_path ?? null,
        latest_msr_synced_at: iso(data.latest_msr_synced_at),
        topLevelKeys: Object.keys(data).sort(),
      });
      const snaps = Array.isArray(data.snapshots) ? (data.snapshots as Record<string, unknown>[]) : [];
      console.table(
        snaps.map((s) => ({
          reportMonthIso: s.reportMonthIso,
          monthIso: s.monthIso,
          reportDate: s.reportDate,
          asOfDate: iso(s.asOfDate),
          hasOcc: Boolean((s.occupancy as Record<string, unknown> | undefined)?.rsfOccPct),
          hasFin: Boolean(s.financials),
          propertyName: s.propertyName,
        })),
      );
    }

    const code = String(cfg?.propertyCode ?? target).trim().toLowerCase();
    console.log(`\nmsrReports where propertyCode == "${code}" (no orderBy, client-sorted):`);
    try {
      const plain = await firestore.collection("msrReports").where("propertyCode", "==", code).get();
      const rows = plain.docs
        .map((d) => {
          const x = d.data();
          return {
            id: d.id,
            propertyCode: x.propertyCode,
            reportDate: x.reportDate,
            emailDate: x.emailDate,
            parseStatus: x.parseStatus,
            storagePath: x.storagePath ? "yes" : "NO",
          };
        })
        .sort((a, b) => String(b.reportDate ?? "").localeCompare(String(a.reportDate ?? "")));
      console.log(`count=${rows.length}`);
      console.table(rows.slice(0, 12));
    } catch (e) {
      console.log("plain query FAILED:", (e as Error).message);
    }

    console.log(`\nmsrReports where propertyCode == "${code}" orderBy reportDate desc limit 3 (the sync's query):`);
    try {
      const q = await firestore.collection("msrReports").where("propertyCode", "==", code).orderBy("reportDate", "desc").limit(3).get();
      console.table(q.docs.map((d) => ({ id: d.id, reportDate: d.data().reportDate, emailDate: d.data().emailDate, parseStatus: d.data().parseStatus })));
    } catch (e) {
      console.log("ORDERED QUERY FAILED:", (e as Error).message);
    }
  }

  console.log("\n\n=== msrReports: distinct propertyCode with max reportDate (emailDate >= 2026-07-01)");
  try {
    const recent = await firestore.collection("msrReports").where("emailDate", ">=", "2026-07-01").get();
    const agg = new Map<string, { n: number; maxReport: string; maxEmail: string; statuses: Set<string> }>();
    recent.docs.forEach((d) => {
      const x = d.data();
      const k = String(x.propertyCode ?? "(none)");
      const cur = agg.get(k) ?? { n: 0, maxReport: "", maxEmail: "", statuses: new Set<string>() };
      cur.n += 1;
      cur.maxReport = String(x.reportDate ?? "") > cur.maxReport ? String(x.reportDate ?? "") : cur.maxReport;
      cur.maxEmail = String(x.emailDate ?? "") > cur.maxEmail ? String(x.emailDate ?? "") : cur.maxEmail;
      cur.statuses.add(String(x.parseStatus ?? ""));
      agg.set(k, cur);
    });
    console.table(Array.from(agg.entries()).map(([propertyCode, v]) => ({ propertyCode, n: v.n, maxReport: v.maxReport, maxEmail: v.maxEmail, statuses: Array.from(v.statuses).join(",") })));
    console.log(`total recent docs: ${recent.size}`);
  } catch (e) {
    console.log("recent query FAILED:", (e as Error).message);
  }

  console.log("\n=== dashboard_share_links created today");
  try {
    const links = await firestore.collection("dashboard_share_links").orderBy("created_at", "desc").limit(6).get();
    console.table(
      links.docs.map((d) => {
        const x = d.data();
        return { id: d.id, property_id: x.property_id, snapshot_date_iso: x.snapshot_date_iso, snapshot_month_iso: x.snapshot_month_iso, created_at: iso(x.created_at), expires_at: iso(x.expires_at) };
      }),
    );
  } catch (e) {
    console.log("share links query FAILED:", (e as Error).message);
  }
};

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
