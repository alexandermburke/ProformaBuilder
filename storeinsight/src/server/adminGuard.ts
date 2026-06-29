import { cookies } from "next/headers";
import { firestore } from "@/server/firebaseAdmin";
import { SESSION_COOKIE_NAME, verifySessionTokenNode } from "@/lib/internalAuth";
import { isAdminEmail } from "@/lib/userRoles";
import { AUTH_USERS_COLLECTION } from "@/lib/authConstants";

/**
 * Server-only session + admin gating. An account is an admin if it is a
 * hard-coded bootstrap admin (see userRoles.ts) OR its authUsers doc has
 * role === "admin". The bootstrap admin always wins so the panel can never lock
 * everyone out.
 *
 * Crucially, authorization is re-validated against the live authUsers store on
 * every protected request (not just at login), so disabling or deleting an
 * account revokes access immediately rather than waiting for the session cookie
 * to expire.
 */

export type StoredUser = { exists: boolean; role: string | null; disabled: boolean };

export const getStoredUser = async (email: string): Promise<StoredUser> => {
  if (!firestore) return { exists: false, role: null, disabled: false };
  try {
    const snap = await firestore
      .collection(AUTH_USERS_COLLECTION)
      .doc(email.trim().toLowerCase())
      .get();
    if (!snap.exists) return { exists: false, role: null, disabled: false };
    const data = snap.data() ?? {};
    const role = typeof data.role === "string" ? data.role.trim().toLowerCase() : null;
    // Match login's truthy semantics (verifyFirestoreUser uses `if (user.disabled)`).
    return { exists: true, role, disabled: Boolean(data.disabled) };
  } catch (error) {
    console.warn("[admin-guard] failed to read auth user", error);
    return { exists: false, role: null, disabled: false };
  }
};

export const getStoredRole = async (email: string): Promise<string | null> =>
  (await getStoredUser(email)).role;

export const isAdminUser = async (email?: string | null): Promise<boolean> => {
  if (!email) return false;
  if (isAdminEmail(email)) return true; // bootstrap admin always wins
  const user = await getStoredUser(email);
  return user.exists && !user.disabled && user.role === "admin";
};

export const getSessionEmail = async (): Promise<string | null> => {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  return verifySessionTokenNode(token);
};

export type SessionContext = { email: string; active: boolean; isAdmin: boolean };

/**
 * Resolves the caller's session against the live authUsers store. `active` is
 * false when the account has been disabled or deleted since the cookie was
 * issued. The bootstrap admin is always active so it can never be locked out.
 */
export const resolveSession = async (): Promise<SessionContext | null> => {
  const email = await getSessionEmail();
  if (!email) return null;
  const normalized = email.trim().toLowerCase();
  if (isAdminEmail(normalized)) return { email: normalized, active: true, isAdmin: true };
  const user = await getStoredUser(normalized);
  const active = user.exists && !user.disabled;
  return { email: normalized, active, isAdmin: active && user.role === "admin" };
};

/**
 * Returns the normalized email of the calling admin, or null if the request is
 * not an authenticated, active admin. Use at the top of every admin-only route.
 */
export const requireAdminEmail = async (): Promise<string | null> => {
  const session = await resolveSession();
  return session && session.active && session.isAdmin ? session.email : null;
};
