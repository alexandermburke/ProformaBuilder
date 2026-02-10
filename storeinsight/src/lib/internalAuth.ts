import crypto from "crypto";
import {
  AUTH_SECRET_ENV,
  AUTH_USERS_COLLECTION,
  SESSION_COOKIE_NAME,
  SESSION_TTL_MS,
} from "./authConstants";
import { firestore } from "@/server/firebaseAdmin";

type StoredAuthUser = {
  email?: string;
  password?: string;
  passwordHash?: string;
  password_hash?: string;
  disabled?: boolean;
};

const PBKDF2_DIGEST = "sha256";
const PBKDF2_ITERATIONS = 120_000;
const PBKDF2_KEY_LENGTH = 32;

const normalizeEmail = (email: string): string => email.trim().toLowerCase();
const normalizePassword = (password: string): string => password.trim();

const parsePbkdf2Hash = (
  stored: string,
): { iterations: number; salt: Buffer; hash: string } | null => {
  if (!stored.startsWith("pbkdf2$")) return null;
  const parts = stored.split("$");
  if (parts.length !== 5) return null;
  const [, digest, iterationsRaw, saltBase64, hashBase64] = parts;
  if (digest !== PBKDF2_DIGEST) return null;
  const iterations = Number(iterationsRaw);
  if (!Number.isFinite(iterations) || iterations < 10_000) return null;
  if (!saltBase64 || !hashBase64) return null;
  try {
    const salt = Buffer.from(saltBase64, "base64");
    if (!salt.length) return null;
    return { iterations, salt, hash: hashBase64 };
  } catch {
    return null;
  }
};

const verifyPbkdf2Hash = (password: string, stored: string): boolean => {
  const parsed = parsePbkdf2Hash(stored);
  if (!parsed) return false;
  try {
    const derived = crypto.pbkdf2Sync(
      password,
      parsed.salt,
      parsed.iterations,
      PBKDF2_KEY_LENGTH,
      PBKDF2_DIGEST,
    );
    return timingSafeEqual(derived.toString("base64"), parsed.hash);
  } catch {
    return false;
  }
};

export const createPasswordHash = (password: string): string => {
  const salt = crypto.randomBytes(16);
  const hash = crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, PBKDF2_KEY_LENGTH, PBKDF2_DIGEST);
  return `pbkdf2$${PBKDF2_DIGEST}$${PBKDF2_ITERATIONS}$${salt.toString("base64")}$${hash.toString(
    "base64",
  )}`;
};

const getSecret = (): string => {
  const secret = process.env[AUTH_SECRET_ENV];
  if (!secret || !secret.trim()) {
    throw new Error(`Missing ${AUTH_SECRET_ENV} env for internal auth.`);
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

const fetchUserFromFirestore = async (normalizedEmail: string): Promise<StoredAuthUser | null> => {
  if (!firestore) return null;
  try {
    const docRef = firestore.collection(AUTH_USERS_COLLECTION).doc(normalizedEmail);
    const docSnap = await docRef.get();
    if (docSnap.exists) {
      return docSnap.data() as StoredAuthUser;
    }
    const querySnap = await firestore
      .collection(AUTH_USERS_COLLECTION)
      .where("email", "==", normalizedEmail)
      .limit(1)
      .get();
    if (!querySnap.empty) {
      return querySnap.docs[0]?.data() as StoredAuthUser;
    }
  } catch (error) {
    console.warn("[auth] Failed to read auth user from Firestore.", error);
  }
  return null;
};

const verifyFirestoreUser = (user: StoredAuthUser, normalizedPassword: string): boolean => {
  if (user.disabled) return false;
  const storedHash = user.passwordHash ?? user.password_hash;
  if (storedHash) {
    return verifyPbkdf2Hash(normalizedPassword, storedHash);
  }
  if (typeof user.password === "string") {
    return timingSafeEqual(user.password.trim(), normalizedPassword);
  }
  return false;
};

export const authenticateUser = async (email: string, password: string): Promise<boolean> => {
  const normalizedEmail = normalizeEmail(email);
  const normalizedPassword = normalizePassword(password);
  if (!normalizedEmail || !normalizedPassword) return false;
  if (!firestore) return false;
  const user = await fetchUserFromFirestore(normalizedEmail);
  if (!user) return false;
  return verifyFirestoreUser(user, normalizedPassword);
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
