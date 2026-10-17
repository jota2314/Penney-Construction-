import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const compiled = { exports: {} };
new Function('module', 'exports', ts.transpileModule(readFileSync('src/lib/finance/overview-cash.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(compiled, compiled.exports);
const { summarizeCashFlow, summarizeRecordedActivity } = compiled.exports;

const bill = (overrides = {}) => ({ invoice_date: '2026-10-08', paid_date: '2026-10-09', payment_status: 'paid', payment_method: 'check', amount: 100, paid_amount: null, ...overrides });
const bank = (overrides = {}) => ({ txn_date: '2026-09-30', source: 'eastern_ach', direction: 'debit', amount: 100, ...overrides });
const receipt = (overrides = {}) => ({ received_date: '2026-10-09', amount: 100, ...overrides });

test('unlinked bank payroll is included once independently of payroll bills and internal labor', () => {
  const payroll = bank({ id: 'payroll', description: 'ADP WAGE PAY', amount: '15000.25' });
  const result = summarizeCashFlow([], [bill({ amount: 15000.25 }), bill({ amount: 500, payment_method: 'internal' })], [payroll, { ...payroll }], '2026-10-17');
  assert.equal(result.bank.spent, 15000.25);
  assert.equal(result.bank.payroll, 15000.25);
  assert.equal(result.bank.count, 1);
  assert.equal(result.later.records.paidBills, 15000.25);
  assert.equal('net' in result.later.records, false);
});

test('card purchases stay in records and only checking payoff enters bank cash', () => {
  const bills = ['capital_one', 'credit_card', 'amex'].map(payment_method => bill({ payment_method, amount: 250 }));
  const result = summarizeCashFlow([], bills, [bank({ amount: 800, category_key: 'card_payoff' }), bank({ source: 'capone', amount: 750 })], '2026-10-17');
  assert.equal(result.bank.spent, 800);
  assert.equal(result.bank.cardPayoff, 800);
  assert.equal(result.later.records.paidBills, 750);
  assert.equal(result.later.records.cardPurchases, 750);
  assert.equal(result.later.records.directPayments, 0);
});

test('returned deposits remain gross bank debit and deposit once; book reversals cannot duplicate them', () => {
  const result = summarizeCashFlow([receipt({ received_date: '2026-09-30', amount: -8615 })], [], [bank({ direction: 'credit', amount: 8615 }), bank({ description: 'RETURN DEPOSIT ITEM', amount: 8615 })], '2026-10-17');
  assert.equal(result.bank.received, 8615);
  assert.equal(result.bank.spent, 8615);
  assert.equal(result.bank.net, 0);
  assert.equal(result.months[8].records.received, -8615);
  assert.equal(result.later.records.received, 0);
});

test('partial payments use explicit paid amount, payment date, and estimated-date warnings', () => {
  const result = summarizeRecordedActivity([], [
    bill({ invoice_date: '2025-12-20', paid_date: '2026-10-12', amount: 1000, paid_amount: 200, payment_status: 'partial' }),
    bill({ paid_date: null, amount: 1000, paid_amount: 50, payment_status: 'partial' }),
    bill({ paid_date_source: 'invoice_date_00129', amount: 25 }),
    bill({ paid_date_source: 'legacy_backfill', amount: 30 }),
    bill({ payment_status: 'partial', paid_amount: null, amount: 1000 }),
    bill({ payment_status: 'unpaid', paid_amount: 999, amount: 1000 }),
    bill({ duplicate_of_id: 'other', amount: 5000 }),
  ], '2026-10-01', '2026-10-17');
  assert.equal(result.paidBills, 305);
  assert.equal(result.directPayments, 305);
  assert.equal(result.paidBillCount, 4);
  assert.equal(result.estimatedDateCount, 3);
});

test('records distinguish direct, card, and unknown payments with cents preserved', () => {
  const bills = ['check', 'ach', 'cash', 'wire', 'debit_card', null, 'on_account'].map(payment_method => bill({ payment_method, amount: '0.10' }));
  const result = summarizeRecordedActivity([receipt({ amount: '0.30' }), receipt({ amount: '-0.10' })], bills, '2026-10-01', '2026-10-17');
  assert.equal(result.received, 0.2);
  assert.equal(result.paidBills, 0.7);
  assert.equal(result.directPayments, 0.5);
  assert.equal(result.unclassifiedPayments, 0.2);
});

test('partial bills with missing, zero, negative, or invalid payment amounts warn without guessing totals', () => {
  const uncertain = [null, 0, -5, 'invalid'].map((paid_amount, index) => bill({ id: `partial-${index}`, payment_status: 'partial', paid_amount, amount: 1000 }));
  const result = summarizeRecordedActivity([], [
    ...uncertain,
    bill({ id: 'undated-partial', payment_status: 'partial', paid_amount: null, paid_date: null, invoice_date: null, amount: 2000 }),
    bill({ payment_status: 'partial', paid_amount: 30, amount: 1000 }),
    bill({ amount: 20 }),
  ], '2026-10-01', '2026-10-17');
  assert.equal(result.unresolvedPaymentAmounts, 5);
  assert.deepEqual(result.unresolvedPaymentIds, ['partial-0', 'partial-1', 'partial-2', 'partial-3', 'undated-partial']);
  assert.equal(result.undatedPayments, 1);
  assert.equal(result.undatedPaymentAmount, 0);
  assert.equal(result.paidBills, 50);
  assert.equal(result.paidBillCount, 2);
});

test('out-of-period malformed amounts do not hide current-period or undated records', () => {
  const result = summarizeRecordedActivity([
    receipt({ received_date: '2025-12-31', amount: null }),
    receipt({ received_date: '2026-11-01', amount: 'invalid' }),
    receipt({ amount: 20 }),
    receipt({ received_date: null, amount: 3 }),
  ], [
    bill({ paid_date: '2025-12-31', amount: null, paid_amount: 'invalid' }),
    bill({ paid_date: '2026-11-01', amount: 'invalid' }),
    bill({ amount: 10 }),
    bill({ paid_date: null, invoice_date: null, amount: 5 }),
  ], '2026-10-01', '2026-10-17');
  assert.equal(result.received, 20);
  assert.equal(result.paidBills, 10);
  assert.equal(result.undatedReceipts, 1);
  assert.equal(result.undatedReceiptAmount, 3);
  assert.equal(result.undatedPayments, 1);
  assert.equal(result.undatedPaymentAmount, 5);
});

test('missing and invalid payment dates remain visible', () => {
  const result = summarizeRecordedActivity([receipt({ received_date: null, amount: 75 })], [
    bill({ paid_date: null, invoice_date: null, amount: 25 }),
    bill({ paid_date: '2026-02-30', invoice_date: 'bad', amount: 50 }),
    bill({ paid_date: 'bad', invoice_date: '2026-10-08', amount: 10 }),
  ], '2026-10-01', '2026-10-17');
  assert.equal(result.undatedPayments, 2);
  assert.equal(result.undatedPaymentAmount, 75);
  assert.equal(result.undatedReceipts, 1);
  assert.equal(result.undatedReceiptAmount, 75);
  assert.equal(result.invalidDateCount, 3);
  assert.equal(result.estimatedDateCount, 1);
  assert.equal(result.paidBills, 10);
});

test('year and today bounds exclude previous years and future bank/record activity', () => {
  const result = summarizeCashFlow([
    receipt({ received_date: '2025-12-31', amount: 999 }),
    receipt({ received_date: '2026-01-01', amount: 50 }),
    receipt({ received_date: '2026-10-18', amount: 999 }),
  ], [bill({ paid_date: '2026-10-18', amount: 999 })], [
    bank({ txn_date: '2025-12-31', amount: 999 }),
    bank({ txn_date: '2026-01-01', amount: 10 }),
    bank({ txn_date: '2026-10-18', amount: 999 }),
  ], '2026-10-17');
  assert.equal(result.bank.spent, 10);
  assert.equal(result.bank.through, '2026-01-01');
  assert.equal(result.months[0].records.received, 50);
  assert.equal(result.later.records.paidBills, 0);
  assert.equal(result.months[10].records.received, 0);
});

test('bank gaps stay empty and later records start after the final imported transaction, not next month', () => {
  const result = summarizeCashFlow([receipt({ received_date: '2026-09-15', amount: 90 }), receipt({ amount: 100 })], [bill()], [bank({ txn_date: '2026-01-02' }), bank({ txn_date: '2026-09-11' })], '2026-10-17');
  assert.equal(result.bank.firstDate, '2026-01-02');
  assert.equal(result.bank.through, '2026-09-11');
  assert.equal(result.months[1].bank.count, 0);
  assert.equal(result.months[1].bank.through, null);
  assert.equal(result.later.from, '2026-09-12');
  assert.equal(result.later.records.received, 190);
  assert.equal(result.later.records.paidBills, 100);
  assert.equal('complete' in result.bank, false);
  assert.equal('bankBalance' in result, false);
});

test('without bank imports, all current-year records remain provisional', () => {
  const result = summarizeCashFlow([receipt()], [bill()], [], '2026-10-17');
  assert.equal(result.bank.count, 0);
  assert.equal(result.bank.firstDate, null);
  assert.equal(result.bank.through, null);
  assert.equal(result.later.from, '2026-01-01');
  assert.equal(result.later.records.received, 100);
  assert.equal(result.later.records.paidBills, 100);
  assert.equal(result.months.length, 12);
});

test('September imported control reconciles exactly without replacing October records', () => {
  const result = summarizeCashFlow([receipt({ amount: '272391.32' })], [bill({ amount: '219497.61' })], [
    bank({ direction: 'credit', amount: '2937922.90' }),
    bank({ direction: 'debit', amount: '2707358.39' }),
  ], '2026-10-17');
  assert.equal(result.bank.received, 2937922.9);
  assert.equal(result.bank.spent, 2707358.39);
  assert.equal(result.bank.net, 230564.51);
  assert.equal(result.later.records.received, 272391.32);
  assert.equal(result.later.records.paidBills, 219497.61);
});

test('identical IDs deduplicate while conflicting records and invalid bank inputs fail loudly', () => {
  const r = receipt({ id: 'receipt-1' });
  const b = bill({ id: 'bill-1' });
  const totals = summarizeRecordedActivity([r, { ...r }], [b, { ...b }], '2026-10-01', '2026-10-17');
  assert.equal(totals.received, 100);
  assert.equal(totals.paidBills, 100);
  assert.throws(() => summarizeRecordedActivity([r, { ...r, amount: 101 }], [], '2026-10-01', '2026-10-17'), /Conflicting receipt/);
  assert.throws(() => summarizeCashFlow([], [], [bank({ id: 'same' }), bank({ id: 'same', amount: 101 })], '2026-10-17'), /Conflicting bank/);
  for (const amount of [null, '', 'not-money', -100, Infinity]) {
    assert.throws(() => summarizeCashFlow([], [], [bank({ amount })], '2026-10-17'), /amount/);
  }
  assert.throws(() => summarizeCashFlow([], [], [bank({ direction: 'unknown' })], '2026-10-17'), /direction/);
  assert.throws(() => summarizeCashFlow([], [], [bank({ txn_date: '2026-02-30' })], '2026-10-17'), /date/);
});
