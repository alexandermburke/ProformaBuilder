import { NextRequest, NextResponse } from "next/server";
import type { PropertyConfig } from "@/types/dailySummary";
import { listProperties } from "@/app/api/daily-summary/store";
import { firestore, storage } from "@/server/firebaseAdmin";
import { generateFlashFromMsr } from "@/lib/flash/generateFlashFromMsr";
import { recordFlashRunResult } from "@/lib/dailySummaryRuns";
import { sendFlashEmail } from "@/lib/flash/sendFlashEmail";
import { convertPptxRemote } from "@/lib/convertPptxRemote";
import { convertPptxBufferToPdfLocal, convertPptxBufferToPngLocal, resolveSofficePath } from "@/lib/flash/convertPptxLocal";

export const runtime = "nodejs";

type MsrDoc = {
  storagePath?: string;
  cloudfrontUrl?: string;
  propertyCode?: string;
  reportDate?: string;
  emailDate?: string;
};

const isValidDate = (value: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(value);
const formatReportDateDisplay = (value: string): string => {
  if (!isValidDate(value)) return value;
  const [year, month, day] = value.split("-");
  return `${month}/${day}/${year}`;
};

const normalizeCode = (value: string | undefined | null): string => (value ?? "").toString().trim();
const normalizeSlug = (value: string | undefined | null): string => normalizeCode(value).toLowerCase();

const resolvePropertyCode = (property: PropertyConfig): string =>
  normalizeCode(property.propertyCode) || normalizeCode(property.tenantPropertyId) || normalizeCode(property.id);

const getCurrentMstTime = (): string => {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Phoenix",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return formatter.format(new Date());
};

const isTimeOnOrAfter = (current: string, target?: string | null): boolean => {
  if (!target) return true;
  const [ch, cm] = current.split(":").map(Number);
  const [th, tm] = target.split(":").map(Number);
  if (![ch, cm, th, tm].every((n) => Number.isFinite(n))) return true;
  if (ch > th) return true;
  if (ch === th && cm >= tm) return true;
  return false;
};

export async function POST(req: NextRequest) {
  if (!firestore || !storage) {
    return NextResponse.json({ error: "Firebase is not initialized (firestore/storage missing)." }, { status: 500 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    reportDate?: string;
    propertyCodes?: string[];
    sendEmails?: boolean | string;
    mode?: string;
    respectSendTime?: boolean | string;
    emailBody?: string;
  };

  const reportDate = normalizeCode(body.reportDate);
  if (!reportDate || !isValidDate(reportDate)) {
    return NextResponse.json({ error: "reportDate (YYYY-MM-DD) is required." }, { status: 400 });
  }

  const sendEmails = body.sendEmails === true || body.sendEmails === "true";
  const respectSendTime = body.respectSendTime === true || body.respectSendTime === "true";
  const currentMstTime = getCurrentMstTime();

  console.info("[flash-report/auto] start", {
    reportDate,
    sendEmails,
    respectSendTime,
    propertyCodes: body.propertyCodes ?? [],
  });

  const requestedCodes =
    Array.isArray(body.propertyCodes) && body.propertyCodes.length > 0
      ? new Set(
          body.propertyCodes
            .map((c) => (typeof c === "string" ? c.trim().toLowerCase() : "").toLowerCase())
            .filter((c) => c.length > 0),
        )
      : null;

  let properties: PropertyConfig[] = [];
  try {
    properties = await listProperties();
  } catch (err) {
    console.error("[flash-report/auto] unable to load properties", err);
    return NextResponse.json({ error: "Unable to load properties." }, { status: 500 });
  }

  const baseProps = properties.filter((prop) => {
    const code = normalizeSlug(resolvePropertyCode(prop));
    if (!code) return false;
    if (requestedCodes && !requestedCodes.has(code)) return false;
    if (!requestedCodes && !prop.enabled) return false; // default: only enabled properties
    if (requestedCodes && (sendEmails || respectSendTime) && !prop.enabled) return false; // email/scheduled respects toggle
    return true;
  });

  console.info("[flash-report/auto] resolved properties", {
    reportDate,
    count: baseProps.length,
    propertyCodes: baseProps.map((p) => resolvePropertyCode(p)),
    sendEmails,
    respectSendTime,
  });

  if (baseProps.length === 0) {
    console.warn("[flash-report/auto] no properties matched request", {
      reportDate,
      sendEmails,
      respectSendTime,
      requestedCount: requestedCodes?.size ?? 0,
    });
    return NextResponse.json({ error: "No properties matched the request." }, { status: 404 });
  }

  let msrSnap = await firestore.collection("msrReports").where("emailDate", "==", reportDate).get();
  if (msrSnap.empty) {
    msrSnap = await firestore.collection("msrReports").where("reportDate", "==", reportDate).get();
  }
  if (msrSnap.empty) {
    console.warn("[flash-report/auto] no msr found for reportDate", { reportDate });
    return NextResponse.json(
      {
        error: "MSR not found for reportDate",
        reportDate,
        propertiesProcessed: [],
        propertiesSkipped: baseProps.map((prop) => ({ propertyCode: resolvePropertyCode(prop), propertyId: prop.propertyId, reason: "msr_missing" })),
        sendEmails,
        mode: respectSendTime ? "scheduled" : "manual",
      },
      { status: 404 },
    );
  }
  const msrByCode = new Map<string, MsrDoc>();
  msrSnap.docs.forEach((doc) => {
    const data = doc.data() as MsrDoc;
    const codeRaw = normalizeCode(data.propertyCode ?? doc.id.split("_")[0]);
    const slug = normalizeSlug(codeRaw);
    if (!slug) return;
    msrByCode.set(slug, { ...data, propertyCode: codeRaw });
  });
  console.info("[flash-report/auto] msr docs resolved", { reportDate, count: msrByCode.size, keys: Array.from(msrByCode.keys()) });

  const propertiesProcessed: Array<{
    propertyCode: string;
    propertyId?: string;
    propertyName?: string;
    msrPath: string;
    flashPath: string;
    emailSent: boolean;
    status: string;
  }> = [];
  const propertiesSkipped: Array<{ propertyCode: string; propertyId?: string; reason: string }> = [];

  for (const prop of baseProps) {
    const propertyCode = normalizeSlug(resolvePropertyCode(prop));
    if (!propertyCode) continue;
    const propertyId = prop.propertyId ?? prop.tenantPropertyId ?? prop.id;
    const propertyName = prop.name || propertyCode;
    const sendTimeMst = prop.sendTimeMst ?? prop.sendTimeLocal;

    if (respectSendTime && !isTimeOnOrAfter(currentMstTime, sendTimeMst)) {
      console.info("[flash-report/auto] skipping property before send time", { propertyCode, sendTimeMst, currentMstTime });
      propertiesSkipped.push({ propertyCode, propertyId, reason: "before_send_time" });
      continue;
    }

    const msrDoc = msrByCode.get(propertyCode);
    if (!msrDoc || !msrDoc.storagePath) {
      await recordFlashRunResult({
        propertyCode,
        propertyId,
        propertyName,
        reportDate,
        status: "AWAITING_MSR",
        sendTimeMst,
        errorMessage: "MSR not found for reportDate",
      }).catch((err) => console.warn("[flash-report/auto] status update failed (awaiting msr)", { propertyCode, reportDate }, err));
      propertiesSkipped.push({ propertyCode, propertyId, reason: "msr_missing" });
      continue;
    }
    console.info("[flash-report/auto] msr report chosen", {
      reportDate,
      propertyCode,
      msrEmailDate: msrDoc.emailDate ?? null,
      msrReportDate: msrDoc.reportDate ?? null,
      msrPath: msrDoc.storagePath,
    });

    try {
      let emailSent = false;
      const [msrBuffer] = await storage.file(msrDoc.storagePath).download();
      const generation = await generateFlashFromMsr(Buffer.from(msrBuffer), {
        propertyCode,
        reportDate,
        propertyConfig: prop,
        asOfDateOverride: formatReportDateDisplay(reportDate),
      });

      const flashPath = `flash_reports/${reportDate}/${generation.pptxFilename}`;
      await storage.file(flashPath).save(generation.pptxBuffer, {
        contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        resumable: false,
        metadata: { cacheControl: "private,max-age=0" },
      });

      let pdfPath: string | undefined;
      let pngPath: string | undefined;
      let slidePngPaths: string[] | undefined;
      let pdfBufferLocal: Buffer | undefined;
      let slidePngBuffer: Buffer | undefined;
      const convertUrl = process.env.PPTX_CONVERT_URL || process.env.LIBRE_CONVERT_URL;
      const bucketName = process.env.FIREBASE_STORAGE_BUCKET || storage.name;
      const hasSoffice = Boolean(resolveSofficePath());
      if (convertUrl && bucketName) {
        try {
          const convertResult = await convertPptxRemote({
            convertUrl,
            pptxBuffer: generation.pptxBuffer,
            pptxFilename: generation.pptxFilename,
          });
          if (convertResult.pdfBuffer) {
            pdfBufferLocal = convertResult.pdfBuffer;
            pdfPath = `flash_reports/${reportDate}/${propertyCode}-${reportDate}.pdf`;
            await storage.file(pdfPath).save(convertResult.pdfBuffer, {
              contentType: "application/pdf",
              resumable: false,
              metadata: { cacheControl: "private,max-age=0" },
            });
          }
          if (convertResult.pngBuffer) {
            slidePngBuffer = convertResult.pngBuffer;
            pngPath = `flash_reports/${reportDate}/${propertyCode}-${reportDate}.png`;
            await storage.file(pngPath).save(convertResult.pngBuffer, {
              contentType: "image/png",
              resumable: false,
              metadata: { cacheControl: "private,max-age=0" },
            });
            slidePngPaths = [pngPath];
          }
          console.info("[flash-report/auto] pptx convert ok", {
            propertyCode,
            reportDate,
            pdfStored: Boolean(pdfPath),
            pngStored: Boolean(pngPath),
          });
        } catch (err) {
          console.warn("[flash-report/auto] pptx convert failed", { propertyCode, reportDate }, err);
        }
      }

      if (!slidePngBuffer) {
        if (hasSoffice) {
          try {
            slidePngBuffer = await convertPptxBufferToPngLocal(generation.pptxBuffer);
          } catch (err) {
            console.warn("[flash-report/email] local png render failed", { propertyCode, reportDate }, err);
          }
        } else {
          console.warn("[flash-report/email] png not generated (no converter available)", { propertyCode, reportDate });
        }
      }
      if (slidePngBuffer && !pngPath) {
        try {
          pngPath = `flash_reports/${reportDate}/${propertyCode}-${reportDate}.png`;
          await storage.file(pngPath).save(slidePngBuffer, {
            contentType: "image/png",
            resumable: false,
            metadata: { cacheControl: "private,max-age=0" },
          });
          slidePngPaths = [pngPath];
        } catch (err) {
          console.warn("[flash-report/email] failed to store png", { propertyCode, reportDate }, err);
        }
      }

      if (!pdfBufferLocal) {
        if (hasSoffice) {
          try {
            pdfBufferLocal = await convertPptxBufferToPdfLocal(generation.pptxBuffer);
          } catch (err) {
            console.warn("[flash-report/email] local pdf render failed", { propertyCode, reportDate }, err);
          }
        } else {
          console.warn("[flash-report/email] pdf not generated (no converter available)", { propertyCode, reportDate });
        }
      }
      if (pdfBufferLocal && !pdfPath) {
        try {
          pdfPath = `flash_reports/${reportDate}/${propertyCode}-${reportDate}.pdf`;
          await storage.file(pdfPath).save(pdfBufferLocal, {
            contentType: "application/pdf",
            resumable: false,
            metadata: { cacheControl: "private,max-age=0" },
          });
        } catch (err) {
          console.warn("[flash-report/email] failed to store pdf", { propertyCode, reportDate }, err);
        }
      }

      if (sendEmails) {
        console.info("[flash-report/email] sending", {
          reportDate,
          propertyCode,
          to: prop.ownerEmails ?? [],
          sendEmails,
        });
        const pdfFilename = `${propertyCode}-${reportDate}.pdf`;
        const pngFilename = `${propertyCode}-${reportDate}.png`;
        const pptxFilename = `${propertyCode}-${reportDate}.pptx`;
        if (!pdfBufferLocal && pdfPath) {
          try {
            const [pdfBuffer] = await storage.file(pdfPath).download();
            pdfBufferLocal = pdfBuffer;
          } catch (err) {
            console.warn("[flash-report/email] unable to download pdf attachment", { propertyCode, reportDate, pdfPath }, err);
          }
        }
        if (!slidePngBuffer && slidePngPaths && slidePngPaths.length > 0) {
          try {
            const [pngBuffer] = await storage.file(slidePngPaths[0]).download();
            slidePngBuffer = pngBuffer;
          } catch (err) {
            console.warn("[flash-report/email] unable to download slide png", { propertyCode, reportDate, slidePngPaths }, err);
          }
        }
        emailSent = await sendFlashEmail({
          property: prop,
          pptxBuffer: generation.pptxBuffer,
          pptxFilename,
          tokens: generation.tokens,
          customBody: body.emailBody ?? "",
          fromOverride: process.env.SMTP_FROM || undefined,
          slidePngBuffer,
          pdfBuffer: pdfBufferLocal,
          pdfFilename,
          pngBuffer: slidePngBuffer,
          pngFilename,
          reportDateDisplay: formatReportDateDisplay(reportDate),
          attachPptx: !pdfBufferLocal,
        });
        if (!emailSent) {
          throw new Error("Email delivery failed or skipped");
        }
      } else {
        console.info("[flash-report/email] sendEmails=false, skipping send", { reportDate, propertyCode });
      }

      await recordFlashRunResult({
        propertyCode,
        propertyId,
        propertyName: generation.propertyName || propertyName,
        reportDate,
        msrPath: msrDoc.storagePath,
        flashPath,
        pdfPath: pdfPath ?? null,
        slidePngPaths: slidePngPaths ?? null,
        status: "HEALTHY",
        sendTimeMst,
      }).catch((err) =>
        console.warn("[flash-report/auto] status update failed (success)", { propertyCode, reportDate }, err),
      );

      propertiesProcessed.push({
        propertyCode,
        propertyId,
        propertyName: generation.propertyName || propertyName,
        msrPath: msrDoc.storagePath,
        flashPath,
        emailSent,
        status: emailSent ? "emailed" : "generated",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unexpected error during flash generation";
      console.error("[flash-report/auto] failed for property", { propertyCode, reportDate, msrPath: msrDoc.storagePath }, err);
      await recordFlashRunResult({
        propertyCode,
        propertyId,
        propertyName,
        reportDate,
        msrPath: msrDoc.storagePath,
        flashPath: null,
        status: "FAILED",
        errorMessage: message.slice(0, 500),
        sendTimeMst,
      }).catch((statusErr) =>
        console.warn("[flash-report/auto] status update failed (error)", { propertyCode, reportDate }, statusErr),
      );
    }
  }

  console.info("[flash-report/auto] processed summary", {
    reportDate,
    processedCount: propertiesProcessed.length,
    skippedCount: propertiesSkipped.length,
  });
  if (propertiesProcessed.length === 0) {
    console.warn("[flash-report/auto] no properties to process for reportDate", { reportDate });
  }

  return NextResponse.json({
    reportDate,
    propertiesProcessed,
    propertiesSkipped,
    sendEmails,
    mode: respectSendTime ? "scheduled" : "manual",
  });
}
