import { NextRequest, NextResponse } from "next/server";
import { runDailyMsrIngestion } from "@/lib/runDailyMsrIngestion";

export const runtime = "nodejs";

const getTodayMstDate = (): string => {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Phoenix",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(now).reduce<Record<string, string>>((acc, part) => {
    if (part.type === "year" || part.type === "month" || part.type === "day") {
      acc[part.type] = part.value;
    }
    return acc;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
};

const isCronRequest = (req: NextRequest): boolean => req.headers.get("user-agent")?.toLowerCase().startsWith("vercel-cron") === true;

const authorize = (req: NextRequest): boolean => {
  const header = req.headers.get("x-cron-secret");
  const secret = process.env.CRON_SECRET;
  if (header != null) {
    return !!secret && header === secret;
  }
  if (isCronRequest(req)) {
    return true;
  }
  return false;
};

const handle = async (request: NextRequest): Promise<NextResponse> => {
  if (!authorize(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const reportDate = getTodayMstDate();
  try {
    const senderEmail = process.env.MSR_DEV_DEFAULT_SENDER || "reports@tenantinc.com";
    const subjectPhrase = process.env.MSR_DEV_DEFAULT_SUBJECT || "Reports Delivery";
    const allowedSenders = (process.env.MSR_ALLOWED_SENDERS || "")
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);

    const summary = await runDailyMsrIngestion({
      senderEmail,
      subjectPhrase,
      processingDate: new Date(),
      allowedSenders,
    });

    return NextResponse.json({
      reportDate,
      emailsProcessed: summary.emailsProcessed,
      propertiesIngested: summary.propertiesIngested,
      emailsWithErrors: summary.emailsWithErrors,
      mode: "scheduled",
    });
  } catch (err) {
    console.error("[cron/msr-ingest] failed", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unexpected error during MSR ingestion" },
      { status: 500 },
    );
  }
};

// Vercel Cron example:
// - Path: /api/cron/msr-ingest · Method: GET/POST · Header x-cron-secret: <CRON_SECRET> · Schedule: 15 15 * * * (08:15 MST)
export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
