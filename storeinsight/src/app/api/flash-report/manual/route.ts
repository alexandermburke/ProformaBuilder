import { execFile } from "node:child_process";
import fs from "node:fs";
import { promises as fsp } from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import PizZip from "pizzip";
import nodemailer from "nodemailer";
import type Mail from "nodemailer/lib/mailer";
import { createCanvas } from "canvas";
import { Chart as ChartJS, registerables, type ChartConfiguration, type Plugin } from "chart.js";
import { listProperties } from "@/app/api/daily-summary/store";
import type { PropertyConfig } from "@/types/dailySummary";
import { stripHiddenTokenCharacters } from "@/lib/pptTokens";
import { firestore, storage } from "@/server/firebaseAdmin";

export const runtime = "nodejs";

type TokenMap = Record<string, string | number | unknown[]>;

const chartWidth = 1200;
const chartHeight = 650;
const chartPixelRatio = 2;
const whiteBackgroundPlugin: Plugin<"bar"> = {
  id: "customCanvasBackgroundColor",
  beforeDraw: (chart, _args, opts) => {
    const { ctx, width, height } = chart;
    ctx.save();
    ctx.globalCompositeOperation = "destination-over";
    ctx.fillStyle = (opts as { color?: string }).color || "#FFFFFF";
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  },
};
ChartJS.register(...registerables, whiteBackgroundPlugin);
ChartJS.defaults.responsive = false;
ChartJS.defaults.animation = false;
ChartJS.defaults.devicePixelRatio = chartPixelRatio;
ChartJS.defaults.font.size = 18;
ChartJS.defaults.font.family = 'Arial, "Helvetica Neue", sans-serif';
ChartJS.defaults.color = "#111827";

type MailerConfig = {
  host: string;
  port: number;
  user?: string;
  pass?: string;
  from: string;
};

const sanitizeFromAddress = (value?: string | null): string | undefined => {
  if (!value) return undefined;
  let from = value.trim();
  from = from.replace(/^SMTP_FROM=/i, "").trim();
  if ((from.startsWith("\"") && from.endsWith("\"")) || (from.startsWith("'") && from.endsWith("'"))) {
    from = from.slice(1, -1).trim();
  }
  return from || undefined;
};

const resolveMailerConfig = (): MailerConfig | null => {
  const host = process.env.SMTP_HOST;
  const portRaw = process.env.SMTP_PORT;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = sanitizeFromAddress(process.env.SMTP_FROM) || sanitizeFromAddress(user);
  if (!host || !portRaw || !from) {
    console.info("[flash-report/manual] SMTP config missing; skipping email delivery");
    return null;
  }
  const port = Number(portRaw);
  if (!Number.isFinite(port)) {
    console.warn("[flash-report/manual] Invalid SMTP_PORT; skipping email delivery");
    return null;
  }
  return { host, port, user: user || undefined, pass: pass || undefined, from };
};

const getFlashDevMode = async (): Promise<boolean> => {
  if (process.env.FLASH_DEV_MODE === "true" || process.env.NEXT_PUBLIC_FLASH_DEV_MODE === "true") {
    return true;
  }
  if (!firestore) return false;
  try {
    const doc = await firestore.collection("config").doc("flashSettings").get();
    const data = doc.data();
    if (data && typeof data.flashDevMode === "boolean") {
      return data.flashDevMode;
    }
  } catch (err) {
    console.warn("[flash-report/manual] unable to read flash dev mode", err);
  }
  return false;
};

function resolveSofficePath(): string {
  const envPath = process.env.LIBREOFFICE_PATH;
  if (envPath) return envPath;
  if (process.platform === "win32") {
    const candidates = [
      "C:\\Program Files\\LibreOffice\\program\\soffice.exe",
      "C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe",
      "C:\\Program Files\\LibreOffice\\program\\soffice.com",
      "C:\\Program Files (x86)\\LibreOffice\\program\\soffice.com",
    ];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) return candidate;
    }
  } else {
    const candidates = ["/usr/bin/soffice", "/usr/local/bin/soffice", "/snap/bin/libreoffice"];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return "soffice";
}

function renderChartBuffer(configuration: ChartConfiguration<"bar", number[], string>, mimeType: "image/png" | "image/jpeg"): Buffer {
  const canvas = createCanvas(chartWidth, chartHeight);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  new ChartJS(ctx as unknown as CanvasRenderingContext2D, configuration);
  return mimeType === "image/png" ? canvas.toBuffer("image/png") : canvas.toBuffer("image/jpeg");
}

