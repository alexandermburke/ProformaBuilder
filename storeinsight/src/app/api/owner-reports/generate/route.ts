import fs from "node:fs/promises";
import path from "node:path";
import PizZip from "pizzip";
import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import nodemailer from "nodemailer";
import { buildOwnerPptx } from "@/lib/buildOwnerPptx";
import { extractOwnerFields } from "@/lib/extractOwnerFields";
import { toNumber } from "@/lib/compute";
import { extractBudgetTableFields, type BudgetTokenDetail } from "@/lib/extractBudget";
import {
  extractDelinquencyMetrics,
  type DelinquencyTokens,
} from "@/lib/extractDelinquency";
import { extractWebRateTokensFromAvailableSpaces } from "@/lib/extractAvailableSpaces";
import { computeOwnerPerformance, type OwnerPerformanceOptions } from "@/lib/ownerPerformance";
import { REQUIRED_DELINQUENCY_TOKENS } from "@/lib/pptTokens";
import type { OwnerFields } from "@/types/ownerReport";
import { listProperties } from "@/app/api/daily-summary/store";
import type { PropertyConfig } from "@/types/dailySummary";
import { extractPpcPerformanceTokens } from "@/lib/extractPpcPerformance";
import { extractMsrFlashTokens, type FlashMsrTokens } from "@/lib/extractMsrFlashTokens";
import { extractRepairTokens } from "@/lib/extractRepairs";

export const runtime = "nodejs";

const shouldLogDelinquencyTokens =
  process.env.NODE_ENV !== "production" || Boolean(process.env.DEBUG);

type MailerConfig = {
  host: string;
  port: number;
  user?: string;
  pass?: string;
  from: string;
};

const resolveMailerConfig = (): MailerConfig | null => {
  const host = process.env.SMTP_HOST;
  const portRaw = process.env.SMTP_PORT;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM || user;
  if (!host || !portRaw || !from) {
    console.info("[owner-reports] SMTP config missing; skipping email delivery");
    return null;
  }
  const port = Number(portRaw);
  if (!Number.isFinite(port)) {
    console.warn("[owner-reports] Invalid SMTP_PORT; skipping email delivery");
    return null;
  }
  return { host, port, user: user || undefined, pass: pass || undefined, from };
};

const logDelinquencyTokens = (tokens: DelinquencyTokens): void => {
  if (!shouldLogDelinquencyTokens) return;
  const payload: Record<string, string> = {};
  for (const token of REQUIRED_DELINQUENCY_TOKENS) {
    const key = token as keyof DelinquencyTokens;
    payload[token] = tokens[key];
  }
  console.debug("[delinq]", payload);
};

function listPptxTokens(buf: Buffer): string[] {
  try {
    const zip = new PizZip(buf);
    const files = Object.keys(zip.files).filter(
      (name) => name.startsWith("ppt/slides/slide") && name.endsWith(".xml"),
    );
    const tokens = new Set<string>();
    for (const file of files) {
      const xml = zip.file(file)?.asText() ?? "";
      for (const match of xml.matchAll(/\{\{([A-Z0-9_]+)\}\}/g)) {
        tokens.add(match[1]);
      }
    }
    return Array.from(tokens);
  } catch {
    return [];
  }
}

async function resolveProperty(propertyKey: string | null | undefined): Promise<PropertyConfig | null> {
  if (!propertyKey) return null;
  const key = propertyKey.trim();
  if (!key) return null;
  try {
    const properties = await listProperties();
    return (
      properties.find((p) => p.id === key) ??
      properties.find((p) => p.tenantPropertyId === key) ??
      null
    );
  } catch (err) {
    console.error("[owner-reports] unable to resolve property for email", err);
    return null;
  }
}

