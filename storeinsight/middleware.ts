import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE_NAME } from "@/lib/authConstants";
import { verifySessionTokenEdge } from "@/lib/edgeAuth";

const PUBLIC_PATHS = ["/login", "/signup", "/api/auth/login", "/api/auth/logout", "/health", "/dash/t"];
const TOKEN_ROUTE_PREFIX = "/dash/t";
const TOKEN_RATE_LIMIT_WINDOW_MS = 60_000;
const TOKEN_RATE_LIMIT_MAX = 30;
const tokenRateLimit = new Map<string, { count: number; resetAt: number }>();

const isPublic = (pathname: string): boolean =>
  PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));

const redirectToLogin = (request: NextRequest): NextResponse => {
  if (request.nextUrl.pathname.startsWith("/api")) {
    return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  }
  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("redirect", request.nextUrl.pathname + request.nextUrl.search);
  return NextResponse.redirect(loginUrl);
};

const getClientIp = (request: NextRequest): string => {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const [first] = forwarded.split(",");
    if (first) return first.trim();
  }
  return request.ip ?? "unknown";
};

const applyTokenHeaders = (response: NextResponse): NextResponse => {
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
};

const rateLimitTokenRoute = (request: NextRequest): NextResponse | null => {
  const now = Date.now();
  const ip = getClientIp(request);
  const existing = tokenRateLimit.get(ip);
  if (!existing || now > existing.resetAt) {
    tokenRateLimit.set(ip, { count: 1, resetAt: now + TOKEN_RATE_LIMIT_WINDOW_MS });
    return null;
  }
  if (existing.count >= TOKEN_RATE_LIMIT_MAX) {
    const retryAfter = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
    const response = NextResponse.json(
      { ok: false, message: "Too many requests. Please try again." },
      { status: 429 },
    );
    response.headers.set("Retry-After", retryAfter.toString());
    return applyTokenHeaders(response);
  }
  existing.count += 1;
  tokenRateLimit.set(ip, existing);
  return null;
};

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;
  const isTokenRoute = pathname.startsWith(TOKEN_ROUTE_PREFIX);

  if (isTokenRoute && process.env.NODE_ENV === "production") {
    const forwardedProto = request.headers.get("x-forwarded-proto");
    const protocol = forwardedProto ?? request.nextUrl.protocol.replace(":", "");
    if (protocol !== "https") {
      const url = request.nextUrl.clone();
      url.protocol = "https";
      return applyTokenHeaders(NextResponse.redirect(url));
    }
  }

  if (isTokenRoute) {
    const limited = rateLimitTokenRoute(request);
    if (limited) return limited;
  }

  if (
    isPublic(pathname) ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/static") ||
    pathname.startsWith("/api/cron/")
  ) {
    const response = NextResponse.next();
    return isTokenRoute ? applyTokenHeaders(response) : response;
  }

  const session = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!session) {
    return redirectToLogin(request);
  }

  const email = await verifySessionTokenEdge(session).catch(() => null);
  if (!email) {
    return redirectToLogin(request);
  }

  const response = NextResponse.next();
  return isTokenRoute ? applyTokenHeaders(response) : response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|gif|ico)).*)"],
};
