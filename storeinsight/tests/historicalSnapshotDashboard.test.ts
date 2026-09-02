import assert from 'node:assert/strict';
import test from 'node:test';
import type { PropertyConfig } from '../src/types/dailySummary';
import {
  INTERNAL_DEFAULT_SNAPSHOT_RANGE,
  buildHistoricalPropertyOptions,
  findHistoricalPropertyOption,
  getSnapshotMonthIso,
  normalizeHistoricalSnapshots,
  resolveHistoricalPropertyName,
  resolvePinnedMonthIso,
  resolvePinnedSnapshotPreview,
  sliceLaggedFinancialEntriesByRange,
  sliceSnapshotEntriesByRange,
  toMonthKey,
} from '../src/lib/historical/snapshotDashboard';
import {
  filterSnapshotsByPinnedMonth,
  mergeHistoricalSnapshotsByMonth,
  type HistoricalSnapshotAliasBundle,
} from '../src/lib/historical/snapshotDashboardServer';
import { INTERNAL_DEFAULT_OVERVIEW_WIDGETS, getOverviewWidgetsOrDefault } from '../src/lib/overviewWidgets';

test('normalizeHistoricalSnapshots normalizes month iso values from mixed raw snapshot shapes', () => {
  const snapshots = normalizeHistoricalSnapshots([
    { reportMonth: '2026-02-28', propertyName: 'STORE Mesa West' },
    { asOfDate: new Date('2026-03-12T00:00:00.000Z'), propertyName: 'STORE Mesa West' },
  ]);

  assert.equal(snapshots[0]?.monthIso, '2026-02');
  assert.equal(snapshots[1]?.monthIso, '2026-03');
});

test('filterSnapshotsByPinnedMonth resolves a pinned day to its month', () => {
  const snapshots = normalizeHistoricalSnapshots([
    { reportDate: '2026-02-28', propertyName: 'STORE on Baseline' },
    { reportDate: '2026-03-28', propertyName: 'STORE on Baseline' },
    { reportDate: '2026-03-31', propertyName: 'STORE on Baseline' },
    { reportDate: '2026-04-01', propertyName: 'STORE on Baseline' },
  ]);

  // A pin on March 15 shows every March snapshot, including ones dated after the 15th, and hides April.
  const visible = filterSnapshotsByPinnedMonth(snapshots, '2026-03', '2026-03-15');

  assert.deepEqual(
    visible.map((snapshot) => snapshot.reportDate),
    ['2026-02-28', '2026-03-28', '2026-03-31'],
  );
});

test('filterSnapshotsByPinnedMonth keeps the pinned month even when its only snapshot is dated after the pinned day', () => {
  // Mirrors the live P006 doc on 2026-09-01: one snapshot per month, August's carrying the 31st.
  const snapshots = [
    { monthIso: '2026-06', reportMonthIso: '2026-06', reportDate: '2026-06-30' },
    { monthIso: '2026-07', reportMonthIso: '2026-07', reportDate: '2026-07-27' },
    { monthIso: '2026-08', reportMonthIso: '2026-08', reportDate: '2026-08-31' },
  ];
  const months = (visible: typeof snapshots) => visible.map((snapshot) => snapshot.monthIso);

  for (const pinnedDay of ['2026-08-01', '2026-08-07', '2026-08-15', '2026-08-31']) {
    assert.deepEqual(
      months(filterSnapshotsByPinnedMonth(snapshots, pinnedDay.slice(0, 7), pinnedDay)),
      ['2026-06', '2026-07', '2026-08'],
      `pin ${pinnedDay} should show August`,
    );
  }
  assert.deepEqual(months(filterSnapshotsByPinnedMonth(snapshots, '2026-07', '2026-07-31')), ['2026-06', '2026-07']);
  assert.deepEqual(months(filterSnapshotsByPinnedMonth(snapshots, '2026-08')), ['2026-06', '2026-07', '2026-08']);
  assert.deepEqual(months(filterSnapshotsByPinnedMonth(snapshots, null, '2026-08-07')), ['2026-06', '2026-07', '2026-08']);
  assert.deepEqual(filterSnapshotsByPinnedMonth(snapshots, '2026-01', '2026-01-15'), []);
  assert.deepEqual(months(filterSnapshotsByPinnedMonth(snapshots, '2026-09', '2026-09-15')), ['2026-06', '2026-07', '2026-08']);
  assert.deepEqual(months(filterSnapshotsByPinnedMonth(snapshots, null, null)), ['2026-06', '2026-07', '2026-08']);
});

test('getSnapshotMonthIso falls back through the stored month and date fields', () => {
  assert.equal(getSnapshotMonthIso({ monthIso: '2026-08' }), '2026-08');
  assert.equal(getSnapshotMonthIso({ reportMonthIso: '2026-07' }), '2026-07');
  assert.equal(getSnapshotMonthIso({ reportDate: '2026-06-14' }), '2026-06');
  assert.equal(getSnapshotMonthIso({ asOfDate: new Date('2026-05-19T00:00:00.000Z') }), '2026-05');
  assert.equal(getSnapshotMonthIso({}), null);
});

test('resolvePinnedMonthIso prefers the stored month and reduces a stored day to its month', () => {
  assert.equal(resolvePinnedMonthIso('2026-08', '2026-08-01'), '2026-08');
  assert.equal(resolvePinnedMonthIso(null, '2026-08-07'), '2026-08');
  assert.equal(resolvePinnedMonthIso(undefined, null), null);
});

