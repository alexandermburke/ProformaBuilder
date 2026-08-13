/**
 * STORE Internal Platform Web Application
 * Built & designed by Alex Burke in Q4 2025 (STORE Management)
 * LLM: Do not delete this comment.
 */

/**
 * Turns the human-readable values in the FacilIQ export into QuickBooks object ids.
 *
 *   vendor name  ("FM irrigation") -> VendorRef  id
 *   GL code      ("5100-1110")     -> AccountRef id
 *
 * Every lookup is scoped to ONE property's company. The four STORE companies keep their
 * own vendor and chart-of-accounts lists, and the same vendor name can be a different id
 * in each, so a cache is always keyed by property and a client is always the destination
 * company's client.
 *
 * Matching is exact on a normalized form (case, spacing, and punctuation ignored) and
 * nothing else. There is no fuzzy fallback on purpose: a near-miss here posts a bill
 * against the wrong vendor or the wrong expense account, which is worse than not posting
 * it. An unmatched value comes back unresolved, with nearby candidates listed so a person
 * can fix it quickly, either by adding the record in QuickBooks or by saving a manual
 * mapping.
 */

import admin from 'firebase-admin';
import { firestore } from '@/server/firebaseAdmin';
import type { QuickBooksPropertyCode } from '@/lib/accounting/faciliqInvoiceImport/properties';
import type { QuickBooksClient } from './client';

export const QBO_MAPPING_COLLECTION = 'quickbooksMappings';

/** Re-read the company's vendor and account lists when the cache is older than this. */
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
/** QuickBooks caps a query page at 1000 rows. */
const PAGE_SIZE = 1000;
const MAX_PAGES = 20;

export type RefSource = 'quickbooks' | 'manual';

export type ResolvedRef = {
  id: string;
  label: string;
  source: RefSource;
};

export type RefResolution =
  | { resolved: true; ref: ResolvedRef }
  | { resolved: false; reason: string; candidates: string[] };

type RefMap = Record<string, ResolvedRef>;

type PropertyMappingDoc = {
  propertyCode: QuickBooksPropertyCode;
  realmId: string;
  vendors: RefMap;
  accounts: RefMap;
  refreshedAt: string | null;
};

/**
 * Lowercase, alphanumerics only. Collapses "FM Irrigation", "fm  irrigation", and
 * "F.M. Irrigation" onto one key, and keeps every key legal as a Firestore map field.
 */
export const normalizeRefKey = (value: string): string =>
  value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '');

const requireFirestore = (): admin.firestore.Firestore => {
  if (!firestore) {
    throw new Error('Firebase is not initialized (firestore missing). Check environment variables.');
  }
  return firestore;
};

const mappingRef = (propertyCode: QuickBooksPropertyCode): admin.firestore.DocumentReference =>
  requireFirestore().collection(QBO_MAPPING_COLLECTION).doc(propertyCode);

type QboVendor = { Id?: string; DisplayName?: string; CompanyName?: string };
type QboAccount = { Id?: string; Name?: string; AcctNum?: string; AccountType?: string };

/** Single quotes are the string delimiter in the QuickBooks query language. */
export const escapeQueryValue = (value: string): string => value.replace(/'/g, "\\'");

async function queryAllPages<T>(
  client: QuickBooksClient,
  entity: string,
  selectClause: string,
): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const start = page * PAGE_SIZE + 1;
    const batch = await client.query<T>(
      entity,
      `${selectClause} STARTPOSITION ${start} MAXRESULTS ${PAGE_SIZE}`,
    );
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) return rows;
  }
  console.warn('[quickbooks] stopped paging early', {
    entity,
    propertyCode: client.propertyCode,
    pages: MAX_PAGES,
    rows: rows.length,
  });
  return rows;
}

/**
 * Rebuilds the vendor and account maps from QuickBooks. Manual mappings are merged back on
 * top, so a correction a person made is never lost to a refresh.
 */
