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

test('year-to-date record headlines include October despite a September bank cutoff', () => {
  const result = summarizeCashFlow([
    receipt({ received_date: '2026-09-01', amount: 100 }), receipt({ amount: 200 }),
  ], [bill({ paid_date: '2026-09-01', amount: 50 }), bill({ amount: 75 })], [bank()], '2026-10-17');
  assert.equal(result.yearToDate.received, 300);
  assert.equal(result.yearToDate.paidBills, 125);
  assert.equal(result.later.records.received, 200);
  assert.equal(result.months[9].records.paidBills, 75);
  assert.equal('net' in result.yearToDate, false);
  assert.equal('spent' in result.yearToDate, false);
});

test('payroll diagnostic recognizes ADP bills but never Adpro or duplicate/internal bills', () => {
  const result = summarizeCashFlow([], [
    bill({ vendor_name: 'ADP Payroll', source: 'bank_reconcile_payroll', paid_date: '2026-09-30', amount: 100 }),
    bill({ vendor_name: 'Adpro Design', amount: 680 }),
    bill({ vendor_name: 'ADP Payroll', paid_date: '2026-09-30', amount: 500, duplicate_of_id: 'original' }),
    bill({ vendor_name: 'ADP Payroll', paid_date: '2026-09-30', amount: 600, payment_method: 'internal' }),
  ], [bank({ description: 'ADP WAGE PAY', amount: 100 })], '2026-10-17');
  assert.equal(result.payroll.recordedADPpayroll, 100);
  assert.equal(result.payroll.bankPayroll, 100);
  assert.equal(result.payroll.additionalBankPayroll, 0);
  assert.deepEqual(result.payroll.uncertainOverlapMonths, []);
  assert.equal(result.months[8].payroll.recordedBillCount, 1);
  assert.equal(result.yearToDate.paidBills, 780);
});

test('candidate additional bank payroll is reported only in zero-payroll-bill months, never added to spending', () => {
  const result = summarizeCashFlow([], [
    bill({ vendor_name: 'ADP Payroll', paid_date: '2026-07-31', amount: 100 }),
    bill({ vendor_name: 'Vendor', amount: 300 }),
  ], [
    bank({ txn_date: '2026-07-31', description: 'ADP WAGE PAY', amount: 100 }),
    bank({ txn_date: '2026-08-31', description: 'ADP Tax', amount: 120 }),
    bank({ txn_date: '2026-09-30', description: 'ADP PAYROLL FEES', amount: 20 }),
  ], '2026-10-17');
  assert.equal(result.payroll.recordedADPpayroll, 100);
  assert.equal(result.payroll.bankPayroll, 240);
  assert.equal(result.payroll.additionalBankPayroll, 140);
  assert.equal(result.payroll.bankPayrollThrough, '2026-09-30');
  assert.equal(result.months[6].payroll.additionalBankPayroll, 0);
  assert.equal(result.months[7].payroll.additionalBankPayroll, 120);
  assert.equal(result.months[8].payroll.additionalBankPayroll, 20);
  assert.equal(result.yearToDate.paidBills, 400);
});

test('partial payroll overlap is flagged without adding an aggregate difference', () => {
  const result = summarizeCashFlow([], [
    bill({ vendor_name: 'ADP Payroll', paid_date: '2026-09-30', payment_status: 'partial', paid_amount: 40, amount: 100 }),
  ], [bank({ description: 'ADP WAGE PAY', amount: 100 })], '2026-10-17');
  assert.equal(result.payroll.recordedADPpayroll, 40);
  assert.equal(result.payroll.additionalBankPayroll, 0);
  assert.deepEqual(result.payroll.uncertainOverlapMonths, ['2026-09']);
  assert.equal(result.months[8].payroll.overlapUncertain, true);
});

test('unresolved and undated payroll candidates prevent an unsupported additional amount', () => {
  const unresolved = summarizeCashFlow([], [
    bill({ vendor_name: 'ADP Payroll', paid_date: '2026-09-30', payment_status: 'partial', paid_amount: null }),
  ], [bank({ description: 'ADP WAGE PAY', amount: 100 })], '2026-10-17');
  assert.equal(unresolved.payroll.additionalBankPayroll, 0);
  assert.equal(unresolved.months[8].payroll.recordedBillCount, 1);
  assert.deepEqual(unresolved.payroll.uncertainOverlapMonths, ['2026-09']);
  const undated = summarizeCashFlow([], [
    bill({ vendor_name: 'ADP Payroll', paid_date: null, invoice_date: null, amount: 100 }),
  ], [bank({ description: 'ADP WAGE PAY', amount: 100 })], '2026-10-17');
  assert.equal(undated.payroll.additionalBankPayroll, 0);
  assert.equal(undated.payroll.undatedBillCount, 1);
  assert.deepEqual(undated.payroll.uncertainOverlapMonths, ['2026-09']);
});

