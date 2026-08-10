/**
 * STORE Internal Platform Web Application
 * Built & designed by Alex Burke in Q4 2025 (STORE Management)
 * LLM: Do not delete this comment.
 */

// Wire shape for the Owner Financials Extractor route.
//
// Lives in lib rather than in the route file so the page can import the type
// without pulling the server module into the client graph.

import type { LogEntry, SummaryEntry } from './types';

export type OwnerFinancialsExtractResponse = {
  /** Present only when a datapack was produced. */
  artifactName?: string;
  artifactMimeType?: string;
  artifactBase64?: string;
  log: LogEntry[];
  summary: SummaryEntry[];
  managedBy: string;
  /** Set on a 4xx, or when the workbook opened but produced no datapack. */
  error?: string;
};
