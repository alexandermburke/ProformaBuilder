import { NextRequest, NextResponse } from "next/server";
import { authorizeCronRequest } from "@/lib/cronAuth";
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

const handle = async (request: NextRequest): Promise<NextResponse> => {
  const auth = authorizeCronRequest(request);
  if (!auth.ok) {
    console.warn("[cron/msr-ingest] unauthorized", { reason: auth.reason });
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

// Vercel Cron:
// - Path: /api/cron/msr-ingest · Method: GET/POST · Header x-cron-secret: <CRON_SECRET>
// - Schedule: 15 12 * * *
//
// SCHEDULING NOTE, do not tighten this without reading it. On Vercel's Hobby plan a cron
// fires anywhere inside its scheduled HOUR, not at the stated minute. So this job runs
// somewhere in 12:00-12:59 UTC and /api/cron/daily-flash runs somewhere in 15:00-15:59,
// which guarantees the flash starts at least an hour after the ingest even in the worst
// pairing. Tenant delivers the MSR emails between 08:15 and 09:10 UTC (measured over 30
// deliveries), so 12:00 still leaves the ingest nearly three hours of slack on the other
// side. An earlier version of this pair sat at 14:15 and 15:15, which could collapse to a
// one-minute gap and left the flash reading data the ingest had not finished writing.
export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
