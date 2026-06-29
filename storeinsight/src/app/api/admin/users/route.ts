import { NextRequest, NextResponse } from "next/server";
import { firestore } from "@/server/firebaseAdmin";
import { requireAdminEmail } from "@/server/adminGuard";
import { createPasswordHash } from "@/lib/internalAuth";
import { isAdminEmail } from "@/lib/userRoles";
import { AUTH_USERS_COLLECTION } from "@/lib/authConstants";

const MIN_PASSWORD_LENGTH = 8;
const VALID_ROLES = new Set(["admin", "user"]);

const normalizeEmail = (email: string): string => email.trim().toLowerCase();
// Constrained so the email is always a safe Firestore document id: no slashes,
// whitespace, or control characters (which would otherwise throw or nest docs).
const isValidEmail = (email: string): boolean => /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(email);
const normalizeRole = (value: unknown): "admin" | "user" | null => {
  if (typeof value !== "string") return null;
  const role = value.trim().toLowerCase();
  return VALID_ROLES.has(role) ? (role as "admin" | "user") : null;
};

const forbidden = () => NextResponse.json({ ok: false, message: "Forbidden" }, { status: 403 });
const badRequest = (message: string) => NextResponse.json({ ok: false, message }, { status: 400 });

type StoredUser = { email?: string; role?: string; disabled?: boolean; updatedAt?: unknown };

// Effective role for display: the bootstrap admin always reports "admin".
const effectiveRole = (email: string, data: StoredUser): "admin" | "user" =>
  isAdminEmail(email) || data.role?.trim().toLowerCase() === "admin" ? "admin" : "user";

export async function GET(): Promise<Response> {
  const admin = await requireAdminEmail();
  if (!admin) return forbidden();
  if (!firestore) return NextResponse.json({ ok: false, message: "Firestore unavailable" }, { status: 500 });

  try {
    const snap = await firestore.collection(AUTH_USERS_COLLECTION).get();
    const users = snap.docs
      .map((doc) => {
        const data = doc.data() as StoredUser;
        const email = normalizeEmail(data.email ?? doc.id);
        return {
          email,
          role: effectiveRole(email, data),
          disabled: Boolean(data.disabled),
          // never expose passwordHash
          protected: isAdminEmail(email),
        };
      })
      .sort((a, b) => a.email.localeCompare(b.email));
    return NextResponse.json({ ok: true, users, currentEmail: admin });
  } catch (error) {
    console.error("[admin/users] list failed", error);
    return NextResponse.json({ ok: false, message: "Unable to list users" }, { status: 500 });
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  const admin = await requireAdminEmail();
  if (!admin) return forbidden();
  if (!firestore) return NextResponse.json({ ok: false, message: "Firestore unavailable" }, { status: 500 });

  const body = (await req.json().catch(() => null)) as
    | { email?: string; password?: string; role?: string }
    | null;
  if (!body) return badRequest("Invalid request body.");

  const email = normalizeEmail(body.email ?? "");
  const password = (body.password ?? "").trim();
  const role = normalizeRole(body.role ?? "user");

  if (!email || !isValidEmail(email)) return badRequest("A valid email is required.");
  if (!role) return badRequest("Role must be 'admin' or 'user'.");
  if (password.length < MIN_PASSWORD_LENGTH) {
    return badRequest(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }

  try {
    const docRef = firestore.collection(AUTH_USERS_COLLECTION).doc(email);
    const existing = await docRef.get();
    if (existing.exists) return NextResponse.json({ ok: false, message: "User already exists." }, { status: 409 });
    await docRef.set({
      email,
      passwordHash: createPasswordHash(password),
      role,
      disabled: false,
      updatedAt: new Date(),
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[admin/users] create failed", error);
    return NextResponse.json({ ok: false, message: "Unable to create user" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest): Promise<Response> {
  const admin = await requireAdminEmail();
  if (!admin) return forbidden();
  if (!firestore) return NextResponse.json({ ok: false, message: "Firestore unavailable" }, { status: 500 });

  const body = (await req.json().catch(() => null)) as
    | { email?: string; password?: string; role?: string; disabled?: boolean }
    | null;
  if (!body) return badRequest("Invalid request body.");

  const email = normalizeEmail(body.email ?? "");
  if (!email || !isValidEmail(email)) return badRequest("A valid email is required.");

  const docRef = firestore.collection(AUTH_USERS_COLLECTION).doc(email);
  const snap = await docRef.get();
  if (!snap.exists) return NextResponse.json({ ok: false, message: "User not found." }, { status: 404 });

  const update: Record<string, unknown> = {};

  if (body.password !== undefined) {
    const password = String(body.password).trim();
    if (password.length < MIN_PASSWORD_LENGTH) {
      return badRequest(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    }
    // Only the primary admin may change the primary admin's password; otherwise
    // another admin could reset it and hijack/lock out that account.
    if (isAdminEmail(email) && email !== admin) {
      return badRequest("Only the primary admin can change the primary admin's password.");
    }
    update.passwordHash = createPasswordHash(password);
  }

  if (body.role !== undefined) {
    const role = normalizeRole(body.role);
    if (!role) return badRequest("Role must be 'admin' or 'user'.");
    // Lockout guards: never demote the bootstrap admin or yourself.
    if (role !== "admin" && isAdminEmail(email)) return badRequest("The primary admin cannot be demoted.");
    if (role !== "admin" && email === admin) return badRequest("You cannot remove your own admin role.");
    update.role = role;
  }

  if (body.disabled !== undefined) {
    const disabled = Boolean(body.disabled);
    if (disabled && isAdminEmail(email)) return badRequest("The primary admin cannot be disabled.");
    if (disabled && email === admin) return badRequest("You cannot disable your own account.");
    update.disabled = disabled;
  }

  if (Object.keys(update).length === 0) return badRequest("No changes provided.");
  update.updatedAt = new Date();

  try {
    await docRef.set(update, { merge: true });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[admin/users] update failed", error);
    return NextResponse.json({ ok: false, message: "Unable to update user" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest): Promise<Response> {
  const admin = await requireAdminEmail();
  if (!admin) return forbidden();
  if (!firestore) return NextResponse.json({ ok: false, message: "Firestore unavailable" }, { status: 500 });

  const email = normalizeEmail(req.nextUrl.searchParams.get("email") ?? "");
  if (!email || !isValidEmail(email)) return badRequest("A valid email is required.");
  if (email === admin) return badRequest("You cannot delete your own account.");
  if (isAdminEmail(email)) return badRequest("The primary admin cannot be deleted.");

  try {
    const docRef = firestore.collection(AUTH_USERS_COLLECTION).doc(email);
    const snap = await docRef.get();
    if (!snap.exists) return NextResponse.json({ ok: false, message: "User not found." }, { status: 404 });
    await docRef.delete();
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[admin/users] delete failed", error);
    return NextResponse.json({ ok: false, message: "Unable to delete user" }, { status: 500 });
  }
}
