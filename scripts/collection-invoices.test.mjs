import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
const require = createRequire(import.meta.url);
const ts = require('typescript');
function load(file, mocks = {}) {
  const compiled = { exports: {} };
  const js = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  new Function('require', 'module', 'exports', js)(name => {
    if (name in mocks) return mocks[name];
    if (name === 'server-only') return {};
    return require(name);
  }, compiled, compiled.exports);
  return compiled.exports;
}
const { collectionPlanProjectIds: identities, publishedCollectionPlan: plan } = load('src/lib/finance/published-collection-plan.ts');

test('every dated-plan row resolves to a verified project identity, including similar-name jobs', () => {
  const rows = [...plan.managers.flatMap(m => m.items), ...plan.comingUp.flatMap(w => w.items), ...plan.conditional];
  for (const row of rows) assert.match(identities[row.project], /^[a-f0-9-]{36}$/);
  assert.equal(identities.Conway, 'b12ec6da-a6ca-4d9e-92ae-80c334c49517');
  assert.equal(identities.LaPointe, 'c6e28677-095c-450c-993c-9d5454d4d1fb');
  assert.equal(identities.Dougherty, '6021d4a6-7e8a-4df5-b4d0-420583cf1415');
});

function mockLoader({ failProjects = false, failSecondPage = false, failMilestones = false } = {}) {
  const ranges = [];
  const projects = [{ id: 'one', name: 'Job one' }, { id: 'two', name: 'Job two' }];
  const invoices = Array.from({ length: 1001 }, (_, i) => ({ id: `invoice-${i}`, project_id: i === 1000 ? 'two' : 'one', invoice_number: i + 1, title: 'Existing invoice', amount: '123.45', status: i % 2 ? 'sent' : 'draft', due_date: null }));
  const supabase = { from(table) {
    const query = { select() { return query; }, in() { return query; }, order() { return query; },
      range(from, to) {
        if (table === 'project_payment_milestones') return Promise.resolve(failMilestones ? { data: null, error: { message: 'Unavailable' } } : { data: [{ project_id: 'two', client_invoice_id: 'invoice-1000', label: 'Deposit', sort_order: 10 }], error: null });
        ranges.push([from, to]);
        return Promise.resolve(failSecondPage && from > 0 ? { data: null, error: { message: 'Unavailable' } } : { data: invoices.slice(from, to + 1), error: null });
      },
      then(resolve) { return Promise.resolve(table === 'projects' ? { data: failProjects ? null : projects, error: failProjects ? { message: 'Unavailable' } : null } : {}).then(resolve); },
    };
    return query;
  } };
  const { getCollectionInvoices } = load('src/lib/finance/collection-invoices.ts', {
    '@/lib/supabase/server': { createClient: async () => supabase },
    './published-collection-plan': { collectionPlanProjectIds: { First: 'one', 'First final': 'one', Second: 'two' } },
  });
  return { getCollectionInvoices, ranges };
}
test('invoice inventory includes drafts and pages beyond 1000 while keeping jobs separate', async () => {
  const { getCollectionInvoices, ranges } = mockLoader();
  const result = await getCollectionInvoices();
  assert.deepEqual(ranges, [[0, 999], [1000, 1999]]);
  assert.equal(result.First.invoices.length, 1000);
  assert.equal(result.Second.invoices.length, 1);
  assert.equal(result.Second.invoices[0].id, 'invoice-1000');
  assert.equal(result.Second.invoices[0].amount, 123.45);
  assert.equal(result.Second.invoices[0].status, 'draft');
  assert.equal(result.Second.invoices[0].milestone.label, 'Deposit');
  assert.equal(result['First final'], result.First);
});
test('failed inventory reads return unavailable, never an empty or partial list', async () => {
  assert.equal(await mockLoader({ failProjects: true }).getCollectionInvoices(), null);
  assert.equal(await mockLoader({ failSecondPage: true }).getCollectionInvoices(), null);
  assert.equal(await mockLoader({ failMilestones: true }).getCollectionInvoices(), null);
});
test('invoice access uses the native PDF and shared creator for the selected project', () => {
  const React = require('react');
  const { CollectionInvoiceActions } = load('src/components/ceo/collection-invoice-actions.tsx', {
    '@/components/invoices/client-invoice-dialog': { ClientInvoiceDialog: ({ projectId }) => React.createElement('button', { 'data-project-id': projectId }, 'New Invoice') },
    '@/lib/finance/collection-invoice-workflow': load('src/lib/finance/collection-invoice-workflow.ts'),
    '@/lib/money': { formatMoney: value => `$${value.toFixed(2)}` },
  });
  const html = require('react-dom/server').renderToStaticMarkup(React.createElement(CollectionInvoiceActions, { project: { id: 'job-id', name: 'Job name', invoices: [{ id: 'native-invoice-id', invoice_number: 2, title: 'Deposit', status: 'draft', amount: 99, due_date: null }] } }));
  for (const text of ['invoiceId=native-invoice-id', 'data-project-id="job-id"', 'Other drafts', 'Invoice #2', '$99.00', '/projects/job-id?tab=finances#fin-invoices', 'Need an additional invoice?']) assert.ok(html.includes(text), text);
});

test('existing invoices follow their issue state; stale milestone links cannot hide sent invoices', () => {
  const { groupCollectionInvoices, canReviewInvoiceDraft } = load('src/lib/finance/collection-invoice-workflow.ts');
  const draft = { id: 'draft', status: 'draft', updated_at: '2026-10-09', paid_at: null, paid_amount: 0, sent_to_client_at: null, quickbooks_invoice_id: null, milestone: { label: 'Deposit', sort_order: 10 } };
  const sent = { ...draft, id: 'sent', status: 'sent', sent_to_client_at: '2026-10-05' };
  const staleDraft = { ...sent, id: 'stale-draft', status: 'draft' };
  const paid = { ...draft, id: 'paid', status: 'paid', paid_amount: 100 };
  const voided = { ...draft, id: 'voided', status: 'void' };
  const other = { ...draft, id: 'other', milestone: null };
  const groups = groupCollectionInvoices([paid, draft, sent, staleDraft, voided, other]);
  assert.deepEqual(groups.issued.map(i => i.id), ['sent', 'stale-draft']);
  assert.deepEqual(groups.scheduled.map(i => i.id), ['draft']);
  assert.deepEqual(groups.drafts.map(i => i.id), ['other']);
  assert.deepEqual(groups.history.map(i => i.id), ['paid', 'voided']);
  assert.equal(canReviewInvoiceDraft(draft), true);
  for (const protectedInvoice of [sent, staleDraft, paid, voided, { ...draft, quickbooks_invoice_id: 'qb' }, { ...draft, paid_amount: 1 }, { ...draft, updated_at: '' }]) assert.equal(canReviewInvoiceDraft(protectedInvoice), false);
});
