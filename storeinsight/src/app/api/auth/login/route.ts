import { NextResponse } from "next/server";
import { authenticateUser, createSessionToken, SESSION_COOKIE_NAME, SESSION_TTL_MS } from "@/lib/internalAuth";

export async function POST(request: Request): Promise<Response> {
  const body = await request.json().catch(() => null);
  const email = body?.email;
  const password = body?.password;

  if (!email || !password) {
    return NextResponse.json({ ok: false, message: "Email and password are required." }, { status: 400 });
  }

  if (!authenticateUser(email, password)) {
    return NextResponse.json({ ok: false, message: "Invalid credentials." }, { status: 401 });
  }

  const token = createSessionToken(email);

  const response = NextResponse.json({ ok: true }, { status: 200 });
  response.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
    path: "/",
  });

  return response;
}