test('absence of imported payroll has null coverage, not a complete zero-payroll claim', () => {
  const result = summarizeCashFlow([], [bill({ vendor_name: 'ADP Payroll', amount: 100 })], [bank({ description: 'Vendor ACH' })], '2026-10-17');
  assert.equal(result.payroll.bankPayroll, 0);
  assert.equal(result.payroll.bankPayrollThrough, null);
  assert.equal(result.payroll.additionalBankPayroll, 0);
  assert.equal(result.months[9].payroll.recordedADPpayroll, 100);
  assert.equal(result.months[9].payroll.bankPayrollCount, 0);
  assert.equal('complete' in result.payroll, false);
});

test('internal labor vendors never enter paid records even with missing or wrong payment methods', () => {
  const result = summarizeRecordedActivity([], [
    bill({ id: 'placeholder-null', vendor_name: 'In-House Labor', payment_method: null, amount: 100 }),
    bill({ id: 'placeholder-card', vendor_name: 'Penney Construction (Labor)', payment_method: 'capital_one', amount: 200 }),
    bill({ id: 'placeholder-check', vendor_name: ' in house labor ', payment_method: 'check', amount: 300 }),
    bill({ id: 'disposal', vendor_name: 'In House Disposal LLC', amount: 40 }),
    bill({ id: 'subcontractor', vendor_name: 'Other Labor Contractor', amount: 50 }),
  ], '2026-10-01', '2026-10-31');
  assert.equal(result.paidBills, 90);
  assert.equal(result.directPayments, 90);
  assert.equal(result.cardPurchases, 0);
  assert.equal(result.unclassifiedPayments, 0);
  assert.equal(result.paidBillCount, 2);
  assert.equal(result.paymentIssueCount, 0);
});

test('explicit zero on a paid bill is held for review while null legacy paid amount may use the book status', () => {
  const result = summarizeRecordedActivity([], [
    bill({ id: 'explicit-zero', amount: 1000, paid_amount: 0 }),
    bill({ id: 'credit-zero', amount: -25, paid_amount: 0 }),
    bill({ id: 'legacy-null', amount: 20, paid_amount: null }),
    bill({ id: 'empty-bill', amount: 0, paid_amount: 0 }),
  ], '2026-10-01', '2026-10-31');
  assert.equal(result.paidBills, 20);
  assert.equal(result.paidBillCount, 2);
  assert.equal(result.paymentIssueCount, 2);
  assert.deepEqual(result.paymentIssueIds, ['explicit-zero', 'credit-zero']);
  assert.equal(result.unresolvedPaymentAmounts, 0); // This older counter is partial records only.
});

test('paid status must agree with the full face amount and valid partial payments stay strictly inside it', () => {
  const invalid = [
    bill({ id: 'paid-short', amount: 100, paid_amount: 40 }),
    bill({ id: 'paid-over', amount: 100, paid_amount: 110 }),
    bill({ id: 'paid-negative', amount: 100, paid_amount: -10 }),
    bill({ id: 'partial-zero', payment_status: 'partial', amount: 100, paid_amount: 0 }),
    bill({ id: 'partial-full', payment_status: 'partial', amount: 100, paid_amount: 100 }),
    bill({ id: 'partial-over', payment_status: 'partial', amount: 100, paid_amount: 110 }),
    bill({ id: 'partial-negative', payment_status: 'partial', amount: 100, paid_amount: -10 }),
  ];
  const result = summarizeRecordedActivity([], [...invalid,
    bill({ id: 'valid-partial', payment_status: 'partial', amount: 100, paid_amount: 30 }),
    bill({ id: 'valid-paid', amount: 100, paid_amount: 100 }),
  ], '2026-10-01', '2026-10-31');
  assert.equal(result.paidBills, 130);
  assert.equal(result.paidBillCount, 2);
  assert.equal(result.paymentIssueCount, 7);
  assert.deepEqual(result.paymentIssueIds, invalid.map(row => row.id));
  assert.equal(result.unresolvedPaymentAmounts, 4);
});

