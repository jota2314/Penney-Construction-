import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

// Exercise the actual server loader, models and rendered cash view with fixture
// adapters. No browser, authenticated session, database or financial write.
const require = createRequire(import.meta.url);
const source = name => fs.readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
class FixedDate extends Date {
  constructor(...args) { super(...(args.length ? args : ['2026-11-05T16:00:00Z'])); }
  static now() { return Date.parse('2026-11-05T16:00:00Z'); }
}
function load(name, modules = {}, text = source(name)) {
  const exports = {};
  const compiled = ts.transpileModule(text, {
    fileName: name,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(compiled, {
    exports, module: { exports }, Date: FixedDate, Intl,
    require: name => modules[name] ?? require(name),
  }, { filename: name });
  return exports;
}
const ledger = source('src/lib/crew/load-labor-ledger.ts');
const { financialRows } = load('financial-rows.ts', {}, ledger.slice(
  ledger.indexOf('export async function financialRows'), ledger.indexOf('export async function loadLaborLedger'),
));
const money = load('src/lib/money.ts');
const cashModel = load('src/lib/finance/overview-cash.ts');
const bankModel = load('src/lib/finance/bank-period.ts');
const selection = load('src/lib/finance/cash-month-selection.ts');
const link = { __esModule: true, default: ({ children, ...props }) => React.createElement('a', props, children) };
const panel = load('src/components/finances/bank-period-panel.tsx', { '@/lib/money': money, 'next/link': link });
const view = load('src/components/finances/cash-activity.tsx', {
  '@/lib/money': money, 'next/link': link,
  '@/lib/finance/cash-month-selection': selection,
  '@/components/finances/bank-period-panel': panel,
});
const bankRow = (id, date, amount) => ({
  id, txn_date: date, amount, source: 'eastern_ach', direction: 'debit', description: 'Supplier ACH',
  category_key: null, check_number: null, external_ref: null, statement_file: null,
  statement_month: date.slice(0, 7), match_status: 'unmatched', match_note: null, bank_transaction_matches: [],
});
function harness() {
  const state = {
    failure: null, workspaceError: false, collectionError: false, queries: [], props: null,
    rows: {
      bank_transactions: [bankRow('january', '2026-01-02', '100.02'), bankRow('october', '2026-10-31', '200.03')],
      payments_received: [{ id: 'book-only', received_date: '2026-11-03', amount: '9999.99' }],
      invoices: [],
    },
  };
  class Query {
    constructor(table) { this.table = table; this.filters = []; state.queries.push(this); }
    select() { return this; }
    order() { return this; }
    is(key, value) { this.filters.push(row => (row[key] ?? null) === value); return this; }
    in(key, values) { this.filters.push(row => values.includes(row[key])); return this; }
    like(key, value) { this.filters.push(row => row[key].startsWith(value.replace(/%$/, ''))); return this; }
    gte(key, value) { this.filters.push(row => row[key] >= value); return this; }
    lte(key, value) { this.filters.push(row => row[key] <= value); return this; }
    range(from, to) {
      return Promise.resolve(state.failure === this.table ? { data: null, error: { message: `${this.table} failed` } }
        : { data: state.rows[this.table].filter(row => this.filters.every(filter => filter(row))).slice(from, to + 1), error: null });
    }
  }
  const { default: CashPage } = load('src/components/finances/sections/cash.tsx', {
    'next/link': link,
    'next/navigation': { redirect: route => { throw new Error(`Unexpected redirect ${route}`); } },
    '@/lib/auth/require-auth': { requireAuth: async () => ({ profile: { role: 'owner' } }) },
    '@/lib/auth/role-access': { canSeeBoardMoney: () => true },
    '@/lib/supabase/server': { createClient: async () => ({ from: table => new Query(table) }) },
    '@/lib/crew/load-labor-ledger': { financialRows },
    '@/lib/money': money,
    '@/lib/finance/overview-cash': cashModel,
    '@/lib/finance/bank-period': bankModel,
    '@/lib/finance/cash-month-selection': selection,
    '@/lib/finance/workspace-data': { getFinanceWorkspace: async () => {
      if (state.workspaceError) throw new Error('Workspace failed');
      return { collections: [], bills: { bills: [], total: 0, reviewBalance: 0 } };
    } },
    '@/lib/finance/workspace-model': { isActionableCollection: () => false },
    '@/components/ceo/collection-plan-dialog': { CollectionPlanDialog: ({ children }) => React.createElement('span', null, children) },
    '@/lib/finance/published-collection-plan': { publishedCollectionPlan: {} },
    '@/lib/finance/collection-invoices': { getCollectionInvoices: async () => {
      if (state.collectionError) throw new Error('Collection invoices failed');
      return {};
    } },
    '@/components/finances/cash-activity': { CashActivity: props => { state.props = props; return React.createElement(view.CashActivity, props); } },
  });
  return { state, render: async m => renderToStaticMarkup(await CashPage({ searchParams: Promise.resolve(m === undefined ? {} : { m }) })) };
}

test('cash server selects exact October bank period and never substitutes YTD book receipts', async () => {
  const { state, render } = harness();
  const html = await render('2026-10');
  assert.equal(state.props.bankPeriod.start, '2026-10-01');
  assert.equal(state.props.bankPeriod.end, '2026-10-31');
  assert.equal(state.props.bankPeriod.totals.debitsCents, 20003);
  assert.equal(state.props.recordsUnavailable, false);
  assert.match(html, /October 2026/);
  assert.doesNotMatch(html, /\$9,999\.99/);
  assert.match(html, /Latest imported bank transaction: Oct 31, 2026/);
});

test('explicit YTD selection passes January through today and complete imported cash', async () => {
  const { state, render } = harness();
  const html = await render('ytd');
  assert.equal(state.props.bankPeriod.start, '2026-01-01');
  assert.equal(state.props.bankPeriod.end, '2026-11-05');
  assert.equal(state.props.bankPeriod.totals.debitsCents, 30005);
  assert.equal(state.props.month, 'ytd');
  assert.match(html, /data-period="ytd"/);
  assert.match(html, /\$300\.05/);
});

test('explicit empty November remains unavailable even though books include November receipts', async () => {
  const { state, render } = harness();
  const html = await render('2026-11');
  assert.equal(state.props.bankPeriod.status, 'empty');
  assert.equal(state.props.bankPeriod.totals, null);
  assert.match(html, /data-month="2026-11"/);
  assert.match(html, /No imported activity/);
  assert.match(html, /does not establish zero spending/);
  assert.equal(state.props.cash.months[10].records.received, 9999.99);
});

test('failed receipt or bill read leaves independently verified bank cash visible', async () => {
  for (const failure of ['payments_received', 'invoices']) {
    const { state, render } = harness();
    state.failure = failure;
    const html = await render('2026-10');
    assert.equal(state.props.recordsUnavailable, true, failure);
    assert.equal(state.props.bankPeriod.totals.debitsCents, 20003, failure);
    assert.match(html, /\$200\.03/, failure);
    assert.match(html, /Separate bill and receipt records could not be verified/, failure);
    assert.doesNotMatch(html, /data-testid="recorded-comparison"/, failure);
  }
});

test('malformed recorded receipt cannot suppress valid bank cash or manufacture book totals', async () => {
  const { state, render } = harness();
  state.rows.payments_received[0].amount = 'bad';
  const html = await render('ytd');
  assert.equal(state.props.recordsUnavailable, true);
  assert.equal(state.props.bankPeriod.totals.debitsCents, 30005);
  assert.match(html, /\$300\.05/);
  assert.doesNotMatch(html, /Recorded receipt subtotal/);
});

test('bank read or validation failure rejects rather than presenting a partial or book cash total', async () => {
  const failed = harness();
  failed.state.failure = 'bank_transactions';
  await assert.rejects(failed.render('2026-10'), /bank_transactions failed/);
  assert.equal(failed.state.props, null);
  const invalid = harness();
  invalid.state.rows.bank_transactions[0].amount = 'invalid';
  await assert.rejects(invalid.render('2026-10'), /Bank records need verification/);
  assert.equal(invalid.state.props, null);
});

test('ancillary workspace and collection failures cannot suppress bank cash or invent balances', async () => {
  for (const failure of ['workspaceError', 'collectionError', 'both']) {
    const { state, render } = harness();
    state.workspaceError = failure === 'workspaceError' || failure === 'both';
    state.collectionError = failure === 'collectionError' || failure === 'both';
    const html = await render('2026-10');
    assert.equal(state.props.bankPeriod.totals.debitsCents, 20003, failure);
    assert.equal(state.props.recordsUnavailable, false, failure);
    assert.match(html, /\$200\.03/, failure);
    if (state.workspaceError) {
      for (const title of ['Owed to us', 'We owe']) {
        const card = [...html.matchAll(/<section\b[^>]*>[\s\S]*?<\/section>/g)]
          .find(match => match[0].includes(`>${title}</h2>`))?.[0];
        assert.ok(card, `${failure}: ${title} still renders`);
        assert.match(card, /Unavailable/, `${failure}: ${title}`);
        assert.doesNotMatch(card, /\$0(?:\.00)?/, `${failure}: missing ${title} is not zero`);
      }
      assert.match(html, /Collection balances could not load/);
      assert.match(html, /Open bill balances could not load/);
    }
    if (state.collectionError) {
      assert.match(html, /href="\/finances\?section=collections"[^>]*>Review collections/);
      assert.doesNotMatch(html, /View collection plan &amp; invoices/);
    } else {
      assert.match(html, /View collection plan &amp; invoices/);
    }
  }
});
