import admin from "firebase-admin";
import type { DailyRunStatus } from "@/types/dailySummary";
import { firestore } from "@/server/firebaseAdmin";

export type RunStatusState = "HEALTHY" | "PENDING" | "FAILED" | "AWAITING_MSR";

type Timestamp = FirebaseFirestore.Timestamp;

const RUN_COLLECTION = "dailySummaryRuns";
const fallbackRuns: Record<string, DailyRunStatus> = {};

const normalizeCode = (value: string): string => (value ?? "").toString().trim().toLowerCase();

const formatTimestamp = (value?: Timestamp | null): string | null => {
  if (!value) return null;
  return value.toDate().toISOString();
};

const runDocRef = (reportDate: string, propertyCode: string) =>
  firestore!.collection(RUN_COLLECTION).doc(reportDate).collection("properties").doc(propertyCode);

const computeNextRunAt = (reportDate: string, sendTimeMst?: string): Date | null => {
  if (!reportDate || !sendTimeMst) return null;
  const [hourStr, minuteStr] = sendTimeMst.split(":");
  const hour = Number(hourStr);
  const minute = Number(minuteStr);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  const iso = `${reportDate}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00-07:00`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
};

const setFallbackRun = (key: string, payload: DailyRunStatus) => {
  fallbackRuns[key] = payload;
};

export async function recordMsrReceipt(params: {
  propertyCode: string;
  reportDate: string;
  msrPath?: string;
  propertyName?: string;
  propertyId?: string;
  sendTimeMst?: string;
}): Promise<void> {
  const propertyCode = normalizeCode(params.propertyCode);
  const key = `${params.reportDate}|${propertyCode}`;
  const nextRunAt = computeNextRunAt(params.reportDate, params.sendTimeMst);
  if (!firestore) {
    setFallbackRun(key, {
      propertyCode,
      propertyId: params.propertyId ?? params.propertyCode,
      propertyName: params.propertyName,
      reportDate: params.reportDate,
      msrReceived: true,
      msrReceivedAt: new Date().toISOString(),
      lastRunAt: null,
      nextRunAt: nextRunAt ? nextRunAt.toISOString() : null,
      status: "PENDING",
      errorMessage: null,
      msrPath: params.msrPath ?? null,
      flashPath: null,
    });
    return;
  }

  const docRef = runDocRef(params.reportDate, propertyCode);
  const nextRunTs = nextRunAt ? admin.firestore.Timestamp.fromDate(nextRunAt) : null;
  await docRef.set(
    {
      propertyCode,
      propertyId: params.propertyId ?? params.propertyCode,
      propertyName: params.propertyName ?? null,
      reportDate: params.reportDate,
      msrPath: params.msrPath ?? null,
      msrReceived: true,
      msrReceivedAt: admin.firestore.FieldValue.serverTimestamp(),
      nextRunAt: nextRunTs ?? admin.firestore.FieldValue.delete(),
      status: "PENDING",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}

export async function recordFlashRunResult(params: {
  propertyCode: string;
  reportDate: string;
  status: RunStatusState;
  flashPath?: string | null;
  errorMessage?: string | null;
  msrPath?: string | null;
  propertyName?: string;
  propertyId?: string;
  sendTimeMst?: string;
}): Promise<void> {
  const propertyCode = normalizeCode(params.propertyCode);
  const key = `${params.reportDate}|${propertyCode}`;
  const nextRunAt = computeNextRunAt(params.reportDate, params.sendTimeMst);
  if (!firestore) {
    setFallbackRun(key, {
      propertyCode,
      propertyId: params.propertyId ?? params.propertyCode,
      propertyName: params.propertyName,
      reportDate: params.reportDate,
      msrReceivedAt: params.msrPath ? new Date().toISOString() : fallbackRuns[key]?.msrReceivedAt ?? null,
      lastRunAt: new Date().toISOString(),
      nextRunAt: nextRunAt ? nextRunAt.toISOString() : null,
      status: params.status,
      errorMessage: params.errorMessage ?? null,
      msrPath: params.msrPath ?? fallbackRuns[key]?.msrPath ?? null,
      msrReceived: params.msrPath ? true : fallbackRuns[key]?.msrReceived ?? false,
      flashPath: params.flashPath ?? null,
    });
    return;
  }

  const docRef = runDocRef(params.reportDate, propertyCode);
  const nextRunTs = nextRunAt ? admin.firestore.Timestamp.fromDate(nextRunAt) : null;
  const errorValue =
    params.errorMessage !== undefined
      ? params.errorMessage
      : params.status === "FAILED"
        ? null
        : admin.firestore.FieldValue.delete();
  const payload: Record<string, unknown> = {
    propertyCode,
    propertyId: params.propertyId ?? params.propertyCode,
    propertyName: params.propertyName ?? null,
    reportDate: params.reportDate,
    status: params.status,
    lastRunAt: admin.firestore.FieldValue.serverTimestamp(),
    nextRunAt: nextRunTs ?? admin.firestore.FieldValue.delete(),
    errorMessage: errorValue,
    flashPath: params.flashPath ?? null,
    msrPath: params.msrPath ?? null,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  if (params.msrPath) {
    payload.msrReceived = true;
    payload.msrReceivedAt = admin.firestore.FieldValue.serverTimestamp();
  }
  await docRef.set(payload, { merge: true });
}

export async function listRunStatusesForDate(reportDate: string): Promise<DailyRunStatus[]> {
  if (!firestore) {
    return Object.values(fallbackRuns).filter((item) => item.reportDate === reportDate);
  }
  const snapshot = await firestore.collection(RUN_COLLECTION).doc(reportDate).collection("properties").get();
  return snapshot.docs.map((doc) => {
    const data = doc.data() as {
      propertyId?: string;
      propertyName?: string;
      msrReceived?: boolean | null;
      msrReceivedAt?: Timestamp | null;
      lastRunAt?: Timestamp | null;
      nextRunAt?: Timestamp | null;
      status?: RunStatusState;
      errorMessage?: string | null;
      msrPath?: string | null;
      flashPath?: string | null;
    };
    return {
      propertyCode: doc.id,
      propertyId: data.propertyId ?? doc.id,
      propertyName: data.propertyName ?? undefined,
      reportDate,
      msrReceived: data.msrReceived ?? null,
      msrReceivedAt: formatTimestamp(data.msrReceivedAt),
      lastRunAt: formatTimestamp(data.lastRunAt),
      nextRunAt: formatTimestamp(data.nextRunAt),
      status: data.status ?? "AWAITING_MSR",
      errorMessage: data.errorMessage ?? null,
      msrPath: data.msrPath ?? null,
      flashPath: data.flashPath ?? null,
    } satisfies DailyRunStatus;
  });
}