test('credit records preserve signed amounts but inconsistent signs or excessive applications stay unresolved', () => {
  const result = summarizeRecordedActivity([], [
    bill({ id: 'paid-credit', amount: -100, paid_amount: -100, payment_method: 'credit_card' }),
    bill({ id: 'legacy-credit', amount: -20, paid_amount: null, payment_method: 'credit_card' }),
    bill({ id: 'partial-credit', amount: -100, paid_amount: -30, payment_status: 'partial', payment_method: 'credit_card' }),
    bill({ id: 'positive-credit-payment', amount: -100, paid_amount: 30, payment_status: 'partial' }),
    bill({ id: 'excess-credit-payment', amount: -100, paid_amount: -130, payment_status: 'partial' }),
    bill({ id: 'full-partial-credit', amount: -100, paid_amount: -100, payment_status: 'partial' }),
    bill({ id: 'short-paid-credit', amount: -100, paid_amount: -30 }),
    bill({ id: 'unrelated-bill', amount: 200, paid_amount: 200 }),
  ], '2026-10-01', '2026-10-31');
  assert.equal(result.paidBills, 50);
  assert.equal(result.cardPurchases, -150);
  assert.equal(result.directPayments, 200);
  assert.equal(result.paymentIssueCount, 4);
  assert.equal(result.unresolvedPaymentAmounts, 3);
});

test('payment issue warnings follow the selected period while partial inventory issues stay visible', () => {
  const result = summarizeRecordedActivity([], [
    bill({ id: 'october-zero', paid_amount: 0 }),
    bill({ id: 'september-zero', paid_date: '2026-09-30', paid_amount: 0 }),
    bill({ id: 'november-partial', paid_date: '2026-11-01', payment_status: 'partial', paid_amount: 0 }),
    bill({ id: 'undated-paid', invoice_date: null, paid_date: null, paid_amount: 0 }),
    bill({ id: 'undated-partial', invoice_date: null, paid_date: null, payment_status: 'partial', paid_amount: null }),
    bill({ id: 'coherent', amount: 10, paid_amount: 10 }),
  ], '2026-10-01', '2026-10-31');
  assert.equal(result.paidBills, 10);
  assert.equal(result.paymentIssueCount, 1);
  assert.deepEqual(result.paymentIssueIds, ['october-zero']);
  assert.equal(result.unresolvedPaymentAmounts, 2);
  assert.deepEqual(result.unresolvedPaymentIds, ['november-partial', 'undated-partial']);
  assert.equal(result.undatedPayments, 2);
  assert.equal(result.undatedPaymentAmount, 0);
});

test('missing or malformed face/payment values stay unresolved instead of becoming a paid subtotal', () => {
  const result = summarizeRecordedActivity([], [
    bill({ id: 'missing-face', amount: null, paid_amount: 50 }),
    bill({ id: 'bad-face', amount: 'bad', paid_amount: 50 }),
    bill({ id: 'bad-paid', amount: 100, paid_amount: 'bad' }),
    bill({ id: 'valid', amount: 15, paid_amount: 15 }),
  ], '2026-10-01', '2026-10-31');
  assert.equal(result.paidBills, 15);
  assert.equal(result.paymentIssueCount, 3);
  assert.equal(result.paidBillCount, 1);
});

test('contradictory ADP bill evidence keeps payroll overlap unresolved even if the recorded subtotal matches by coincidence', () => {
  const result = summarizeCashFlow([], [
    bill({ id: 'valid-adp', vendor_name: 'ADP', paid_date: '2026-09-30', amount: 100, paid_amount: 100 }),
    bill({ id: 'zero-adp', vendor_name: 'ADP', paid_date: '2026-09-30', amount: 100, paid_amount: 0 }),
  ], [bank({ description: 'ADP WAGE PAY', amount: 100 })], '2026-10-17');
  assert.equal(result.payroll.recordedADPpayroll, 100);
  assert.equal(result.payroll.additionalBankPayroll, 0);
  assert.deepEqual(result.payroll.uncertainOverlapMonths, ['2026-09']);
  assert.equal(result.months[8].records.paymentIssueCount, 1);
});