async function sendOwnerReportEmail(
  property: PropertyConfig,
  attachment: Buffer,
  filename: string,
  ownerValues: OwnerFields,
): Promise<boolean> {
  const mailConfig = resolveMailerConfig();
  if (!mailConfig) return false;
  const recipients = (property.ownerEmails ?? []).filter((email) => typeof email === "string" && email.trim().length > 0);
  if (!property.enabled) {
    console.info("[owner-reports] property disabled; skipping email delivery", property.id);
    return false;
  }
  if (recipients.length === 0) {
    console.info("[owner-reports] no ownerEmails configured; skipping email delivery", property.id);
    return false;
  }
  try {
    console.info("[owner-reports] preparing email delivery", {
      propertyId: property.id,
      to: recipients,
      host: mailConfig.host,
      port: mailConfig.port,
    });
    const transporter = nodemailer.createTransport({
      host: mailConfig.host,
      port: mailConfig.port,
      secure: mailConfig.port === 465,
      auth: mailConfig.user && mailConfig.pass ? { user: mailConfig.user, pass: mailConfig.pass } : undefined,
    });
    const subject = `Owner Report - ${property.name ?? property.id} (${ownerValues.CURRENTDATE || "Latest"})`;
    const text = [
      `Attached is the latest owner report for ${property.name || property.id}.`,
      ownerValues.CURRENTDATE ? `As of: ${ownerValues.CURRENTDATE}` : "",
      "",
      "This email was sent automatically from the Owner Reports generator.",
    ]
      .filter(Boolean)
      .join("\n");
    await transporter.sendMail({
      from: mailConfig.from,
      to: recipients,
      subject,
      text,
      attachments: [
        {
          filename,
          content: attachment,
          contentType:
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        },
      ],
    });
    console.info("[owner-reports] emailed owner report", {
      propertyId: property.id,
      to: recipients,
      subject,
    });
    return true;
  } catch (err) {
    console.error("[owner-reports] failed to send owner email", err);
    return false;
  }
}

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const file = form.get("file");
  const overrides = form.get("overrides");
  const budget = form.get("budget");
  const budgetTokensRaw = form.get("budgetTokens");
  const budgetOverridesRaw = form.get("budgetOverrides");
  const inventory = form.get("inventory");
  const propertyIdRaw = form.get("propertyId");
  const sendEmailRaw = form.get("sendEmail");
  const propertyKey =
    typeof propertyIdRaw === "string" && propertyIdRaw.trim().length > 0
      ? propertyIdRaw.trim()
      : null;
  const msr = form.get("msr");
  const msrTokensRaw = form.get("msrTokens");
  let propertyForEmail: PropertyConfig | null = null;
  if (propertyKey) {
    try {
      propertyForEmail = await resolveProperty(propertyKey);
    } catch (err) {
      console.error("[owner-reports] unable to resolve property for email", err);
    }
  }
  const iprc = form.get("iprc");
  const availableSpaces = form.get("availableSpacesFile");
  const repairsFile = form.get("repairsFile");
  const inventoryTokensRaw = form.get("inventoryTokens");
  const performanceOptionsRaw = form.get("performanceOptions");
  const ppcFile = form.get("ppcFile");

  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: "Upload an .xlsx file as 'file'." }, { status: 400 });
  }

  const loadFallbackBudget = async (): Promise<Buffer | null> => {
    try {
      const fallbackPath = path.join(process.cwd(), "public", "Budget.xlsx");
      const data = await fs.readFile(fallbackPath);
      return data;
    } catch {
      return null;
    }
  };

  const blobWithName = file as Blob & { name?: string };
  const filename = typeof blobWithName.name === "string" ? blobWithName.name : "report.xlsx";
  const buffer = Buffer.from(await file.arrayBuffer());
  const auto = extractOwnerFields(buffer, filename);

  let data: OwnerFields = auto;
  if (typeof overrides === "string" && overrides.trim()) {
    data = { ...auto, ...(JSON.parse(overrides) as Partial<OwnerFields>) } as OwnerFields;
  }

  let budgetBuffer: Buffer | undefined;
  if (budget instanceof Blob) {
    budgetBuffer = Buffer.from(await budget.arrayBuffer());
  }
  let inventoryBuffer: Buffer | undefined;
  if (inventory instanceof Blob) {
    inventoryBuffer = Buffer.from(await inventory.arrayBuffer());
  }
  let iprcText: string | undefined;
  if (iprc instanceof Blob) {
    const buffer = Buffer.from(await iprc.arrayBuffer());
    iprcText = buffer.toString("utf8");
  }
  let availableSpacesBuffer: Buffer | undefined;
  if (availableSpaces instanceof Blob) {
    availableSpacesBuffer = Buffer.from(await availableSpaces.arrayBuffer());
  }
  let repairsBuffer: Buffer | undefined;
  if (repairsFile instanceof Blob) {
    repairsBuffer = Buffer.from(await repairsFile.arrayBuffer());
  }
  let msrTokensFromFile: FlashMsrTokens | undefined;
  if (msr instanceof Blob) {
    try {
      const msrBuffer = Buffer.from(await msr.arrayBuffer());
      msrTokensFromFile = await extractMsrFlashTokens(msrBuffer);
    } catch (err) {
      console.warn("[owner-reports] Unable to parse MSR workbook", err);
    }
  }
  const ppcBuffers: Buffer[] = [];
  if (ppcFile instanceof Blob) {
    ppcBuffers.push(Buffer.from(await ppcFile.arrayBuffer()));
  }

  let budgetTokens: Record<string, number> | undefined;
  if (typeof budgetTokensRaw === "string" && budgetTokensRaw.trim()) {
    try {
      const parsed = JSON.parse(budgetTokensRaw) as Record<string, unknown>;
      const normalized: Record<string, number> = {};
      if (parsed && typeof parsed === "object") {
        for (const [token, value] of Object.entries(parsed)) {
          const numeric = toNumber(value);
          if (Number.isFinite(numeric)) {
            normalized[token] = numeric;
          }
        }
      }
      if (Object.keys(normalized).length > 0) {
        budgetTokens = normalized;
      }
    } catch (err) {
      console.error("[owner-reports] Unable to parse budget tokens", err);
    }
  }

  let budgetOverrides: Record<string, number> | undefined;
  if (typeof budgetOverridesRaw === "string" && budgetOverridesRaw.trim()) {
    try {
      const parsed = JSON.parse(budgetOverridesRaw) as Record<string, string>;
      const normalized: Record<string, number> = {};
      for (const [token, value] of Object.entries(parsed)) {
        const numeric = toNumber(value);
        if (Number.isFinite(numeric)) {
          normalized[token] = numeric;
        }
      }
      if (Object.keys(normalized).length > 0) {
        budgetOverrides = normalized;
      }
    } catch (err) {
      console.error("[owner-reports] Unable to parse budget overrides", err);
    }
  }

  let msrTokensFromClient: FlashMsrTokens | undefined;
  if (typeof msrTokensRaw === "string" && msrTokensRaw.trim()) {
    try {
      const parsed = JSON.parse(msrTokensRaw) as Record<string, unknown>;
      const normalized: FlashMsrTokens = {};
      for (const [token, value] of Object.entries(parsed ?? {})) {
        if (typeof value === "number" && Number.isFinite(value)) {
          normalized[token] = value;
        } else if (typeof value === "string" && value.trim().length > 0) {
          normalized[token] = value;
        }
      }
      if (Object.keys(normalized).length > 0) {
        msrTokensFromClient = normalized;
      }
    } catch (err) {
      console.error("[owner-reports] Unable to parse MSR tokens", err);
    }
  }

  let performanceTokens: Record<string, string | number> | undefined;
  let performanceOptions: OwnerPerformanceOptions | undefined;
  if (typeof performanceOptionsRaw === "string" && performanceOptionsRaw.trim()) {
    try {
      performanceOptions = JSON.parse(performanceOptionsRaw) as OwnerPerformanceOptions;
    } catch (err) {
      console.warn("[inventory] Unable to parse performance options", err);
    }
  }
  if (typeof inventoryTokensRaw === "string" && inventoryTokensRaw.trim()) {
    try {
      const parsed = JSON.parse(inventoryTokensRaw) as Record<string, unknown>;
      const normalized: Record<string, string | number> = {};
      for (const [token, value] of Object.entries(parsed ?? {})) {
        if (typeof value === "number" && Number.isFinite(value)) {
          normalized[token] = value;
        } else if (typeof value === "string" && value.trim().length > 0) {
          normalized[token] = value;
        }
      }
      if (Object.keys(normalized).length > 0) {
        performanceTokens = normalized;
      }
    } catch (err) {
      console.error("[inventory] Unable to parse performance tokens", err);
    }
  }

  const templatePath = path.join(process.cwd(), "public", "OWNERTEMPLATE.pptx");
  const templateBuffer = await fs.readFile(templatePath);
  const templateTokens = listPptxTokens(templateBuffer);

  let budgetDetails: Record<string, BudgetTokenDetail> | undefined;
  if (budgetBuffer) {
    try {
      const extraction = await extractBudgetTableFields(budgetBuffer, undefined);
      budgetTokens = extraction.tokens;
      budgetDetails = extraction.details;
    } catch (err) {
      console.error("[owner-reports] Unable to re-parse budget workbook on server", err);
    }
  } else {
    const fallback = await loadFallbackBudget();
    if (fallback) {
      try {
        const extraction = await extractBudgetTableFields(fallback, undefined);
        budgetTokens = extraction.tokens;
        budgetDetails = extraction.details;
        budgetBuffer = fallback;
        console.info("[owner-reports] applied fallback budget workbook from public/Budget.xlsx");
      } catch (err) {
        console.error("[owner-reports] Unable to parse fallback budget workbook", err);
      }
    }
  }

  if (inventoryBuffer) {
    try {
      const result = computeOwnerPerformance({
        hummingbirdWorkbook: inventoryBuffer,
        iprcCsvText: iprcText ?? "",
        options: performanceOptions,
      });
      if (result.ok) {
        performanceTokens = result.tokens;
      } else {
        console.warn("[inventory] Unable to re-parse performance inputs on server:", result.message);
      }
    } catch (err) {
      console.error("[inventory] Unable to parse performance inputs on server", err);
    }
  }

  let availableSpacesTokens: Record<string, string> | undefined;
  if (availableSpacesBuffer) {
    try {
      const workbook = XLSX.read(availableSpacesBuffer, { type: "buffer" });
      availableSpacesTokens = extractWebRateTokensFromAvailableSpaces(workbook);
    } catch (err) {
      console.warn("[available-spaces] Unable to parse Available Spaces workbook", err);
    }
  }

  let repairTokens: Record<string, string> | undefined;
  if (repairsBuffer) {
    try {
      repairTokens = extractRepairTokens(repairsBuffer);
    } catch (err) {
      console.warn("[repairs] Unable to parse Repair and Maintenance spreadsheet", err);
    }
  }

  try {
    const delinquency = extractDelinquencyMetrics(buffer);
    if (delinquency.ok) {
      performanceTokens = { ...(performanceTokens ?? {}), ...delinquency.tokens };
      logDelinquencyTokens(delinquency.tokens);
    } else {
      console.warn("[delinquency]", delinquency.message);
    }
  } catch (err) {
    console.error("[delinquency] Unable to parse delinquency metrics", err);
  }

  const budgetTokensNumeric = budgetTokens ?? {};
  console.log("[budget] detected", Object.keys(budgetTokensNumeric).length, "numeric tokens");

  // PPC performance tokens (IMPRE, CLICKS, CONV, COSCON) from the marketing sheet
  let ppcTokens: Record<string, string | number> | undefined;
  try {
  const buffersForPpc = ppcBuffers.length > 0 ? ppcBuffers : [buffer];
    const propertyHint =
      propertyForEmail?.name ||
      propertyForEmail?.propertyId ||
      propertyForEmail?.tenantPropertyId ||
      data?.ADDRESS ||
      propertyKey ||
      "";
    const ppcNumeric = extractPpcPerformanceTokens(buffersForPpc, propertyHint);
    if (ppcNumeric && Object.keys(ppcNumeric).length > 0) {
      ppcTokens = {};
      for (const [key, value] of Object.entries(ppcNumeric)) {
        ppcTokens[key] = typeof value === "number" && Number.isFinite(value) ? Number(value.toFixed(2)) : value;
      }
    }
  } catch (err) {
    console.warn("[owner-reports] PPC extraction failed", err);
  }

  if (propertyForEmail?.facilityOpenDate) {
    const acquired = String(propertyForEmail.facilityOpenDate).trim();
    if (acquired && (!data.ACQUIREDDATE || String(data.ACQUIREDDATE).trim().length === 0)) {
      data = { ...data, ACQUIREDDATE: acquired };
    }
  }

  const msrTokens = msrTokensFromFile ?? msrTokensFromClient;
  const combinedPerformanceTokens = {
    ...(performanceTokens ?? {}),
    ...(ppcTokens ?? {}),
    ...(msrTokens ?? {}),
    ...(repairTokens ?? {}),
  };

  const pptx = await buildOwnerPptx({
    templateBuffer,
    ownerValues: data,
    budgetTokensNumeric,
    budgetDetails,
    budgetOverrides,
    templateTokens,
    budgetBuffer: budgetBuffer ?? null,
    availableSpacesBuffer: availableSpacesBuffer ?? null,
    availableSpacesTokens,
    performanceTokens: combinedPerformanceTokens,
  });
  const outName = `Owner-Report-${data.CURRENTDATE || "report"}.pptx`;

  const sendEmail =
    typeof sendEmailRaw === "string"
      ? ["true", "1", "yes", "on"].includes(sendEmailRaw.trim().toLowerCase())
      : true;

  if (sendEmail) {
    if (propertyKey) {
      if (propertyForEmail) {
        try {
          await sendOwnerReportEmail(propertyForEmail, pptx, outName, data);
        } catch (err) {
          console.error("[owner-reports] owner email send failed (non-fatal)", err);
        }
      } else {
        console.info("[owner-reports] propertyId provided but not found; skipping email", propertyKey);
      }
    } else {
      console.info("[owner-reports] no propertyId provided; owner email not attempted");
    }
  } else {
    console.info("[owner-reports] owner email delivery disabled by request", { propertyId: propertyKey });
  }

  const pptxBytes = new Uint8Array(pptx);
  return new NextResponse(pptxBytes, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "Content-Disposition": `attachment; filename="${outName}"`,
      "Cache-Control": "no-store",
    },
  });
}
