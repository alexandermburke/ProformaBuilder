import assert from 'node:assert/strict';
import test from 'node:test';
import * as XLSX from 'xlsx';
import {
  formatTrackerEntryForPrompt,
  parseDealTrackerWorkbook,
} from '../src/lib/dealTracker';

function buildTrackerBuffer(): Buffer {
  const rows = [
    [
      'Deal #',
      'Deal Type',
      'Facility Name',
      'Full Address',
      'City',
      'State',
      'Region',
      'Current Management',
      'NRSF',
      'Total Units',
      'Occupancy %',
      'Effective Rate ($/SF)',
      'Gross Revenue',
      'NOI',
      'Asking Price',
      'Price / SF',
      'Cap Rate',
      'Active Deal?',
      'Deal Status',
      'Call for Offers Date',
      'Broker / Contact',
      'Year Built',
      'Climate Controlled?',
      'Proforma Status',
      'Notes',
    ],
    [
      '1',
      'Acquisition',
      '44th St & Camelback',
      '4250',
      'Phoenix',
      'AZ',
      'Southwest',
      'XYZ Storage Mgmt',
      '52,000',
      '425',
      '87.0%',
      '$14.50',
      '$655,980',
      '$485,000',
      '$6,800,000',
      '$130.77',
      '7.1%',
      'Yes',
      'Due Diligence',
      '06/15/2025',
      'John Smith - CBRE',
      '2005',
      'Partial',
      '',
      'Strong submarket; 3-mile radius avg occ 92%.',
    ],
    [
      '2',
      'Management',
      'Sunset Storage',
      '100 Sunset Blvd',
      'Tucson',
      'AZ',
      'Southwest',
      'Acme Mgmt',
      '40,000',
      '300',
      '78%',
      '$12.00',
      '$420,000',
      '$280,000',
      '$3,500,000',
      '$87.50',
      '8.0%',
      'No',
      'Passed',
      '',
      'Jane Doe - Marcus',
      '1998',
      'No',
      '',
      'Weak submarket.',
    ],
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Deal Tracker');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

test('parseDealTrackerWorkbook normalizes currency, percent, and yes/no fields', () => {
  const parsed = parseDealTrackerWorkbook(buildTrackerBuffer());
  assert.equal(parsed.entries.length, 2);
  assert.equal(parsed.missingHeaders.length, 0);

  const first = parsed.entries[0];
  assert.equal(first.dealNumber, '1');
  assert.equal(first.dealType, 'Acquisition');
  assert.equal(first.facilityName, '44th St & Camelback');
  assert.equal(first.city, 'Phoenix');
  assert.equal(first.nrsf, 52000);
  assert.equal(first.occupancyPct, 87);
  assert.equal(first.effectiveRatePerSf, 14.5);
  assert.equal(first.grossRevenue, 655980);
  assert.equal(first.askingPrice, 6800000);
  assert.equal(first.capRatePct, 7.1);
  assert.equal(first.active, true);

  const second = parsed.entries[1];
  assert.equal(second.active, false);
  assert.equal(second.dealType, 'Management');
  assert.equal(second.dealStatus, 'Passed');
});

test('parseDealTrackerWorkbook preserves the raw cell strings for provenance', () => {
  const parsed = parseDealTrackerWorkbook(buildTrackerBuffer());
  const first = parsed.entries[0];
  assert.equal(first.raw['Asking Price'], '$6,800,000');
  assert.equal(first.raw['Cap Rate'], '7.1%');
  assert.equal(first.raw['Active Deal?'], 'Yes');
});

test('parseDealTrackerWorkbook reports missing headers when columns are absent', () => {
  const rows = [
    ['Deal #', 'Facility Name', 'City'],
    ['1', 'Test Facility', 'Phoenix'],
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Deal Tracker');
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  const parsed = parseDealTrackerWorkbook(buffer);
  assert.equal(parsed.entries.length, 1);
  assert.ok(parsed.missingHeaders.includes('askingPrice'));
  assert.ok(parsed.missingHeaders.includes('noi'));
});

test('formatTrackerEntryForPrompt skips empty fields and emits one line each', () => {
  const parsed = parseDealTrackerWorkbook(buildTrackerBuffer());
  const text = formatTrackerEntryForPrompt(parsed.entries[0]);
  assert.match(text, /- Deal #: 1/);
  assert.match(text, /- Deal type: Acquisition/);
  assert.match(text, /- Facility: 44th St & Camelback/);
  assert.match(text, /- Asking price: 6800000/);
  assert.doesNotMatch(text, /Proforma status/);
});
