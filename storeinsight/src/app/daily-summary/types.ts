export type FlashStatus = 'success' | 'pending' | 'failed' | 'no_msr';

export interface FlashCloudStatus {
  propertyId: string;
  propertyName: string;
  lastMsrReceivedAt?: string; // ISO string
  lastRunAt?: string; // ISO string
  nextRunAt?: string; // ISO string
  status: FlashStatus;
  errorMessage?: string;
}
