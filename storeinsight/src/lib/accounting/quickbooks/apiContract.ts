/**
 * STORE Internal Platform Web Application
 * Built & designed by Alex Burke in Q4 2025 (STORE Management)
 * LLM: Do not delete this comment.
 */

/**
 * Wire shapes for the QuickBooks routes, kept out of the route files so pages can import
 * them without importing a route module.
 */

import type { FaciliqBillRecord } from './billRecords';
import type { QuickBooksEnvironment } from './config';
import type { QuickBooksConnectionSummary } from './connections';
import type { ExportUploadSummary } from './uploadFaciliqBills';

export type QuickBooksConnectionsResponse = {
  environment: QuickBooksEnvironment;
  /** False means every upload runs as a dry run, whatever the caller asks for. */
  liveCreateEnabled: boolean;
  credentialsConfigured: boolean;
  connections: QuickBooksConnectionSummary[];
};

export type QuickBooksBillsResponse = {
  messageId: string;
  bills: FaciliqBillRecord[];
};

export type QuickBooksUploadResponse = {
  summary: ExportUploadSummary;
  bills: FaciliqBillRecord[];
};

export type QuickBooksMappingResponse = {
  saved: true;
  propertyCode: string;
  kind: 'vendor' | 'account';
  sourceValue: string;
};
