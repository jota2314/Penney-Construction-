import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
function load(path, imports = {}, globals = {}) {
  const compiled = { exports: {} };
  const code = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  new Function('module', 'exports', 'require', ...Object.keys(globals), code)(compiled, compiled.exports, name => imports[name] ?? require(name), ...Object.values(globals));
  return compiled.exports;
}
const selection = load('src/lib/finance/cash-month-selection.ts');
const { selectCashMonth } = selection;
const { summarizeCashFlow } = load('src/lib/finance/overview-cash.ts');
const { summarizeBankPeriod } = load('src/lib/finance/bank-period.ts');
const money = load('src/lib/money.ts');
const link = { __esModule: true, default: ({ children, ...props }) => React.createElement('a', props, children) };
const bankPanel = load('src/components/finances/bank-period-panel.tsx', {
  '@/lib/money': money,
  'next/link': link,
});
const { CashActivity } = load('src/components/finances/cash-activity.tsx', {
  '@/lib/finance/cash-month-selection': selection,
  '@/components/finances/bank-period-panel': bankPanel,
  '@/lib/money': money,
  'next/link': link,
});
const today = '2026-11-05';
const cash = summarizeCashFlow([], [], [{
  id: 'october-debit', txn_date: '2026-10-30', source: 'eastern_ach', direction: 'debit', amount: '513908.96',
}], today);
const render = (month, data = cash, bankPeriod, extra = {}) => renderToStaticMarkup(React.createElement(CashActivity, { cash: data, today, month, bankPeriod, ...extra }));
const period = { start: '2026-10-01', end: '2026-10-31' };
const bankRow = (overrides = {}) => ({
  id: 'withdrawal', txn_date: '2026-10-12', source: 'eastern_ach', amount: '100.01',
  direction: 'debit', description: 'Supplier payment', category_key: null, check_number: null,
  statement_file: 'October statement.pdf', statement_month: '2026-10', match_status: 'unmatched',
  match_note: null, external_ref: null, bank_transaction_matches: [], ...overrides,
});
const renderPanel = bank => renderToStaticMarkup(React.createElement(bankPanel.BankPeriodPanel, { bank, periodLabel: 'October 2026' }));

function elementAt(html, tag, marker) {
  const index = html.indexOf(marker);
  assert.ok(index >= 0, `Missing ${marker}`);
  const start = html.lastIndexOf(`<${tag}`, index);
  const tags = new RegExp(`<\\/?${tag}\\b[^>]*>`, 'g');
  tags.lastIndex = start;
  let depth = 0, match;
  while ((match = tags.exec(html))) {
    depth += match[0].startsWith('</') ? -1 : 1;
    if (depth === 0) return html.slice(start, tags.lastIndex);
  }
  throw new Error(`Unclosed ${tag}`);
}
function assertPrimaryBankPanel(html) {
  const index = html.indexOf('data-testid="bank-period-panel"');
  assert.ok(index >= 0);
  let depth = 0;
  for (const tag of html.slice(0, index).match(/<\/?details\b[^>]*>/g) ?? []) depth += tag.startsWith('</') ? -1 : 1;
  assert.equal(depth, 0, 'Bank headline must not be inside a collapsed details element');
  const comparison = html.indexOf('data-testid="recorded-comparison"');
  if (comparison >= 0) assert.ok(index < comparison, 'Bank headline must precede recorded diagnostics');
}
const syntheticBank = [
  bankRow({ id: 'september-bank', txn_date: '2026-09-10', amount: '87654.32' }),
  bankRow({ id: 'october-bank', amount: '123.45' }),
  bankRow({ id: 'october-credit', source: 'eastern_deposit', direction: 'credit', amount: '678.90' }),
];
const syntheticCash = summarizeCashFlow([
  { id: 'jan-receipt', received_date: '2026-01-10', amount: 900000.11 },
  { id: 'oct-receipt', received_date: '2026-10-12', amount: 1234.56 },
  { id: 'nov-receipt', received_date: '2026-11-04', amount: 77.77 },
], [
  { id: 'jan-bill', invoice_date: '2026-01-10', paid_date: '2026-01-12', payment_status: 'paid', payment_method: 'check', amount: 800000.22, paid_amount: null },
  { id: 'oct-bill', invoice_date: '2026-10-10', paid_date: '2026-10-12', payment_status: 'paid', payment_method: 'credit_card', amount: 2345.67, paid_amount: null },
  { id: 'nov-bill', invoice_date: '2026-11-01', paid_date: '2026-11-04', payment_status: 'paid', payment_method: null, amount: 88.88, paid_amount: null },
], syntheticBank, today);
// Distinct sentinel values ensure no payroll diagnostic can become a cash tile.
syntheticCash.payroll.additionalBankPayroll = 654321.09;
syntheticCash.payroll.recordedADPpayroll = 765432.10;
syntheticCash.payroll.bankPayrollThrough = '2026-10-30';
const syntheticOctober = summarizeBankPeriod(syntheticBank, period);
const syntheticYear = summarizeBankPeriod(syntheticBank, { start: '2026-01-01', end: today });

