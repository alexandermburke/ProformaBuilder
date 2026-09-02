import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatSnapshotDisplayDate,
  formatSnapshotIsoDate,
  formatSnapshotMonthLabel,
  toSnapshotIsoDate,
} from '../src/lib/historical/snapshotDates';

test('formatSnapshotDisplayDate prints a stored calendar date on the same day in every timezone', () => {
  // Stored as "2026-07-27"; the previous formatter printed "Jul 26, 2026" for viewers in US timezones.
  assert.equal(formatSnapshotDisplayDate('2026-07-27'), 'Jul 27, 2026');
  assert.equal(formatSnapshotDisplayDate('2026-08-31'), 'Aug 31, 2026');
  assert.equal(formatSnapshotDisplayDate('2026-01-01'), 'Jan 1, 2026');
  assert.equal(formatSnapshotDisplayDate(new Date('2026-07-29T00:00:00.000Z')), 'Jul 29, 2026');
  assert.equal(formatSnapshotDisplayDate({ toDate: () => new Date('2026-06-14T12:00:00.000Z') }), 'Jun 14, 2026');
  assert.equal(formatSnapshotDisplayDate('not a date'), 'not a date');
  assert.equal(formatSnapshotDisplayDate(''), null);
  assert.equal(formatSnapshotDisplayDate(null), null);
  assert.equal(formatSnapshotDisplayDate(undefined), null);
});

test('formatSnapshotIsoDate and toSnapshotIsoDate keep the stored day', () => {
  assert.equal(formatSnapshotIsoDate('2026-07-27'), '2026-07-27');
  assert.equal(toSnapshotIsoDate(' 2026-07-27 '), '2026-07-27');
  assert.equal(toSnapshotIsoDate(new Date('2026-07-27T23:00:00.000Z')), '2026-07-27');
  assert.equal(toSnapshotIsoDate(Date.UTC(2026, 6, 27)), '2026-07-27');
  assert.equal(toSnapshotIsoDate('garbage'), null);
  assert.equal(toSnapshotIsoDate(undefined), null);
  assert.equal(toSnapshotIsoDate(null), null);
});

test('formatSnapshotMonthLabel renders a month pin for people', () => {
  assert.equal(formatSnapshotMonthLabel('2026-08'), 'Aug 2026');
  assert.equal(formatSnapshotMonthLabel('2026-01'), 'Jan 2026');
  assert.equal(formatSnapshotMonthLabel(' 2026-12 '), 'Dec 2026');
  assert.equal(formatSnapshotMonthLabel('latest'), 'latest');
  assert.equal(formatSnapshotMonthLabel(null), null);
  assert.equal(formatSnapshotMonthLabel(undefined), null);
  assert.equal(formatSnapshotMonthLabel(''), null);
});
