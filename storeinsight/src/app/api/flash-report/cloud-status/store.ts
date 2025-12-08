import type { CloudRunState, CloudRunStatusRow, CloudStatusResponse } from "@/types/cloudStatus";
import type { DailyRunStatus } from "@/types/dailySummary";
import { listProperties } from "@/app/api/daily-summary/store";
import { listRunStatusesForDate } from "@/lib/dailySummaryRuns";
import { storage } from "@/server/firebaseAdmin";

const mstFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Phoenix",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function getCurrentMstDate(): string {
  return mstFormatter.format(new Date());
}

const normalizeStatus = (status?: string | null): CloudRunState => {
  const normalized = (status ?? "").toString().toLowerCase();
  if (normalized === "healthy") return "healthy";
  if (normalized === "pending") return "pending";
  if (normalized === "failed") return "failed";
  return "awaiting_msr";
};

const matchByCode = (filename: string, propertyCode: string): boolean => {
  const name = filename.toLowerCase();
  const code = propertyCode.toLowerCase();
  return name.includes(code);
};

type FileInfo = { name: string; updated?: string };

async function getFileInfos(prefix: string): Promise<FileInfo[]> {
  if (!storage) return [];
  try {
    const [files] = await storage.getFiles({ prefix });
    const withMeta = await Promise.all(
      files.map(async (file) => {
        if (!file.metadata || !file.metadata.updated) {
          try {
            const [meta] = await file.getMetadata();
            return { name: file.name, updated: meta.updated };
          } catch {
            return { name: file.name, updated: undefined };
          }
        }
        return { name: file.name, updated: file.metadata.updated };
      }),
    );
    return withMeta;
  } catch (err) {
    console.warn("[cloud-status] unable to list storage files", { prefix }, err);
    return [];
  }
}

const computeNextRunAt = (reportDate: string, sendTimeMst?: string | null): string | null => {
  if (!reportDate || !sendTimeMst) return null;
  const [hourStr, minuteStr] = sendTimeMst.split(":");
  const hour = Number(hourStr);
  const minute = Number(minuteStr);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  // Build ISO in MST offset (-07:00; ignoring DST nuance for simplicity)
  const iso = `${reportDate}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00-07:00`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

export async function getCloudStatus(targetDate?: string): Promise<CloudStatusResponse> {
  const asOfDate = targetDate ?? getCurrentMstDate();
  const properties = await listProperties();
  const runStatuses = await listRunStatusesForDate(asOfDate).catch(() => []);
  const statusMap = new Map<string, DailyRunStatus>();

  runStatuses.forEach((status) => {
    const key = (status.propertyCode ?? status.propertyId ?? "").toLowerCase();
    if (key) statusMap.set(key, status);
  });

  // Always pull storage signals so we can show timestamps even if run status docs are missing
  const msrFiles = await getFileInfos(`msr_raw/${asOfDate}/`);
  const flashList = await getFileInfos(`flash_reports/${asOfDate}/`);
  const flashFiles = flashList.filter((f) => f.name.toLowerCase().endsWith(".pptx"));
  const pdfFiles = flashList.filter((f) => f.name.toLowerCase().endsWith(".pdf"));
  const pngFiles = flashList.filter((f) => f.name.toLowerCase().endsWith(".png"));

  const latestUpdated = (list: FileInfo[]) =>
    list
      .map((f) => f.updated)
      .filter(Boolean)
      .map((u) => new Date(u!))
      .filter((d) => !Number.isNaN(d.getTime()))
      .sort((a, b) => b.getTime() - a.getTime())[0];

  const rows: CloudRunStatusRow[] = properties.map((prop) => {
    const code = (prop.propertyCode ?? prop.id ?? prop.tenantPropertyId ?? "").toLowerCase();
    const statusDoc = statusMap.get(code);

    let rowStatus: CloudRunState;
    let msrReceivedAt: string | null = statusDoc?.msrReceivedAt ?? null;
    let lastRunAt: string | null = statusDoc?.lastRunAt ?? null;
    let nextRunAt: string | null = statusDoc?.nextRunAt ?? null;
    const errorMessage: string | null = statusDoc?.errorMessage ?? null;

    const msrHit = msrFiles.filter((file) => matchByCode(file.name, code));
    const pdfHit = pdfFiles.filter((file) => matchByCode(file.name, code));
    const pngHit = pngFiles.filter((file) => matchByCode(file.name, code));
    const pptxHit = flashFiles.filter((file) => matchByCode(file.name, code));

    const msrDate = msrHit.length > 0 ? latestUpdated(msrHit) : undefined;
    const pdfDate = pdfHit.length > 0 ? latestUpdated(pdfHit) : undefined;
    const pngDate = pngHit.length > 0 ? latestUpdated(pngHit) : undefined;
    const pptxDate = pptxHit.length > 0 ? latestUpdated(pptxHit) : undefined;

    // Prefer recorded status, but backfill timestamps from storage where missing
    if (statusDoc) {
      rowStatus = normalizeStatus(statusDoc.status);
      if (!msrReceivedAt && msrDate) msrReceivedAt = msrDate.toISOString();
      if (!lastRunAt) {
        const latest = [pdfDate, pngDate, pptxDate].filter((d): d is Date => Boolean(d)).sort((a, b) => b.getTime() - a.getTime())[0];
        lastRunAt = latest ? latest.toISOString() : null;
      }
    } else {
      if (pdfHit.length > 0 || (pptxHit.length > 0 && pngHit.length > 0)) {
        rowStatus = "healthy";
        msrReceivedAt = msrReceivedAt ?? (msrDate ? msrDate.toISOString() : null);
        const latest = [pdfDate, pptxDate, pngDate].filter((d): d is Date => Boolean(d)).sort((a, b) => b.getTime() - a.getTime())[0];
        lastRunAt = latest ? latest.toISOString() : null;
      } else if (msrHit.length > 0) {
        rowStatus = "pending";
        msrReceivedAt = msrReceivedAt ?? (msrDate ? msrDate.toISOString() : null);
      } else {
        rowStatus = "awaiting_msr";
      }
    }

    if (!nextRunAt) {
      nextRunAt = computeNextRunAt(asOfDate, prop.sendTimeMst ?? prop.sendTimeLocal);
    }

    return {
      propertyId: prop.propertyId ?? prop.tenantPropertyId ?? prop.id,
      propertyName: prop.name,
      msrReceivedAt,
      lastRunStatus: rowStatus,
      lastRunAt,
      nextRunAt,
      errorMessage,
    };
  });

  return {
    asOfDate,
    rows,
  };
}
