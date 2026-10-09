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

function mockLoader({ failProjects = false, failSecondPage = false } = {}) {
  const ranges = [];
  const projects = [{ id: 'one', name: 'Job one' }, { id: 'two', name: 'Job two' }];
  const invoices = Array.from({ length: 1001 }, (_, i) => ({ id: `invoice-${i}`, project_id: i === 1000 ? 'two' : 'one', invoice_number: i + 1, title: 'Existing invoice', amount: '123.45', status: i % 2 ? 'sent' : 'draft', due_date: null }));
  const supabase = { from(table) {
    const query = { select() { return query; }, in() { return query; }, order() { return query; },
      range(from, to) { ranges.push([from, to]); return Promise.resolve(failSecondPage && from > 0 ? { data: null, error: { message: 'Unavailable' } } : { data: invoices.slice(from, to + 1), error: null }); },
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
  assert.equal(result['First final'], result.First);
});
test('failed inventory reads return unavailable, never an empty or partial list', async () => {
  assert.equal(await mockLoader({ failProjects: true }).getCollectionInvoices(), null);
  assert.equal(await mockLoader({ failSecondPage: true }).getCollectionInvoices(), null);
});
test('invoice access uses the native PDF and shared creator for the selected project', () => {
  const React = require('react');
  const { CollectionInvoiceActions } = load('src/components/ceo/collection-invoice-actions.tsx', {
    '@/components/invoices/client-invoice-dialog': { ClientInvoiceDialog: ({ projectId }) => React.createElement('button', { 'data-project-id': projectId }, 'New Invoice') },
    '@/lib/money': { formatMoney: value => `$${value.toFixed(2)}` },
  });
  const html = require('react-dom/server').renderToStaticMarkup(React.createElement(CollectionInvoiceActions, { project: { id: 'job-id', name: 'Job name', invoices: [{ id: 'native-invoice-id', invoice_number: 2, title: 'Deposit', status: 'draft', amount: 99, due_date: null }] } }));
  for (const text of ['invoiceId=native-invoice-id', 'data-project-id="job-id"', 'existing draft', 'Invoice #2', '$99.00', '/projects/job-id?tab=finances#fin-invoices']) assert.ok(html.includes(text), text);
});
