export type CloudRunState =
  | "healthy"
  | "pending"
  | "failed"
  | "awaiting_msr"
  | "HEALTHY"
  | "PENDING"
  | "FAILED"
  | "AWAITING_MSR";

export interface CloudRunStatusRow {
  propertyId: string;
  propertyName: string;
  msrReceivedAt: string | null; // ISO string or null
  lastRunStatus: CloudRunState;
  lastRunAt: string | null;
  nextRunAt: string | null;
  errorMessage?: string | null;
}

export interface CloudStatusResponse {
  asOfDate: string; // YYYY-MM-DD in MST
  rows: CloudRunStatusRow[];
}
