import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const ts = require('typescript');
function load(file, dependencies = {}) {
  const module = { exports: {} };
  const source = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('module', 'exports', 'require', source)(module, module.exports, name => {
    if (!(name in dependencies)) throw new Error(`Unexpected dependency ${name}`);
    return dependencies[name];
  });
  return module.exports;
}
const model = load('src/lib/finance/bank-period.ts');
const { summarizeBankPeriod, bankAmountCents } = model;
const period = { start: '2025-10-01', end: '2025-10-31' };
const bank = (overrides = {}) => ({
  id: 'bank-1', txn_date: '2025-10-10', source: 'eastern_ach', amount: '12.34', direction: 'debit',
  description: 'Vendor ACH', category_key: 'materials', check_number: null,
  statement_file: 'example-october.pdf', statement_month: '2025-10-01', match_status: 'unmatched',
  match_note: null, external_ref: null, bank_transaction_matches: [], ...overrides,
});
const link = (overrides = {}) => ({ id: 'link-1', invoice_id: 'bill-1', payment_id: null, amount_applied: '12.34', confidence: 'manual', ...overrides });

test('inclusive selected period supports a past year and excludes surrounding dates', () => {
  const result = summarizeBankPeriod([
    bank({ id: 'first', txn_date: period.start, amount: '0.10' }),
    bank({ id: 'last', txn_date: period.end, source: 'eastern_deposit', direction: 'credit', amount: '0.30' }),
    bank({ id: 'early', txn_date: '2025-09-30', amount: 999 }),
    bank({ id: 'late', txn_date: '2025-11-01', amount: 999 }),
  ], period);
  assert.equal(result.status, 'available');
  assert.deepEqual(result.totals, { debitsCents: 10, creditsCents: 30, netCents: 20, payrollCents: 0, cardRepaymentsCents: 0, checksCents: 0, otherCents: 10 });
  assert.equal(result.count, 2);
  assert.equal(result.firstDate, period.start);
  assert.equal(result.through, period.end);
});

test('cross-year periods and one-day periods use the supplied posting bounds', () => {
  const records = [bank({ id: 'old', txn_date: '2024-12-31', amount: 1 }), bank({ id: 'new', txn_date: '2025-01-01', amount: 2 })];
  assert.equal(summarizeBankPeriod(records, { start: '2024-12-31', end: '2025-01-01' }).totals.debitsCents, 300);
  assert.equal(summarizeBankPeriod(records, { start: '2025-01-01', end: '2025-01-01' }).totals.debitsCents, 200);
});

test('card purchases and other banks are excluded while Eastern payoff counts once', () => {
  const result = summarizeBankPeriod([
    bank({ id: 'payoff', category_key: 'card_payoff', amount: 120 }),
    bank({ id: 'card-purchase', source: 'capone', amount: 120 }),
    bank({ id: 'other-bank', source: 'other_ach', amount: 500 }),
  ], period);
  assert.equal(result.count, 1);
  assert.equal(result.totals.debitsCents, 12000);
  assert.equal(result.totals.cardRepaymentsCents, 12000);
});

test('payroll, repayments, checks and other debits partition cash without overlap', () => {
  const result = summarizeBankPeriod([
    bank({ id: 'payroll', amount: 10, description: 'ADP WAGE PAY', category_key: 'card_payoff', check_number: '1' }),
    bank({ id: 'card', amount: 20, category_key: 'card_payoff', check_number: '2' }),
    bank({ id: 'check', amount: 30, source: 'eastern_check', check_number: '3' }),
    bank({ id: 'design', amount: 40, description: 'Adpro Design' }),
    bank({ id: 'return', amount: 50, description: 'RETURN DEPOSIT ITEM' }),
    bank({ id: 'deposit', amount: 60, source: 'eastern_deposit', direction: 'credit', description: 'ADP RETURN' }),
  ], period);
  const t = result.totals;
  assert.equal(t.debitsCents, t.payrollCents + t.cardRepaymentsCents + t.checksCents + t.otherCents);
  assert.deepEqual([t.payrollCents, t.cardRepaymentsCents, t.checksCents, t.otherCents], [1000, 2000, 3000, 9000]);
  assert.equal(t.creditsCents, 6000);
  assert.equal(result.debitCount, 5);
  assert.equal(result.creditCount, 1);
});

test('identical bank IDs deduplicate independent of object property ordering without mutating input', () => {
  const first = bank({ bank_transaction_matches: [link()] });
  const original = JSON.stringify(first);
  const second = Object.fromEntries(Object.entries(first).reverse());
  const result = summarizeBankPeriod([first, second], period);
  assert.equal(result.count, 1);
  assert.equal(result.duplicateCount, 1);
  assert.equal(result.totals.debitsCents, 1234);
  assert.equal(result.rows[0].matches.length, 1);
  assert.equal(JSON.stringify(first), original);
});