async function convertPptxBufferToPngLocal(pptBuffer: Buffer): Promise<Buffer> {
  if (!pptBuffer || pptBuffer.length === 0) {
    throw new Error("PPTX buffer is empty");
  }
  const sofficePath = resolveSofficePath();
  console.info("[flash-report/manual] using soffice path", sofficePath);
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "flash-ppt-"));
  const pptPath = path.join(tempDir, "flash.pptx");
  try {
    await fsp.writeFile(pptPath, pptBuffer);
    await new Promise<void>((resolve, reject) => {
      execFile(
        sofficePath,
        ["--headless", "--convert-to", "png", "--outdir", tempDir, pptPath],
        (error, stdout, stderr) => {
          if (error) {
            error.message += `; stdout: ${stdout}; stderr: ${stderr}`;
            reject(error);
            return;
          }
          resolve();
        },
      );
    });
    const files = await fsp.readdir(tempDir);
    const pngName = files.find((f) => f.toLowerCase().endsWith(".png"));
    if (!pngName) {
      throw new Error("LibreOffice convert did not produce a PNG");
    }
    const pngBuffer = await fsp.readFile(path.join(tempDir, pngName));
    return pngBuffer;
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function convertPptxBufferToPdfLocal(pptBuffer: Buffer): Promise<Buffer> {
  if (!pptBuffer || pptBuffer.length === 0) {
    throw new Error("PPTX buffer is empty");
  }
  const sofficePath = resolveSofficePath();
  console.info("[flash-report/manual] converting pptx to pdf with soffice", sofficePath);
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "flash-pdf-"));
  const pptPath = path.join(tempDir, "flash.pptx");
  try {
    await fsp.writeFile(pptPath, pptBuffer);
    await new Promise<void>((resolve, reject) => {
      execFile(
        sofficePath,
        ["--headless", "--convert-to", "pdf", "--outdir", tempDir, pptPath],
        (error, stdout, stderr) => {
          if (error) {
            error.message += `; stdout: ${stdout}; stderr: ${stderr}`;
            reject(error);
            return;
          }
          resolve();
        },
      );
    });
    const files = await fsp.readdir(tempDir);
    const pdfName = files.find((f) => f.toLowerCase().endsWith(".pdf"));
    if (!pdfName) {
      throw new Error("LibreOffice convert did not produce a PDF");
    }
    const pdfBuffer = await fsp.readFile(path.join(tempDir, pdfName));
    return pdfBuffer;
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function loadImageBufferFromData(data: string): Promise<Buffer | null> {
  if (!data) return null;
  try {
    if (data.startsWith("http://") || data.startsWith("https://")) {
      const res = await fetch(data);
      if (!res.ok) return null;
      const arrayBuffer = await res.arrayBuffer();
      return Buffer.from(arrayBuffer);
    }
    if (data.startsWith("data:")) {
      const base64 = data.split(",")[1];
      if (!base64) return null;
      return Buffer.from(base64, "base64");
    }
    return Buffer.from(data, "base64");
  } catch (err) {
    console.error("[flash-report/manual] unable to load property image", err);
    return null;
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "\"":
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return char;
    }
  });
}

