import admin from "firebase-admin";
import { firestore, storage } from "@/server/firebaseAdmin";
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
  processingDate?: Date;
  allowedSenders?: string[];
};

const mstDateString = (date: Date): string => {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Phoenix",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(date).reduce<Record<string, string>>((acc, part) => {
    if (part.type === "year" || part.type === "month" || part.type === "day") {
      acc[part.type] = part.value;
    }
    return acc;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
};

const addDays = (date: Date, days: number): Date => {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
};

export async function runDailyMsrIngestion(options: IngestionOptions): Promise<DailyIngestionSummary> {
  if (!firestore) {
    throw new Error("Firebase is not initialized (firestore missing). Check environment variables.");
  }

  const cronDate = options.processingDate ?? new Date();
  const targetDate = mstDateString(cronDate); // today (MST)
  const cutoffOld = mstDateString(addDays(cronDate, -2)); // older than 2 days

  // Step 1: pull latest emails into msrEmails collection
  await ingestMsrEmails(options);

  // Step 1a: prune stale msrReports and msrEmails older than cutoff
  try {
    if (firestore) {
      const staleReportsSnap = await firestore.collection("msrReports").where("emailDate", "<", cutoffOld).get();
      for (const doc of staleReportsSnap.docs) {
        const data = doc.data() as { storagePath?: string; emailDate?: string; reportDate?: string };
        console.info("[msr-ingest] pruning stale MSR", { emailDate: data.emailDate, reportDate: data.reportDate, id: doc.id });
        if (data.storagePath && storage) {
          await storage.file(data.storagePath).delete({ ignoreNotFound: true }).catch((err) => {
            console.warn("[msr-ingest] unable to delete stale blob", { path: data.storagePath }, err);
          });
        }
        await doc.ref.delete().catch((err) => console.warn("[msr-ingest] unable to delete stale msrReport", { id: doc.id }, err));
      }
    }
  } catch (err) {
    console.warn("[msr-ingest] prune stale msrReports failed", err);
  }

  // Step 2: find unprocessed emails (filter to targetDate)
  // Step 2: find unprocessed emails
  const limit = options.maxEmailsToProcess && options.maxEmailsToProcess > 0 ? options.maxEmailsToProcess : 200;
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
  let targetEmailsSeen = 0;

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
      receivedAt?: string;
      receivedDateMst?: string;
    };
    const receivedDateMst = data.receivedDateMst ?? (data.receivedAt ? mstDateString(new Date(data.receivedAt)) : null);
    if (receivedDateMst && receivedDateMst < cutoffOld) {
      console.info("[msr-ingest] pruning stale email", { id: doc.id, receivedDateMst });
      await doc.ref.delete().catch((err) => console.warn("[msr-ingest] unable to delete stale email", { id: doc.id }, err));
      continue;
    }
    if (receivedDateMst && receivedDateMst !== targetDate) {
      console.info("[msr-ingest] skipping non-target email", { id: doc.id, receivedDateMst, targetDate });
      continue;
    }
    targetEmailsSeen += 1;

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
        emailDate: receivedDateMst ?? targetDate,
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

  if (targetEmailsSeen === 0) {
    console.warn("[msr-ingest] no MSR email found for targetDate", { targetDate });
  }

  return {
    emailsProcessed,
    propertiesIngested: properties.size,
    emailsWithErrors,
    reportsIngested,
  };
}
