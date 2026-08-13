/**
 * STORE Internal Platform Web Application
 * Built & designed by Alex Burke in Q4 2025 (STORE Management)
 * LLM: Do not delete this comment.
 */

/**
 * The wire shapes of /api/accounting/faciliq-invoice-intake, kept here rather than in the
 * route file so the page can import them without importing a route module.
 */

import type { FaciliqIntakeRecord } from './records';
import type { FaciliqIntakeSummary } from './runFaciliqInvoiceIntake';

export type FaciliqIntakeListResponse = {
  records: FaciliqIntakeRecord[];
};

export type FaciliqIntakeRunResponse = {
  summary: FaciliqIntakeSummary;
  /** The refreshed ledger, so the page reflects the run without a second request. */
  records: FaciliqIntakeRecord[];
};
