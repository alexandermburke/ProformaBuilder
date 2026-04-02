import admin from "firebase-admin";
import { firestore, storage } from "@/server/firebaseAdmin";
import { listProperties } from "@/app/api/daily-summary/store";
import type { PropertyConfig } from "@/types/dailySummary";
import { extractViewerUrlFromHtml, fetchMsrMessageHtmlById, ingestMsrEmails, isTenantViewerUrl } from "./ingestMsrEmails";
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
  // Keep the ingestion target pinned to the mailbox email's actual received date in MST.
  // Do not offset this to yesterday. Reruns for the same report day must continue matching
  // the same receivedDateMst so we do not skip valid same-day MSR delivery emails.
  const targetDate = mstDateString(cronDate);
  const cutoffOld = mstDateString(addDays(cronDate, -2)); // older than 2 days

  // Step 1: pull latest emails into msrEmails collection
  await ingestMsrEmails(options);

  const existingTargetEmailSnap = await firestore
    .collection("msrEmails")
    .where("receivedDateMst", "==", targetDate)
    .limit(1)
    .get();
  const targetEmailAlreadyStored = !existingTargetEmailSnap.empty;

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

  const repairViewerUrl = async (messageId: string): Promise<string | null> => {
    try {
      const html = await fetchMsrMessageHtmlById({ messageId, userId: options.userId });
      const repaired = html ? extractViewerUrlFromHtml(html) : null;
      if (!repaired) {
        console.warn("[msr-daily] unable to repair viewer URL from message body", { messageId });
        return null;
      }
      await firestore.collection("msrEmails").doc(messageId).set(
        {
          viewerUrl: repaired,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      console.info("[msr-daily] repaired viewer URL from Graph message body", { messageId });
      return repaired;
    } catch (err) {
      console.warn("[msr-daily] viewer URL repair failed", { messageId }, err);
      return null;
    }
  };

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
    let viewerUrl = data.viewerUrl;
    if (!viewerUrl) {
      console.warn("[msr-daily] skipping email missing viewerUrl", { id: messageId });
      emailsWithErrors.push(messageId);
      continue;
    }
    if (!isTenantViewerUrl(viewerUrl)) {
      const repairedViewerUrl = await repairViewerUrl(messageId);
      if (repairedViewerUrl) {
        viewerUrl = repairedViewerUrl;
      }
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
      const errorText = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      if (!isTenantViewerUrl(viewerUrl) || /ENOTFOUND|fetch failed/i.test(errorText)) {
        const repairedViewerUrl = await repairViewerUrl(messageId);
        if (repairedViewerUrl && repairedViewerUrl !== viewerUrl) {
          try {
            const ingested: IngestedMsr[] = await ingestManagementSummariesFromViewer(repairedViewerUrl, {
              propertyConfigs,
              emailDate: receivedDateMst ?? targetDate,
            });
            if (!ingested.length) {
              throw new Error("No XLSX URLs discovered from repaired viewer page");
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
            continue;
          } catch (retryErr) {
            console.error("[msr-daily] ingestion retry after viewer repair failed", { messageId, subject: data.subject }, retryErr);
          }
        }
      }
      console.error("[msr-daily] ingestion failed", { messageId, subject: data.subject, viewerUrl }, err);
      emailsWithErrors.push(messageId);
    }
  }

  if (targetEmailsSeen === 0 && !targetEmailAlreadyStored) {
    console.warn("[msr-ingest] no MSR email found for targetDate", { targetDate });
  } else if (targetEmailsSeen === 0 && targetEmailAlreadyStored) {
    console.info("[msr-ingest] target-date MSR email already stored; no unprocessed emails remain", { targetDate });
  }

  return {
    emailsProcessed,
    propertiesIngested: properties.size,
    emailsWithErrors,
    reportsIngested,
  };
}
