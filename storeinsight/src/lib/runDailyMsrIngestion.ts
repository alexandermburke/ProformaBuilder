import admin from "firebase-admin";
import { firestore } from "@/server/firebaseAdmin";
import { listProperties } from "@/app/api/daily-summary/store";
import type { PropertyConfig } from "@/types/dailySummary";
import { ingestMsrEmails } from "./ingestMsrEmails";
import { ingestManagementSummariesFromViewer, type IngestedMsr } from "./ingestManagementSummary";

export type DailyIngestionSummary = {
  emailsProcessed: number;
  propertiesIngested: number;
  emailsWithErrors: string[];
  reportsIngested: Array<{ propertyCode: string; reportDate: string }>;
};

type IngestionOptions = {
  senderEmail: string;
  subjectPhrase: string;
  maxMessages?: number;
  userId?: string;
  maxEmailsToProcess?: number;
};

export async function runDailyMsrIngestion(options: IngestionOptions): Promise<DailyIngestionSummary> {
  if (!firestore) {
    throw new Error("Firebase is not initialized (firestore missing). Check environment variables.");
  }

  // Step 1: pull latest emails into msrEmails collection
  await ingestMsrEmails(options);

  // Step 2: find unprocessed emails
  const limit = options.maxEmailsToProcess && options.maxEmailsToProcess > 0 ? options.maxEmailsToProcess : 1;
  const pendingSnap = await firestore
    .collection("msrEmails")
    .where("processed", "==", false)
    .orderBy("receivedAt", "desc")
    .limit(limit)
    .get();

  const emailsWithErrors: string[] = [];
  const reportsIngested: Array<{ propertyCode: string; reportDate: string }> = [];
  const properties = new Set<string>();
  let emailsProcessed = 0;

  let propertyConfigs: PropertyConfig[] = [];
  try {
    propertyConfigs = await listProperties();
  } catch (err) {
    console.warn("[msr-daily] unable to load property configs (non-fatal)", err);
  }

  for (const doc of pendingSnap.docs) {
    const data = doc.data() as {
      messageId?: string;
      subject?: string;
      viewerUrl?: string;
    };
    const messageId = data.messageId ?? doc.id;
    const viewerUrl = data.viewerUrl;
    if (!viewerUrl) {
      console.warn("[msr-daily] skipping email missing viewerUrl", { id: messageId });
      emailsWithErrors.push(messageId);
      continue;
    }

    try {
      const ingested: IngestedMsr[] = await ingestManagementSummariesFromViewer(viewerUrl, {
        propertyConfigs,
      });
      if (!ingested.length) {
        throw new Error("No XLSX URLs discovered from viewer page");
      }

      for (const item of ingested) {
        const propertyCode = item.propertyCode.toLowerCase();
        properties.add(propertyCode);
        reportsIngested.push({ propertyCode, reportDate: item.reportDate });
      }

      await doc.ref.update({
        processed: true,
        processedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      emailsProcessed += 1;
    } catch (err) {
      console.error("[msr-daily] ingestion failed", { messageId, subject: data.subject, viewerUrl }, err);
      emailsWithErrors.push(messageId);
    }
  }

  return {
    emailsProcessed,
    propertiesIngested: properties.size,
    emailsWithErrors,
    reportsIngested,
  };
}
