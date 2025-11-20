import { AUTH_SECRET_ENV } from "./authConstants";

const encoder = new TextEncoder();

const getSecret = (): string => {
  const secret = process.env[AUTH_SECRET_ENV];
  if (!secret || !secret.trim()) {
    throw new Error(`Missing ${AUTH_SECRET_ENV} in .env.local for internal auth.`);
  }
  return secret;
};

const toHex = (buffer: ArrayBuffer): string =>
  Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

const sign = async (payload: string): Promise<string> => {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(getSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return toHex(signature);
};

const timingSafeEqualString = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
};

export const verifySessionTokenEdge = async (token: string): Promise<string | null> => {
  const [email, expiresAtRaw, signature] = token.split(":");
  if (!email || !expiresAtRaw || !signature) return null;
  const expiresAt = Number(expiresAtRaw);
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return null;
  const payload = `${email}:${expiresAt}`;
  const expected = await sign(payload);
  if (!timingSafeEqualString(signature, expected)) return null;
  return email;
};
