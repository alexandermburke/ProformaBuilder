/**
 * Manage internal auth users directly in Firestore (the `authUsers` collection).
 *
 * This replaces the AUTH_USERS env + seed workflow for adding/removing logins.
 * Passwords are stored as PBKDF2 hashes, exactly like the login route expects
 * (see src/lib/internalAuth.ts). Firebase service-account credentials still come
 * from .env.local because any Firestore access requires them; no USER credentials
 * live in env anymore.
 *
 * Usage:
 *   npx tsx scripts/manageAuthUsers.ts set <email> [password]   create or update (password hashed)
 *   npx tsx scripts/manageAuthUsers.ts list                     list all users
 *   npx tsx scripts/manageAuthUsers.ts disable <email>          block sign-in
 *   npx tsx scripts/manageAuthUsers.ts enable <email>           re-enable sign-in
 *   npx tsx scripts/manageAuthUsers.ts delete <email>           remove the user
 *
 * If <password> is omitted on `set`, you will be prompted for it.
 */
import crypto from "node:crypto";
import path from "node:path";
import readline from "node:readline";
import dotenv from "dotenv";
import { AUTH_USERS_COLLECTION } from "../src/lib/authConstants";

dotenv.config({ path: path.join(process.cwd(), ".env.local") });

const PBKDF2_DIGEST = "sha256";
const PBKDF2_ITERATIONS = 120_000;
const PBKDF2_KEY_LENGTH = 32;

const normalizeEmail = (email: string): string => email.trim().toLowerCase();

// Mirrors createPasswordHash in src/lib/internalAuth.ts so the login route can
// verify what this script writes.
const createPasswordHash = (password: string): string => {
  const salt = crypto.randomBytes(16);
  const hash = crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, PBKDF2_KEY_LENGTH, PBKDF2_DIGEST);
  return `pbkdf2$${PBKDF2_DIGEST}$${PBKDF2_ITERATIONS}$${salt.toString("base64")}$${hash.toString(
    "base64",
  )}`;
};

const prompt = (question: string): Promise<string> =>
  new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });

const USAGE = `Manage internal auth users in Firestore ("${AUTH_USERS_COLLECTION}").

  npx tsx scripts/manageAuthUsers.ts set <email> [password]   create or update (password hashed)
  npx tsx scripts/manageAuthUsers.ts list                     list all users
  npx tsx scripts/manageAuthUsers.ts disable <email>          block sign-in
  npx tsx scripts/manageAuthUsers.ts enable <email>           re-enable sign-in
  npx tsx scripts/manageAuthUsers.ts delete <email>           remove the user
`;

const main = async (): Promise<void> => {
  const [command, emailArg, passwordArg] = process.argv.slice(2);
  if (!command || command === "help" || command === "--help") {
    console.log(USAGE);
    process.exit(command ? 0 : 1);
  }

  const { firestore } = await import("../src/server/firebaseAdmin");
  if (!firestore) {
    console.error(
      "[manage-auth-users] Firebase admin not initialized. Check FIREBASE_* env vars in .env.local.",
    );
    process.exit(1);
  }
  const collection = firestore.collection(AUTH_USERS_COLLECTION);

  if (command === "list") {
    const snap = await collection.get();
    if (snap.empty) {
      console.log("(no users)");
      return;
    }
    snap.docs
      .map((doc) => doc.data() as { email?: string; disabled?: boolean })
      .sort((a, b) => (a.email ?? "").localeCompare(b.email ?? ""))
      .forEach((user) => console.log(`  ${user.disabled ? "[disabled] " : ""}${user.email ?? "(no email)"}`));
    console.log(`\n${snap.size} user(s).`);
    return;
  }

  const email = emailArg ? normalizeEmail(emailArg) : "";
  if (!email) {
    console.error(`[manage-auth-users] Missing <email> for "${command}".\n\n${USAGE}`);
    process.exit(1);
  }
  const docRef = collection.doc(email);

  if (command === "set") {
    let password = (passwordArg ?? "").trim();
    if (!password) password = (await prompt(`Password for ${email}: `)).trim();
    if (!password) {
      console.error("[manage-auth-users] Password is required.");
      process.exit(1);
    }
    await docRef.set(
      { email, passwordHash: createPasswordHash(password), disabled: false, updatedAt: new Date() },
      { merge: true },
    );
    console.log(`[manage-auth-users] Saved ${email}.`);
    return;
  }

  if (command === "disable" || command === "enable") {
    const snap = await docRef.get();
    if (!snap.exists) {
      console.error(`[manage-auth-users] No user "${email}".`);
      process.exit(1);
    }
    await docRef.set({ disabled: command === "disable", updatedAt: new Date() }, { merge: true });
    console.log(`[manage-auth-users] ${command === "disable" ? "Disabled" : "Enabled"} ${email}.`);
    return;
  }

  if (command === "delete") {
    const snap = await docRef.get();
    if (!snap.exists) {
      console.error(`[manage-auth-users] No user "${email}".`);
      process.exit(1);
    }
    await docRef.delete();
    console.log(`[manage-auth-users] Deleted ${email}.`);
    return;
  }

  console.error(`[manage-auth-users] Unknown command "${command}".\n\n${USAGE}`);
  process.exit(1);
};

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("[manage-auth-users] Unhandled error:", error);
    process.exit(1);
  });
