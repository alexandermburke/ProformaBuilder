export type PropertyConfig = {
  id: string;
  name: string;
  tenantPropertyId: string;
  timezone: "America/Phoenix";
  sendTimeLocal: string; // "HH:MM"
  ownerEmails: string[];
  enabled: boolean;
};

export type DailyRunStatus = {
  propertyId: string;
  lastRunAt?: string;
  lastRunStatus?: "success" | "failed";
};
