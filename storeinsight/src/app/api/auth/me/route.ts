import { NextResponse } from "next/server";
import { resolveSession } from "@/server/adminGuard";

export async function GET(): Promise<Response> {
  // resolveSession re-checks the live authUsers store, so a disabled or deleted
  // account is rejected here even while its (still-signed) cookie is valid.
  const session = await resolveSession();
  if (!session || !session.active) {
    return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({
    ok: true,
    email: session.email,
    role: session.isAdmin ? "admin" : "user",
    isAdmin: session.isAdmin,
  });
}
