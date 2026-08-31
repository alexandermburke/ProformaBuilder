import { NextRequest, NextResponse } from "next/server";
import { authorizeCronRequest } from "@/lib/cronAuth";
import { POST as runAutoFlash } from "@/app/api/flash-report/auto/daily/route";

export const runtime = "nodejs";

const getTodayMstDate = (): string => getTodayMstDateFor(new Date());

function getTodayMstDateFor(date: Date): string {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Phoenix",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(date).reduce<Record<string, string>>((acc, part) => {
    if (part.type === "year" || part.type === "month" || part.type === "day") {
      acc[part.type] = part.value;
    }
    return acc;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

const isValidDate = (value: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(value);

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
    const auth = authorizeCronRequest(request);
    if (!auth.ok) {
      console.warn("[cron/daily-flash] unauthorized", { reason: auth.reason });
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
        respectSendTime: false,
      }),
    });

    console.info("[cron/daily-flash] dispatching", { reportDate, sendEmails, propertyCodes: body.propertyCodes ?? [] });
    const res = await runAutoFlash(proxyRequest);
    const durationMs = Date.now() - started;

    const responseClone = res.clone();
    const responseJson = await responseClone.json().catch(() => null);
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
      console.error("[cron/daily-flash] completed with error", {
        status: res.status,
        durationMs,
        detail,
        reportDate: (responseJson as { reportDate?: string })?.reportDate,
        propertiesProcessed: (responseJson as { propertiesProcessed?: unknown[] })?.propertiesProcessed?.length ?? null,
        propertiesSkipped: (responseJson as { propertiesSkipped?: unknown[] })?.propertiesSkipped?.length ?? null,
      });
    } else {
      console.info("[cron/daily-flash] completed", {
        status: res.status,
        durationMs,
        reportDate: (responseJson as { reportDate?: string })?.reportDate,
        propertiesProcessed: (responseJson as { propertiesProcessed?: unknown[] })?.propertiesProcessed?.length ?? null,
        propertiesSkipped: (responseJson as { propertiesSkipped?: unknown[] })?.propertiesSkipped?.length ?? null,
      });
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

// Vercel Cron:
// - Path: /api/cron/daily-flash · Method: GET/POST · Header x-cron-secret: <CRON_SECRET>
// - Schedule: 15 15 * * *, i.e. somewhere in 15:00-15:59 UTC on Hobby.
// - Depends on /api/cron/msr-ingest having run. That job is scheduled a full hour band
//   earlier for exactly this reason; see the scheduling note in its route file before
//   moving either one.
export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