function buildFlashEmailHtmlFromPng(
  tokens: TokenMap,
  customBody?: string,
  options?: { pdfUrl?: string | null; includeImage?: boolean },
): string {
  const bodySection =
    customBody && customBody.trim()
      ? `<div style="margin: 12px 0 16px 0; padding: 12px; background: rgba(37,99,235,0.06); border: 1px solid rgba(37,99,235,0.16); border-radius: 10px; font-size: 12px; line-height: 1.45; color: #1f2937;">${escapeHtml(customBody.trim()).replace(/\n/g, "<br />")}</div>`
      : "";
  const pdfUrl = options?.pdfUrl?.replace(/"/g, "%22");
  const pdfButton = pdfUrl
    ? `<div style="margin: 14px 0 10px 0;"><a href="${pdfUrl}" style="display: inline-flex; align-items: center; gap: 8px; padding: 11px 20px; border-radius: 999px; background: #0a84ff; color: #ffffff; text-decoration: none; font-weight: 700; font-size: 13px; letter-spacing: 0.01em; border: 1px solid #0a6fde; box-shadow: 0 6px 14px rgba(0,0,0,0.16); font-family: 'SF Pro Display','SF Pro Text','Helvetica Neue','Segoe UI',Arial,sans-serif;">Download full PDF</a></div>`
    : `<p style="margin: 10px 0 14px 0; font-size: 11px; color: #6b7280;">PDF download link unavailable.</p>`;
  const includeImage = options?.includeImage !== false;
  const imageBlock = includeImage
    ? `<div style="margin-top: 8px;"><img src="cid:flash-slide" style="max-width: 100%; height: auto; border: 1px solid #ccc;" /></div>`
    : "";
  return `
    <html>
      <body style="font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; font-size: 12px; color: #222; margin: 0; padding: 16px;">
        ${bodySection}
        ${imageBlock}
        <p style="margin-top: 12px; margin-bottom: 10px; font-size: 11px; color: #6b7280;">This is an auto-generated email. For issues please email <a href="mailto:alex@storestorage.com" style="color: #2563eb; text-decoration: none;">alex@storestorage.com</a></p>
        ${pdfButton}
      </body>
    </html>
  `;
}

async function renderArAgingChart(tokens: TokenMap): Promise<Buffer> {
  const labels = ["0-10", "11-30", "31-60", "61-90", "91-120", "121-180", "181-360", "361+"];
  const data = [
    tokens.ARAGING_0_10,
    tokens.ARAGING_11_30,
    tokens.ARAGING_31_60,
    tokens.ARAGING_61_90,
    tokens.ARAGING_91_120,
    tokens.ARAGING_121_180,
    tokens.ARAGING_181_360,
    tokens.ARAGING_361_PLUS,
  ].map(Number);

  const configuration: ChartConfiguration<"bar", number[], string> = {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "AR Dollars",
          data,
          backgroundColor: "#3b52a1",
          borderRadius: 4,
          borderWidth: 1,
        },
      ],
    },
    options: {
      responsive: false,
      plugins: {
        legend: { display: false },
        title: { display: false },
      },
      layout: { padding: { top: 20, right: 24, bottom: 20, left: 50 } },
      scales: {
        y: {
          beginAtZero: true,
          title: { display: true, text: "Dollars ($)" },
          ticks: { font: { size: 16, weight: 600 }, color: "#111827", padding: 8 },
          grid: { lineWidth: 1, color: "rgba(0,0,0,0.1)" },
          border: { display: true, color: "#111827" },
        },
        x: {
          title: { display: true, text: "Days" },
          ticks: { font: { size: 16, weight: 600 }, color: "#111827", padding: 6 },
          grid: { lineWidth: 1, color: "rgba(0,0,0,0.08)" },
          border: { display: true, color: "#111827" },
        },
      },
    },
  };

  return renderChartBuffer(configuration, "image/jpeg");
}

async function renderOccupancyChart(tokens: TokenMap): Promise<Buffer> {
  const labels = ["Sqft", "Spaces", "Projected"];
  const data = [tokens.OCCPCT_SQFT, tokens.OCCPCT_SPACES, tokens.OCCPCT_ECON].map(Number);

  const configuration: ChartConfiguration<"bar", number[], string> = {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "Percent Occupied",
          data,
          backgroundColor: "#4a4a4a",
          borderRadius: 4,
          borderWidth: 1,
        },
      ],
    },
    options: {
      responsive: false,
      plugins: {
        legend: { display: false },
        title: { display: false },
      },
      layout: { padding: { top: 40, right: 32, bottom: 24, left: 60 } },
      scales: {
        y: {
          beginAtZero: true,
          suggestedMax: 110,
          max: 110,
          title: { display: true, text: "Percent" },
          ticks: { font: { size: 16, weight: 600 }, color: "#111827", padding: 8 },
          grid: { lineWidth: 1, color: "rgba(0,0,0,0.1)" },
          border: { display: true, color: "#111827" },
        },
        x: {
          title: { display: true, text: "Type" },
          ticks: { font: { size: 16, weight: 600 }, color: "#111827", padding: 6 },
          grid: { lineWidth: 1, color: "rgba(0,0,0,0.08)" },
          border: { display: true, color: "#111827" },
        },
      },
    },
  };

  return renderChartBuffer(configuration, "image/jpeg");
}

