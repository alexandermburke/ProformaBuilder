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

type CronFlashBody = {
  reportDate?: string;
  propertyCodes?: string[];
  sendEmails?: boolean | string;
};

const handle = async (request: NextRequest): Promise<NextResponse> => {
  const started = Date.now();
  console.info("[cron/daily-flash] received", {
    method: request.method,
    ua: request.headers.get("user-agent") ?? "",
  });
  try {
    if (!authorize(request)) {
      console.warn("[cron/daily-flash] unauthorized");
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    let body: CronFlashBody = {};
    if (request.method === "POST") {
      try {
        body = ((await request.json()) as CronFlashBody) ?? {};
      } catch (err) {
        console.error("[cron/daily-flash] body parse failed", err);
        body = {};
      }
    }

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

    console.info("[cron/daily-flash] dispatching", { reportDate, sendEmails, propertyCodes: body.propertyCodes ?? [] });
    const res = await runAutoFlash(proxyRequest);
    const durationMs = Date.now() - started;

    if (res.status >= 400) {
      let detail: unknown = null;
      try {
        detail = await res.clone().json();
      } catch {
        try {
          detail = await res.clone().text();
        } catch {
          detail = null;
        }
      }
      console.error("[cron/daily-flash] completed with error", { status: res.status, durationMs, detail });
    } else {
      console.info("[cron/daily-flash] completed", { status: res.status, durationMs });
    }
    return res;
  } catch (err) {
    console.error("[cron/daily-flash] failed", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unexpected error during daily flash cron" },
      { status: 500 },
    );
  }
};

// Vercel Cron example:
// - Path: /api/cron/daily-flash · Method: GET/POST · Header x-cron-secret: <CRON_SECRET> · Schedule: 15 16 * * * (09:15 MST)
export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
