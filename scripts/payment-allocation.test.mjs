import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { createRequire } from 'node:module';

const code = ts.transpileModule(readFileSync('src/lib/finance/payment-allocation.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const exports = {};
new Function('exports', code)(exports);
const { paymentBucket, summarizePayments, groupPaymentRows } = exports;
const row = (overrides = {}) => ({
  id: 'invoice', vendor_name: 'Supplier', description: 'Materials', amount: 100, paid_amount: 100,
  payment_status: 'paid', project_id: 'office', projects: { is_overhead: true },
  split_group_id: null, review_status: 'ok', ...overrides,
});

test('settlement of an allocated purchase never becomes overhead', () => {
  const summary = summarizePayments([
    row({ id: 'job', project_id: 'job', projects: { is_overhead: false }, amount: 284, paid_amount: 284 }),
    row({ id: 'bank:payoff', project_id: null, projects: null, amount: 850, paid_amount: 850 }),
  ]);
  assert.equal(summary.project.total, 284);
  assert.equal(summary.card.total, 850);
  assert.equal(summary.overhead.total, 0);
});

test('split allocations survive either input order and filtering before grouping', () => {
  const parts = [
    row({ id: 'unassigned', project_id: null, projects: null, split_group_id: 'ez', amount: 566, paid_amount: 566 }),
    row({ id: 'merluzzi', project_id: 'job', projects: { is_overhead: false }, split_group_id: 'ez', amount: 284, paid_amount: 284 }),
  ];
  for (const rows of [parts, [...parts].reverse()]) {
    const summary = summarizePayments(rows);
    assert.equal(summary.overhead.total, 0);
    assert.equal(summary.project.total, 284);
    assert.equal(summary.review.total, 566);
    const [group] = groupPaymentRows(rows);
    assert.equal(group.amount, 850);
    assert.equal(group.allocations.length, 2);
    const [jobGroup] = groupPaymentRows(rows.filter(r => paymentBucket(r) === 'project'));
    assert.equal(jobGroup.amount, 284);
  }
  assert.equal(parts[0].amount, 566, 'grouping must not mutate invoice input');
});

test('ADP, assets, missing jobs, flagged overhead and loans remain separate', () => {
  assert.equal(paymentBucket(row({ vendor_name: 'ADP Payroll' })), 'payroll');
  assert.equal(paymentBucket(row({ vendor_name: 'AdPro Design' })), 'overhead');
  assert.equal(paymentBucket(row({ is_capex: true })), 'capital');
  assert.equal(paymentBucket(row({ project_id: null })), 'review');
  assert.equal(paymentBucket(row({ projects: null })), 'review');
  assert.equal(paymentBucket(row({ review_status: 'needs_review' })), 'review');
  assert.equal(paymentBucket(row({ description: 'Loan repayment to owner; principal/interest pending' })), 'review');
  assert.equal(paymentBucket(row({ projects: [{ is_overhead: true }] })), 'overhead');
  assert.equal(paymentBucket(row({ project_id: 'job', projects: { is_overhead: false }, review_status: 'needs_review' })), 'project');
});

test('signed credits, cents and paid/unpaid split siblings reconcile', () => {
  const rows = [
    row({ id: 'paid', split_group_id: 'mixed', paid_amount: 100.01 }),
    row({ id: 'unpaid', split_group_id: 'mixed', payment_status: 'unpaid', paid_amount: 0, amount: 80 }),
    row({ id: 'credit', paid_amount: -19.99, amount: -19.99 }),
    row({ id: 'legacy', paid_amount: null, amount: 10 }),
  ];
  const summary = summarizePayments(rows);
  assert.equal(summary.overhead.total, 90.02);
  assert.equal(summary.overhead.count, 3);
  assert.equal(groupPaymentRows(rows)[0].payment_status, 'partial');
  assert.equal(Object.values(summary).reduce((s, x) => s + x.total, 0), 90.02);
});

test('multiple jobs and overhead under one bill remain separate totals', () => {
  const rows = [
    row({ id: 'a', split_group_id: 'bill', project_id: 'job-a', projects: { is_overhead: false }, amount: 40, paid_amount: 40 }),
    row({ id: 'b', split_group_id: 'bill', project_id: 'job-b', projects: { is_overhead: false }, amount: 35, paid_amount: 35 }),
    row({ id: 'c', split_group_id: 'bill', amount: 25, paid_amount: 25 }),
  ];
  const summary = summarizePayments(rows);
  assert.equal(summary.project.total, 75);
  assert.equal(summary.project.count, 1);
  assert.equal(summary.overhead.total, 25);
  assert.equal(groupPaymentRows(rows).length, 1);
});

test('expense page renders separate payments and drills into the correct split piece', async () => {
  const require = createRequire(import.meta.url);
  const { renderToStaticMarkup } = require('react-dom/server');
  const React = require('react');
  const compile = path => ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const categories = {};
  new Function('exports', compile('src/lib/finance/spend-category.ts'))(categories);
  const invoices = [
    row({ id: 'remaining', split_group_id: 'ez', project_id: null, projects: null, amount: 566, paid_amount: 566 }),
    row({ id: 'merluzzi', split_group_id: 'ez', project_id: 'job', projects: { is_overhead: false, name: 'Merluzzi Basement' }, amount: 284, paid_amount: 284 }),
    row({ id: 'office', vendor_name: 'Office rent' }),
    row({ id: 'adp', vendor_name: 'ADP Payroll', amount: 1000, paid_amount: 1000 }),
    row({ id: 'vans', vendor_name: 'Vans', is_capex: true, amount: 45000, paid_amount: 45000 }),
  ].map(r => ({ ...r, invoice_date: '2026-09-10', estimate_line_item_id: 'line' }));
  const db = { from(table) {
    const query = {
      select() { return query; }, gte() { return query; }, lte() { return query; },
      eq() { return query; }, order() { return query; },
      range() { return Promise.resolve({ data: invoices }); },
      then(resolve) { return Promise.resolve({ data: table === 'bank_transactions' ? [{ id: 'payoff', txn_date: '2026-09-10', amount: 850, description: 'CAPITAL ONE' }] : [] }).then(resolve); },
    };
    return query;
  } };
  const mocks = {
    'next/link': { default: ({ children, ...props }) => React.createElement('a', props, children) },
    '@/components/layout/header': { Header: () => null },
    '@/components/finances/finance-tabs': { FinanceTabs: () => null },
    '@/lib/auth/require-auth': { requireAuth: async () => {} },
    '@/lib/supabase/server': { createClient: async () => db },
    '@/lib/actions/field-capture': { countCapturesForReview: async () => 0 },
    '@/lib/time-range': { computePeriod: () => ({ start: '2026-09-01', end: '2026-09-30', label: 'September 2026' }) },
    '@/lib/finance/spend-category': categories,
    '@/lib/finance/payment-allocation': exports,
  };
  const pageExports = {};
  new Function('exports', 'require', compile('src/app/(app)/spent/page.tsx'))(pageExports, id => mocks[id] ?? require(id));
  const render = async params => renderToStaticMarkup(await pageExports.default({ searchParams: Promise.resolve({ range: 'month', ...params }) }));
  const html = await render({});
  assert.match(html, /Payments recorded/);
  assert.match(html, /\$47,800/);
  assert.match(html, /Assigned overhead/);
  assert.match(html, /Card payments/);
  assert.match(html, /ADP payroll payments/);
  const transactions = html.slice(html.indexOf('id="transactions"'));
  assert.match(transactions, /Merluzzi Basement/);
  assert.match(transactions, /\$284/);
  assert.match(transactions, /\$566/);
  const jobHtml = await render({ allocation: 'project' });
  const jobList = jobHtml.slice(jobHtml.indexOf('id="transactions"'));
  assert.match(jobList, /Merluzzi Basement/);
  assert.doesNotMatch(jobList, /\$566|CAPITAL ONE|ADP Payroll|Vans/);
  const overheadHtml = await render({ allocation: 'overhead' });
  const overheadList = overheadHtml.slice(overheadHtml.indexOf('id="transactions"'));
  assert.match(overheadList, /Office rent/);
  assert.doesNotMatch(overheadList, /Merluzzi Basement|Capital One|ADP Payroll|Vans/);
});
