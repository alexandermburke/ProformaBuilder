/**
 * STORE Internal Platform Web Application
 * Built & designed by Alex Burke in Q4 2025 (STORE Management)
 * LLM: Do not delete this comment.
 */

import type { JSX } from 'react';
import { HistoricalDashboardView } from '@/components/historical/HistoricalDashboardView';
import type { MoMSeries } from '@/lib/flash/momSeries';
import { getPropertyHistoricalFromFirebase } from '@/lib/historical/firebaseStore';
import type { HistoricalDataByRange } from '@/lib/historical/dataInput';
import { PROPERTY_OPTIONS } from '@/lib/propertyDirectory';

export default async function HistoricalDataPage(): Promise<JSX.Element> {
  const propertyIds = PROPERTY_OPTIONS.map((option) => option.id);
  const firebaseResults = await Promise.all(
    propertyIds.map(async (id) => {
      try {
        const result = await getPropertyHistoricalFromFirebase(id);
        return { id, result, fetchFailed: false };
      } catch {
        return { id, result: { data: null, updatedAt: null }, fetchFailed: true };
      }
    }),
  );

  const dataByRangeByProperty: Record<string, HistoricalDataByRange> = {};
  const firebaseAvailabilityByProperty: Record<string, boolean> = {};
  const momSeriesByProperty: Record<string, MoMSeries | null> = {};

  firebaseResults.forEach(({ id, result }) => {
    if (result.data?.historicalByRange) {
      dataByRangeByProperty[id] = result.data.historicalByRange;
      firebaseAvailabilityByProperty[id] = true;
    } else {
      firebaseAvailabilityByProperty[id] = false;
    }

    const series = result.data?.momSeries;
    if (series) {
      momSeriesByProperty[id] = series;
    }
  });

  return (
    <HistoricalDashboardView
      viewMode="internal"
      propertyOptions={PROPERTY_OPTIONS}
      dataByRangeByProperty={dataByRangeByProperty}
      momSeriesByProperty={momSeriesByProperty}
      firebaseAvailabilityByProperty={firebaseAvailabilityByProperty}
      showUploadLink
      showDirectoryLink
    />
  );
}
