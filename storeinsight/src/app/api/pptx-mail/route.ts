import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import { listProperties } from "@/app/api/daily-summary/store";
import { sendFlashEmail } from "@/lib/flash/sendFlashEmail";
import { convertPptxBufferToPdfLocal, convertPptxBufferToPngLocal } from "@/lib/flash/convertPptxLocal";
import { convertPptxRemote } from "@/lib/convertPptxRemote";
import { firestore, storage } from "@/server/firebaseAdmin";

const normalizePropertyKey = (value?: string | null): string =>
  (value ?? "").toString().trim().toLowerCase();

const resolveProperty = async (key: string) => {
  const properties = await listProperties();
  const normalized = normalizePropertyKey(key);
  return (
    properties.find(
      (p) =>
        normalizePropertyKey(p.id) === normalized ||
        normalizePropertyKey(p.propertyId) === normalized ||
        normalizePropertyKey(p.propertyCode) === normalized ||
        normalizePropertyKey(p.tenantPropertyId) === normalized ||
        normalizePropertyKey(p.name) === normalized,
    ) ?? null
  );
};

const getFlashDevMode = async (): Promise<boolean> => {
  if (!firestore) return false;
  try {
    const doc = await firestore.collection("config").doc("flashSettings").get();
    const data = doc.data();
    if (data && typeof data.flashDevMode === "boolean") {
      return data.flashDevMode;
    }
  } catch (err) {
    console.warn("[pptx-mail] unable to read flash dev mode", err);
  }
  return false;
};

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const propertyKey = (form.get("propertyId") as string | null)?.trim();
  const asOfDate = (form.get("asOfDate") as string | null)?.trim();
  if (!propertyKey) {
    return NextResponse.json({ error: "propertyId is required" }, { status: 400 });
  }
  if (!asOfDate) {
    return NextResponse.json({ error: "asOfDate is required" }, { status: 400 });
  }

  const property = await resolveProperty(propertyKey);
  if (!property) {
    return NextResponse.json({ error: `Property not found for key "${propertyKey}"` }, { status: 404 });
  }

  const emailBody = typeof form.get("emailBody") === "string" ? (form.get("emailBody") as string) : undefined;
  const attachPptx = form.get("attachPptx") === "true" || form.get("attachPptx") === "on";
  const files = form.getAll("pptx");
  if (!files.length) {
    return NextResponse.json({ error: "At least one PPTX file is required (field name: pptx)" }, { status: 400 });
  }

  const results: Array<{ file: string; pdfConverted: boolean; emailed: boolean; error?: string }> = [];
  const convertUrl = process.env.PPTX_CONVERT_URL || process.env.LIBRE_CONVERT_URL || null;
  const devMode = await getFlashDevMode();
  const propertyCode = property.propertyCode ?? property.tenantPropertyId ?? property.id;
  const safePropertyId = propertyCode.replace(/[^A-Za-z0-9._-]+/g, "_");
  const safeAsOfSegment = asOfDate.replace(/[^0-9A-Za-z._-]+/g, "_");

  for (let i = 0; i < files.length; i += 1) {
    const blob = files[i];
    if (!(blob instanceof Blob)) {
      results.push({ file: `item-${i + 1}`, pdfConverted: false, emailed: false, error: "Invalid file input" });
      continue;
    }

    const name = (blob as Blob & { name?: string }).name || `upload-${i + 1}.pptx`;
    const pptxBuffer = Buffer.from(await blob.arrayBuffer());

    let pdfBuffer: Buffer | null = null;
    let pdfName: string | null = null;
    let pdfUrl: string | null = null;
    let pngBuffer: Buffer | null = null;
    let pngName: string | null = null;
    // Prefer remote converter if configured, then fall back to local LibreOffice.
    if (convertUrl) {
      let remoteResult: Awaited<ReturnType<typeof convertPptxRemote>> | null = null;
      try {
        remoteResult = await convertPptxRemote({ convertUrl, pptxBuffer, pptxFilename: name });
        pdfBuffer = remoteResult.pdfBuffer;
        pngBuffer = remoteResult.pngBuffer;
        pdfName =
          remoteResult.pdfFilename ||
          (name.toLowerCase().endsWith(".pptx") ? name.replace(/\.pptx$/i, ".pdf") : `${name}.pdf`);
        pngName = remoteResult.pngFilename || name.replace(/\.pptx$/i, "-slide1.png");
      } catch (remoteErr) {
        // Remote failed; try local as a fallback.
        try {
          pdfBuffer = await convertPptxBufferToPdfLocal(pptxBuffer);
          pdfName = name.toLowerCase().endsWith(".pptx") ? name.replace(/\.pptx$/i, ".pdf") : `${name}.pdf`;
          // PNG fallback (local) for first slide
          try {
            pngBuffer = await convertPptxBufferToPngLocal(pptxBuffer);
            pngName = name.replace(/\.pptx$/i, "-slide1.png");
          } catch {
            // ignore png failure
          }
        } catch (localErr) {
          results.push({
            file: name,
            pdfConverted: false,
            emailed: false,
            error:
              remoteErr instanceof Error
                ? `${remoteErr.message}; local fallback failed: ${localErr instanceof Error ? localErr.message : localErr}`
                : "PDF conversion failed",
          });
          continue;
        }
      }
      // If remote succeeded for PDF but did not return PNG, try local PNG for first slide.
      if (pdfBuffer && !pngBuffer) {
        try {
          pngBuffer = await convertPptxBufferToPngLocal(pptxBuffer);
          pngName = name.replace(/\.pptx$/i, "-slide1.png");
        } catch {
          // ignore png failure
        }
      }
    } else {
      try {
        pdfBuffer = await convertPptxBufferToPdfLocal(pptxBuffer);
        pdfName = name.toLowerCase().endsWith(".pptx") ? name.replace(/\.pptx$/i, ".pdf") : `${name}.pdf`;
        try {
          pngBuffer = await convertPptxBufferToPngLocal(pptxBuffer);
          pngName = name.replace(/\.pptx$/i, "-slide1.png");
        } catch {
          // ignore png failure
        }
      } catch (err) {
        results.push({
          file: name,
          pdfConverted: false,
          emailed: false,
          error: err instanceof Error ? err.message : "PDF conversion failed",
        });
        continue;
      }
    }

    if (pdfBuffer && storage) {
      const pdfPath = `owner_reports/${safeAsOfSegment}/${safePropertyId}/${pdfName ?? "report.pdf"}`;
      try {
        await storage.file(pdfPath).save(pdfBuffer, {
          contentType: "application/pdf",
          resumable: false,
          metadata: { cacheControl: "private,max-age=0" },
        });
        const [signedUrl] = await storage
          .file(pdfPath)
          .getSignedUrl({ action: "read", expires: Date.now() + 7 * 24 * 60 * 60 * 1000 });
        pdfUrl = signedUrl;
      } catch (err) {
        console.warn("[pptx-mail] unable to store/sign pdf", { pdfPath }, err);
      }
    }

    const propertyLabel = property.name || property.propertyCode || property.tenantPropertyId || property.id;
    const tokens = {
      PROPERTYDISPLAYNAME: propertyLabel,
      FACILITYSHORTNAME: propertyLabel,
      FACILITYCODE: propertyCode,
      ASOFDATE: asOfDate,
    };

    const emailed = await sendFlashEmail({
      property,
      pptxBuffer,
      pptxFilename: path.basename(name),
      pdfBuffer,
      pdfFilename: pdfName,
      customBody: emailBody,
      attachPptx,
      devModeOverride: devMode,
      tokens,
      reportDateDisplay: asOfDate,
      pdfUrl,
      subjectOverride: `Owner Report - ${propertyLabel}${asOfDate ? ` (${asOfDate})` : ""}`,
      slidePngBuffer: pngBuffer || undefined,
      pngBuffer: pngBuffer || undefined,
      pngFilename: pngName || undefined,
    });

    results.push({ file: name, pdfConverted: Boolean(pdfBuffer), emailed });
  }

  const failed = results.find((r) => !r.emailed);
  return NextResponse.json(
    {
      propertyId: property.id,
      propertyCode: property.propertyCode ?? property.tenantPropertyId ?? property.id,
      sent: !failed,
      results,
    },
    { status: failed ? 207 : 200 },
  );
}
