export type PropertyConfig = {
  id: string;
  propertyCode: string; // slug used for ingestion + filenames (e.g. "storeatthegrove")
  propertyId: string; // human-readable ID (e.g. "L001" / "W002")
  name: string;
  tenantPropertyId: string;
  timezone: "America/Phoenix";
  sendTimeLocal: string; // "HH:MM"
  sendTimeMst?: string; // "HH:MM" (alias for sendTimeLocal)
  ownerEmails: string[];
  enabled: boolean;
  facilityOpenDate?: string;
  momPlaceholderMonths?: string[];
  momPlaceholderGrossAccruedRent?: number[];
  momPlaceholderOccupiedPct?: number[];
  storeManagedMarkerMonth?: string; // YYYY-MM applied to MoM charts
  storeManagedMarkerText?: string; // marker label (defaults to "STORE Managed")
  heroImageUrl?: string; // Firebase Storage URL/path
  heroImagePath?: string; // Storage object path
  heroImageUpdatedAt?: string | null;
  // legacy fields kept for backward compatibility
  propertyImageData?: string;
  imagePath?: string;
  heroImageRemove?: boolean;
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
  pdfPath?: string | null;
  slidePngPaths?: string[] | null;
};
