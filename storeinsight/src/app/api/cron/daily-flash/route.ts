import { NextRequest, NextResponse } from "next/server";
import { POST as runAutoFlash } from "@/app/api/flash-report/auto/daily/route";

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

const isValidDate = (value: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(value);

const isAuthorized = (req: NextRequest): boolean => {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("x-cron-secret");
  return header != null && header === secret;
};

// Vercel Cron example:
// - Path: /api/cron/daily-flash · Method: POST · Header x-cron-secret: <CRON_SECRET> · Schedule: 15 16 * * * (09:15 MST)
export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    reportDate?: string;
    propertyCodes?: string[];
    sendEmails?: boolean | string;
  };

  const providedDate =
    typeof body.reportDate === "string" && isValidDate(body.reportDate.trim()) ? body.reportDate.trim() : null;
  const reportDate = providedDate || getTodayMstDate();
  const sendEmails = body.sendEmails === undefined ? true : body.sendEmails === true || body.sendEmails === "true";

  const proxyRequest = new NextRequest(new URL("/api/flash-report/auto/daily", "http://localhost"), {
    method: "POST",
    headers: new Headers({ "content-type": "application/json" }),
    body: JSON.stringify({
      reportDate,
      propertyCodes: Array.isArray(body.propertyCodes) ? body.propertyCodes : undefined,
      sendEmails,
      mode: "scheduled",
    }),
  });

  return runAutoFlash(proxyRequest);
}