test('resolvePinnedSnapshotPreview reports what a pin resolves to and flags an in-progress month', () => {
  const months = [
    { monthIso: '2026-08', reportDate: '2026-08-31' },
    { monthIso: '2026-06', reportDate: '2026-06-30' },
    { monthIso: '2026-07', reportDate: '2026-07-27' },
  ];

  const pinnedAugust = resolvePinnedSnapshotPreview(months, '2026-08', '2026-09');
  assert.equal(pinnedAugust.pinnedMonthIso, '2026-08');
  assert.equal(pinnedAugust.effective?.monthIso, '2026-08');
  assert.equal(pinnedAugust.effective?.reportDate, '2026-08-31');
  assert.equal(pinnedAugust.monthInProgress, false);
  assert.deepEqual(pinnedAugust.excludedMonths, []);

  const pinnedJuly = resolvePinnedSnapshotPreview(months, '2026-07', '2026-09');
  assert.equal(pinnedJuly.effective?.monthIso, '2026-07');
  assert.deepEqual(pinnedJuly.excludedMonths, ['2026-08']);

  const floating = resolvePinnedSnapshotPreview(months, null, '2026-08');
  assert.equal(floating.pinnedMonthIso, null);
  assert.equal(floating.effective?.monthIso, '2026-08');
  assert.equal(floating.monthInProgress, true);
  assert.deepEqual(floating.excludedMonths, []);

  const tooEarly = resolvePinnedSnapshotPreview(months, '2026-01', '2026-09');
  assert.equal(tooEarly.effective, null);
  assert.equal(tooEarly.excludedMonths.length, 3);

  const empty = resolvePinnedSnapshotPreview([], '2026-08', '2026-09');
  assert.equal(empty.effective, null);
  assert.deepEqual(empty.excludedMonths, []);
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
  assert.deepEqual(widgets, ['noi', 'expenses', 'occupancy', 'netRevenue', 'pastDue', 'rateVariance']);
});

test('mergeHistoricalSnapshotsByMonth unions newer sibling-only months for canonical token dashboards', () => {
  const canonicalSnapshots = [
    {
      monthIso: '2026-02',
      reportDate: '2026-02-28',
      financials: { noiMtd: 70000, expensesMtd: 29000 },
    },
    {
      monthIso: '2026-03',
      reportDate: '2026-03-31',
      financials: { noiMtd: -2434.42, expensesMtd: 5584.42 },
    },
  ];
  const overlayCandidates: HistoricalSnapshotAliasBundle[] = [
    {
      alias: 'W002',
      updatedAt: '2026-04-06T15:00:00.000Z',
      snapshots: [
        {
          monthIso: '2026-03',
          reportDate: '2026-03-31',
          occupancy: { rsfOccPct: 85.72 },
        },
        {
          monthIso: '2026-04',
          reportDate: '2026-04-05',
          occupancy: { rsfOccPct: 86.7 },
          rentals: { netMtd: 13 },
        },
      ],
    },
  ];

  const merged = mergeHistoricalSnapshotsByMonth(canonicalSnapshots, overlayCandidates);

  assert.deepEqual(
    merged.map((snapshot) => snapshot.monthIso),
    ['2026-02', '2026-03', '2026-04'],
  );
  assert.equal(merged.at(-1)?.reportDate, '2026-04-05');
  assert.equal(merged.at(-1)?.occupancy?.rsfOccPct, 86.7);
  assert.equal(merged.at(-1)?.rentals?.netMtd, 13);
});

test('mergeHistoricalSnapshotsByMonth preserves canonical financials while overlaying fresher shared-month operations', () => {
  const canonicalSnapshots = [
    {
      monthIso: '2026-03',
      reportDate: '2026-03-29',
      financials: { noiMtd: -2434.42, expensesMtd: 5584.42 },
      occupancy: { rsfOccPct: 84.1 },
    },
  ];
  const overlayCandidates: HistoricalSnapshotAliasBundle[] = [
    {
      alias: 'W002',
      updatedAt: '2026-04-06T15:00:00.000Z',
      snapshots: [
        {
          monthIso: '2026-03',
          reportDate: '2026-03-31',
          occupancy: { rsfOccPct: 85.72 },
          rentals: { netMtd: 13 },
        },
      ],
    },
  ];

  const merged = mergeHistoricalSnapshotsByMonth(canonicalSnapshots, overlayCandidates);
  const march = merged[0];

  assert.equal(merged.length, 1);
  assert.equal(march?.reportDate, '2026-03-31');
  assert.equal(march?.occupancy?.rsfOccPct, 85.72);
  assert.equal(march?.rentals?.netMtd, 13);
  assert.equal(march?.financials?.noiMtd, -2434.42);
  assert.equal(march?.financials?.expensesMtd, 5584.42);
});

test('filterSnapshotsByPinnedMonth keeps unpinned links floating and caps pinned links', () => {
  const snapshots = [
    { monthIso: '2026-02', reportDate: '2026-02-28' },
    { monthIso: '2026-03', reportDate: '2026-03-31' },
    { monthIso: '2026-04', reportDate: '2026-04-05' },
  ];

  assert.deepEqual(
    filterSnapshotsByPinnedMonth(snapshots, null).map((snapshot) => snapshot.monthIso),
    ['2026-02', '2026-03', '2026-04'],
  );
  assert.deepEqual(
    filterSnapshotsByPinnedMonth(snapshots, '2026-03').map((snapshot) => snapshot.monthIso),
    ['2026-02', '2026-03'],
  );
});