async function sendFlashReportEmail(
  property: PropertyConfig,
  pptxFilename: string,
  asOfDate: string,
  tokens: TokenMap,
  slidePngBuffer: Buffer | null,
  pdfUrl: string | null,
  customBody: string,
  devModeOverride: boolean,
): Promise<boolean> {
  const mailConfig = resolveMailerConfig();
  if (!mailConfig) return false;
  const recipients = devModeOverride
    ? ["alex@storestorage.com"]
    : (property.ownerEmails ?? []).filter((email) => email && email.trim().length > 0);
  if (recipients.length === 0) {
    console.info("[flash-report/manual] no ownerEmails configured; skipping email delivery", property.id);
    return false;
  }
  try {
    console.info("[flash-report/manual] preparing email delivery", {
      propertyId: property.id,
      to: recipients,
      host: mailConfig.host,
      port: mailConfig.port,
      devMode: devModeOverride,
    });
    const transporter = nodemailer.createTransport({
      host: mailConfig.host,
      port: mailConfig.port,
      secure: mailConfig.port === 465,
      auth: mailConfig.user && mailConfig.pass ? { user: mailConfig.user, pass: mailConfig.pass } : undefined,
    });
    const propertyLabel =
      (tokens.PROPERTYDISPLAYNAME as string) ||
      (tokens.FACILITYSHORTNAME as string) ||
      property.name ||
      property.id;
    const reportDate = (tokens.ASOFDATE as string) || asOfDate || "Latest";
    const subject = `Daily Flash - ${propertyLabel} (${reportDate})`;
    const html = buildFlashEmailHtmlFromPng(tokens, customBody, {
      pdfUrl,
      includeImage: Boolean(slidePngBuffer),
    });
    const attachments: Mail.Attachment[] = [];
    if (slidePngBuffer) {
      attachments.push({
        filename: "daily-flash-slide.png",
        content: slidePngBuffer,
        cid: "flash-slide",
      });
    }
    await transporter.sendMail({
      from: mailConfig.from,
      to: recipients,
      subject,
      html,
      attachments,
    });
    console.info("[flash-report/manual] emailed flash report", {
      propertyId: property.id,
      to: recipients,
      subject,
      pptxFilename,
      attachments: {
        pdfLinked: Boolean(pdfUrl),
        pngIncluded: Boolean(slidePngBuffer),
      },
    });
    return true;
  } catch (err) {
    console.error("[flash-report/manual] failed to send flash email", err);
    return false;
  }
}

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const propertyId = String(formData.get("propertyId") ?? "");
  const asOfDate = String(formData.get("asOfDate") ?? "");
  const emailBody = String(formData.get("emailBody") ?? "");
  const file = formData.get("file");

  if (!propertyId) {
    return NextResponse.json({ error: "propertyId is required" }, { status: 400 });
  }

  if (!asOfDate) {
    return NextResponse.json({ error: "asOfDate is required" }, { status: 400 });
  }

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }

  const workbookBuffer = await file.arrayBuffer();
  const workbook = new ExcelJS.Workbook();

  try {
    await workbook.xlsx.load(workbookBuffer);
  } catch (err) {
    console.error("[flash-report/manual] unable to read workbook", err);
    return NextResponse.json({ error: "Uploaded file is not a valid XLSX workbook." }, { status: 400 });
  }

  const msrSheet = workbook.getWorksheet("MSR");
  const delinquenciesSheet = workbook.getWorksheet("Delinquencies");

  if (!msrSheet) {
    return NextResponse.json({ error: 'Workbook is missing required "MSR" worksheet.' }, { status: 400 });
  }

  if (!delinquenciesSheet) {
    return NextResponse.json({ error: 'Workbook is missing required "Delinquencies" worksheet.' }, { status: 400 });
  }

  let tokens: TokenMap;
  try {
    tokens = buildTokenMap(msrSheet, delinquenciesSheet);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unable to read workbook cells.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const properties = await listProperties();
  const property = properties.find((p) => p.id === propertyId || p.propertyId === propertyId);
  if (!property) {
    return NextResponse.json({ error: "Unknown propertyId" }, { status: 404 });
  }
  const facilityOpenDate = property.facilityOpenDate;
  if (facilityOpenDate) {
    tokens.FACILITYOPENDATE = facilityOpenDate;
  }

  const [arAgingChartJpeg, occupancyChartJpeg] = await Promise.all([renderArAgingChart(tokens), renderOccupancyChart(tokens)]);

  const templatePath = path.join(process.cwd(), "public", "FLASHTEMPLATE.pptx");

  let templateBuffer: Buffer;
  try {
    templateBuffer = await fsp.readFile(templatePath);
  } catch (err) {
    console.error("[flash-report/manual] unable to read PPTX template", err);
    return NextResponse.json({ error: "Template file not found." }, { status: 500 });
  }

  const zip = new PizZip(templateBuffer);
  const heroImageSource = property.propertyImageData || property.imagePath || property.heroImageUrl;
  if (heroImageSource) {
    const heroImage = await loadImageBufferFromData(heroImageSource);
    if (heroImage) {
      zip.file("ppt/media/image2.jpeg", heroImage);
    }
  }
  zip.file("ppt/media/image3.jpeg", arAgingChartJpeg);
  zip.file("ppt/media/image4.jpeg", occupancyChartJpeg);
  scrubHiddenCharactersFromZip(zip);
  const rendered = await renderTokensIntoZip(zip, tokens);
  let slidePngBuffer: Buffer | null = null;
  let pdfBuffer: Buffer | null = null;
  try {
    slidePngBuffer = await convertPptxBufferToPngLocal(rendered);
  } catch (err) {
    console.error("[flash-report/manual] unable to convert PPTX to PNG (non-fatal)", err);
  }
  try {
    pdfBuffer = await convertPptxBufferToPdfLocal(rendered);
  } catch (err) {
    console.error("[flash-report/manual] unable to convert PPTX to PDF (non-fatal, link will be unavailable)", err);
  }

  const safePropertyId = propertyId.replace(/[^A-Za-z0-9._-]+/g, "_");
  const filename = `DailyFlash-${safePropertyId}-${asOfDate}.pptx`;
  const safeAsOfSegment = (asOfDate || "latest").replace(/[^0-9A-Za-z._-]+/g, "_");
  let pdfDownloadUrl: string | null = null;
  if (pdfBuffer) {
    if (storage) {
      const pdfPath = `flash_reports/${safeAsOfSegment}/${safePropertyId}-${safeAsOfSegment}.pdf`;
      try {
        await storage.file(pdfPath).save(pdfBuffer, {
          contentType: "application/pdf",
          resumable: false,
          metadata: { cacheControl: "private,max-age=0" },
        });
        const [signedUrl] = await storage
          .file(pdfPath)
          .getSignedUrl({ action: "read", expires: Date.now() + 7 * 24 * 60 * 60 * 1000 });
        pdfDownloadUrl = signedUrl;
      } catch (err) {
        console.warn("[flash-report/manual] unable to store or sign pdf", { pdfPath }, err);
      }
    } else {
      console.warn("[flash-report/manual] storage not configured; cannot host pdf");
    }
  }

  try {
    const devMode = await getFlashDevMode();
    await sendFlashReportEmail(
      property,
      filename,
      asOfDate,
      tokens,
      slidePngBuffer,
      pdfDownloadUrl,
      emailBody,
      devMode,
    );
  } catch (err) {
    console.error("[flash-report/manual] email delivery failed (non-fatal)", err);
  }

  return new NextResponse(rendered as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

function buildTokenMap(msrSheet: ExcelJS.Worksheet, delinquenciesSheet: ExcelJS.Worksheet): TokenMap {
  const propertyDisplayName = readString(msrSheet, "K1", "Property display name (MSR!K1)");
  const [facilityCode, facilityShortName] = deriveFacilitySegments(propertyDisplayName);
  const asOfDateCell = readDate(msrSheet, "A3", "As-of date (MSR!A3)");

  const mtdRentals = readNumber(msrSheet, "E61", "MTD rentals (MSR!E61)");
  const netsqftmtd = readNumber(msrSheet, "E70", "Net SQ FT Activity	(MSR!E70)");
  const dailyRentals = readNumber(msrSheet, "D61", "Daily rentals (MSR!D61)");
  const dailyReservations = readNumber(msrSheet, "D65", "Daily reservations (MSR!D65)");
  const rybtmi = readNumber(msrSheet, "F61", "YTD move-ins (MSR!F61)");
  const mtdVacates = readNumber(msrSheet, "E62", "MTD vacates (MSR!E62)");
  const dailyVacates = readNumber(msrSheet, "D62", "Daily vacates (MSR!D62)");
  const mtdNetRentals = readNumber(msrSheet, "E63", "MTD net rentals (MSR!E63)");
  const webLeadsMtd = readNumber(msrSheet, "M47", "Web leads MTD (MSR!M47)");
  const walkInLeadsMtd = readNumber(msrSheet, "M48", "Walk-in leads MTD (MSR!M48)");
  const phoneLeadsMtd = readNumber(msrSheet, "M49", "Phone leads MTD (MSR!M49)");
  const otherLeadsMtd = readNumber(msrSheet, "M50", "Other leads MTD (MSR!M50)");
  const leadsMtd = webLeadsMtd + walkInLeadsMtd + phoneLeadsMtd + otherLeadsMtd;
  const convRaw = readNumber(msrSheet, "O10", "Lead conversion % (MSR!O10)");
  const conv = formatPercent(convRaw);

  const totalRsf = readNumber(msrSheet, "M44", "Total RSF (MSR!M44)");
  const occRsf = readNumber(msrSheet, "M41", "Occupied RSF (MSR!M41)");
  const rsfOccPct = formatToTwo(readNumber(msrSheet, "N41", "RSF occupancy % (MSR!N41)"));
  const occUnits = readNumber(msrSheet, "K41", "Occupied units (MSR!K41)");
  const pmOccUnits = occUnits - mtdNetRentals;
  const coverage = formatPercent(readNumber(msrSheet, "N14", "Coverage enrollment % (MSR!N14)"));

  const totalArAll = formatToTwo(readNumber(msrSheet, "F47", "AR Balance (All leases) (MSR!F47)"));
  const ar30Plus = formatToTwo(sumArOverDays(delinquenciesSheet, 30));
  const ar60Plus = formatToTwo(sumArOverDays(delinquenciesSheet, 60));
  const arOver30Pct = formatPercent(totalArAll > 0 ? ar30Plus / totalArAll : 0);
  const arOver60Pct = formatPercent(totalArAll > 0 ? ar60Plus / totalArAll : 0);

  const occPctSqft = formatToTwo(readNumber(msrSheet, "E8", "SQ FT occupancy % (MSR!E8)"));
  const occPctSpaces = formatToTwo(readNumber(msrSheet, "E9", "Spaces occupancy % (MSR!E9)"));
  const occPctEcon = formatToTwo(readNumber(msrSheet, "E10", "Economic occupancy % (MSR!E10)"));

  const arAgingTokens: Record<string, number> = {
    ARAGING_0_10: formatToTwo(readNumber(msrSheet, "L72", "AR Aging 0-10 (MSR!L72)")),
    ARAGING_11_30: formatToTwo(readNumber(msrSheet, "L73", "AR Aging 11-30 (MSR!L73)")),
    ARAGING_31_60: formatToTwo(readNumber(msrSheet, "L74", "AR Aging 31-60 (MSR!L74)")),
    ARAGING_61_90: formatToTwo(readNumber(msrSheet, "L75", "AR Aging 61-90 (MSR!L75)")),
    ARAGING_91_120: formatToTwo(readNumber(msrSheet, "L76", "AR Aging 91-120 (MSR!L76)")),
    ARAGING_121_180: formatToTwo(readNumber(msrSheet, "L77", "AR Aging 121-180 (MSR!L77)")),
    ARAGING_181_360: formatToTwo(readNumber(msrSheet, "L78", "AR Aging 181-360 (MSR!L78)")),
    ARAGING_361_PLUS: formatToTwo(readNumber(msrSheet, "L79", "AR Aging 361+ (MSR!L79)")),
  };

  const projRent = readNumber(msrSheet, "L32", "Projected rent (MSR!L32)");
  const projRentPerSf = readNumber(msrSheet, "K32", "Projected rent per SF (MSR!K32)");
  const gpr = readNumber(msrSheet, "L26", "Gross potential rent (MSR!L26)");
  const gprPerSf = readNumber(msrSheet, "K26", "GPR per SF (MSR!K26)");
  const grossPotRentSf = readNumber(msrSheet, "N26", "Gross potential rent per SF (MSR!N26)");
  const grossVacantRevenue = readNumber(msrSheet, "I28", "Gross Vacant Revenue (MSR!I28)");
  const avgSfVaca = readNumber(msrSheet, "L38", "Average SF Vacant (MSR!L38)");
  const econOccPct = formatToTwo(readNumber(msrSheet, "J32", "Economic occupancy % (MSR!J32)"));
  const effPotRent = projRent + grossVacantRevenue;
  const effRentSf = totalRsf > 0 ? effPotRent / totalRsf : 0;

  return {
    PROPERTYDISPLAYNAME: propertyDisplayName,
    FACILITYCODE: facilityCode,
    FACILITYSHORTNAME: facilityShortName,
    ASOFDATE: formatDate(asOfDateCell),
    MTDRENTALS: mtdRentals,
    DAILYRENTALS: dailyRentals,
    DAILYRES: dailyReservations,
    RYTBMI: rybtmi,
    LEADSMTD: leadsMtd,
    CONV: conv,
    MTDVACATES: mtdVacates,
    DAILYVACATES: dailyVacates,
    MTDNETRENTALS: mtdNetRentals,
    TOTALRSF: formatNumberWithCommas(totalRsf),
    OCCRSF: formatNumberWithCommas(occRsf),
    RSFOCCPCT: formatPercent(rsfOccPct),
    OCCUNITS: occUnits,
    COVERAGE: coverage,
    PMOCCUNITS: pmOccUnits,
    MOMOCCGROWTHPCT: formatPercent(0),
    TOTALARALL: formatCurrency(totalArAll),
    AR30PLUS: formatCurrency(ar30Plus),
    AROVER30DAYSPCT: arOver30Pct,
    AROVER60DAYSPCT: arOver60Pct,
    NETSQFTACTMTD: formatNumberWithCommas(netsqftmtd),
      PROJRENT: formatCurrency(projRent),
      PROJRENTPERSF: formatCurrency(projRentPerSf),
      PROJRENTMOMPCT: formatPercent(0),
      GROSSPOTRENT: formatCurrency(gpr),
      GROSSPOTSFT: formatCurrency(grossPotRentSf),
      GROSSPOTRENTSF: formatCurrency(grossPotRentSf), // alias for template variations
      GPRPERSF: formatCurrency(gprPerSf),
      GPRMOMPCT: formatPercent(0),
      EFFPOTRENT: formatCurrency(effPotRent),
      EFFRENTSF: formatCurrency(effRentSf),
      EFFRENTPERSF: formatCurrency(effRentSf), // alias for template variations
      AVGSFVACA: formatCurrency(avgSfVaca),
      AVGRENTVACANTSF: formatCurrency(avgSfVaca), // alias for template variations
      ECONOCCPCT: formatPercent(econOccPct),
      OCCPCT_SQFT: occPctSqft,
      OCCPCT_SPACES: occPctSpaces,
    OCCPCT_ECON: occPctEcon,
    ...arAgingTokens,
    RENTALSBYMONTHSERIES: [],
    VACATESBYMONTHSERIES: [],
    RSFOCCUPANCYBYMONTHSERIES: [],
    PROJECTEDRENTALREVENUESERIES: [],
    FACILITYOPENDATE: "",
  };
}

function deriveFacilitySegments(input: string): [string, string] {
  if (!input.includes(" - ")) {
    return [input, input];
  }
  const [code, name] = input.split(" - ");
  return [code?.trim() ?? input, name?.trim() ?? input];
}

function readString(sheet: ExcelJS.Worksheet, address: string, label: string): string {
  const value = normalizeCellValue(sheet.getCell(address).value);
  if (value == null) {
    throw new Error(`${label} is missing.`);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) throw new Error(`${label} is empty.`);
    return trimmed;
  }
  if (typeof value === "number" || value instanceof Date || typeof value === "boolean") {
    return String(value);
  }
  throw new Error(`${label} is invalid.`);
}

function readNumber(sheet: ExcelJS.Worksheet, address: string, label: string): number {
  const value = normalizeCellValue(sheet.getCell(address).value);
  if (value == null) {
    throw new Error(`${label} is missing.`);
  }
  const numeric = coerceNumber(value);
  if (!Number.isFinite(numeric)) {
    throw new Error(`${label} is not a number.`);
  }
  return numeric;
}

function readDate(sheet: ExcelJS.Worksheet, address: string, label: string): Date {
  const value = normalizeCellValue(sheet.getCell(address).value);
  if (value == null) {
    throw new Error(`${label} is missing.`);
  }
  if (value instanceof Date) return value;
  if (typeof value === "number" && Number.isFinite(value)) {
    return excelSerialDateToJsDate(value);
  }
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }
  throw new Error(`${label} is not a valid date.`);
}

