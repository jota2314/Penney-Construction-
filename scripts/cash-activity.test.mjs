import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
function load(path, imports = {}) {
  const compiled = { exports: {} };
  const code = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  new Function('module', 'exports', 'require', code)(compiled, compiled.exports, name => imports[name] ?? require(name));
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
const render = (month, data = cash, bankPeriod) => renderToStaticMarkup(React.createElement(CashActivity, { cash: data, today, month, bankPeriod }));
const period = { start: '2026-10-01', end: '2026-10-31' };
const bankRow = (overrides = {}) => ({
  id: 'withdrawal', txn_date: '2026-10-12', source: 'eastern_ach', amount: '100.01',
  direction: 'debit', description: 'Supplier payment', category_key: null, check_number: null,
  statement_file: 'October statement.pdf', statement_month: '2026-10', match_status: 'unmatched',
  match_note: null, external_ref: null, bank_transaction_matches: [], ...overrides,
});
const renderPanel = bank => renderToStaticMarkup(React.createElement(bankPanel.BankPeriodPanel, { bank, periodLabel: 'October 2026' }));

test('explicit empty November stays selected after October bank activity', () => {
  const result = selectCashMonth(cash.months, '2026-11');
  assert.equal(result.selected.key, '2026-11');
  assert.equal(result.selected.bank.count, 0);
  assert.equal(result.issue, null);
  const html = render('2026-11');
  assert.match(html, /data-month="2026-11"/);
  assert.match(html, /November 2026<\/h3>/);
  assert.match(html, /No bank activity has been imported for it, so a bank cash-flow total is unavailable/);
  assert.doesNotMatch(html, /data-month="2026-10"/);
  assert.doesNotMatch(html, /October 2026<\/h3>/);
});

test('explicit empty future month remains selected even when the entire year is empty', () => {
  const empty = summarizeCashFlow([], [], [], today);
  const html = render('2026-12', empty);
  assert.match(html, /data-month="2026-12"/);
  assert.match(html, /December 2026<\/h3>/);
  assert.match(html, /bank cash-flow total is unavailable/);
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
  const panel = html.slice(html.indexOf('data-testid="bank-period-panel"'));
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
