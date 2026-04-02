import assert from 'node:assert/strict';
import test from 'node:test';
import * as XLSX from 'xlsx';
import { parseBudgetFinancialWorkbook } from '../src/lib/historical/budgetFinancialParser';

function buildBudgetWorkbookBuffer(): Buffer {
  const rows = [
    ['STORE on Pittman'],
    ['Budget Comparison'],
    ['Month = Mar 2026'],
    ['', 'PTD Actual', 'PTD Budget', 'Variance', '% Var', 'YTD Actual', 'YTD Budget', 'Variance', '% Var'],
    ['Total Income', 0, 0, 0, 0, 0, 0, 0, 0],
    ['Total Property Expenses', 2434.42, 0, 0, 0, 0, 0, 0, 0],
    ['Total Other Expenses', 3150, 0, 0, 0, 0, 0, 0, 0],
    ['Total Expenses', 5584.42, 0, 0, 0, 0, 0, 0, 0],
  ];
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, sheet, 'Budget Comparison');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

test('parseBudgetFinancialWorkbook keeps NOI aligned to property expenses and exposes total expenses separately', async () => {
  const result = await parseBudgetFinancialWorkbook(buildBudgetWorkbookBuffer());

  assert.equal(result.snapshot.reportMonthIso, '2026-03');
  assert.equal(result.snapshot.propertyName, 'STORE on Pittman');
  assert.equal(result.snapshot.financials?.expensesMtd, 2434.42);
  assert.equal(result.snapshot.financials?.totalOperatingExpenseMtd, 2434.42);
  assert.equal(result.snapshot.financials?.propertyExpensesMtd, 2434.42);
  assert.equal(result.snapshot.financials?.totalExpensesMtd, 5584.42);
  assert.equal(result.snapshot.financials?.otherExpensesMtd, 3150);
  assert.equal(result.snapshot.financials?.noiMtd, -2434.42);
  assert.equal(result.snapshot.financials?.netOperatingIncomeMtd, -2434.42);

  assert.equal(result.sources.propertyExpenses.token, 'TOTALPROPCM');
  assert.equal(result.sources.totalExpenses.token, 'TOTEXPCM');
  assert.equal(result.sources.otherExpenses?.token, 'TOTOTHEREXPCM');
  assert.equal(result.sources.noi.formula, 'NOI = Total Income - Total Property Expenses');
  assert.ok(
    result.warnings.includes('Property Expenses exclude Other Expenses and match the expense basis used for NOI.'),
  );
  assert.ok(
    result.warnings.includes('Total Expenses include Other Expenses and are shown separately for reference only.'),
  );
});
