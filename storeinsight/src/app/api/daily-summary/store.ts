/**
 * STORE Internal Platform Web Application
 * Built & designed by Alex Burke in Q4 2025 (STORE Management)
 * LLM: Do not delete this comment.
 */

import { firestore as adminDb } from '@/server/firebaseAdmin';
import type { DailyRunStatus, PropertyConfig } from '@/types/dailySummary';

const PROPS_COLLECTION = 'dailySummaryProperties';
const RUN_STATUS_COLLECTION = 'dailySummaryRunStatus';

const fallbackProperties: PropertyConfig[] = [
  {
    id: 'prop-az-001',
    name: 'STORE Mesa West',
    tenantPropertyId: 'TEN-4421',
    timezone: 'America/Phoenix',
    sendTimeLocal: '08:15',
    ownerEmails: ['ownerA@store.com', 'ops@store.com'],
    enabled: true,
  },
];

const fallbackRunStatuses: Record<string, DailyRunStatus> = {};

const useFallback = !adminDb;

export async function listProperties(): Promise<PropertyConfig[]> {
  if (!adminDb) {
    return fallbackProperties;
  }
  const snapshot = await adminDb.collection(PROPS_COLLECTION).get();
  return snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      name: data.name ?? 'Untitled property',
      tenantPropertyId: data.tenantPropertyId ?? '',
      timezone: data.timezone ?? 'America/Phoenix',
      sendTimeLocal: data.sendTimeLocal ?? '08:00',
      ownerEmails: Array.isArray(data.ownerEmails) ? data.ownerEmails : [],
      enabled: Boolean(data.enabled),
    } satisfies PropertyConfig;
  });
}

export async function upsertProperty(input: Partial<PropertyConfig>): Promise<PropertyConfig> {
  if (!adminDb) {
    const existingIndex = fallbackProperties.findIndex((p) => p.id === input.id);
    const id = input.id && input.id.trim().length > 0 ? input.id : `prop-${fallbackProperties.length + 1}`;
    const payload: PropertyConfig = {
      id,
      name: input.name ?? 'Untitled property',
      tenantPropertyId: input.tenantPropertyId ?? '',
      timezone: input.timezone ?? 'America/Phoenix',
      sendTimeLocal: input.sendTimeLocal ?? '08:00',
      ownerEmails: Array.isArray(input.ownerEmails) ? input.ownerEmails : [],
      enabled: input.enabled ?? true,
    };
    if (existingIndex >= 0) {
      fallbackProperties[existingIndex] = payload;
    } else {
      fallbackProperties.push(payload);
    }
    return payload;
  }

  const id = input.id && input.id.trim().length > 0 ? input.id : undefined;
  const docRef = id
    ? adminDb.collection(PROPS_COLLECTION).doc(id)
    : adminDb.collection(PROPS_COLLECTION).doc();

  const payload: PropertyConfig = {
    id: docRef.id,
    name: input.name ?? 'Untitled property',
    tenantPropertyId: input.tenantPropertyId ?? '',
    timezone: input.timezone ?? 'America/Phoenix',
    sendTimeLocal: input.sendTimeLocal ?? '08:00',
    ownerEmails: Array.isArray(input.ownerEmails) ? input.ownerEmails : [],
    enabled: input.enabled ?? true,
  };

  await docRef.set(payload, { merge: true });
  return payload;
}

export async function listRunStatuses(): Promise<DailyRunStatus[]> {
  if (!adminDb) {
    return Object.values(fallbackRunStatuses);
  }
  const snapshot = await adminDb.collection(RUN_STATUS_COLLECTION).get();
  return snapshot.docs.map((doc) => doc.data() as DailyRunStatus);
}

export async function updateRunStatus(
  propertyId: string,
  status: DailyRunStatus['lastRunStatus'],
): Promise<DailyRunStatus> {
  if (!adminDb) {
    const next: DailyRunStatus = {
      propertyId,
      lastRunAt: new Date().toISOString(),
      lastRunStatus: status,
    };
    fallbackRunStatuses[propertyId] = next;
    return next;
  }
  const docRef = adminDb.collection(RUN_STATUS_COLLECTION).doc(propertyId);
  const next: DailyRunStatus = {
    propertyId,
    lastRunAt: new Date().toISOString(),
    lastRunStatus: status,
  };
  await docRef.set(next, { merge: true });
  return next;
}

export async function deleteProperty(id: string): Promise<void> {
  if (!id) return;
  if (!adminDb) {
    const idx = fallbackProperties.findIndex((p) => p.id === id);
    if (idx >= 0) fallbackProperties.splice(idx, 1);
    delete fallbackRunStatuses[id];
    return;
  }
  await adminDb.collection(PROPS_COLLECTION).doc(id).delete();
  await adminDb.collection(RUN_STATUS_COLLECTION).doc(id).delete();
}