test('conflicting same-ID bank rows invalidate totals and preserve each conflicting version', () => {
  const result = summarizeBankPeriod([bank(), bank({ amount: 99 })], period);
  assert.equal(result.status, 'invalid');
  assert.equal(result.totals, null);
  assert.equal(result.rows.length, 2);
  assert.ok(result.rows.every(row => row.issues.some(issue => issue.code === 'conflicting_duplicate')));
});

test('a date conflict with an out-of-period version remains a conflict', () => {
  const result = summarizeBankPeriod([bank(), bank({ txn_date: '2025-09-30' })], period);
  assert.equal(result.rows.length, 1);
  assert.equal(result.totals, null);
  assert.equal(result.issues[0].code, 'conflicting_duplicate');
});

test('missing, negative, malformed, nonfinite and fractional-cent values never become zero', () => {
  for (const amount of [null, undefined, '', ' ', 'not-money', -1, '-0.01', Infinity, NaN, '1.001', 90071992547410]) {
    const result = summarizeBankPeriod([bank({ amount })], period);
    assert.equal(result.status, 'invalid', String(amount));
    assert.equal(result.totals, null);
    assert.equal(result.rows[0].amountCents, null);
  }
  assert.equal(bankAmountCents('1.2300'), 123);
  assert.equal(bankAmountCents('0'), 0);
  assert.equal(bankAmountCents(0.1), 10);
  assert.equal(bankAmountCents('1,000.00'), null);
});

test('invalid dates, directions, IDs and unknown Eastern sources make totals unavailable', () => {
  for (const overrides of [{ txn_date: null }, { txn_date: '2025-02-30' }, { direction: null }, { direction: 'out' }, { id: '' }, { source: 'eastern_unknown' }]) {
    const result = summarizeBankPeriod([bank(overrides)], period);
    assert.equal(result.status, 'invalid', JSON.stringify(overrides));
    assert.equal(result.totals, null);
    assert.ok(result.issues.length > 0);
  }
});

test('empty period is unavailable, whereas an imported zero movement is present', () => {
  assert.equal(summarizeBankPeriod([], period).status, 'empty');
  assert.equal(summarizeBankPeriod([bank({ source: 'capone' })], period).totals, null);
  assert.equal(summarizeBankPeriod([bank({ amount: 0 })], period).totals.debitsCents, 0);
});

test('invalid bounds fail before selecting data', () => {
  for (const bounds of [{ start: 'bad', end: period.end }, { start: period.end, end: period.start }, { start: '2025-02-30', end: period.end }]) {
    assert.throws(() => summarizeBankPeriod([], bounds), /Invalid bank period/);
  }
});

test('sum overflow makes totals unavailable even when individual cents are safe', () => {
  const result = summarizeBankPeriod([bank({ id: 'one', amount: '50000000000000' }), bank({ id: 'two', amount: '50000000000000' })], period);
  assert.equal(result.totals, null);
  assert.ok(result.issues.some(issue => issue.code === 'sum_overflow'));
});

test('repeated external references across IDs stay visible and are never silently deduplicated', () => {
  const result = summarizeBankPeriod([bank({ id: 'one', external_ref: 'statement-row-7' }), bank({ id: 'two', external_ref: 'statement-row-7' })], period);
  assert.equal(result.count, 2);
  assert.equal(result.totals, null);
  assert.ok(result.issues.every(issue => issue.code === 'possible_duplicate_reference'));
});

test('statement and match metadata never claims complete coverage or reconciliation', () => {
  const result = summarizeBankPeriod([bank({ match_status: 'matched', match_note: 'legacy auto-match', bank_transaction_matches: [link()] })], period);
  assert.deepEqual(result.statementFiles, ['example-october.pdf']);
  assert.deepEqual(result.statementMonths, ['2025-10-01']);
  assert.equal(result.coverage, 'unverified');
  assert.equal(result.reconciled, false);
  assert.equal(result.linkedRowCount, 1);
  assert.equal(result.noLinkRowCount, 0);
  assert.equal(result.rows[0].linkedCents, 1234);
  assert.equal(result.rows[0].remainingCents, 0);
});

