import fs from "node:fs/promises";
import path from "node:path";
import Docxtemplater from "docxtemplater";
import PizZip from "pizzip";
import admin from "firebase-admin";
import { firestore, storage } from "@/server/firebaseAdmin";

export type GenerateFlashOptions = {
  tokens: Record<string, string | number>;
  propertyCode: string;
  reportDate: string; // YYYY-MM-DD
  templateName?: string; // defaults to FLASHTEMPLATE
  convertUrl?: string; // LibreOffice microservice base URL
};

export type GenerateFlashResult = {
  pptxPath?: string;
  pdfPath?: string;
  status: "generated" | "failed";
  error?: string;
};

const findTemplate = async (templateName: string): Promise<string> => {
  const candidateDirs = [path.join(process.cwd(), "templates"), path.join(process.cwd(), "public")];
  for (const dir of candidateDirs) {
    const candidate = path.join(dir, `${templateName}.pptx`);
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // continue
    }
  }
  throw new Error(`Template ${templateName}.pptx not found in templates/ or public/`);
};

const renderPptx = async (templatePath: string, tokens: Record<string, string | number>): Promise<Buffer> => {
  const content = await fs.readFile(templatePath);
  const zip = new PizZip(content);
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    syntax: { allowUnclosedTag: true, allowUnopenedTag: true },
  });
  doc.render(tokens);
  return doc.getZip().generate({ type: "nodebuffer" });
};

const convertWithLibreService = async (
  pptxBuffer: Buffer,
  format: "pdf" | "png",
  convertUrl: string,
): Promise<Buffer> => {
  const form = new FormData();
  form.append(
    "file",
    new Blob([pptxBuffer], {
      type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    }),
    "flash.pptx",
  );
  form.append("format", format);

  const res = await fetch(`${convertUrl.replace(/\/$/, "")}/convert`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Conversion failed (${res.status}): ${text.slice(0, 300)}`);
  }
  const arrayBuf = await res.arrayBuffer();
  return Buffer.from(arrayBuf);
};

export async function generateFlashArtifacts(options: GenerateFlashOptions): Promise<GenerateFlashResult> {
  if (!firestore || !storage) {
    throw new Error("Firebase is not initialized (firestore/storage missing). Check environment variables.");
  }

  const { tokens, propertyCode, reportDate } = options;
  const templateName = options.templateName || "FLASHTEMPLATE";
  const convertUrl = options.convertUrl || process.env.LIBRE_CONVERT_URL || "http://localhost:3000";
  const docId = `${propertyCode}_${reportDate}`;
  const docRef = firestore.collection("msrReports").doc(docId);

  let pptxPath: string | undefined;
  let pdfPath: string | undefined;

  try {
    const templatePath = await findTemplate(templateName);
    const pptxBuffer = await renderPptx(templatePath, tokens);

    pptxPath = `msr_flash/${reportDate}/${propertyCode}.pptx`;
    await storage.file(pptxPath).save(pptxBuffer, {
      contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      resumable: false,
      metadata: { cacheControl: "private,max-age=0" },
    });

    let pdfBuffer: Buffer | null = null;
    try {
      pdfBuffer = await convertWithLibreService(pptxBuffer, "pdf", convertUrl);
    } catch (convertErr) {
      const message =
        convertErr instanceof Error ? convertErr.message : typeof convertErr === "string" ? convertErr : "Conversion failed";
      await docRef.set(
        {
          pptxPath,
          flashStatus: "failed",
          flashError: message.slice(0, 500),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      return { pptxPath, status: "failed", error: message };
    }

    if (pdfBuffer) {
      pdfPath = `msr_flash/${reportDate}/${propertyCode}.pdf`;
      await storage.file(pdfPath).save(pdfBuffer, {
        contentType: "application/pdf",
        resumable: false,
        metadata: { cacheControl: "private,max-age=0" },
      });
    }

    await docRef.set(
      {
        pptxPath,
        pdfPath,
        flashStatus: "generated",
        flashError: admin.firestore.FieldValue.delete(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    return { pptxPath, pdfPath, status: "generated" };
  } catch (err) {
    const message = err instanceof Error ? err.message : "PPTX generation failed";
    console.error("[flash-generate] failed", { docId, propertyCode, reportDate }, err);
    await docRef.set(
      {
        pptxPath,
        flashStatus: "failed",
        flashError: message.slice(0, 500),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return { pptxPath, pdfPath, status: "failed", error: message };
  }
}
