/**
 * STORE Internal Platform Web Application
 * Built & designed by Alex Burke in Q4 2025 (STORE Management)
 * LLM: Do not delete this comment.
 */

import admin from 'firebase-admin';
import { firestore as adminDb, storage as adminStorage } from '@/server/firebaseAdmin';
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
    heroImageUrl: '',
    heroImagePath: '',
    heroImageUpdatedAt: null,
    propertyImageData: '',
  },
];

const fallbackRunStatuses: Record<string, DailyRunStatus> = {};

const normalizeOptionalNumberArray = (value: unknown): number[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const numbers = value
    .map((item) => (typeof item === 'number' ? item : Number(item)))
    .filter((item) => Number.isFinite(item));
  return numbers.length > 0 ? numbers : undefined;
};

const normalizeOptionalMonthArray = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const monthPattern = /^\d{4}-\d{2}$/;
  const months = value
    .map((item) => String(item ?? '').trim())
    .filter((item) => monthPattern.test(item));
  return months.length > 0 ? months : undefined;
};

export async function listProperties(): Promise<PropertyConfig[]> {
  if (!adminDb) {
    return fallbackProperties;
  }
  const snapshot = await adminDb.collection(PROPS_COLLECTION).get();
  return snapshot.docs.map((doc) => {
    const data = doc.data();
    const propertyId = (data.propertyId ?? data.tenantPropertyId ?? doc.id ?? '').toString();
    const propertyCodeRaw = (data.propertyCode ?? '').toString().trim();
    const propertyCode = (propertyCodeRaw ? propertyCodeRaw.toLowerCase() : '') || propertyId || doc.id;
    const sendTimeLocal = data.sendTimeLocal ?? data.sendTimeMst ?? '08:00';
  const heroImagePath = data.heroImagePath ?? '';
  const heroImageUrl =
    data.heroImageUrl ||
    (heroImagePath && adminStorage ? `https://storage.googleapis.com/${adminStorage.name}/${heroImagePath}` : '') ||
    data.imagePath ||
    data.propertyImageData ||
    '';
  const heroImageUpdatedAt =
    data.heroImageUpdatedAt && typeof data.heroImageUpdatedAt.toDate === 'function'
      ? data.heroImageUpdatedAt.toDate().toISOString()
      : data.heroImageUpdatedAt ?? null;
    return {
      id: doc.id,
      propertyCode: propertyCode || doc.id,
      propertyId: propertyId || doc.id,
      name: data.name ?? 'Untitled property',
      tenantPropertyId: data.tenantPropertyId ?? propertyId ?? doc.id,
      timezone: data.timezone ?? 'America/Phoenix',
      sendTimeLocal,
      sendTimeMst: data.sendTimeMst ?? sendTimeLocal,
      ownerEmails: Array.isArray(data.ownerEmails) ? data.ownerEmails : [],
      enabled: data.enabled === undefined ? true : Boolean(data.enabled),
      facilityOpenDate: data.FACILITYOPENDATE ?? data.facilityOpenDate ?? '',
      momPlaceholderMonths: normalizeOptionalMonthArray(data.momPlaceholderMonths),
      momPlaceholderGrossAccruedRent: normalizeOptionalNumberArray(data.momPlaceholderGrossAccruedRent),
      momPlaceholderOccupiedPct: normalizeOptionalNumberArray(data.momPlaceholderOccupiedPct),
      heroImageUrl,
      heroImagePath,
      heroImageUpdatedAt,
      // legacy aliases to keep UI backward-compatible
      propertyImageData: heroImageUrl,
      imagePath: heroImagePath,
    } satisfies PropertyConfig;
  });
}

type DecodedImage = { buffer: Buffer; contentType: string; extension: string };

const decodeImageData = (data: string): DecodedImage | null => {
  if (!data || typeof data !== 'string') return null;
  const dataUrlMatch = data.match(/^data:(.+?);base64,(.+)$/);
  if (dataUrlMatch) {
    const contentType = dataUrlMatch[1] || 'image/png';
    const base64 = dataUrlMatch[2];
    const buffer = Buffer.from(base64, 'base64');
    const extension = contentType.split('/')[1] || 'png';
    return { buffer, contentType, extension };
  }
  // plain base64 string (no prefix)
  try {
    const buffer = Buffer.from(data, 'base64');
    return { buffer, contentType: 'image/png', extension: 'png' };
  } catch {
    return null;
  }
};

