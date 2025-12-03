import type { CloudRunState, CloudRunStatusRow, CloudStatusResponse } from "@/types/cloudStatus";
import type { DailyRunStatus } from "@/types/dailySummary";
import { listProperties } from "@/app/api/daily-summary/store";
import { listRunStatusesForDate } from "@/lib/dailySummaryRuns";

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

export async function getCloudStatus(targetDate?: string): Promise<CloudStatusResponse> {
  const asOfDate = targetDate ?? getCurrentMstDate();
  const properties = await listProperties();
  const runStatuses = await listRunStatusesForDate(asOfDate).catch(() => []);
  const statusMap = new Map<string, DailyRunStatus>();

  runStatuses.forEach((status) => {
    const key = (status.propertyCode ?? status.propertyId ?? "").toLowerCase();
    if (key) statusMap.set(key, status);
  });

  const rows: CloudRunStatusRow[] = properties.map((prop) => {
    const code = (prop.propertyCode ?? prop.id ?? prop.tenantPropertyId ?? "").toLowerCase();
    const statusDoc = statusMap.get(code);
    const rowStatus = normalizeStatus(statusDoc?.status);

    return {
      propertyId: prop.id,
      propertyName: prop.name,
      msrReceivedAt: statusDoc?.msrReceivedAt ?? null,
      lastRunStatus: rowStatus,
      lastRunAt: statusDoc?.lastRunAt ?? null,
      nextRunAt: statusDoc?.nextRunAt ?? null,
      errorMessage: statusDoc?.errorMessage ?? null,
    };
  });

  return {
    asOfDate,
    rows,
  };
}