test('explicit empty November stays selected after October bank activity', () => {
  const result = selectCashMonth(cash.months, '2026-11');
  assert.equal(result.selected.key, '2026-11');
  assert.equal(result.selected.bank.count, 0);
  assert.equal(result.issue, null);
  const html = render('2026-11');
  assert.match(html, /data-month="2026-11"/);
  assert.match(html, /November 2026<\/h3>/);
  assert.match(html, /Eastern bank activity unavailable/);
  assert.doesNotMatch(html, /data-month="2026-10"/);
  assert.doesNotMatch(html, /October 2026<\/h3>/);
});

test('explicit empty future month remains selected even when the entire year is empty', () => {
  const empty = summarizeCashFlow([], [], [], today);
  const html = render('2026-12', empty);
  assert.match(html, /data-month="2026-12"/);
  assert.match(html, /December 2026<\/h3>/);
  assert.match(html, /Eastern bank activity unavailable/);
});

test('invalid explicit month shows a correction message instead of earlier totals', () => {
  for (const month of ['', '2026-00', '2026-13', '2026-1', 'October', '2026-11-01']) {
    assert.deepEqual(selectCashMonth(cash.months, month), { selected: undefined, issue: 'invalid' });
    const html = render(month);
    assert.match(html, /That month is invalid/);
    assert.doesNotMatch(html, /data-testid="selected-cash-month"/);
  }
});

test('a valid prior or later year is not substituted with current-year money', () => {
  for (const month of ['2025-10', '2027-10']) {
    assert.deepEqual(selectCashMonth(cash.months, month), { selected: undefined, issue: 'not_loaded' });
    const html = render(month);
    assert.ok(html.includes(`The requested month (${month}) is not loaded in this 2026 view.`));
    assert.doesNotMatch(html, /data-testid="selected-cash-month"/);
  }
});

test('only absent selection defaults to most recent imported bank month', () => {
  assert.equal(selectCashMonth(cash.months).selected.key, '2026-10');
  assert.match(render(undefined), /data-month="2026-10"/);
  assert.match(render(undefined), /Showing the latest month with imported bank activity: October 2026/);
  assert.match(render('2026-10'), /October 2026<\/h3>/);
  const recordsOnly = summarizeCashFlow([{ id: 'receipt', received_date: '2026-11-04', amount: 25 }], [], [], today);
  assert.equal(selectCashMonth(recordsOnly.months).selected.key, '2026-11');
});

