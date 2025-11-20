import crypto from "crypto";
import { AUTH_SECRET_ENV, AUTH_USERS_ENV, SESSION_COOKIE_NAME, SESSION_TTL_MS } from "./authConstants";

type Credential = {
  email: string;
  password: string;
};

const parseUsersFromEnv = (): Credential[] => {
  const raw = process.env[AUTH_USERS_ENV];
  if (!raw) return [];
  return raw
    .split(/[;,]/)
    .map((entry) => {
      const [email, password] = entry.split(":");
      if (!email || !password) return null;
      return { email: email.trim().toLowerCase(), password: password.trim() };
    })
    .filter((item): item is Credential => Boolean(item && item.email && item.password));
};

const getSecret = (): string => {
  const secret = process.env[AUTH_SECRET_ENV];
  if (!secret || !secret.trim()) {
    throw new Error(`Missing ${AUTH_SECRET_ENV} in .env.local for internal auth.`);
  }
  return secret;
};

const timingSafeEqual = (a: string, b: string): boolean => {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  try {
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
};

const sign = (payload: string): string => crypto.createHmac("sha256", getSecret()).update(payload).digest("hex");

export const authenticateUser = (email: string, password: string): boolean => {
  const normalizedEmail = email.trim().toLowerCase();
  const normalizedPassword = password.trim();
  return parseUsersFromEnv().some(
    (user) => user.email === normalizedEmail && user.password === normalizedPassword,
  );
};

export const createSessionToken = (email: string): string => {
  const normalizedEmail = email.trim().toLowerCase();
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const payload = `${normalizedEmail}:${expiresAt}`;
  const signature = sign(payload);
  return `${normalizedEmail}:${expiresAt}:${signature}`;
};

export const verifySessionTokenNode = (token: string): string | null => {
  const [email, expiresAtRaw, signature] = token.split(":");
  if (!email || !expiresAtRaw || !signature) return null;
  const expiresAt = Number(expiresAtRaw);
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return null;
  const payload = `${email}:${expiresAt}`;
  const expected = sign(payload);
  if (!timingSafeEqual(signature, expected)) return null;
  return email;
};

export { SESSION_COOKIE_NAME, SESSION_TTL_MS };