const isBinaryImageString = (value: string): boolean => {
  if (!value) return false;
  if (value.startsWith('data:image/')) return true;
  if (/^https?:\/\//i.test(value)) return false;
  // naive base64 check (no URL characters and reasonable length)
  return /^[A-Za-z0-9+/=]+$/.test(value.trim());
};

const purgeHeroImages = async (propertyId: string, existingPath?: string | null): Promise<void> => {
  if (!adminStorage) return;
  const prefix = `daily-summary/${propertyId}/`;
  try {
    const [files] = await adminStorage.getFiles({ prefix });
    const deletions = files.map((file) => file.delete({ ignoreNotFound: true }));
    if (existingPath) {
      deletions.push(adminStorage.file(existingPath).delete({ ignoreNotFound: true }));
    }
    await Promise.allSettled(deletions);
  } catch (err) {
    console.warn('[daily-summary] purge hero images failed', { propertyId, err });
  }
};

const uploadHeroImage = async (
  propertyId: string,
  imageData: string,
  existingPath?: string | null,
): Promise<{ heroImageUrl: string; heroImagePath: string }> => {
  if (!adminStorage) {
    throw new Error('Firebase Storage is not configured.');
  }
  const decoded = decodeImageData(imageData);
  if (!decoded) {
    throw new Error('Invalid image data.');
  }
  await purgeHeroImages(propertyId, existingPath);
  const objectPath = `daily-summary/${propertyId}/hero-image-${Date.now()}.${decoded.extension || 'png'}`;
  const file = adminStorage.file(objectPath);
  await file.save(decoded.buffer, {
    contentType: decoded.contentType,
    resumable: false,
    public: true,
    metadata: { cacheControl: 'public,max-age=60' },
  });
  const heroImageUrl = `https://storage.googleapis.com/${adminStorage.name}/${objectPath}`;
  return { heroImageUrl, heroImagePath: objectPath };
};

export async function upsertProperty(input: Partial<PropertyConfig>): Promise<PropertyConfig> {
  if (!adminDb) {
    const existingIndex = fallbackProperties.findIndex((p) => p.id === input.id);
    const propertyId =
      (input.propertyId ?? input.tenantPropertyId ?? input.id ?? input.propertyCode ?? '').toString().trim() ||
      `prop-${fallbackProperties.length + 1}`;
    const code =
      input.propertyCode && input.propertyCode.trim().length > 0
        ? input.propertyCode.trim().toLowerCase()
        : ((input.id ?? '').trim() || (input.tenantPropertyId ?? '').trim() || propertyId).toLowerCase();
    const id = input.id && input.id.trim().length > 0 ? input.id : propertyId;
    const payload: PropertyConfig = {
      id,
      propertyCode: code ?? id.toLowerCase(),
      propertyId,
      name: input.name ?? 'Untitled property',
      tenantPropertyId: input.tenantPropertyId ?? propertyId,
      timezone: input.timezone ?? 'America/Phoenix',
      sendTimeLocal: input.sendTimeLocal ?? input.sendTimeMst ?? '08:00',
      sendTimeMst: input.sendTimeMst ?? input.sendTimeLocal ?? '08:00',
      ownerEmails: Array.isArray(input.ownerEmails) ? input.ownerEmails : [],
      enabled: input.enabled ?? true,
      facilityOpenDate: input.facilityOpenDate ?? '',
      momPlaceholderMonths: normalizeOptionalMonthArray(input.momPlaceholderMonths) ?? [],
      momPlaceholderGrossAccruedRent: normalizeOptionalNumberArray(input.momPlaceholderGrossAccruedRent) ?? [],
      momPlaceholderOccupiedPct: normalizeOptionalNumberArray(input.momPlaceholderOccupiedPct) ?? [],
      heroImageUrl: input.heroImageUrl ?? '',
      heroImagePath: input.heroImagePath ?? '',
      heroImageUpdatedAt: input.heroImageUpdatedAt ?? null,
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

  const docId =
    (input.id ?? input.propertyId ?? input.tenantPropertyId ?? input.propertyCode ?? '').toString().trim() || undefined;
  const propertyIdField =
    (input.propertyId ?? input.tenantPropertyId ?? docId ?? input.propertyCode ?? '').toString().trim() || undefined;
  const normalizedCode =
    input.propertyCode && input.propertyCode.trim().length > 0
      ? input.propertyCode.trim().toLowerCase()
      : propertyIdField ?? docId ?? undefined;
  const docRef = docId ? adminDb.collection(PROPS_COLLECTION).doc(docId) : adminDb.collection(PROPS_COLLECTION).doc();

  const propertyCode = (normalizedCode ?? docRef.id).toString().trim().toLowerCase();

  const existing = await docRef.get();
  const existingData = existing.exists ? existing.data() : {};
  let heroImageUrl = existingData?.heroImageUrl ?? existingData?.imagePath ?? existingData?.propertyImageData ?? '';
  let heroImagePath = existingData?.heroImagePath ?? existingData?.imagePath ?? '';
  let heroImageUpdatedAt: string | null =
    existingData?.heroImageUpdatedAt && typeof existingData.heroImageUpdatedAt.toDate === 'function'
      ? existingData.heroImageUpdatedAt.toDate().toISOString()
      : existingData?.heroImageUpdatedAt ?? null;

  const shouldRemoveHeroImage = input.heroImageRemove === true;
  const incomingImageData = typeof input.propertyImageData === 'string' ? input.propertyImageData.trim() : '';
  const shouldUploadImage = incomingImageData && isBinaryImageString(incomingImageData);

  if (shouldRemoveHeroImage) {
    await purgeHeroImages(docRef.id, heroImagePath);
    heroImageUrl = '';
    heroImagePath = '';
    heroImageUpdatedAt = new Date().toISOString();
    await docRef.set(
      {
        heroImageUrl,
        heroImagePath,
        heroImageUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
        propertyImageData: admin.firestore.FieldValue.delete(),
        imagePath: admin.firestore.FieldValue.delete(),
      },
      { merge: true },
    );
  }

  if (shouldUploadImage) {
    try {
      const upload = await uploadHeroImage(docRef.id, incomingImageData, heroImagePath);
      heroImageUrl = upload.heroImageUrl;
      heroImagePath = upload.heroImagePath;
      heroImageUpdatedAt = new Date().toISOString();
      await docRef.set(
        {
          heroImageUrl,
          heroImagePath,
          heroImageUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
          propertyImageData: admin.firestore.FieldValue.delete(),
          imagePath: admin.firestore.FieldValue.delete(),
        },
        { merge: true },
      );
    } catch (err) {
      console.error('[daily-summary] hero image upload failed', err);
    }
  }

  const docPayload: Record<string, unknown> = {
    id: docRef.id,
    propertyCode,
    propertyId: propertyIdField ?? docRef.id,
    name: input.name ?? 'Untitled property',
    tenantPropertyId: input.tenantPropertyId ?? propertyIdField ?? docRef.id,
    timezone: input.timezone ?? 'America/Phoenix',
    sendTimeLocal: input.sendTimeLocal ?? input.sendTimeMst ?? '08:00',
    sendTimeMst: input.sendTimeMst ?? input.sendTimeLocal ?? '08:00',
    ownerEmails: Array.isArray(input.ownerEmails) ? input.ownerEmails : [],
    enabled: input.enabled ?? true,
    facilityOpenDate: input.facilityOpenDate ?? '',
    momPlaceholderMonths:
      normalizeOptionalMonthArray(input.momPlaceholderMonths) ??
      normalizeOptionalMonthArray(existingData?.momPlaceholderMonths) ??
      [],
    momPlaceholderGrossAccruedRent:
      normalizeOptionalNumberArray(input.momPlaceholderGrossAccruedRent) ??
      normalizeOptionalNumberArray(existingData?.momPlaceholderGrossAccruedRent) ??
      [],
    momPlaceholderOccupiedPct:
      normalizeOptionalNumberArray(input.momPlaceholderOccupiedPct) ??
      normalizeOptionalNumberArray(existingData?.momPlaceholderOccupiedPct) ??
      [],
    heroImageUrl,
    heroImagePath,
    propertyImageData: admin.firestore.FieldValue.delete(),
    imagePath: admin.firestore.FieldValue.delete(),
  };

  if (input.propertyImageData) {
    docPayload.heroImageUpdatedAt = admin.firestore.FieldValue.serverTimestamp();
  }

  await docRef.set(docPayload, { merge: true });

  const result: PropertyConfig = {
    id: docRef.id,
    propertyCode,
    propertyId: propertyIdField ?? docRef.id,
    name: input.name ?? 'Untitled property',
    tenantPropertyId: input.tenantPropertyId ?? propertyIdField ?? docRef.id,
    timezone: input.timezone ?? 'America/Phoenix',
    sendTimeLocal: input.sendTimeLocal ?? input.sendTimeMst ?? '08:00',
    sendTimeMst: input.sendTimeMst ?? input.sendTimeLocal ?? '08:00',
    ownerEmails: Array.isArray(input.ownerEmails) ? input.ownerEmails : [],
    enabled: input.enabled ?? true,
    facilityOpenDate: input.facilityOpenDate ?? '',
    momPlaceholderMonths:
      normalizeOptionalMonthArray(input.momPlaceholderMonths) ??
      normalizeOptionalMonthArray(existingData?.momPlaceholderMonths) ??
      [],
    momPlaceholderGrossAccruedRent:
      normalizeOptionalNumberArray(input.momPlaceholderGrossAccruedRent) ??
      normalizeOptionalNumberArray(existingData?.momPlaceholderGrossAccruedRent) ??
      [],
    momPlaceholderOccupiedPct:
      normalizeOptionalNumberArray(input.momPlaceholderOccupiedPct) ??
      normalizeOptionalNumberArray(existingData?.momPlaceholderOccupiedPct) ??
      [],
    heroImageUrl,
    heroImagePath,
    heroImageUpdatedAt,
    propertyImageData: heroImageUrl,
    imagePath: heroImagePath,
  };

  return result;
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
