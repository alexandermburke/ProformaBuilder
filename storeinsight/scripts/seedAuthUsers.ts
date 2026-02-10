import crypto from "node:crypto";
import path from "node:path";
import dotenv from "dotenv";
import { AUTH_USERS_COLLECTION, AUTH_USERS_ENV } from "../src/lib/authConstants";

type Credential = {
  email: string;
  password: string;
};

dotenv.config({ path: path.join(process.cwd(), ".env.local") });

const normalizeEmail = (email: string): string => email.trim().toLowerCase();
const normalizePassword = (password: string): string => password.trim();

const PBKDF2_DIGEST = "sha256";
const PBKDF2_ITERATIONS = 120_000;
const PBKDF2_KEY_LENGTH = 32;

const createPasswordHash = (password: string): string => {
  const salt = crypto.randomBytes(16);
  const hash = crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, PBKDF2_KEY_LENGTH, PBKDF2_DIGEST);
  return `pbkdf2$${PBKDF2_DIGEST}$${PBKDF2_ITERATIONS}$${salt.toString("base64")}$${hash.toString(
    "base64",
  )}`;
};

const parseUsersFromEnv = (): Credential[] => {
  const raw = process.env[AUTH_USERS_ENV];
  if (!raw) return [];
  const entries = raw
    .split(/[\n\r,;]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  return entries
    .map((entry) => {
      const separatorIndex = entry.indexOf(":");
      if (separatorIndex <= 0) return null;
      const email = normalizeEmail(entry.slice(0, separatorIndex));
      const password = normalizePassword(entry.slice(separatorIndex + 1));
      if (!email || !password) return null;
      return { email, password };
    })
    .filter((item): item is Credential => Boolean(item && item.email && item.password));
};

const main = async (): Promise<void> => {
  const { firestore } = await import("../src/server/firebaseAdmin");
  if (!firestore) {
    console.error("[seed-auth-users] Firebase admin not initialized. Check FIREBASE_* env vars.");
    process.exit(1);
  }

  const users = parseUsersFromEnv();
  if (!users.length) {
    console.error(`[seed-auth-users] ${AUTH_USERS_ENV} is empty or invalid.`);
    process.exit(1);
  }

  console.log(`[seed-auth-users] Seeding ${users.length} users into ${AUTH_USERS_COLLECTION}...`);

  const batch = firestore.batch();
  const now = new Date();
  users.forEach((user) => {
    const docRef = firestore.collection(AUTH_USERS_COLLECTION).doc(user.email);
    batch.set(
      docRef,
      {
        email: user.email,
        passwordHash: createPasswordHash(user.password),
        updatedAt: now,
      },
      { merge: true },
    );
  });

  await batch.commit();
  console.log("[seed-auth-users] Done.");
};

main().catch((error) => {
  console.error("[seed-auth-users] Unhandled error:", error);
  process.exit(1);
});
