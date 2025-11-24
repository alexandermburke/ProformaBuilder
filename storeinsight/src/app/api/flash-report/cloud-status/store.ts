import type { CloudRunState, CloudRunStatusRow, CloudStatusResponse } from "@/types/cloudStatus";
import { firestore as adminDb } from "@/server/firebaseAdmin";

type Timestamp = FirebaseFirestore.Timestamp;

type FlashRunPropertyDoc = {
  propertyId: string;
  msrReceivedAt?: Timestamp | null;
  lastRunStatus?: CloudRunState | null;
  lastRunAt?: Timestamp | null;
  nextRunAt?: Timestamp | null;
  errorMessage?: string | null;
};

export type DailyFlashProperty = {
  id: string;
  name: string;
  sendTimeMst: string;
  enabled: boolean;
};

const FLASH_PROPS_COLLECTION = "flashProperties";
const FLASH_RUNS_COLLECTION = "flashRuns";

const fallbackProperties: DailyFlashProperty[] = [
  {
    id: "demo-001",
    name: "Demo Property",
    sendTimeMst: "09:00",
    enabled: true,
  },
];

const useFallback = !adminDb;

const mstFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Phoenix",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const formatIso = (timestamp?: Timestamp | null): string | null => {
  if (!timestamp) return null;
  return timestamp.toDate().toISOString();
};

export function getCurrentMstDate(): string {
  return mstFormatter.format(new Date());
}

export async function listFlashProperties(): Promise<DailyFlashProperty[]> {
  if (useFallback) return fallbackProperties;
  const snapshot = await adminDb!.collection(FLASH_PROPS_COLLECTION).get();
  return snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      name: data.name ?? "Untitled property",
      sendTimeMst: data.sendTimeMst ?? "09:00",
      enabled: Boolean(data.enabled),
    } satisfies DailyFlashProperty;
  });
}

export async function getCloudStatus(): Promise<CloudStatusResponse> {
  const asOfDate = getCurrentMstDate();
  const properties = await listFlashProperties();

  const rows: CloudRunStatusRow[] = [];
  const runEntries: Map<string, FlashRunPropertyDoc> = new Map();

  if (!useFallback) {
    const propsSnapshot = await adminDb!
      .collection(FLASH_RUNS_COLLECTION)
      .doc(asOfDate)
      .collection("properties")
      .get();
    propsSnapshot.docs.forEach((doc) => {
      runEntries.set(doc.id, doc.data() as FlashRunPropertyDoc);
    });
  }

  properties.forEach((prop) => {
    const entry = runEntries.get(prop.id);
    const lastRunStatus: CloudRunState = entry?.lastRunStatus ?? "awaiting_msr";
    rows.push({
      propertyId: prop.id,
      propertyName: prop.name,
      msrReceivedAt: formatIso(entry?.msrReceivedAt ?? null),
      lastRunStatus,
      lastRunAt: formatIso(entry?.lastRunAt ?? null),
      nextRunAt: formatIso(entry?.nextRunAt ?? null),
      errorMessage: entry?.errorMessage ?? null,
    });
  });

  return {
    asOfDate,
    rows,
  };
}