test('CashActivity renders the actual selected-period panel with exact cash and source drilldowns', () => {
  const rows = [
    bankRow({ bank_transaction_matches: [{ id: 'link', invoice_id: 'bill-1', payment_id: null, amount_applied: '100.01', confidence: 'exact' }] }),
    bankRow({ id: 'fee', description: 'Bank fee', amount: '1.02' }),
    bankRow({ id: 'deposit', source: 'eastern_deposit', direction: 'credit', description: 'Customer deposit', amount: '200.02' }),
    bankRow({ id: 'card', source: 'capone', description: 'Separate card purchase', amount: '99999.00' }),
  ];
  const selected = summarizeBankPeriod(rows, period);
  const data = summarizeCashFlow([], [], rows, today);
  const html = render('2026-10', data, selected);
  assert.match(html, /data-month="2026-10"/);
  assert.equal((html.match(/data-testid="bank-period-panel"/g) ?? []).length, 1);
  assertPrimaryBankPanel(html);
  assert.ok(html.includes('$101.03'));
  assert.ok(html.includes('$200.02'));
  assert.ok(html.includes('$98.99'));
  assert.match(html, /Inspect all 3 bank entries/);
  assert.match(html, /href="\/spent\/bill-1"/);
  assert.match(html, /October statement\.pdf/);
  assert.match(html, /Statement difference: not verified/);
  assert.doesNotMatch(html, /Separate card purchase|\$99,999/);
  assert.doesNotMatch(html, /<form\b|<button\b|<input\b/);
});

test('empty selected-month panel shows unavailable cash, not zero or previous-month money', () => {
  const empty = summarizeBankPeriod([], { start: '2026-11-01', end: '2026-11-30' });
  const html = render('2026-11', cash, empty);
  const panel = elementAt(html, 'section', 'data-testid="bank-period-panel"');
  assert.match(html, /data-month="2026-11"/);
  assert.match(panel, /No imported activity/);
  assert.ok((panel.match(/Unavailable/g) ?? []).length >= 3);
  assert.doesNotMatch(panel, /\$0\.00|\$513,908\.96/);
  assert.match(panel, /does not establish zero spending or a reconciled month/);
});

test('invalid bank data suppresses totals and retains the affected movement for inspection', () => {
  const invalid = summarizeBankPeriod([bankRow({ id: 'invalid', amount: 'not-money', description: 'Amount requires review' })], period);
  const html = renderPanel(invalid);
  assert.match(html, /Bank records need review/);
  assert.match(html, /Bank total needs verification/);
  assert.match(html, /Amount requires review/);
  assert.match(html, /missing, negative, invalid or fractional-cent amount/);
  assert.ok((html.match(/Unavailable/g) ?? []).length >= 3);
  assert.doesNotMatch(html, /\$0\.00|<form\b|<button\b|<input\b/);
});

test('saved-link conflicts stay visible without changing the independently valid bank total', () => {
  const linked = summarizeBankPeriod([bankRow({ bank_transaction_matches: [{
    id: 'overlinked', invoice_id: 'bill-2', payment_id: null, amount_applied: '150.00', confidence: 'exact',
  }] })], period);
  const html = renderPanel(linked);
  assert.ok(html.includes('$100.01'));
  assert.match(html, /1 entries have record-link amounts that need review/);
  assert.match(html, /Saved record links exceed this bank movement/);
  assert.match(html, /href="\/spent\/bill-2"/);
  assert.match(html, /Remaining unlinked: Unavailable/);
  assert.match(html, /Statement difference: not verified/);
  assert.doesNotMatch(html, /<form\b|<button\b|<input\b/);
});

test('failed bank loading reports unavailable and does not manufacture a zero total', () => {
  const html = renderToStaticMarkup(React.createElement(bankPanel.BankPeriodUnavailable));
  assert.match(html, /Eastern bank activity unavailable/);
  assert.match(html, /could not load completely/);
  assert.match(html, /Bill records remain separate/);
  assert.doesNotMatch(html, /\$0|<form\b|<button\b|<input\b/);
});

