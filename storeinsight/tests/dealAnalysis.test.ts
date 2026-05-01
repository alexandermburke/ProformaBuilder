import assert from 'node:assert/strict';
import test from 'node:test';
import * as XLSX from 'xlsx';
import {
  buildAnalysisPrompt,
  parseAnalysisJson,
  summarizeWorkbook,
} from '../src/lib/dealAnalysis';

function buildWorkbookBuffer(): Buffer {
  const rows = [
    ['Property', 'Sunset Storage'],
    ['Month', 'Revenue', 'Expenses', 'NOI'],
    ['2025-01', 120000, 48000, 72000],
    ['2025-02', 122500, 47500, 75000],
    ['2025-03', 125000, 49000, 76000],
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'P&L');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

test('summarizeWorkbook produces a sheet preview with stringified cells', () => {
  const summary = summarizeWorkbook(buildWorkbookBuffer(), 'sunset.xlsx');
  assert.equal(summary.filename, 'sunset.xlsx');
  assert.equal(summary.sheets.length, 1);
  const sheet = summary.sheets[0];
  assert.equal(sheet.name, 'P&L');
  assert.equal(sheet.rows, 5);
  assert.equal(sheet.cols, 4);
  assert.deepEqual(sheet.preview[0], ['Property', 'Sunset Storage', '', '']);
  assert.deepEqual(sheet.preview[2], ['2025-01', '120000', '48000', '72000']);
});

test('buildAnalysisPrompt embeds notes and the sheet preview', () => {
  const summary = summarizeWorkbook(buildWorkbookBuffer(), 'sunset.xlsx');
  const { system, user } = buildAnalysisPrompt({
    summary,
    trackerContext: null,
    notes: 'Listed at $9M',
  });
  assert.match(system, /STORE Management/);
  assert.match(system, /Phoenix/);
  assert.match(system, /ACQUISITION/);
  assert.match(system, /MANAGEMENT/);
  assert.match(system, /LLM-inferred/);
  assert.match(user, /User notes: Listed at \$9M/);
  assert.match(user, /Sheet: P&L/);
  assert.match(user, /Sunset Storage/);
});

test('buildAnalysisPrompt embeds tracker context when provided without a workbook', () => {
  const { system, user } = buildAnalysisPrompt({
    summary: null,
    trackerContext: '- Deal #: 1\n- Facility: 44th St & Camelback\n- Asking price: 6800000',
    notes: '',
  });
  assert.match(system, /Tracker fields/);
  assert.match(user, /Deal Tracker entry/);
  assert.match(user, /44th St & Camelback/);
  assert.doesNotMatch(user, /Uploaded workbook/);
});

test('parseAnalysisJson rejects invalid recommendation values', () => {
  const bad = JSON.stringify({
    recommendation: 'maybe',
    confidence: 'high',
    summary: '',
    strengths: [],
    concerns: [],
    keyMetrics: [],
    followUps: [],
  });
  assert.equal(parseAnalysisJson(bad), null);
});

test('parseAnalysisJson returns a typed analysis for valid payloads and drops bad metric entries', () => {
  const ok = JSON.stringify({
    recommendation: 'pursue',
    confidence: 'medium',
    summary: 'Stable NOI growth.',
    strengths: ['Revenue trending up'],
    concerns: ['Expense ratio unclear', 42],
    keyMetrics: [
      { label: 'NOI margin', value: '60%' },
      { label: '', value: '99' },
      { value: 'no label' },
    ],
    followUps: ['Pull rent roll'],
  });
  const result = parseAnalysisJson(ok);
  assert.ok(result);
  assert.equal(result?.recommendation, 'pursue');
  assert.equal(result?.confidence, 'medium');
  assert.deepEqual(result?.strengths, ['Revenue trending up']);
  assert.deepEqual(result?.concerns, ['Expense ratio unclear']);
  assert.deepEqual(result?.keyMetrics, [{ label: 'NOI margin', value: '60%' }]);
  assert.deepEqual(result?.followUps, ['Pull rent roll']);
});

test('parseAnalysisJson returns null for malformed JSON', () => {
  assert.equal(parseAnalysisJson('not json'), null);
});
