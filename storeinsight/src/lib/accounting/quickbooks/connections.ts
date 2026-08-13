/**
 * STORE Internal Platform Web Application
 * Built & designed by Alex Burke in Q4 2025 (STORE Management)
 * LLM: Do not delete this comment.
 */

/**
 * One QuickBooks company connection per STORE property.
 *
 * The document id IS the property code, so a property can hold exactly one connection and
 * a lookup can never drift to a neighbour's books. The reverse direction is guarded too:
 * `findConnectionByRealmId` is checked before a connection is saved, so one QuickBooks
 * company can never be attached to two properties.
 *
 * Tokens are stored encrypted (see tokenCrypto.ts) and are never returned by
 * `toConnectionSummary`, which is the only shape the API and the page ever see.
 */

import crypto from 'node:crypto';
import admin from 'firebase-admin';
import { firestore } from '@/server/firebaseAdmin';
import type { QuickBooksPropertyCode } from '@/lib/accounting/faciliqInvoiceImport/properties';
import { getQuickBooksProperty } from '@/lib/accounting/faciliqInvoiceImport/properties';
import type { QuickBooksEnvironment } from './config';
import { decryptToken, encryptToken } from './tokenCrypto';

export const QBO_CONNECTION_COLLECTION = 'quickbooksConnections';

export type QuickBooksConnectionStatus = 'connected' | 'needs_reauth';

export type StoredQuickBooksConnection = {
  propertyCode: QuickBooksPropertyCode;
  realmId: string;
  environment: QuickBooksEnvironment;
  companyName: string;
  companyLegalName: string;
  /**
   * True when the QuickBooks company's own name resolves back to this same STORE property.
   * False means the names did not match and a person accepted the pairing anyway, which
   * the connections page shows rather than hides.
   */
  companyNameVerified: boolean;
  status: QuickBooksConnectionStatus;
  accessTokenEnc: string;
  accessTokenExpiresAt: string;
  refreshTokenEnc: string;
  refreshTokenExpiresAt: string;
  connectedBy: string;
  connectedAt: string;
  lastRefreshedAt: string | null;
  lastError: string | null;
};

/** Everything the browser is allowed to know about a connection. Never carries a token. */
export type QuickBooksConnectionSummary = {
  propertyCode: QuickBooksPropertyCode;
  propertyName: string;
  connected: boolean;
  realmId: string | null;
  environment: QuickBooksEnvironment | null;
  companyName: string | null;
  companyLegalName: string | null;
  companyNameVerified: boolean;
  status: QuickBooksConnectionStatus | null;
  connectedBy: string | null;
  connectedAt: string | null;
  lastRefreshedAt: string | null;
  refreshTokenExpiresAt: string | null;
  lastError: string | null;
};

const requireFirestore = (): admin.firestore.Firestore => {
  if (!firestore) {
    throw new Error('Firebase is not initialized (firestore missing). Check environment variables.');
  }
  return firestore;
};

const collection = (): admin.firestore.CollectionReference =>
  requireFirestore().collection(QBO_CONNECTION_COLLECTION);

const stamp = () => admin.firestore.FieldValue.serverTimestamp();

const readStored = (
  snapshot: admin.firestore.DocumentSnapshot | admin.firestore.QueryDocumentSnapshot,
): StoredQuickBooksConnection | null => {
  const data = snapshot.data();
  if (!data) return null;
  const { createdAt: _createdAt, updatedAt: _updatedAt, ...rest } = data as StoredQuickBooksConnection & {
    createdAt?: unknown;
    updatedAt?: unknown;
  };
  return rest;
};

export const QBO_OAUTH_STATE_COLLECTION = 'quickbooksOAuthStates';

/**
 * Burns an OAuth state value so its authorization code can only be exchanged once.
 *
 * Intuit is explicit that an authorization code must be exchanged exactly once, and that a
 * second attempt can invalidate the tokens the first one produced. A browser refresh on the
 * callback URL is enough to cause that, so the state is claimed atomically before the
 * exchange. Returns false when it was already used.
 */
export async function consumeOAuthState(state: string): Promise<boolean> {
  const id = crypto.createHash('sha256').update(state).digest('hex').slice(0, 40);
  try {
    await requireFirestore()
      .collection(QBO_OAUTH_STATE_COLLECTION)
      .doc(id)
      .create({ usedAt: admin.firestore.FieldValue.serverTimestamp() });
    return true;
  } catch (err) {
    const code = (err as { code?: number })?.code;
    const message = (err as { message?: string })?.message ?? '';
    if (code === 6 || /already exists/i.test(message)) return false;
    throw err;
  }
}

export async function getConnection(
  propertyCode: QuickBooksPropertyCode,
): Promise<StoredQuickBooksConnection | null> {
  const snapshot = await collection().doc(propertyCode).get();
  return snapshot.exists ? readStored(snapshot) : null;
}

