import fs from "node:fs/promises";
import path from "node:path";
import Docxtemplater from "docxtemplater";
import PizZip from "pizzip";
import admin from "firebase-admin";
import { firestore, storage } from "@/server/firebaseAdmin";
import { convertPptxRemote } from "@/lib/convertPptxRemote";

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
  slidePngPaths?: string[];
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
  storageBucket: string,
  pptxPath: string,
  convertUrl: string,
): Promise<{ pdfPath: string; slidePngPaths: string[] }> => {
  const outputBasePath = pptxPath.replace(/\.pptx$/i, "");
  return convertPptxRemote({
    convertUrl,
    storageBucket,
    pptxPath,
    outputBasePath,
  });
};

export async function generateFlashArtifacts(options: GenerateFlashOptions): Promise<GenerateFlashResult> {
  if (!firestore || !storage) {
    throw new Error("Firebase is not initialized (firestore/storage missing). Check environment variables.");
  }

  const { tokens, propertyCode, reportDate } = options;
  const templateName = options.templateName || "FLASHTEMPLATE";
  const convertUrl = options.convertUrl || process.env.LIBRE_CONVERT_URL || process.env.PPTX_CONVERT_URL || "http://localhost:3000";
  const docId = `${propertyCode}_${reportDate}`;
  const docRef = firestore.collection("msrReports").doc(docId);
  const storageBucketName = process.env.FIREBASE_STORAGE_BUCKET || storage?.name;

  let pptxPath: string | undefined;
  let pdfPath: string | undefined;
  let slidePngPaths: string[] = [];

  try {
    const templatePath = await findTemplate(templateName);
    const pptxBuffer = await renderPptx(templatePath, tokens);

    pptxPath = `msr_flash/${reportDate}/${propertyCode}.pptx`;
    await storage.file(pptxPath).save(pptxBuffer, {
      contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      resumable: false,
      metadata: { cacheControl: "private,max-age=0" },
    });

    if (convertUrl && storageBucketName) {
      try {
        const convertResult = await convertWithLibreService(storageBucketName, pptxPath, convertUrl);
        pdfPath = convertResult.pdfPath;
        slidePngPaths = convertResult.slidePngPaths;
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
    }

    await docRef.set(
      {
        pptxPath,
        pdfPath,
        slidePngPaths,
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
