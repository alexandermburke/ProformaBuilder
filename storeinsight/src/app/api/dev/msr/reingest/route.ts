import { NextResponse } from "next/server";
import { runDailyMsrIngestion } from "@/lib/runDailyMsrIngestion";

const devEnabled = process.env.ENABLE_MSR_DEV_UI === "true" || process.env.NODE_ENV !== "production";

const isValidDate = (value: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(value);

export async function POST(request: Request) {
  if (!devEnabled) {
    return NextResponse.json({ error: "MSR dev tools are disabled" }, { status: 404 });
  }

  try {
    const body = (await request.json().catch(() => ({}))) as {
      date?: string;
      senderEmail?: string;
      subjectPhrase?: string;
      maxMessages?: number;
      userId?: string;
      allowedSenders?: string[];
    };

    const targetDateRaw = typeof body.date === "string" ? body.date.trim() : "";
    if (!isValidDate(targetDateRaw)) {
      return NextResponse.json({ error: "date (YYYY-MM-DD) is required" }, { status: 400 });
    }
    const targetDate = new Date(`${targetDateRaw}T12:00:00-07:00`);

    const senderEmail =
      typeof body.senderEmail === "string" && body.senderEmail.trim().length > 0
        ? body.senderEmail.trim()
        : process.env.MSR_DEV_DEFAULT_SENDER || "reports@tenantinc.com";
    const subjectPhrase =
      typeof body.subjectPhrase === "string" && body.subjectPhrase.trim().length > 0
        ? body.subjectPhrase.trim()
        : process.env.MSR_DEV_DEFAULT_SUBJECT || "Reports Delivery";
    const maxMessages =
      typeof body.maxMessages === "number" && Number.isFinite(body.maxMessages) && body.maxMessages > 0
        ? body.maxMessages
        : undefined;
    const userId = typeof body.userId === "string" && body.userId.trim().length > 0 ? body.userId.trim() : undefined;
    const allowedSenders =
      Array.isArray(body.allowedSenders) && body.allowedSenders.length > 0
        ? body.allowedSenders
        : (process.env.MSR_ALLOWED_SENDERS || "")
            .split(",")
            .map((v) => v.trim())
            .filter(Boolean);

    console.info("[dev/msr/reingest] starting", { targetDate: targetDateRaw, allowedSenders });
    const summary = await runDailyMsrIngestion({
      senderEmail,
      subjectPhrase,
      maxMessages,
      userId,
      processingDate: targetDate,
      allowedSenders,
    });
    console.info("[dev/msr/reingest] complete", summary);

    return NextResponse.json({ targetDate: targetDateRaw, ...summary });
  } catch (err) {
    console.error("[dev/msr/reingest] failed", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unexpected error during daily ingestion" },
      { status: 500 },
    );
  }
}