function sumArOverDays(sheet: ExcelJS.Worksheet, minDays: number): number {
  let total = 0;
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // header row
    const days = coerceNumber(normalizeCellValue(row.getCell("D").value));
    const amount = coerceNumber(normalizeCellValue(row.getCell("E").value));
    if (Number.isFinite(days) && Number.isFinite(amount) && days >= minDays) {
      total += amount;
    }
  });
  return total;
}

function formatToTwo(value: number): number {
  if (!Number.isFinite(value)) return value;
  const factor = 100;
  return Math.round(value * factor) / factor;
}

function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return "";
  return `${formatToTwo(value)}%`;
}

function formatCurrency(value: number): string {
  if (!Number.isFinite(value)) return "";
  return value.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatNumberWithCommas(value: number): string {
  if (!Number.isFinite(value)) return "";
  return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function normalizeCellValue(value: ExcelJS.CellValue): ExcelJS.CellValue | null {
  if (value && typeof value === "object" && "result" in value && value.result != null) {
    return value.result as ExcelJS.CellValue;
  }
  return value ?? null;
}

function coerceNumber(value: ExcelJS.CellValue | null): number {
  if (value == null) return 0;
  if (typeof value === "number") return value;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string") {
    if (!value.trim()) return 0;
    const negative = /^\(.*\)$/.test(value);
    const cleaned = value.replace(/[,$\s]/g, "").replace(/%/g, "");
    const parsed = Number(cleaned);
    if (!Number.isFinite(parsed)) return Number.NaN;
    return negative ? -parsed : parsed;
  }
  return Number.NaN;
}

function excelSerialDateToJsDate(serial: number): Date {
  const epoch = new Date(Date.UTC(1899, 11, 30));
  const date = new Date(epoch.getTime() + serial * 24 * 60 * 60 * 1000);
  return date;
}

function formatDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const year = date.getFullYear();
  return `${month}/${day}/${year}`;
}