test('partial saved links show remaining amount and receipt links remain distinct from bills', () => {
  const result = summarizeBankPeriod([
    bank({ id: 'debit', amount: 100, bank_transaction_matches: [link({ amount_applied: 30 })] }),
    bank({ id: 'credit', direction: 'credit', amount: 10, bank_transaction_matches: [link({ id: 'receipt-link', invoice_id: null, payment_id: 'receipt-1', amount_applied: 10 })] }),
    bank({ id: 'no-link', amount: 2 }),
  ], period);
  assert.equal(result.rows.find(row => row.id === 'debit').remainingCents, 7000);
  assert.equal(result.linkedRowCount, 2);
  assert.equal(result.noLinkRowCount, 1);
  assert.equal(result.matchingIssueCount, 0);
});

test('invalid and excessive saved links flag matching only, never alter bank cash', () => {
  for (const links of [
    [link({ amount_applied: null })], [link({ amount_applied: -5 })],
    [link({ amount_applied: 20 })], [link({ invoice_id: null })],
    [link({ payment_id: 'also-receipt' })], [link(), link({ amount_applied: 11 })],
  ]) {
    const result = summarizeBankPeriod([bank({ bank_transaction_matches: links })], period);
    assert.equal(result.status, 'available');
    assert.equal(result.totals.debitsCents, 1234);
    assert.equal(result.rows[0].remainingCents, null);
    assert.equal(result.matchingIssueCount, 1);
  }
});

test('different child-link versions on otherwise identical parents do not duplicate bank cash', () => {
  const result = summarizeBankPeriod([
    bank({ bank_transaction_matches: [link()] }),
    bank({ bank_transaction_matches: [link({ amount_applied: 11 })] }),
  ], period);
  assert.equal(result.count, 1);
  assert.equal(result.totals.debitsCents, 1234);
  assert.equal(result.matchingIssueCount, 1);
});

function loaderWith({ pages = [[bank()]], role = 'owner', failPage = -1 } = {}) {
  const calls = [];
  let page = 0;
  const query = {};
  for (const name of ['select', 'like', 'gte', 'lte', 'order']) query[name] = (...args) => { calls.push([name, ...args]); return query; };
  query.range = async (from, to) => {
    calls.push(['range', from, to]);
    const index = page++;
    return index === failPage ? { data: null, error: { message: 'query failed' } } : { data: pages[index] ?? [], error: null };
  };
  const loader = load('src/lib/finance/load-bank-period.ts', {
    '@/lib/supabase/server': { createClient: async () => ({ from: table => { calls.push(['from', table]); return query; } }) },
    '@/lib/auth/require-auth': { requireAuth: async () => ({ profile: { role } }) },
    '@/lib/auth/role-access': { canSeeBoardMoney: value => ['owner', 'precon_manager', 'office_admin'].includes(value) },
    '@/lib/crew/load-labor-ledger': { financialRows: async factory => {
      const rows = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await factory(from, from + 999);
        if (error || !data) throw new Error(error?.message ?? 'Missing page');
        rows.push(...data);
        if (data.length < 1000) return rows;
      }
    } },
    './bank-period': model,
  });
  return { ...loader, calls };
}

test('loader uses caller permissions and exact inclusive period with complete paging', async () => {
  const first = Array.from({ length: 1000 }, (_, index) => bank({ id: `first-${index}`, amount: '0.01' }));
  const loader = loaderWith({ pages: [first, [bank({ id: 'last', amount: '0.02' })]] });
  const result = await loader.loadBankPeriod(period);
  assert.equal(result.count, 1001);
  assert.equal(result.totals.debitsCents, 1002);
  assert.ok(loader.calls.some(call => JSON.stringify(call) === JSON.stringify(['gte', 'txn_date', period.start])));
  assert.ok(loader.calls.some(call => JSON.stringify(call) === JSON.stringify(['lte', 'txn_date', period.end])));
  assert.deepEqual(loader.calls.filter(call => call[0] === 'range'), [['range', 0, 999], ['range', 1000, 1999]]);
  assert.ok(loader.calls.some(call => call[0] === 'select' && call[1].includes('bank_transaction_matches(')));
});

test('unauthorized users and failed later pages cannot get partial bank totals', async () => {
  const denied = loaderWith({ role: 'project_manager' });
  await assert.rejects(denied.loadBankPeriod(period), /not available to this role/);
  assert.equal(denied.calls.length, 0);
  const failing = loaderWith({ pages: [Array.from({ length: 1000 }, (_, index) => bank({ id: `row-${index}` }))], failPage: 1 });
  await assert.rejects(failing.loadBankPeriod(period), /query failed/);
});

test('potentially truncated nested link inventories fail rather than claiming completeness', async () => {
  const loader = loaderWith({ pages: [[bank({ bank_transaction_matches: Array.from({ length: 1000 }, (_, index) => link({ id: `link-${index}` })) })]] });
  await assert.rejects(loader.loadBankPeriod(period), /Complete saved bank link inventory unavailable/);
});