test('October cash is primary and October records stay in a closed comparison without yearly totals', () => {
  const html = render('2026-10', syntheticCash, syntheticOctober);
  assertPrimaryBankPanel(html);
  const panel = elementAt(html, 'section', 'data-testid="bank-period-panel"');
  assert.ok(panel.includes('$123.45'));
  assert.ok(panel.includes('$678.90'));
  assert.ok(panel.includes('$555.45'));
  assert.doesNotMatch(panel, /\$1,234\.56|\$2,345\.67|\$87,654\.32/);
  const comparison = elementAt(html, 'details', 'data-testid="recorded-comparison"');
  assert.doesNotMatch(comparison.match(/^<details[^>]*>/)[0], /\bopen(?:\s|=|>)/);
  assert.ok(comparison.includes('$1,234.56'));
  assert.ok(comparison.includes('$2,345.67'));
  assert.ok(!html.includes(money.formatMoney(syntheticCash.yearToDate.received)));
  assert.ok(!html.includes(money.formatMoney(syntheticCash.yearToDate.paidBills)));
  assert.doesNotMatch(html, /recorded-ytd-summary|Payroll awaiting bill matching|\$654,321\.09|\$765,432\.10/);
});

test('explicit ytd uses the supplied year bank panel and keeps annual recorded comparison collapsed', () => {
  const html = render('ytd', syntheticCash, syntheticYear);
  assert.match(html, /data-period="ytd"/);
  assert.match(html, /Year to date · 2026<\/h3>/);
  assertPrimaryBankPanel(html);
  const panel = elementAt(html, 'section', 'data-testid="bank-period-panel"');
  assert.ok(panel.includes('$87,777.77'));
  assert.ok(panel.includes('$678.90'));
  assert.doesNotMatch(panel, /\$901,312\.44|\$802,434\.77/);
  const comparison = elementAt(html, 'details', 'data-testid="recorded-comparison"');
  assert.doesNotMatch(comparison.match(/^<details[^>]*>/)[0], /\bopen(?:\s|=|>)/);
  assert.ok(comparison.includes(money.formatMoney(syntheticCash.yearToDate.received)));
  assert.ok(comparison.includes(money.formatMoney(syntheticCash.yearToDate.paidBills)));
  assert.doesNotMatch(html, /That month is invalid|Payroll awaiting bill matching|\$654,321\.09|\$765,432\.10/);
});

test('missing bank period never falls back to the older aggregate bank cards', () => {
  for (const requested of ['2026-10', 'ytd']) {
    const html = render(requested, syntheticCash);
    assert.match(html, /Eastern bank activity unavailable/);
    assert.doesNotMatch(html, /data-testid="bank-period-panel"|data-testid="bank-cash-summary"|Imported bank credits|Imported bank debits/);
    assert.ok(!html.includes(money.formatMoney(syntheticCash.bank.spent)));
  }
});

test('a mismatched bank-period prop is rejected rather than displayed under another period label', () => {
  for (const [requested, bank] of [['2026-10', syntheticYear], ['ytd', syntheticOctober]]) {
    const html = render(requested, syntheticCash, bank);
    assert.match(html, /Eastern bank activity unavailable/);
    assert.doesNotMatch(html, /data-testid="bank-period-panel"/);
  }
});

test('unknown and unavailable months do not borrow a supplied unrelated month or year total', () => {
  for (const requested of ['2025-10', '2027-10', 'wrong', '']) {
    const html = render(requested, syntheticCash, syntheticYear);
    assert.doesNotMatch(html, /data-testid="bank-period-panel"|data-testid="recorded-comparison"|data-period="ytd"/);
    assert.ok(!html.includes(money.formatMoney(syntheticCash.yearToDate.received)));
    assert.ok(!html.includes(money.formatMoney(syntheticCash.yearToDate.paidBills)));
  }
});