function scrubHiddenCharactersFromZip(zip: PizZip): void {
  const xmlPaths = Object.keys(zip.files).filter((filename) => filename.startsWith("ppt/") && filename.endsWith(".xml") && !filename.startsWith("ppt/embeddings/"));
  for (const filename of xmlPaths) {
    const file = zip.file(filename);
    if (!file) continue;
    const original = file.asText();
    const sanitized = normalizeTemplateXml(original);
    if (sanitized !== original) {
      zip.file(filename, sanitized);
    }
  }
}

const TOKEN_SPAN_PATTERN = /\{\{[\s\S]*?\}\}/g;
const XML_TAG_PATTERN = /<[^>]+>/g;

function normalizeTemplateXml(xml: string): string {
  const withoutHidden = stripHiddenTokenCharacters(xml);
  return withoutHidden.replace(TOKEN_SPAN_PATTERN, (segment) => {
    const withoutTags = segment.replace(XML_TAG_PATTERN, "");
    const tokenText = withoutTags.replace(/[{}]/g, "").replace(/\s+/g, "");
    if (!tokenText) return segment;
    return `{{${tokenText}}}`;
  });
}

async function renderTokensIntoZip(zip: PizZip, tokens: TokenMap): Promise<Buffer> {
  const normalizedTokens: Record<string, string> = {};
  for (const [key, value] of Object.entries(tokens)) {
    const normalizedKey = normalizeKey(key);
    if (!normalizedKey) continue;
    if (value == null) {
      normalizedTokens[normalizedKey] = "";
      continue;
    }
    normalizedTokens[normalizedKey] = typeof value === "number" ? String(value) : String(value);
  }

  const pptXmlPaths = Object.keys(zip.files).filter(
    (filename) => filename.startsWith("ppt/") && filename.endsWith(".xml") && !filename.startsWith("ppt/embeddings/"),
  );
  for (const filename of pptXmlPaths) {
    const file = zip.file(filename);
    if (!file) continue;
    const original = file.asText();
    const replaced = replaceTokensInContent(original, normalizedTokens);
    if (replaced !== original) {
      zip.file(filename, replaced);
    }
    logTokenReplacement(filename, original, replaced);
  }

  await processEmbeddedWorkbooks(zip, normalizedTokens);

  return zip.generate({ type: "nodebuffer" });
}

