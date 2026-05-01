import admin from 'firebase-admin';
import { firestore } from '@/server/firebaseAdmin';
import type { DealAnalysis } from './dealAnalysis';

export type HumanOverride = {
  recommendation: DealAnalysis['recommendation'];
  confidence: DealAnalysis['confidence'];
  note: string;
  overriddenAt: string;
};

export type StoredDealAnalysisRun = {
  runId: string;
  dealNumber: string;
  facilityName: string;
  dealType: string;
  createdAt: string;
  modelUsed: string;
  inputs: {
    hasTrackerEntry: boolean;
    workbookFilename: string | null;
    notes: string;
  };
  analysis: DealAnalysis;
  humanOverride?: HumanOverride;
};

const COLLECTION = 'dealAnalyses';

function requireFirestore(): admin.firestore.Firestore {
  if (!firestore) {
    throw new Error('Firestore admin is not initialized — cannot persist deal analyses.');
  }
  return firestore;
}

export async function saveDealAnalysisRun(
  input: Omit<StoredDealAnalysisRun, 'runId' | 'createdAt'>,
): Promise<StoredDealAnalysisRun> {
  const db = requireFirestore();
  const dealRef = db.collection(COLLECTION).doc(input.dealNumber);
  const runRef = dealRef.collection('runs').doc();
  const createdAt = new Date().toISOString();
  const stored: StoredDealAnalysisRun = {
    runId: runRef.id,
    createdAt,
    ...input,
  };
  await db.runTransaction(async (tx) => {
    tx.set(
      dealRef,
      {
        dealNumber: input.dealNumber,
        facilityName: input.facilityName,
        dealType: input.dealType,
        latestRunId: runRef.id,
        latestVerdict: input.analysis.recommendation,
        latestConfidence: input.analysis.confidence,
        latestRunAt: createdAt,
      },
      { merge: true },
    );
    tx.set(runRef, stored);
  });
  return stored;
}

export type DealAnalysisLatest = {
  dealNumber: string;
  facilityName: string;
  dealType: string;
  latestRunId: string;
  latestVerdict: DealAnalysis['recommendation'];
  latestConfidence: DealAnalysis['confidence'];
  latestRunAt: string;
};

export async function listLatestVerdicts(): Promise<DealAnalysisLatest[]> {
  const db = requireFirestore();
  const snap = await db.collection(COLLECTION).get();
  const results: DealAnalysisLatest[] = [];
  for (const doc of snap.docs) {
    const data = doc.data();
    if (
      typeof data.latestVerdict === 'string' &&
      typeof data.latestConfidence === 'string' &&
      typeof data.latestRunId === 'string' &&
      typeof data.latestRunAt === 'string'
    ) {
      results.push({
        dealNumber: doc.id,
        facilityName: typeof data.facilityName === 'string' ? data.facilityName : '',
        dealType: typeof data.dealType === 'string' ? data.dealType : '',
        latestRunId: data.latestRunId,
        latestVerdict: data.latestVerdict as DealAnalysis['recommendation'],
        latestConfidence: data.latestConfidence as DealAnalysis['confidence'],
        latestRunAt: data.latestRunAt,
      });
    }
  }
  return results;
}

export async function listRunsForDeal(dealNumber: string): Promise<StoredDealAnalysisRun[]> {
  const db = requireFirestore();
  const runsSnap = await db
    .collection(COLLECTION)
    .doc(dealNumber)
    .collection('runs')
    .orderBy('createdAt', 'desc')
    .limit(50)
    .get();
  return runsSnap.docs.map((d) => d.data() as StoredDealAnalysisRun);
}

function effectiveVerdict(run: StoredDealAnalysisRun): {
  recommendation: DealAnalysis['recommendation'];
  confidence: DealAnalysis['confidence'];
} {
  if (run.humanOverride) {
    return {
      recommendation: run.humanOverride.recommendation,
      confidence: run.humanOverride.confidence,
    };
  }
  return {
    recommendation: run.analysis.recommendation,
    confidence: run.analysis.confidence,
  };
}

async function recomputeParentLatest(
  dealNumber: string,
): Promise<StoredDealAnalysisRun | null> {
  const db = requireFirestore();
  const runs = await listRunsForDeal(dealNumber);
  const dealRef = db.collection(COLLECTION).doc(dealNumber);
  if (runs.length === 0) {
    await dealRef.set(
      {
        latestRunId: null,
        latestVerdict: null,
        latestConfidence: null,
        latestRunAt: null,
      },
      { merge: true },
    );
    return null;
  }
  const latest = runs[0];
  const eff = effectiveVerdict(latest);
  await dealRef.set(
    {
      latestRunId: latest.runId,
      latestVerdict: eff.recommendation,
      latestConfidence: eff.confidence,
      latestRunAt: latest.createdAt,
    },
    { merge: true },
  );
  return latest;
}

export async function deleteDealAnalysisRun(
  dealNumber: string,
  runId: string,
): Promise<{ remainingRuns: number; latest: StoredDealAnalysisRun | null }> {
  const db = requireFirestore();
  await db.collection(COLLECTION).doc(dealNumber).collection('runs').doc(runId).delete();
  const latest = await recomputeParentLatest(dealNumber);
  const remaining = await db.collection(COLLECTION).doc(dealNumber).collection('runs').count().get();
  return { remainingRuns: remaining.data().count, latest };
}

export async function overrideDealAnalysisRun(
  dealNumber: string,
  runId: string,
  override: Pick<HumanOverride, 'recommendation' | 'confidence' | 'note'>,
): Promise<{ run: StoredDealAnalysisRun; latest: StoredDealAnalysisRun | null }> {
  const db = requireFirestore();
  const runRef = db.collection(COLLECTION).doc(dealNumber).collection('runs').doc(runId);
  const overriddenAt = new Date().toISOString();
  const humanOverride: HumanOverride = { ...override, overriddenAt };
  await runRef.set({ humanOverride }, { merge: true });
  const updatedSnap = await runRef.get();
  const run = updatedSnap.data() as StoredDealAnalysisRun;
  const latest = await recomputeParentLatest(dealNumber);
  return { run, latest };
}

export type SavedDealSummary = DealAnalysisLatest & { runCount: number };

export async function listAllSavedDeals(): Promise<SavedDealSummary[]> {
  const db = requireFirestore();
  const verdicts = await listLatestVerdicts();
  const enriched: SavedDealSummary[] = [];
  for (const v of verdicts) {
    const count = await db.collection(COLLECTION).doc(v.dealNumber).collection('runs').count().get();
    enriched.push({ ...v, runCount: count.data().count });
  }
  return enriched.sort(
    (a, b) => new Date(b.latestRunAt).getTime() - new Date(a.latestRunAt).getTime(),
  );
}