test('record loading failure preserves independently loaded bank cash and hides recorded subtotals', () => {
  const html = render('2026-10', syntheticCash, syntheticOctober, { recordsUnavailable: true });
  assertPrimaryBankPanel(html);
  assert.ok(html.includes('$123.45'));
  assert.match(html, /Separate bill and receipt records could not be verified/);
  assert.match(html, /bank activity above is calculated independently/);
  assert.doesNotMatch(html, /data-testid="recorded-comparison"|\$1,234\.56|\$2,345\.67|Payroll awaiting bill matching/);
});

test('unresolved recorded payments are explained inside the comparison and cannot appear as known zero payments', () => {
  const onlyInvalid = summarizeCashFlow([], [{
    id: 'paid-zero', vendor_name: 'Supplier', invoice_date: '2026-10-10', paid_date: '2026-10-12',
    payment_status: 'paid', payment_method: 'check', amount: 999, paid_amount: 0,
  }], syntheticBank, today);
  const html = render('2026-10', onlyInvalid, syntheticOctober);
  assertPrimaryBankPanel(html);
  const comparison = elementAt(html, 'details', 'data-testid="recorded-comparison"');
  assert.match(comparison, /1 bill entries in this period have conflicting or invalid payment amounts and are excluded/);
  assert.match(comparison, /Needs review/);
  assert.ok(!comparison.includes('$999'));
});

test('CashPage keeps authenticated bank cash available when independent book and balance services fail', async () => {
  const model = load('src/lib/finance/bank-period.ts');
  const cashModel = load('src/lib/finance/overview-cash.ts');
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : ['2026-11-05T12:00:00Z'])); }
    static now() { return new Date('2026-11-05T12:00:00Z').getTime(); }
  }
  const db = { from(table) {
    const query = {};
    for (const method of ['select', 'like', 'gte', 'lte', 'order', 'is', 'in']) query[method] = () => query;
    query.range = async () => table === 'bank_transactions'
      ? { data: syntheticBank, error: null }
      : { data: null, error: { message: `${table} unavailable` } };
    return query;
  } };
  const { default: CashPage } = load('src/components/finances/sections/cash.tsx', {
    'next/link': link,
    'next/navigation': { redirect: () => { throw new Error('Unexpected redirect'); } },
    '@/lib/auth/require-auth': { requireAuth: async () => ({ profile: { role: 'owner' } }) },
    '@/lib/auth/role-access': { canSeeBoardMoney: role => role === 'owner' },
    '@/lib/supabase/server': { createClient: async () => db },
    '@/lib/crew/load-labor-ledger': { financialRows: async factory => {
      const response = await factory(0, 999);
      if (response.error || !response.data) throw new Error(response.error?.message ?? 'Query failed');
      return response.data;
    } },
    '@/lib/money': money,
    '@/lib/finance/overview-cash': cashModel,
    '@/lib/finance/workspace-data': { getFinanceWorkspace: async () => { throw new Error('Workspace unavailable'); } },
    '@/lib/finance/workspace-model': { isActionableCollection: () => true },
    '@/components/ceo/collection-plan-dialog': { CollectionPlanDialog: ({ children }) => children },
    '@/lib/finance/published-collection-plan': { publishedCollectionPlan: {} },
    '@/lib/finance/collection-invoices': { getCollectionInvoices: async () => { throw new Error('Collection invoices unavailable'); } },
    '@/components/finances/cash-activity': { CashActivity },
    '@/lib/finance/cash-month-selection': selection,
    '@/lib/finance/bank-period': model,
  }, { Date: FixedDate });
  const html = renderToStaticMarkup(await CashPage({ searchParams: Promise.resolve({ m: '2026-10' }) }));
  assertPrimaryBankPanel(html);
  assert.ok(html.includes('$123.45'));
  assert.ok(html.includes('$678.90'));
  assert.match(html, /Separate bill and receipt records could not be verified/);
  assert.doesNotMatch(html, /data-testid="recorded-comparison"/);
  assert.match(html, /unavailable/i);
});
