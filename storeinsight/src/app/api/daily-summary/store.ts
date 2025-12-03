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
    propertyCode: 'prop-az-001',
    propertyId: 'TEN-4421',
    name: 'STORE Mesa West',
    tenantPropertyId: 'TEN-4421',
    timezone: 'America/Phoenix',
    sendTimeLocal: '08:15',
    sendTimeMst: '08:15',
    ownerEmails: ['ownerA@store.com', 'ops@store.com'],
    enabled: true,
    facilityOpenDate: 'January 2020',
    propertyImageData: '',
  },
];

const fallbackRunStatuses: Record<string, DailyRunStatus> = {};

export async function listProperties(): Promise<PropertyConfig[]> {
  if (!adminDb) {
    return fallbackProperties;
  }
  const snapshot = await adminDb.collection(PROPS_COLLECTION).get();
  return snapshot.docs.map((doc) => {
    const data = doc.data();
    const propertyCode = (data.propertyCode ?? data.tenantPropertyId ?? doc.id ?? '').toString();
    const sendTimeLocal = data.sendTimeLocal ?? data.sendTimeMst ?? '08:00';
    return {
      id: doc.id,
      propertyCode: propertyCode || doc.id,
      propertyId: data.propertyId ?? data.tenantPropertyId ?? doc.id,
      name: data.name ?? 'Untitled property',
      tenantPropertyId: data.tenantPropertyId ?? '',
      timezone: data.timezone ?? 'America/Phoenix',
      sendTimeLocal,
      sendTimeMst: data.sendTimeMst ?? sendTimeLocal,
      ownerEmails: Array.isArray(data.ownerEmails) ? data.ownerEmails : [],
      enabled: Boolean(data.enabled),
      facilityOpenDate: data.FACILITYOPENDATE ?? data.facilityOpenDate ?? '',
      propertyImageData: data.propertyImageData ?? data.imagePath ?? '',
      imagePath: data.imagePath ?? data.propertyImageData ?? '',
    } satisfies PropertyConfig;
  });
}

export async function upsertProperty(input: Partial<PropertyConfig>): Promise<PropertyConfig> {
  if (!adminDb) {
    const existingIndex = fallbackProperties.findIndex((p) => p.id === input.id);
    const code = input.propertyCode && input.propertyCode.trim().length > 0 ? input.propertyCode.trim() : input.tenantPropertyId;
    const id = input.id && input.id.trim().length > 0 ? input.id : code && code.trim() ? code.trim() : `prop-${fallbackProperties.length + 1}`;
    const payload: PropertyConfig = {
      id,
      propertyCode: code ?? id,
      propertyId: input.propertyId ?? input.tenantPropertyId ?? id,
      name: input.name ?? 'Untitled property',
      tenantPropertyId: input.tenantPropertyId ?? '',
      timezone: input.timezone ?? 'America/Phoenix',
      sendTimeLocal: input.sendTimeLocal ?? input.sendTimeMst ?? '08:00',
      sendTimeMst: input.sendTimeMst ?? input.sendTimeLocal ?? '08:00',
      ownerEmails: Array.isArray(input.ownerEmails) ? input.ownerEmails : [],
      enabled: input.enabled ?? true,
      facilityOpenDate: input.facilityOpenDate ?? '',
      propertyImageData: input.propertyImageData ?? input.imagePath ?? '',
      imagePath: input.imagePath ?? input.propertyImageData ?? '',
    };
    if (existingIndex >= 0) {
      fallbackProperties[existingIndex] = payload;
    } else {
      fallbackProperties.push(payload);
    }
    return payload;
  }

  const normalizedCode = input.propertyCode && input.propertyCode.trim().length > 0 ? input.propertyCode.trim() : undefined;
  const id = input.id && input.id.trim().length > 0 ? input.id : normalizedCode;
  const docRef = id
    ? adminDb.collection(PROPS_COLLECTION).doc(id)
    : adminDb.collection(PROPS_COLLECTION).doc(normalizedCode ?? undefined);

  const payload: PropertyConfig = {
    id: docRef.id,
    propertyCode: normalizedCode ?? docRef.id,
    propertyId: input.propertyId ?? input.tenantPropertyId ?? docRef.id,
    name: input.name ?? 'Untitled property',
    tenantPropertyId: input.tenantPropertyId ?? '',
    timezone: input.timezone ?? 'America/Phoenix',
    sendTimeLocal: input.sendTimeLocal ?? input.sendTimeMst ?? '08:00',
    sendTimeMst: input.sendTimeMst ?? input.sendTimeLocal ?? '08:00',
    ownerEmails: Array.isArray(input.ownerEmails) ? input.ownerEmails : [],
    enabled: input.enabled ?? true,
    facilityOpenDate: input.facilityOpenDate ?? '',
    propertyImageData: input.propertyImageData ?? input.imagePath ?? '',
    imagePath: input.imagePath ?? input.propertyImageData ?? '',
  };

  await docRef.set(payload, { merge: true });
  return payload;
}

export async function listRunStatuses(): Promise<DailyRunStatus[]> {
  if (!adminDb) {
    return Object.values(fallbackRunStatuses);
  }
  const snapshot = await adminDb.collection(RUN_STATUS_COLLECTION).get();
  return snapshot.docs.map((doc) => {
    const data = doc.data() as Partial<DailyRunStatus>;
    return {
      propertyCode: doc.id,
      propertyId: data.propertyId ?? doc.id,
      propertyName: data.propertyName,
      reportDate: data.reportDate,
      msrReceived: data.msrReceived ?? null,
      msrReceivedAt: data.msrReceivedAt ?? null,
      lastRunAt: data.lastRunAt ?? null,
      nextRunAt: data.nextRunAt ?? null,
      status: data.status ?? data.lastRunStatus ?? 'PENDING',
      lastRunStatus: data.lastRunStatus,
      errorMessage: data.errorMessage ?? null,
      flashPath: data.flashPath ?? null,
      msrPath: data.msrPath ?? null,
    } satisfies DailyRunStatus;
  });
}

export async function updateRunStatus(
  propertyId: string,
  status: DailyRunStatus['status'],
): Promise<DailyRunStatus> {
  const normalizedStatus = status === 'failed' || status === 'FAILED' ? 'FAILED' : status === 'success' || status === 'HEALTHY' ? 'HEALTHY' : status ?? 'PENDING';
  if (!adminDb) {
    const next: DailyRunStatus = {
      propertyCode: propertyId,
      propertyId,
      lastRunAt: new Date().toISOString(),
      status: normalizedStatus,
      lastRunStatus: normalizedStatus === 'FAILED' ? 'failed' : 'success',
    };
    fallbackRunStatuses[propertyId] = next;
    return next;
  }
  const docRef = adminDb.collection(RUN_STATUS_COLLECTION).doc(propertyId);
  const next: DailyRunStatus = {
    propertyCode: propertyId,
    propertyId,
    lastRunAt: new Date().toISOString(),
    status: normalizedStatus,
    lastRunStatus: normalizedStatus === 'FAILED' ? 'failed' : 'success',
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