function replaceTokensInContent(content: string, normalizedTokens: Record<string, string>): string {
  return content.replace(/{{\s*([^{}]+?)\s*}}/g, (match, rawKey) => {
    const key = normalizeKey(String(rawKey));
    if (!key) return "";
    const value = normalizedTokens[key];
    return value ?? "";
  });
}

function logTokenReplacement(filename: string, original: string, replaced: string): void {
  const markers = {
    ARAGING_0_10: original.includes("{{ARAGING_0_10}}"),
    OCCPCT_SQFT: original.includes("{{OCCPCT_SQFT}}"),
  };
  const didReplace = original !== replaced;
  console.log(
    `[renderTokensIntoZip] processed ${filename} | markers(araging=${markers.ARAGING_0_10}, occ=${markers.OCCPCT_SQFT}) | replaced=${didReplace}`
  );
}

async function processEmbeddedWorkbooks(zip: PizZip, normalizedTokens: Record<string, string>): Promise<void> {
  const embeddedPaths = Object.keys(zip.files).filter(
    (p) => p.startsWith("ppt/embeddings/") && p.endsWith(".xlsx"),
  );
  console.debug("[embedded] workbooks:", embeddedPaths);

  for (const embeddedPath of embeddedPaths) {
    console.debug("[embedded] processing", embeddedPath);
    const file = zip.file(embeddedPath);
    if (!file) continue;
    const buffer =
      typeof file.asUint8Array === "function"
        ? file.asUint8Array()
        : file.asNodeBuffer
          ? file.asNodeBuffer()
          : new Uint8Array(Buffer.from(file.asBinary(), "binary"));
    const workbookZip = new PizZip(buffer);
    const innerXmlPaths = Object.keys(workbookZip.files).filter(
      (innerPath) => innerPath.startsWith("xl/") && innerPath.endsWith(".xml"),
    );
    let mutated = false;
    for (const innerPath of innerXmlPaths) {
      const workbookFile = workbookZip.file(innerPath);
      if (!workbookFile) continue;
      const original = workbookFile.asText();
      if (original.includes("{{ARAGING_0_10}}") || original.includes("{{OCCPCT_SQFT}}")) {
        console.debug("[embedded] found markers in", `${embeddedPath}:${innerPath}`);
      }
      const replaced = replaceTokensInContent(original, normalizedTokens);
      if (replaced !== original) {
        workbookZip.file(innerPath, replaced);
        mutated = true;
        console.debug("[embedded] replaced tokens in", `${embeddedPath}:${innerPath}`);
      }
    }
    if (mutated) {
      const updatedBuffer = workbookZip.generate({ type: "uint8array" });
      zip.file(embeddedPath, updatedBuffer);
    }
  }
}

function normalizeKey(key: string): string {
  return stripHiddenTokenCharacters(key).replace(/\s+/g, "").toUpperCase();
}

