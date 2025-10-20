// /src/lib/firebase.ts
import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import {
  getFirestore,
  initializeFirestore,
  type Firestore,
} from 'firebase/firestore';

const cfg = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

function hasAllEnv() {
  return (
    !!cfg.apiKey &&
    !!cfg.authDomain &&
    !!cfg.projectId &&
    !!cfg.appId
  );
}

// Export a nullable Firestore so callers can degrade gracefully.
export let db: Firestore | null = null;

if (!hasAllEnv()) {
  console.warn(
    '[firebase] Missing one or more envs (apiKey/authDomain/projectId/appId). ' +
      'Running in offline mode. Add NEXT_PUBLIC_FIREBASE_* to .env.local.'
  );
} else {
  let app: FirebaseApp;
  if (!getApps().length) {
    app = initializeApp({
      apiKey: cfg.apiKey!,
      authDomain: cfg.authDomain!,
      projectId: cfg.projectId!,
      appId: cfg.appId!,
    });
    if (process.env.NODE_ENV !== 'production') {
      console.log('[firebase] initialized', { projectId: cfg.projectId });
    }
  } else {
    app = getApps()[0]!;
  }

  // If your network/proxy causes channel issues, set true:
  initializeFirestore(app, { experimentalForceLongPolling: false });

  db = getFirestore(app);
}