import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const compiled = { exports: {} };
new Function('module', 'exports', ts.transpileModule(readFileSync('src/lib/finance/overview-cash.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(compiled, compiled.exports);
const { summarizeRecordedCash } = compiled.exports;

test('YTD includes receipts after the bank import cutoff and preserves reversals', () => {
  const receipts = [
    { received_date: '2026-09-11', amount: '100.25' },
    { received_date: '2026-10-08', amount: '200.75' },
    { received_date: '2026-10-09', amount: '-20' },
    { received_date: '2026-10-10', amount: 999 },
    { received_date: '2025-12-31', amount: 999 },
  ];
  assert.deepEqual(summarizeRecordedCash(receipts, [], [], '2026-10-09'), { received: 281, spent: 0, net: 281 });
});
test('cash out counts card payoff once, excludes internal labor and unpaid bills', () => {
  const base = { invoice_date: '2026-10-08', payment_status: 'paid', payment_method: 'check', amount: 100, paid_amount: null };
  const bills = [base, { ...base, amount: 800, payment_method: 'capital_one' }, { ...base, amount: 500, payment_method: 'internal' }, { ...base, payment_status: 'unpaid' }, { ...base, invoice_date: '2026-10-10' }];
  assert.deepEqual(summarizeRecordedCash([], bills, [{ txn_date: '2026-10-09', amount: 800 }], '2026-10-09'), { received: 0, spent: 900, net: -900 });
});
test('empty records are safe and year boundary follows the supplied Eastern date', () => {
  assert.deepEqual(summarizeRecordedCash([], [], [], '2027-01-01'), { received: 0, spent: 0, net: 0 });
  assert.equal(summarizeRecordedCash([{ received_date: '2026-12-31', amount: 500 }, { received_date: '2027-01-01', amount: 50 }], [], [], '2027-01-01').received, 50);
});
