import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const ts = require('typescript');
function load(path, imports = {}) {
  const compiled = { exports: {} };
  const code = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('module', 'exports', 'require', code)(compiled, compiled.exports, name => imports[name] ?? require(name));
  return compiled.exports;
}
const categories = load('src/lib/finance/spend-category.ts');
const { buildExpenseView, expenseCents } = load('src/lib/finance/expense-model.ts', { './spend-category': categories });
const period = { start: '2026-01-01', end: '2026-12-31' };
const bill = (overrides = {}) => ({
  id: 'bill', vendor_name: 'Local Lumber', vendor_type: 'supplier', trade: 'materials', description: null,
  invoice_number: 'B-1', amount: 100, paid_amount: null, invoice_date: '2026-10-01',
  payment_status: 'paid', payment_method: 'check', project_id: 'job-1', split_group_id: null,
  estimate_line_item_id: 'scope-1', projects: { name: 'Job One', project_number: 'PC-1', is_overhead: false },
  duplicate_of_id: null, source: 'manual', review_status: 'ok', ...overrides,
});

test('bill-date view counts paid, partial and unpaid costs; partial payments contribute to paid and open totals', () => {
  const view = buildExpenseView([
    bill({ id: 'paid' }), bill({ id: 'partial', amount: 78.25, paid_amount: 64.86, payment_status: 'partial' }),
    bill({ id: 'open', amount: 200, payment_status: 'unpaid' }),
  ], period);
  assert.equal(view.summary.netCents, 37825);
  assert.equal(view.summary.paidCents, 16486);
  assert.equal(view.summary.openCents, 21339);
  assert.equal(view.summary.paymentIssueCount, 0);
  assert.equal(view.summary.unknownPaymentCount, 0);
});

test('all card purchases are expenses and internal labor and duplicates are excluded', () => {
  const view = buildExpenseView([
    bill({ id: 'capone', payment_method: 'capital_one' }), bill({ id: 'card', payment_method: 'credit_card' }),
    bill({ id: 'amex', payment_method: 'amex' }), bill({ id: 'internal', payment_method: 'internal', amount: 999 }),
    bill({ id: 'placeholder', vendor_name: 'In-House Labor', amount: 999 }),
    bill({ id: 'duplicate', duplicate_of_id: 'capone', amount: 999 }),
  ], period);
  assert.equal(view.summary.netCents, 30000);
  assert.equal(view.summary.paidCents, 30000);
  assert.equal(view.summary.billCount, 3);
  assert.equal(view.excludedInternalCount, 2);
});

test('credits reduce costs without silently reducing unrelated unpaid bills', () => {
  const view = buildExpenseView([
    bill({ id: 'open', amount: 200, payment_status: 'unpaid' }),
    bill({ id: 'credit', amount: -30, paid_amount: null, payment_status: 'unpaid' }),
    bill({ id: 'refund', amount: -20, paid_amount: -20 }),
  ], period);
  assert.equal(view.summary.chargesCents, 20000);
  assert.equal(view.summary.creditsCents, 5000);
  assert.equal(view.summary.netCents, 15000);
  assert.equal(view.summary.openCents, 20000);
  assert.equal(view.summary.paidCents, -2000);
});

test('split bills preserve every project and category while summaries sum allocations once', () => {
  const records = [
    bill({ id: 'a', amount: 100, split_group_id: 'split' }),
    bill({ id: 'b', amount: 50, split_group_id: 'split', project_id: 'job-2', projects: { name: 'Job Two', project_number: 'PC-2', is_overhead: false }, vendor_name: 'Electrician Inc', vendor_type: 'subcontractor', trade: 'electrical' }),
    bill({ id: 'c', amount: -10, split_group_id: 'credit-split' }),
    bill({ id: 'd', amount: -20, split_group_id: 'credit-split', project_id: 'job-2', projects: { name: 'Job Two', project_number: 'PC-2', is_overhead: false } }),
  ];
  const view = buildExpenseView(records, period);
  assert.equal(view.summary.billCount, 2);
  assert.equal(view.summary.recordCount, 4);
  assert.equal(view.summary.netCents, 12000);
  const split = view.groups.find(group => group.key.startsWith('split:split:'));
  assert.deepEqual(split.projects, ['Job One', 'Job Two']);
  assert.equal(split.categories.length, 2);
  assert.equal(split.amountCents, 15000);
  assert.equal(split.allocations.length, 2);
});

test('category and allocation filters narrow summaries and split groups consistently', () => {
  const records = [
    bill({ id: 'a', amount: 100, split_group_id: 'split' }),
    bill({ id: 'b', amount: 40, split_group_id: 'split', vendor_name: 'Electrician Inc', vendor_type: 'subcontractor', trade: 'electrical', estimate_line_item_id: null }),
    bill({ id: 'c', amount: 30, project_id: null, projects: null }),
  ];
  const subs = buildExpenseView(records, { ...period, category: 'subs' });
  assert.equal(subs.summary.netCents, 4000);
  assert.equal(subs.groups[0].amountCents, 4000);
  assert.equal(subs.groups[0].filteredSplit, true);
  const unallocated = buildExpenseView(records, { ...period, unallocatedOnly: true });
  assert.equal(unallocated.summary.netCents, 7000);
  assert.equal(unallocated.summary.missingAllocationCount, 2);
  assert.equal(unallocated.summary.unassignedCents, 3000);
  assert.equal(unallocated.summary.overheadCents, 0);
});

