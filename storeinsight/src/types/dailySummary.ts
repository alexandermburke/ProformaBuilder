export type PropertyConfig = {
  id: string;
  propertyCode?: string;
  propertyId?: string;
  name: string;
  tenantPropertyId: string;
  timezone: "America/Phoenix";
  sendTimeLocal: string; // "HH:MM"
  sendTimeMst?: string; // "HH:MM" (alias for sendTimeLocal)
  ownerEmails: string[];
  enabled: boolean;
  facilityOpenDate?: string;
  propertyImageData?: string;
  imagePath?: string;
};

export type DailyRunStatus = {
  propertyCode: string;
  propertyId?: string;
  propertyName?: string;
  reportDate?: string;
  msrReceived?: boolean | null;
  msrReceivedAt?: string | null;
  lastRunAt?: string | null;
  nextRunAt?: string | null;
  status?: "HEALTHY" | "PENDING" | "FAILED" | "AWAITING_MSR" | "success" | "failed";
  lastRunStatus?: "success" | "failed";
  errorMessage?: string | null;
  flashPath?: string | null;
  msrPath?: string | null;
};
