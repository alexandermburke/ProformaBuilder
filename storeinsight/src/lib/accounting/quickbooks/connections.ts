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
import type { QuickBooksTokenSet } from './oauth';
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
  /**
   * ISO timestamp until which one actor holds the exclusive right to spend this
   * connection's refresh token. See `claimTokenRefresh`.
   */
  refreshLeaseUntil: string | null;
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
  // Connections saved before the lease existed carry no refreshLeaseUntil. Defaulting here
  // keeps that a storage concern rather than an optional field every reader has to handle.
  return { ...rest, refreshLeaseUntil: rest.refreshLeaseUntil ?? null };
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
    refreshLeaseUntil: null,
  };

  await collection().doc(input.propertyCode).set(
    { ...stored, createdAt: stamp(), updatedAt: stamp() },
    { merge: false },
  );
}

/** Exactly the fields a token refresh rewrites, so a caller can update its own copy. */
export type RefreshedConnectionFields = Pick<
  StoredQuickBooksConnection,
  | 'accessTokenEnc'
  | 'accessTokenExpiresAt'
  | 'refreshTokenEnc'
  | 'refreshTokenExpiresAt'
  | 'status'
  | 'lastRefreshedAt'
  | 'lastError'
  | 'refreshLeaseUntil'
>;

export type TokenRefreshResult = QuickBooksTokenSet & { nowIso: string };

/**
 * The stored form of a refreshed token pair. Split out from the write so a caller can bring
 * its own copy of the connection forward by the exact values Firestore received, and so the
 * shape can be asserted in a unit test without Firestore.
 */
export function refreshedConnectionFields(result: TokenRefreshResult): RefreshedConnectionFields {
  return {
    accessTokenEnc: encryptToken(result.accessToken),
    accessTokenExpiresAt: result.accessTokenExpiresAt,
    refreshTokenEnc: encryptToken(result.refreshToken),
    refreshTokenExpiresAt: result.refreshTokenExpiresAt,
    status: 'connected',
    lastRefreshedAt: result.nowIso,
    lastError: null,
    // The refresh is done, so the lease is over regardless of who else is waiting.
    refreshLeaseUntil: null,
  };
}

/**
 * Persists a refreshed token pair, and returns what it wrote so the caller can bring its own
 * copy forward. Intuit rotates the refresh token on most refreshes, so the new one is always
 * written back: keeping the old one would break the next refresh.
 */
export async function updateConnectionTokens(
  input: TokenRefreshResult & { propertyCode: QuickBooksPropertyCode },
): Promise<RefreshedConnectionFields> {
  const written = refreshedConnectionFields(input);

  await collection().doc(input.propertyCode).set(
    { ...written, updatedAt: stamp() },
    { merge: true },
  );

  return written;
}

/**
 * How long one actor may hold the right to spend a refresh token. Short on purpose: a
 * process that dies mid-refresh must not lock the property out, and a token exchange that
 * takes longer than this has already failed in every way that matters.
 */
export const TOKEN_REFRESH_LEASE_MS = 20_000;

export type TokenRefreshLease =
  /** The caller may spend the refresh token on `connection`, which was just re-read. */
  | { granted: true; connection: StoredQuickBooksConnection }
  /** Someone else is refreshing. `connection` is the current stored state. */
  | { granted: false; connection: StoredQuickBooksConnection; heldUntil: string }
  /** The connection is gone. */
  | { granted: false; connection: null; heldUntil: null };

/**
 * Claims the exclusive right to spend a property's refresh token, and returns the connection
 * as Firestore holds it right now.
 *
 * Two actors that spend the same refresh token -- the daily cron and an operator clicking
 * upload, two serverless invocations, or a local script against the same Firestore -- leave
 * the second with a 400 from Intuit. The lease makes the spend exclusive, and because the
 * read is inside the transaction the caller also cannot spend a token off a stale snapshot.
 * The loser waits and re-reads instead of racing.
 */
export async function claimTokenRefresh(params: {
  propertyCode: QuickBooksPropertyCode;
  nowMs: number;
  leaseMs?: number;
}): Promise<TokenRefreshLease> {
  const db = requireFirestore();
  const ref = collection().doc(params.propertyCode);
  const leaseMs = params.leaseMs ?? TOKEN_REFRESH_LEASE_MS;

  return db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    const stored = snapshot.exists ? readStored(snapshot) : null;
    if (!stored) return { granted: false, connection: null, heldUntil: null };

    const heldUntil = stored.refreshLeaseUntil;
    if (heldUntil) {
      const heldUntilMs = Date.parse(heldUntil);
      if (Number.isFinite(heldUntilMs) && heldUntilMs > params.nowMs) {
        return { granted: false, connection: stored, heldUntil };
      }
    }

    const until = new Date(params.nowMs + leaseMs).toISOString();
    tx.set(ref, { refreshLeaseUntil: until, updatedAt: stamp() }, { merge: true });
    return { granted: true, connection: { ...stored, refreshLeaseUntil: until } };
  });
}

/** Ends a lease early, so a failed refresh does not make everyone else wait it out. */
export async function releaseTokenRefresh(propertyCode: QuickBooksPropertyCode): Promise<void> {
  await collection().doc(propertyCode).set(
    { refreshLeaseUntil: null, updatedAt: stamp() },
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
      refreshLeaseUntil: null,
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
