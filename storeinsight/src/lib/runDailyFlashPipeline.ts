import admin from "firebase-admin";
import { firestore } from "@/server/firebaseAdmin";
import { ingestMsrEmails } from "./ingestMsrEmails";
import { runDailyMsrIngestion } from "./runDailyMsrIngestion";
import { parseMsrReports } from "./parseMsrReports";
import { generateFlashArtifacts } from "./generateFlashArtifacts";

export type DailyPipelineOptions = {
  senderEmail: string;
  subjectPhrase: string;
  maxMessages?: number;
  userId?: string;
  parseLimit?: number;
  flashLimit?: number;
  convertUrl?: string;
  templateName?: string;
};

export type DailyPipelineSummary = {
  emailsIngested: number;
  xlsxIngested: number;
  parseParsed: number;
  parseFailed: number;
  flashGenerated: number;
  flashFailed: number;
  emailsProcessed: number;
  emailsWithErrors: string[];
};

export async function runDailyFlashPipeline(options: DailyPipelineOptions): Promise<DailyPipelineSummary> {
  if (!firestore) {
    throw new Error("Firebase is not initialized (firestore missing). Check environment variables.");
  }

  // Step 1: pull new emails
  const newlyIngestedEmails = await ingestMsrEmails({
    senderEmail: options.senderEmail,
    subjectPhrase: options.subjectPhrase,
    maxMessages: options.maxMessages,
    userId: options.userId,
  });

  // Step 2: discover and store XLSX + msrReports
  const ingestionResult = await runDailyMsrIngestion({
    senderEmail: options.senderEmail,
    subjectPhrase: options.subjectPhrase,
    maxMessages: options.maxMessages,
    userId: options.userId,
  });

  // Step 3: parse pending XLSX
  const parseOutcomes = await parseMsrReports({ limit: options.parseLimit });
  const parseParsed = parseOutcomes.filter((o) => o.parseStatus === "parsed").length;
  const parseFailed = parseOutcomes.filter((o) => o.parseStatus === "failed").length;

  // Step 4: generate Flash artifacts for parsed reports lacking outputs
  const flashTargetsSnap = await firestore.collection("msrReports").where("parseStatus", "==", "parsed").get();
  const flashTargets = flashTargetsSnap.docs
    .map((doc) => ({ id: doc.id, data: doc.data() }))
    .filter(
      (d) =>
        !d.data.pptxPath ||
        !d.data.pdfPath ||
        d.data.flashStatus !== "generated" ||
        d.data.pdfPath === "" ||
        d.data.pptxPath === "",
    )
    .slice(0, options.flashLimit && options.flashLimit > 0 ? options.flashLimit : undefined);

  let flashGenerated = 0;
  let flashFailed = 0;

  for (const target of flashTargets) {
    const { id, data } = target;
    const propertyCode = data.propertyCode ?? "";
    const reportDate = data.reportDate ?? "";
    const tokens = data.tokens as Record<string, string | number> | undefined;

    if (!tokens) {
      await firestore
        .collection("msrReports")
        .doc(id)
        .set(
          {
            flashStatus: "failed",
            flashError: "Missing tokens for flash generation",
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
      flashFailed += 1;
      continue;
    }

    const result = await generateFlashArtifacts({
      tokens,
      propertyCode,
      reportDate,
      convertUrl: options.convertUrl,
      templateName: options.templateName,
    });

    if (result.status === "generated") {
      flashGenerated += 1;
    } else {
      flashFailed += 1;
    }
  }

  return {
    emailsIngested: newlyIngestedEmails.length,
    xlsxIngested: ingestionResult.reportsIngested.length,
    parseParsed,
    parseFailed,
    flashGenerated,
    flashFailed,
    emailsProcessed: ingestionResult.emailsProcessed,
    emailsWithErrors: ingestionResult.emailsWithErrors,
  };
}
