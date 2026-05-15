import { createHash } from "node:crypto";
import nodemailer from "nodemailer";
import type Mail from "nodemailer/lib/mailer";
import type { PropertyConfig } from "@/types/dailySummary";
import type { TokenMap } from "./generateFlashFromMsr";
import { DASHBOARD_BETA_INVESTOR_ID, resolveDashboardEmailPropertyId } from "@/lib/flash/dashboardEmailConfig";
import { createShareLink } from "@/lib/shareLinks";

type MailerConfig = {
  host: string;
  port: number;
  user?: string;
  pass?: string;
  from: string;
  connectionTimeoutMs: number;
  greetingTimeoutMs: number;
  socketTimeoutMs: number;
  maxRetries: number;
  retryDelayMs: number;
};

const DASHBOARD_PUBLIC_ORIGIN = (() => {
  const candidates = [
    process.env.DASHBOARD_PUBLIC_ORIGIN,
    process.env.NEXT_PUBLIC_SITE_URL,
    process.env.NEXT_PUBLIC_APP_URL,
  ]
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter(Boolean);
  const safe = candidates.find((value) => !/localhost/i.test(value));
  return safe || "https://storeinternalplatform.com";
})();

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
  const connectionTimeoutMs = Number(process.env.SMTP_CONNECTION_TIMEOUT_MS ?? 20_000);
  const greetingTimeoutMs = Number(process.env.SMTP_GREETING_TIMEOUT_MS ?? 60_000);
  const socketTimeoutMs = Number(process.env.SMTP_SOCKET_TIMEOUT_MS ?? 120_000);
  const maxRetries = Number(process.env.SMTP_MAX_RETRIES ?? 2);
  const retryDelayMs = Number(process.env.SMTP_RETRY_DELAY_MS ?? 1_500);
  return {
    host,
    port,
    user: user || undefined,
    pass: pass || undefined,
    from,
    connectionTimeoutMs,
    greetingTimeoutMs,
    socketTimeoutMs,
    maxRetries: Number.isFinite(maxRetries) && maxRetries >= 0 ? maxRetries : 2,
    retryDelayMs: Number.isFinite(retryDelayMs) && retryDelayMs >= 0 ? retryDelayMs : 1_500,
  };
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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const isTransientSmtpError = (err: unknown): boolean => {
  if (!err || typeof err !== "object") return false;
  const code = "code" in err ? String((err as { code?: unknown }).code ?? "") : "";
  const command = "command" in err ? String((err as { command?: unknown }).command ?? "") : "";
  const responseCode = "responseCode" in err ? Number((err as { responseCode?: unknown }).responseCode) : NaN;

  if (["ETIMEDOUT", "ECONNRESET", "EAI_AGAIN", "ENOTFOUND", "ECONNREFUSED"].includes(code)) return true;
  if (["CONN", "STARTTLS"].includes(command)) return true;
  if (Number.isFinite(responseCode) && responseCode >= 400 && responseCode < 500) return true;
  return false;
};

