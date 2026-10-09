import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const compiled = { exports: {} };
const js = ts.transpileModule(readFileSync('src/lib/finance/payment-classification.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
new Function('module', 'exports', js)(compiled, compiled.exports);
const { classifyPayment } = compiled.exports;

test('a payment explicitly recorded as change_order does not require a single CO link', () => {
  assert.equal(classifyPayment({ payment_type: 'change_order', change_order_id: null }), 'change_order');
});
test('CO link precedence and existing stage classifications are preserved', () => {
  for (const payment_type of ['deposit', 'final', 'progress', 'draw', 'change_order', null]) {
    assert.equal(classifyPayment({ payment_type, change_order_id: 'linked-co' }), 'change_order');
  }
  for (const [payment_type, expected] of [['deposit', 'deposit'], ['final', 'final'], ['progress', 'progress'], ['draw', 'progress'], [null, 'progress'], ['other', 'progress']]) {
    assert.equal(classifyPayment({ payment_type, change_order_id: null }), expected);
  }
});
test('October receipt regression: CO filter and rollups count the $14,780 once', () => {
  // Native Penney receipts for October 1–9, 2026; cents to keep reconciliation exact.
  const receipts = [
    ['deposit', 2000000], ['final', 1592775], ['final', 3039600],
    ['progress', 1422215], ['change_order', 1478000], ['deposit', 726000],
    ['final', 1200000], ['deposit', 2011506],
  ].map(([payment_type, amount]) => ({ payment_type, amount, change_order_id: null }));
  const sum = rows => rows.reduce((total, row) => total + row.amount, 0);
  const coRows = receipts.filter(row => classifyPayment(row) === 'change_order');
  assert.equal(coRows.length, 1);
  assert.equal(sum(coRows), 1478000);
  assert.equal(sum(receipts.filter(row => classifyPayment(row) === 'progress')), 1422215);
  assert.equal(sum(receipts), 13470096);
  assert.equal(['deposit', 'progress', 'final', 'change_order'].reduce((total, kind) => total + sum(receipts.filter(row => classifyPayment(row) === kind)), 0), sum(receipts));
});
