import assert from 'node:assert/strict';
import test from 'node:test';
import type { PropertyConfig } from '../src/types/dailySummary';
import {
  INTERNAL_DEFAULT_SNAPSHOT_RANGE,
  buildHistoricalPropertyOptions,
  findHistoricalPropertyOption,
  normalizeHistoricalSnapshots,
  resolveHistoricalPropertyName,
  sliceLaggedFinancialEntriesByRange,
  sliceSnapshotEntriesByRange,
  toMonthKey,
} from '../src/lib/historical/snapshotDashboard';
import { INTERNAL_DEFAULT_OVERVIEW_WIDGETS, getOverviewWidgetsOrDefault } from '../src/lib/overviewWidgets';

test('normalizeHistoricalSnapshots normalizes month iso values from mixed raw snapshot shapes', () => {
  const snapshots = normalizeHistoricalSnapshots([
    { reportMonth: '2026-02-28', propertyName: 'STORE Mesa West' },
    { asOfDate: new Date('2026-03-12T00:00:00.000Z'), propertyName: 'STORE Mesa West' },
  ]);

  assert.equal(snapshots[0]?.monthIso, '2026-02');
  assert.equal(snapshots[1]?.monthIso, '2026-03');
});

test('resolveHistoricalPropertyName prefers stored property names before falling back', () => {
  const resolved = resolveHistoricalPropertyName(
    { property_name: 'STORE on Pittman' },
    [{ propertyName: 'Ignored snapshot name', monthIso: '2026-01' }],
    'Fallback property',
  );

  assert.equal(resolved, 'STORE on Pittman');
});

test('buildHistoricalPropertyOptions merges live configs with legacy aliases', () => {
  const propertyConfigs: PropertyConfig[] = [
    {
      id: 'prop-az-001',
      propertyCode: 'storeatthegrove',
      propertyId: 'L001',
      tenantPropertyId: 'TEN-4421',
      name: 'STORE on the Grove',
      timezone: 'America/Phoenix',
      sendTimeLocal: '08:00',
      ownerEmails: [],
      enabled: true,
    },
  ];

  const options = buildHistoricalPropertyOptions(propertyConfigs, [
    { id: 'L001', label: 'STORE on the Grove', city: 'Phoenix, AZ' },
    { id: 'prop-pittman', label: 'STORE on Pittman', city: 'Fairfield, CA' },
  ]);

  assert.equal(options.length, 2);
  const grove = findHistoricalPropertyOption(options, 'storeatthegrove');
  assert.ok(grove);
  assert.equal(grove?.id, 'L001');
  assert.equal(grove?.city, 'Phoenix, AZ');
  assert.ok(grove?.aliases.includes('prop-az-001'));
  assert.ok(grove?.aliases.includes('TEN-4421'));
});

test('findHistoricalPropertyOption resolves requested aliases and falls back to the first enabled property', () => {
  const options = [
    {
      id: 'L001',
      label: 'STORE on the Grove',
      city: 'Phoenix, AZ',
      enabled: true,
      aliases: ['L001', 'prop-az-001', 'TEN-4421'],
    },
    {
      id: 'prop-pittman',
      label: 'STORE on Pittman',
      city: 'Fairfield, CA',
      enabled: true,
      aliases: ['prop-pittman'],
    },
  ];

  assert.equal(findHistoricalPropertyOption(options, 'TEN-4421')?.id, 'L001');
  assert.equal(findHistoricalPropertyOption(options, 'missing')?.id, 'L001');
});

test('sliceSnapshotEntriesByRange supports extended internal ranges and all-history', () => {
  const entries = Array.from({ length: 40 }, (_, index) => {
    const year = 2023 + Math.floor(index / 12);
    const month = (index % 12) + 1;
    const monthIso = `${year}-${String(month).padStart(2, '0')}`;
    return {
      monthIso,
      monthKey: toMonthKey(monthIso),
      index,
    };
  });

  assert.equal(sliceSnapshotEntriesByRange(entries, '12M').length, 12);
  assert.equal(sliceSnapshotEntriesByRange(entries, '24M').length, 24);
  assert.equal(sliceSnapshotEntriesByRange(entries, '36M').length, 36);
  assert.equal(sliceSnapshotEntriesByRange(entries, 'ALL').length, 40);
  assert.equal(INTERNAL_DEFAULT_SNAPSHOT_RANGE, '24M');
});

test('sliceLaggedFinancialEntriesByRange excludes the latest snapshot for lagged financial trends', () => {
  const entries = Array.from({ length: 14 }, (_, index) => {
    const year = 2025 + Math.floor(index / 12);
    const month = (index % 12) + 1;
    const monthIso = `${year}-${String(month).padStart(2, '0')}`;
    return {
      monthIso,
      monthKey: toMonthKey(monthIso),
      index,
    };
  });

  const laggedTwelveMonths = sliceLaggedFinancialEntriesByRange(entries, '12M');
  assert.equal(laggedTwelveMonths.length, 12);
  assert.equal(laggedTwelveMonths.at(-1)?.monthIso, '2026-01');
  assert.equal(sliceLaggedFinancialEntriesByRange(entries, 'ALL').length, 13);
});

test('getOverviewWidgetsOrDefault uses broader internal defaults when no preferences are saved', () => {
  const widgets = getOverviewWidgetsOrDefault(undefined, INTERNAL_DEFAULT_OVERVIEW_WIDGETS);
  assert.deepEqual(widgets, INTERNAL_DEFAULT_OVERVIEW_WIDGETS);
});