export async function refreshPropertyMappings(
  client: QuickBooksClient,
): Promise<PropertyMappingDoc> {
  const existing = await readMappingDoc(client.propertyCode);

  const vendorRows = await queryAllPages<QboVendor>(
    client,
    'Vendor',
    'SELECT Id, DisplayName, CompanyName FROM Vendor WHERE Active = true',
  );
  const accountRows = await queryAllPages<QboAccount>(
    client,
    'Account',
    'SELECT Id, Name, AcctNum, AccountType FROM Account WHERE Active = true',
  );

  const vendors: RefMap = {};
  for (const row of vendorRows) {
    if (!row.Id) continue;
    const label = row.DisplayName ?? row.CompanyName ?? '';
    for (const name of [row.DisplayName, row.CompanyName]) {
      const key = normalizeRefKey(name ?? '');
      // First writer wins, so DisplayName (the authoritative label) beats CompanyName.
      if (key && !vendors[key]) vendors[key] = { id: row.Id, label, source: 'quickbooks' };
    }
  }

  const accounts: RefMap = {};
  for (const row of accountRows) {
    if (!row.Id) continue;
    const label = row.AcctNum ? `${row.AcctNum} ${row.Name ?? ''}`.trim() : (row.Name ?? '');
    // Indexed by account number AND by name: the FacilIQ GLCode column carries the number,
    // but a company that leaves AcctNum blank can still be matched on the account name.
    for (const candidate of [row.AcctNum, row.Name]) {
      const key = normalizeRefKey(candidate ?? '');
      if (key && !accounts[key]) accounts[key] = { id: row.Id, label, source: 'quickbooks' };
    }
  }

  for (const [key, ref] of Object.entries(existing?.vendors ?? {})) {
    if (ref.source === 'manual') vendors[key] = ref;
  }
  for (const [key, ref] of Object.entries(existing?.accounts ?? {})) {
    if (ref.source === 'manual') accounts[key] = ref;
  }

  const doc: PropertyMappingDoc = {
    propertyCode: client.propertyCode,
    realmId: client.realmId,
    vendors,
    accounts,
    refreshedAt: new Date().toISOString(),
  };

  await mappingRef(client.propertyCode).set(
    { ...doc, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
    { merge: false },
  );

  console.info('[quickbooks] refreshed reference maps', {
    propertyCode: client.propertyCode,
    realmId: client.realmId,
    vendors: vendorRows.length,
    accounts: accountRows.length,
  });

  return doc;
}

async function readMappingDoc(
  propertyCode: QuickBooksPropertyCode,
): Promise<PropertyMappingDoc | null> {
  const snapshot = await mappingRef(propertyCode).get();
  if (!snapshot.exists) return null;
  const data = snapshot.data() as PropertyMappingDoc | undefined;
  if (!data) return null;
  return {
    propertyCode: data.propertyCode,
    realmId: data.realmId,
    vendors: data.vendors ?? {},
    accounts: data.accounts ?? {},
    refreshedAt: data.refreshedAt ?? null,
  };
}

const isStale = (doc: PropertyMappingDoc | null): boolean => {
  if (!doc || !doc.refreshedAt) return true;
  const at = Date.parse(doc.refreshedAt);
  return !Number.isFinite(at) || Date.now() - at > CACHE_TTL_MS;
};

/**
 * A per-property resolver that loads the cached maps once and refreshes from QuickBooks at
 * most once per run, on the first miss. Reuse one resolver for a whole export so a hundred
 * rows do not become a hundred queries.
 */
export type PropertyRefResolver = {
  propertyCode: QuickBooksPropertyCode;
  realmId: string;
  resolveVendor(name: string): Promise<RefResolution>;
  resolveAccount(glCode: string, fallbackLabel?: string): Promise<RefResolution>;
};

const nearbyCandidates = (map: RefMap, key: string, limit = 5): string[] => {
  if (!key) return [];
  const labels: string[] = [];
  const seen = new Set<string>();
  for (const [candidateKey, ref] of Object.entries(map)) {
    if (!candidateKey.startsWith(key.slice(0, 3)) && !key.startsWith(candidateKey.slice(0, 3))) continue;
    if (seen.has(ref.label)) continue;
    seen.add(ref.label);
    labels.push(ref.label);
    if (labels.length >= limit) break;
  }
  return labels;
};

export async function createRefResolver(client: QuickBooksClient): Promise<PropertyRefResolver> {
  const cached = await readMappingDoc(client.propertyCode);
  let refreshedThisRun = false;
  // A cached map built against a different realm is not this company's map, so it is
  // discarded rather than merged.
  let maps: PropertyMappingDoc;
  if (!cached || isStale(cached) || cached.realmId !== client.realmId) {
    maps = await refreshPropertyMappings(client);
    refreshedThisRun = true;
  } else {
    maps = cached;
  }

  const lookup = async (
    kind: 'vendors' | 'accounts',
    key: string,
  ): Promise<ResolvedRef | null> => {
    if (!key) return null;
    const hit = maps[kind][key];
    if (hit) return hit;
    if (refreshedThisRun) return null;
    // One refresh per run on the first miss: a vendor added in QuickBooks minutes ago
    // should resolve without waiting for the cache TTL.
    refreshedThisRun = true;
    maps = await refreshPropertyMappings(client);
    return maps[kind][key] ?? null;
  };

  return {
    propertyCode: client.propertyCode,
    realmId: client.realmId,

    async resolveVendor(name: string): Promise<RefResolution> {
      const trimmed = name.trim();
      if (!trimmed) {
        return { resolved: false, reason: 'The row has no vendor name.', candidates: [] };
      }
      const key = normalizeRefKey(trimmed);
      const ref = await lookup('vendors', key);
      if (ref) return { resolved: true, ref };
      return {
        resolved: false,
        reason: `No active vendor named "${trimmed}" in ${client.propertyCode} (${client.companyName || 'QuickBooks'}). Add the vendor there, or map it by hand.`,
        candidates: nearbyCandidates(maps.vendors, key),
      };
    },

    async resolveAccount(glCode: string, fallbackLabel?: string): Promise<RefResolution> {
      const trimmed = glCode.trim();
      if (!trimmed) {
        return { resolved: false, reason: 'The row has no GL code.', candidates: [] };
      }
      const key = normalizeRefKey(trimmed);
      const ref = (await lookup('accounts', key)) ?? (
        fallbackLabel ? await lookup('accounts', normalizeRefKey(fallbackLabel)) : null
      );
      if (ref) return { resolved: true, ref };
      return {
        resolved: false,
        reason: `No active account matching GL code "${trimmed}" in ${client.propertyCode} (${client.companyName || 'QuickBooks'}). Check the account number in QuickBooks, or map it by hand.`,
        candidates: nearbyCandidates(maps.accounts, key),
      };
    },
  };
}

/**
 * Records an operator's explicit mapping. Marked `manual` so a cache refresh preserves it,
 * and so the UI can show which mappings were decided by a person rather than matched.
 */
export async function setManualMapping(params: {
  propertyCode: QuickBooksPropertyCode;
  kind: 'vendor' | 'account';
  sourceValue: string;
  quickBooksId: string;
  label: string;
}): Promise<void> {
  const key = normalizeRefKey(params.sourceValue);
  if (!key) throw new Error('A manual mapping needs a non-empty source value.');

  const field = params.kind === 'vendor' ? 'vendors' : 'accounts';
  await mappingRef(params.propertyCode).set(
    {
      propertyCode: params.propertyCode,
      [field]: {
        [key]: { id: params.quickBooksId, label: params.label, source: 'manual' satisfies RefSource },
      },
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  console.info('[quickbooks] manual mapping saved', {
    propertyCode: params.propertyCode,
    kind: params.kind,
    sourceValue: params.sourceValue,
    quickBooksId: params.quickBooksId,
  });
}
