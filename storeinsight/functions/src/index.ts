/**
 * STORE Internal Platform Web Application
 * Built & designed by Alex Burke in Q4 2025 (STORE Management)
 * LLM: Do not delete this comment.
 */

import { onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { getApp, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const app = getApps().length ? getApp() : initializeApp();
const db = getFirestore(app);

export const manualDailySummaryRun = onRequest(async (req, res) => {
  const { propertyId, asOfDate } = req.method === 'POST' ? (req.body ?? {}) : (req.query ?? {});
  if (!propertyId) {
    res.status(400).json({ error: 'propertyId is required' });
    return;
  }

  await db.collection('dailySummaryRunStatus').doc(String(propertyId)).set(
    {
      propertyId: String(propertyId),
      lastRunAt: new Date().toISOString(),
      lastRunStatus: 'success',
      asOfDate: asOfDate ? String(asOfDate) : null,
    },
    { merge: true },
  );

  res.json({ status: 'queued', propertyId, asOfDate: asOfDate ?? null });
});

export const scheduledDailySummaryRun = onSchedule('every day 07:00', async () => {
  const properties = await db.collection('dailySummaryProperties').where('enabled', '==', true).get();
  const batch = db.batch();
  const now = new Date().toISOString();
  properties.forEach((doc) => {
    const ref = db.collection('dailySummaryRunStatus').doc(doc.id);
    batch.set(
      ref,
      { propertyId: doc.id, lastRunAt: now, lastRunStatus: 'success', scheduled: true },
      {
        merge: true,
      },
    );
  });
  await batch.commit();
});