test('missing job is never labeled overhead and recorded overhead remains separate', () => {
  const view = buildExpenseView([
    bill({ id: 'unassigned', project_id: null, projects: null, amount: 25 }),
    bill({ id: 'overhead', amount: 40, project_id: 'office', projects: { name: 'Office', project_number: 'PC-OH', is_overhead: true } }),
    bill({ id: 'job', amount: 50 }),
  ], period);
  assert.equal(view.summary.unassignedCents, 2500);
  assert.equal(view.summary.overheadCents, 4000);
  assert.equal(view.summary.projectCents, 5000);
  assert.equal(view.groups.find(g => g.id === 'unassigned').projects[0], 'Unassigned job');
});

test('null amounts, unresolved partial payments and explicit zero paid values remain visible issues', () => {
  const view = buildExpenseView([
    bill({ id: 'missing-amount', amount: null }),
    bill({ id: 'partial', payment_status: 'partial', paid_amount: null }),
    bill({ id: 'zero-paid', paid_amount: 0 }),
    bill({ id: 'negative-paid', payment_status: 'partial', paid_amount: -5 }),
  ], period);
  assert.equal(view.summary.invalidAmountCount, 1);
  assert.equal(view.summary.unknownPaymentCount, 3);
  assert.equal(view.summary.paymentIssueCount, 3);
  assert.equal(view.groups.find(g => g.id === 'zero-paid').paidCents, 0);
  assert.equal(view.groups.find(g => g.id === 'partial').openCents, null);
  assert.equal(view.groups.find(g => g.id === 'negative-paid').openCents, null);
});

test('undated rows stay outside period totals and QB imports are labeled for source verification', () => {
  const view = buildExpenseView([
    bill({ id: 'dated', source: 'qb_bill', amount: 60 }),
    bill({ id: 'undated', invoice_date: null, amount: 999 }),
    bill({ id: 'last-year', invoice_date: '2025-12-31', amount: 999 }),
  ], period);
  assert.equal(view.summary.netCents, 6000);
  assert.equal(view.summary.qbImportedCount, 1);
  assert.equal(view.summary.reviewCount, 1);
  assert.equal(view.undatedCount, 1);
  assert.equal(view.undatedRecords[0].id, 'undated');
});

test('mixed-date splits retain their own bill dates and period filters cannot pull in another month', () => {
  const records = [bill({ id: 'sept', split_group_id: 'split', invoice_date: '2026-09-30', amount: 40 }), bill({ id: 'oct', split_group_id: 'split', amount: 60 })];
  const wholeYear = buildExpenseView(records, period);
  assert.equal(wholeYear.groups.length, 2);
  assert.equal(wholeYear.summary.billCount, 1);
  assert.equal(wholeYear.summary.netCents, 10000);
  assert.ok(wholeYear.groups.every(g => g.reasons.includes('Split allocations have different bill dates')));
  const october = buildExpenseView(records, { start: '2026-10-01', end: '2026-10-31' });
  assert.equal(october.summary.netCents, 6000);
  assert.equal(october.groups[0].id, 'oct');
});

test('decimal arithmetic stays in cents and malformed numeric amounts never become zero', () => {
  assert.equal(expenseCents('0.10'), 10);
  assert.equal(expenseCents('-0.10'), -10);
  assert.equal(expenseCents(''), null);
  assert.equal(expenseCents('invalid'), null);
  const view = buildExpenseView([bill({ id: 'a', amount: '0.10' }), bill({ id: 'b', amount: '0.20' })], period);
  assert.equal(view.summary.netCents, 30);
});

test('repeated submissions are flagged while legitimate split allocations stay one bill', () => {
  const view = buildExpenseView([
    bill({ id: 'a', split_group_id: 'split' }), bill({ id: 'b', split_group_id: 'split', amount: 50 }),
    bill({ id: 'repeat', amount: 150 }),
  ], period);
  assert.equal(view.summary.billCount, 2);
  assert.equal(view.summary.netCents, 30000);
  assert.equal(view.summary.reviewCount, 3);
  assert.ok(view.groups.every(group => group.reasons.includes('Possible repeated bill submission — verify the source')));
  const legitimate = buildExpenseView([bill({ id: 'a', split_group_id: 'split' }), bill({ id: 'b', split_group_id: 'split', amount: 50 })], period);
  assert.equal(legitimate.summary.reviewCount, 0);
});

test('known payment subtotals exclude conflicting paid-zero records and retain valid partial payments', () => {
  const view = buildExpenseView([
    bill({ id: 'paid-zero', amount: 100, payment_status: 'paid', paid_amount: 0 }),
    bill({ id: 'partial', amount: 78.25, paid_amount: 64.86, payment_status: 'partial' }),
    bill({ id: 'open', amount: 20, paid_amount: 0, payment_status: 'unpaid' }),
    bill({ id: 'missing', amount: 50, paid_amount: null, payment_status: 'partial' }),
  ], period);
  assert.equal(view.summary.knownPaidCents, 6486);
  assert.equal(view.summary.knownOpenCents, 3339);
  assert.equal(view.summary.knownPaymentCount, 2);
  assert.equal(view.summary.unresolvedPaymentCount, 2);
  assert.equal(view.summary.netCents, 24825);
  const unresolvedOnly = buildExpenseView([bill({ paid_amount: 0, payment_status: 'paid' })], period);
  assert.equal(unresolvedOnly.summary.knownPaymentCount, 0);
  assert.equal(unresolvedOnly.summary.unresolvedPaymentCount, 1);
  assert.equal(unresolvedOnly.summary.knownOpenCents, 0);
});
