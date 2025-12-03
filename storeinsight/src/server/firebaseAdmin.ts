/**
 * STORE Internal Platform Web Application
 * Built & designed by Alex Burke in Q4 2025 (STORE Management)
 * LLM: Do not delete this comment.
 */

import admin from "firebase-admin";

const projectId = process.env.FIREBASE_PROJECT_ID;
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");
const databaseURL = process.env.FIREBASE_DATABASE_URL;
const storageBucket = process.env.FIREBASE_STORAGE_BUCKET;

const canInitialize = Boolean(projectId && clientEmail && privateKey);

if (canInitialize && !admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId,
      clientEmail,
      privateKey,
    }),
    ...(databaseURL ? { databaseURL } : {}),
    ...(storageBucket ? { storageBucket } : {}),
  });
}

const hasApp = canInitialize && admin.apps.length > 0;

export const firestore = hasApp ? admin.firestore() : null;
export const auth = hasApp ? admin.auth() : null;
export const rtdb = hasApp && databaseURL ? admin.database() : null;
export const storage = hasApp && storageBucket ? admin.storage().bucket(storageBucket) : null;