const buildAppleEmailHtml = (opts: {
  propertyLabel: string;
  customBody?: string;
  pdfUrl?: string | null;
  dashboardUrl?: string | null;
  includeImage?: boolean;
}): string => {
  const bodySection =
    opts.customBody && opts.customBody.trim()
      ? `<div style="margin: 14px 0 18px 0; padding: 12px 14px; background: #f5f7ff; border: 1px solid #dbeafe; border-radius: 14px; font-size: 13px; line-height: 1.5; color: #1f2937;">${escapeHtml(opts.customBody.trim()).replace(/\n/g, "<br />")}</div>`
      : "";
  const pdfUrl = opts.pdfUrl?.replace(/"/g, "%22");
  const dashboardUrl = opts.dashboardUrl?.replace(/"/g, "%22");
  const pdfButton = pdfUrl
    ? `<a href="${pdfUrl}" class="cta-button cta-primary" style="display: block; width: 100%; box-sizing: border-box; padding: 12px 22px; border-radius: 999px; background: #0a84ff; color: #ffffff; text-decoration: none; font-weight: 700; font-size: 13px; letter-spacing: 0.01em; border: 1px solid #0a6fde; box-shadow: 0 8px 18px rgba(10,132,255,0.28); font-family: 'SF Pro Display','SF Pro Text','Helvetica Neue','Segoe UI',Arial,sans-serif; min-width: 180px; text-align: center;">View full PDF</a>`
    : "";
  const dashboardButton = dashboardUrl
    ? `<a href="${dashboardUrl}" class="cta-button cta-secondary" style="display: block; width: 100%; box-sizing: border-box; padding: 12px 22px; border-radius: 999px; background: #ffffff; color: #0a84ff; text-decoration: none; font-weight: 700; font-size: 13px; letter-spacing: 0.01em; border: 1px solid #0a84ff; box-shadow: 0 8px 18px rgba(15,23,42,0.08); font-family: 'SF Pro Display','SF Pro Text','Helvetica Neue','Segoe UI',Arial,sans-serif; min-width: 220px; text-align: center;">Historical Dashboard</a>`
    : "";
  const pdfFallback = pdfUrl
    ? ""
    : `<p style="margin: 8px 0 4px 0; font-size: 12px; color: #6b7280;">PDF download link unavailable.</p>`;
  const ctaButtons = [pdfButton, dashboardButton].filter((value) => value);
  const ctaRow = ctaButtons.length
    ? `
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" class="cta-table" style="margin-top: 14px; width: 100%; table-layout: fixed; border-collapse: separate;">
        <tr>
          ${ctaButtons
            .map((button) => {
              const width = ctaButtons.length === 1 ? "100%" : "50%";
              return `<td class="cta-col" width="${width}" align="center" style="padding: 0 8px 10px 8px; text-align: center; vertical-align: top;">${button}</td>`;
            })
            .join("")}
        </tr>
      </table>`
    : "";
  const includeImage = opts.includeImage !== false;
  const imageBlock = includeImage
    ? `<div style="margin-top: 12px; border-radius: 16px; overflow: hidden; border: 1px solid #e5e7eb;"><img src="cid:flash-slide" alt="Daily flash slide" style="display: block; width: 100%; height: auto; border: 0;" /></div>`
    : "";
  return `
    <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <style>
          .cta-table { width: 100% !important; }
          .cta-col { padding: 0 8px 10px 8px; }
          .cta-button { display: block !important; width: 100% !important; box-sizing: border-box !important; max-width: 100% !important; }
          @media (max-width: 560px) {
            .cta-col { display: block !important; width: 100% !important; padding-left: 12px !important; padding-right: 12px !important; }
            .cta-button { width: 100% !important; min-width: 0 !important; }
          }
          .cta-primary:hover { background: #0077ed !important; border-color: #0070e0 !important; }
          .cta-secondary:hover { background: #f1f5ff !important; }
          .cta-button:active { opacity: 0.92 !important; }
        </style>
      </head>
      <body style="margin: 0; padding: 0; background: #f2f2f7; -webkit-text-size-adjust: 100%; font-family: 'SF Pro Text','SF Pro Display',-apple-system,BlinkMacSystemFont,'Helvetica Neue','Segoe UI',Arial,sans-serif; color: #0f172a;">
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background: #f2f2f7; padding: 24px 12px;">
          <tr>
            <td align="center">
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width: 680px; background: #ffffff; border-radius: 24px; border: 1px solid #e5e7eb; box-shadow: 0 18px 40px rgba(15,23,42,0.08); overflow: hidden;">
                <tr>
                  <td style="padding: 24px 24px 10px 24px;">
                    <div style="font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: #94a3b8; font-weight: 600;">Daily Flash Report</div>
                    ${bodySection}
                    ${imageBlock}
                    <div style="height: 1px; background: #e5e7eb; margin: 20px 0 12px 0;"></div>
                    <div style="height: 8px;"></div>
                    ${pdfFallback}
                    ${ctaRow}
                    <p style="margin: 10px 0 0 0; font-size: 11px; color: #6b7280;">This is an auto-generated email. For issues please email <a href="mailto:alex@storestorage.com" style="color: #0a84ff; text-decoration: none;">alex@storestorage.com</a></p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `;
};

export type FlashEmailResult =
  | { ok: true }
  | { ok: false; reason: "smtp_missing" | "no_recipients" | "send_failed" };

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
  subjectOverride?: string;
}): Promise<FlashEmailResult> {
  const mailConfig = resolveMailerConfig();
  if (!mailConfig) return { ok: false, reason: "smtp_missing" };

  const devRecipient = "alex@storestorage.com";
  const recipientsRaw = (options.property.ownerEmails ?? []).filter((email) => email && email.trim().length > 0);
  const recipients =
    options.devModeOverride === true
      ? [devRecipient]
      : recipientsRaw;
  if (recipients.length === 0) {
    console.info("[flash-email] no ownerEmails configured; skipping email delivery", options.property.id);
    return { ok: false, reason: "no_recipients" };
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

    const propertyLabel =
      (options.tokens?.PROPERTYDISPLAYNAME as string) ||
      (options.tokens?.FACILITYSHORTNAME as string) ||
      options.property.name ||
      options.property.id;
    const reportDate = options.reportDateDisplay || (options.tokens?.ASOFDATE as string) || "";
    const subject =
      options.subjectOverride ??
      `Daily Flash - ${propertyLabel}${reportDate ? ` (${reportDate})` : ""}`;
    const inlinePng = options.slidePngBuffer?.length ? options.slidePngBuffer : options.pngBuffer || undefined;
    let dashboardUrl: string | null = null;
    const sharePropertyId = resolveDashboardEmailPropertyId(
      options.property.propertyId,
      options.property.id,
      options.property.propertyCode,
    );
    const useAppleStyle = Boolean(sharePropertyId);
    if (sharePropertyId) {
      try {
        // TODO: enforce unique viewer limit (5) when share link system supports it.
        const shareLink = await createShareLink(sharePropertyId, DASHBOARD_BETA_INVESTOR_ID);
        dashboardUrl = `${DASHBOARD_PUBLIC_ORIGIN}/dash/t/${shareLink.token}`;
        const tokenHashPrefix = createHash("sha256").update(shareLink.token).digest("hex").slice(0, 8);
        console.info("[flash-email] created dashboard link", {
          propertyId: sharePropertyId,
          shareId: shareLink.id,
          tokenHashPrefix,
          expiresAt: shareLink.expiresAt,
        });
      } catch (err) {
        console.warn("[flash-email] unable to create dashboard link", err);
      }
    }

    const html = useAppleStyle
      ? buildAppleEmailHtml({
          propertyLabel,
          customBody: options.customBody,
          pdfUrl: options.pdfUrl,
          dashboardUrl,
          includeImage: Boolean(inlinePng && inlinePng.length),
        })
      : (() => {
          const baseContent = buildHtmlContent({
            propertyLabel,
            customBody: options.customBody,
            pdfUrl: options.pdfUrl,
          });
          const pdfUrlSafe = options.pdfUrl?.replace(/"/g, "%22");
          const downloadButton = pdfUrlSafe
            ? `<div style="margin: 14px 0 10px 0;"><a href="${pdfUrlSafe}" style="display: inline-flex; align-items: center; gap: 8px; padding: 11px 20px; border-radius: 999px; background: #0a84ff; color: #ffffff; text-decoration: none; font-weight: 700; font-size: 13px; letter-spacing: 0.01em; border: 1px solid #0a6fde; box-shadow: 0 6px 14px rgba(0,0,0,0.16); font-family: 'SF Pro Display','SF Pro Text','Helvetica Neue','Segoe UI',Arial,sans-serif;">View full PDF</a></div>`
            : `<p style="margin: 10px 0 12px 0; font-size: 11px; color: #6b7280;">PDF download link unavailable.</p>`;
          const footer = `<p style="margin-top: 12px; margin-bottom: 10px; font-size: 11px; color: #6b7280;">This is an auto-generated email. For issues please email <a href="mailto:alex@storestorage.com" style="color: #2563eb; text-decoration: none;">alex@storestorage.com</a></p>`;
          const pngBlock =
            inlinePng && inlinePng.length
              ? `<div style="margin-top: 12px;"><img src="cid:flash-slide" style="max-width: 100%; height: auto; border: 1px solid #ccc;" /></div>`
              : "";
          return `
            <html>
              <body style="font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; font-size: 12px; color: #222; margin: 0; padding: 16px;">
                ${baseContent}
                ${pngBlock}
                ${footer}
                ${downloadButton}
              </body>
            </html>
          `;
        })();
    const fromAddress = sanitizeFromAddress(options.fromOverride) || mailConfig.from;
    const attachments: Mail.Attachment[] = [];

    if (options.pdfBuffer && options.pdfBuffer.length) {
      attachments.push({
        filename: options.pdfFilename || options.pptxFilename.replace(/\.pptx$/i, ".pdf"),
        content: options.pdfBuffer,
        contentType: "application/pdf",
      });
    }

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
    const maxAttempts = mailConfig.maxRetries + 1;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const transporter = nodemailer.createTransport({
          host: mailConfig.host,
          port: mailConfig.port,
          secure: mailConfig.port === 465,
          auth: mailConfig.user && mailConfig.pass ? { user: mailConfig.user, pass: mailConfig.pass } : undefined,
          connectionTimeout: mailConfig.connectionTimeoutMs,
          greetingTimeout: mailConfig.greetingTimeoutMs,
          socketTimeout: mailConfig.socketTimeoutMs,
        });

        await transporter.sendMail({
          from: fromAddress,
          to: recipients,
          subject,
          html,
          attachments,
        });
        break;
      } catch (err) {
        const transient = isTransientSmtpError(err);
        if (!transient || attempt >= maxAttempts) {
          throw err;
        }
        const delay = mailConfig.retryDelayMs * attempt;
        console.warn("[flash-email] transient smtp error, retrying", {
          attempt,
          maxAttempts,
          delayMs: delay,
          code: (err as { code?: string }).code,
          command: (err as { command?: string }).command,
        });
        await sleep(delay);
      }
    }

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
    return { ok: true };
  } catch (err) {
    console.error("[flash-email] failed to send flash email", err);
    return { ok: false, reason: "send_failed" };
  }
}