export async function listConnections(): Promise<StoredQuickBooksConnection[]> {
  const snapshot = await collection().get();
  return snapshot.docs
    .map(readStored)
    .filter((value): value is StoredQuickBooksConnection => value !== null);
}

/**
 * Guards against attaching one QuickBooks company to two STORE properties, which would
 * silently post one property's bills into another's books.
 */
export async function findConnectionByRealmId(params: {
  realmId: string;
  excludePropertyCode?: QuickBooksPropertyCode;
}): Promise<StoredQuickBooksConnection | null> {
  const snapshot = await collection().where('realmId', '==', params.realmId).limit(5).get();
  for (const doc of snapshot.docs) {
    const stored = readStored(doc);
    if (stored && stored.propertyCode !== params.excludePropertyCode) return stored;
  }
  return null;
}

export type SaveConnectionInput = {
  propertyCode: QuickBooksPropertyCode;
  realmId: string;
  environment: QuickBooksEnvironment;
  companyName: string;
  companyLegalName: string;
  companyNameVerified: boolean;
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
  connectedBy: string;
  nowIso: string;
};

export async function saveConnection(input: SaveConnectionInput): Promise<void> {
  const stored: StoredQuickBooksConnection = {
    propertyCode: input.propertyCode,
    realmId: input.realmId,
    environment: input.environment,
    companyName: input.companyName,
    companyLegalName: input.companyLegalName,
    companyNameVerified: input.companyNameVerified,
    status: 'connected',
    accessTokenEnc: encryptToken(input.accessToken),
    accessTokenExpiresAt: input.accessTokenExpiresAt,
    refreshTokenEnc: encryptToken(input.refreshToken),
    refreshTokenExpiresAt: input.refreshTokenExpiresAt,
    connectedBy: input.connectedBy,
    connectedAt: input.nowIso,
    lastRefreshedAt: null,
    lastError: null,
  };

  await collection().doc(input.propertyCode).set(
    { ...stored, createdAt: stamp(), updatedAt: stamp() },
    { merge: false },
  );
}

/**
 * Persists a refreshed token pair. Intuit rotates the refresh token on most refreshes, so
 * the new one is always written back -- keeping the old one would break the next refresh.
 */
export async function updateConnectionTokens(input: {
  propertyCode: QuickBooksPropertyCode;
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
  nowIso: string;
}): Promise<void> {
  await collection().doc(input.propertyCode).set(
    {
      accessTokenEnc: encryptToken(input.accessToken),
      accessTokenExpiresAt: input.accessTokenExpiresAt,
      refreshTokenEnc: encryptToken(input.refreshToken),
      refreshTokenExpiresAt: input.refreshTokenExpiresAt,
      status: 'connected' satisfies QuickBooksConnectionStatus,
      lastRefreshedAt: input.nowIso,
      lastError: null,
      updatedAt: stamp(),
    },
    { merge: true },
  );
}

/** A dead refresh token cannot be recovered in code; a person has to reconnect. */
export async function markConnectionNeedsReauth(
  propertyCode: QuickBooksPropertyCode,
  error: string,
): Promise<void> {
  await collection().doc(propertyCode).set(
    {
      status: 'needs_reauth' satisfies QuickBooksConnectionStatus,
      lastError: error,
      updatedAt: stamp(),
    },
    { merge: true },
  );
}

export async function deleteConnection(propertyCode: QuickBooksPropertyCode): Promise<void> {
  await collection().doc(propertyCode).delete();
}

/** Server-only. The plaintext tokens never leave the request that asked for them. */
export function readConnectionTokens(connection: StoredQuickBooksConnection): {
  accessToken: string;
  refreshToken: string;
} {
  return {
    accessToken: decryptToken(connection.accessTokenEnc),
    refreshToken: decryptToken(connection.refreshTokenEnc),
  };
}

export function toConnectionSummary(
  propertyCode: QuickBooksPropertyCode,
  connection: StoredQuickBooksConnection | null,
): QuickBooksConnectionSummary {
  const property = getQuickBooksProperty(propertyCode);
  if (!connection) {
    return {
      propertyCode,
      propertyName: property.name,
      connected: false,
      realmId: null,
      environment: null,
      companyName: null,
      companyLegalName: null,
      companyNameVerified: false,
      status: null,
      connectedBy: null,
      connectedAt: null,
      lastRefreshedAt: null,
      refreshTokenExpiresAt: null,
      lastError: null,
    };
  }

  return {
    propertyCode,
    propertyName: property.name,
    connected: connection.status === 'connected',
    realmId: connection.realmId,
    environment: connection.environment,
    companyName: connection.companyName,
    companyLegalName: connection.companyLegalName,
    companyNameVerified: connection.companyNameVerified,
    status: connection.status,
    connectedBy: connection.connectedBy,
    connectedAt: connection.connectedAt,
    lastRefreshedAt: connection.lastRefreshedAt,
    refreshTokenExpiresAt: connection.refreshTokenExpiresAt,
    lastError: connection.lastError,
  };
}
