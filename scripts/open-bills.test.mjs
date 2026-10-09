import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
const require = createRequire(import.meta.url);
const ts = require('typescript');
function load(file) {
  const compiled = { exports: {} };
  const js = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('require', 'module', 'exports', js)(name => name === './receipt-invoice-groups' ? load('src/lib/finance/receipt-invoice-groups.ts') : require(name), compiled, compiled.exports);
  return compiled.exports;
}
const { buildOpenBills } = load('src/lib/finance/open-bills.ts');
const bill = (overrides = {}) => ({ id: 'bill', project_id: 'job', vendor_name: 'Vendor', invoice_number: '100', invoice_date: '2026-10-01', due_date: null, amount: 100, paid_amount: 0, payment_status: 'unpaid', payment_method: null, source: 'office_entry', review_status: 'ok', review_reason: null, duplicate_of_id: null, split_group_id: null, estimate_line_item_id: 'line', pay_approval_status: 'pending', approved_for_pay_at: null, projects: { name: 'Completed project', project_number: 'PC-1' }, ...overrides });
const build = rows => buildOpenBills(rows, '2026-10-09');

test('zero balance with unpaid status stays a conflict, not a payable', () => {
  const summary = build([bill({ paid_amount: 100 })]);
  assert.equal(summary.bills.length, 0);
  assert.equal(summary.total, 0);
  assert.equal(summary.review.length, 1);
  assert.match(summary.review[0].reasons.join(), /conflicts/);
});
test('review flags, internal labor, missing allocation, and QB imports cannot inflate open bills', () => {
  for (const overrides of [{ review_status: 'needs_review', review_reason: 'Incoming check, not a bill', amount: 20000 }, { payment_method: 'internal' }, { vendor_name: 'In-House Labor' }, { estimate_line_item_id: null }, { source: 'qb_import' }, { amount: null }]) {
    const summary = build([bill(overrides)]);
    assert.equal(summary.total, 0);
    assert.equal(summary.review.length, 1);
  }
  assert.equal(build([bill({ duplicate_of_id: 'original' })]).review.length, 0);
});
test('split allocations count as one bill and partial payments reduce its remaining balance', () => {
  const summary = build([bill({ id: 'a', split_group_id: 'split', amount: 530.70, paid_amount: 100, payment_status: 'partial' }), bill({ id: 'b', split_group_id: 'split', amount: 122.10 })]);
  assert.equal(summary.bills.length, 1);
  assert.equal(summary.total, 552.8);
  assert.deepEqual(summary.bills[0].projects, ['Completed project']);
  assert.equal(summary.bills[0].overdueDays, null); // Invoice age is not overdue age.
});
test('repeat submissions and allocation conflicts are surfaced, never silently payable', () => {
  assert.equal(build([bill({ id: 'a' }), bill({ id: 'b' })]).bills.length, 0);
  const summary = build([bill({ id: 'a', split_group_id: 's' }), bill({ id: 'b', split_group_id: 's', review_status: 'needs_review' })]);
  assert.equal(summary.review.length, 1);
  assert.equal(summary.total, 0);
});
test('due-date aging and both approval workflows are honored; paid bills stay out', () => {
  const summary = build([bill({ due_date: '2026-10-07', approved_for_pay_at: '2026-10-08' })]);
  assert.equal(summary.bills[0].overdueDays, 2);
  assert.equal(summary.bills[0].approved, true);
  assert.equal(build([bill({ pay_approval_status: 'approved' })]).bills[0].approved, true);
  assert.equal(build([bill({ payment_status: 'paid' })]).bills.length, 0);
});

if (process.env.OPEN_BILLS_SNAPSHOT) test('current native source inventory reconciles the reported CEO error', () => {
  const { records } = JSON.parse(readFileSync(process.env.OPEN_BILLS_SNAPSHOT, 'utf8'));
  const summary = build(records);
  assert.equal(records.length, 23);
  assert.equal(summary.bills.length, 6);
  assert.equal(summary.total, 15545.36);
  assert.equal(summary.review.length, 12);
  assert.equal(summary.reviewBalance, 25319.2);
  assert.equal(summary.review.filter(row => row.amount === 0).length, 6);
  assert.ok(summary.review.some(row => row.amount === 20000));
  assert.ok(summary.bills.every(row => !row.projects.includes('Unassigned project')));
});
