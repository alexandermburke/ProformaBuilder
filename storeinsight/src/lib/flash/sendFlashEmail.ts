import nodemailer from "nodemailer";
import type Mail from "nodemailer/lib/mailer";
import type { PropertyConfig } from "@/types/dailySummary";
import type { TokenMap } from "./generateFlashFromMsr";

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
    console.info("[flash-email] SMTP config missing; skipping email delivery");
    return null;
  }
  const port = Number(portRaw);
  if (!Number.isFinite(port)) {
    console.warn("[flash-email] Invalid SMTP_PORT; skipping email delivery");
    return null;
  }
  return { host, port, user: user || undefined, pass: pass || undefined, from };
};

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (char) => {
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

const buildHtmlContent = (opts: {
  propertyLabel: string;
  customBody?: string;
  pdfUrl?: string | null;
}): string => {
  const bodySection =
    opts.customBody && opts.customBody.trim()
      ? `<div style="margin: 12px 0 16px 0; padding: 12px; background: rgba(37,99,235,0.06); border: 1px solid rgba(37,99,235,0.16); border-radius: 10px; font-size: 12px; line-height: 1.45; color: #1f2937;">${escapeHtml(opts.customBody.trim()).replace(/\n/g, "<br />")}</div>`
      : "";
  return `
    ${bodySection}
  `;
};

export async function sendFlashEmail(options: {
  property: PropertyConfig;
  pptxBuffer: Buffer;
  pptxFilename: string;
  tokens?: TokenMap;
  reportDateDisplay?: string;
  customBody?: string;
  fromOverride?: string;
  slidePngBuffer?: Buffer;
  pdfBuffer?: Buffer | null;
  pdfFilename?: string | null;
  pngBuffer?: Buffer | null;
  pngFilename?: string | null;
  attachPptx?: boolean;
  devModeOverride?: boolean;
  pdfUrl?: string | null;
}): Promise<boolean> {
  const mailConfig = resolveMailerConfig();
  if (!mailConfig) return false;

  const devRecipient = "alex@storestorage.com";
  const recipientsRaw = (options.property.ownerEmails ?? []).filter((email) => email && email.trim().length > 0);
  const recipients =
    options.devModeOverride === true
      ? [devRecipient]
      : recipientsRaw;
  if (recipients.length === 0) {
    console.info("[flash-email] no ownerEmails configured; skipping email delivery", options.property.id);
    return false;
  }

  try {
    console.info("[flash-email] preparing email delivery", {
      propertyId: options.property.id,
      to: recipients,
      host: mailConfig.host,
      port: mailConfig.port,
      from: sanitizeFromAddress(options.fromOverride) || mailConfig.from,
      devMode: options.devModeOverride === true,
    });

    const transporter = nodemailer.createTransport({
      host: mailConfig.host,
      port: mailConfig.port,
      secure: mailConfig.port === 465,
      auth: mailConfig.user && mailConfig.pass ? { user: mailConfig.user, pass: mailConfig.pass } : undefined,
    });

    const propertyLabel =
      (options.tokens?.PROPERTYDISPLAYNAME as string) ||
      (options.tokens?.FACILITYSHORTNAME as string) ||
      options.property.name ||
      options.property.id;
    const reportDate = options.reportDateDisplay || (options.tokens?.ASOFDATE as string) || "";
    const subject = `Daily Flash - ${propertyLabel}${reportDate ? ` (${reportDate})` : ""}`;
    const inlinePng = options.slidePngBuffer?.length ? options.slidePngBuffer : options.pngBuffer || undefined;
    const baseContent = buildHtmlContent({ propertyLabel, customBody: options.customBody, pdfUrl: options.pdfUrl });
    const pdfUrlSafe = options.pdfUrl?.replace(/"/g, "%22");
    const downloadButton = pdfUrlSafe
      ? `<div style="margin: 14px 0 10px 0;"><a href="${pdfUrlSafe}" style="display: inline-flex; align-items: center; gap: 8px; padding: 11px 20px; border-radius: 999px; background: #0a84ff; color: #ffffff; text-decoration: none; font-weight: 700; font-size: 13px; letter-spacing: 0.01em; border: 1px solid #0a6fde; box-shadow: 0 6px 14px rgba(0,0,0,0.16); font-family: 'SF Pro Display','SF Pro Text','Helvetica Neue','Segoe UI',Arial,sans-serif;">Download full PDF</a></div>`
      : `<p style="margin: 10px 0 12px 0; font-size: 11px; color: #6b7280;">PDF download link unavailable.</p>`;
    const footer = `<p style="margin-top: 12px; margin-bottom: 10px; font-size: 11px; color: #6b7280;">This is an auto-generated email. For issues please email <a href="mailto:alex@storestorage.com" style="color: #2563eb; text-decoration: none;">alex@storestorage.com</a></p>`;
    const pngBlock =
      inlinePng && inlinePng.length
        ? `<div style="margin-top: 12px;"><img src="cid:flash-slide" style="max-width: 100%; height: auto; border: 1px solid #ccc;" /></div>`
        : "";
    const html = `
      <html>
        <body style="font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; font-size: 12px; color: #222; margin: 0; padding: 16px;">
          ${baseContent}
          ${pngBlock}
          ${footer}
          ${downloadButton}
        </body>
      </html>
    `;
    const fromAddress = sanitizeFromAddress(options.fromOverride) || mailConfig.from;
    const attachments: Mail.Attachment[] = [];

    if (inlinePng && inlinePng.length) {
      attachments.push({
        filename: options.pngFilename || "daily-flash.png",
        content: inlinePng,
        contentType: "image/png",
        cid: "flash-slide",
      });
    }

    const shouldAttachPptx = options.attachPptx === true;
    if (shouldAttachPptx) {
      attachments.push({
        filename: options.pptxFilename,
        content: options.pptxBuffer,
        contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      });
    }

    await transporter.sendMail({
      from: fromAddress,
      to: recipients,
      subject,
      html,
      attachments,
    });

    const propertyCode =
      (options.tokens?.FACILITYCODE as string) ||
      options.property.propertyCode ||
      options.property.tenantPropertyId ||
      options.property.id;
    console.info("[flash-email] emailed flash report", {
      propertyId: options.property.id,
      propertyCode,
      reportDate: reportDate || options.reportDateDisplay,
      to: recipients,
      subject,
      attachments: {
        pdfLinked: Boolean(options.pdfUrl),
        pngIncluded: Boolean(inlinePng && inlinePng.length),
        pptxIncluded: shouldAttachPptx,
      },
    });
    return true;
  } catch (err) {
    console.error("[flash-email] failed to send flash email", err);
    return false;
  }
}
