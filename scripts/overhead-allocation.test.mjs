import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const sourceURL = new URL('../src/lib/finance/overhead-allocation.ts', import.meta.url);
const moduleURL = source => `data:text/javascript;base64,${Buffer.from(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText).toString('base64')}`;
const pureURL = moduleURL(fs.readFileSync(sourceURL, 'utf8'));
const { calculateOverheadAllocation: calculate, classifyOverheadBill } = await import(pureURL);
const project = '12345678-1234-4234-8234-123456789abc';
const receipt = (id, amount, date = '2026-07-05', project_id = project) => ({ id, amount, received_date: date, project_id });
const bill = (id, amount, fields = {}) => ({ id, amount, project_id: 'office', invoice_date: '2026-07-05', ...fields });
const base = () => ({
  projectId: project, asOf: '2026-10-14T20:00:00Z',
  jobReceipts: [receipt('job', 100)],
  companyReceipts: [receipt('job', 100), receipt('other', 300, undefined, 'other-job')],
  overheadProjects: [{ id: 'office', is_overhead: true }],
  payroll: [{ month: '2026-07-01', office_burdened: 100, fees: 10, source_note: 'Payroll report' }],
  bills: [bill('rent', 90)],
});

test('allocates actual payroll, fees and net overhead bills against signed net receipts in the same month', () => {
  const input = base();
  input.jobReceipts.push(receipt('bounce', -25)); input.companyReceipts.push(receipt('bounce', -25));
  input.bills.push(bill('credit', -20), bill('manual-office', 50, { estimate_line_items: { description: 'Office Payroll' } }));
  const result = calculate(input);
  assert.deepEqual(result.blockers, []);
  assert.deepEqual(result.months[0], { month: '2026-07', overhead: 23000, companyReceipts: 37500, jobReceipts: 7500, allocated: 4600, payrollComplete: true });
  assert.equal(result.allocated, 4600);
});

test('rounds exact half-cent allocations once per month and blocks an unexplained negative pool', () => {
  const input = base();
  input.jobReceipts = [receipt('job', .01)]; input.companyReceipts = [...input.jobReceipts, receipt('other', .01, undefined, 'other-job')];
  input.payroll = [{ month: '2026-07-01', office_burdened: 0, fees: 0 }]; input.bills = [bill('cent', .01)];
  assert.equal(calculate(input).allocated, 1);
  input.bills[0].amount = -.01;
  assert.equal(calculate(input).allocated, null);
  assert.match(calculate(input).blockers.join(' '), /negative overhead pool/);
});

test('company report and allocation share duplicate, ADP, internal and capex exclusions; Adpro is a real cost', () => {
  const input = base();
  input.bills.push(bill('duplicate', 200, { duplicate_of_id: 'rent' }), bill('van', 45000, { is_capex: true }), bill('adp', 9000, { vendor_name: 'ADP payroll' }), bill('internal', 8000, { payment_method: 'internal' }), bill('design', 20, { vendor_name: 'Adpro Design' }));
  assert.deepEqual(input.bills.map(classifyOverheadBill), ['running_cost', 'duplicate', 'capex', 'excluded', 'excluded', 'running_cost']);
  const result = calculate(input);
  assert.equal(result.months[0].overhead, 22000);
  assert.equal(result.allocated, 5500);
  assert.ok(result.source_register['overhead_bills:van']);
  const earlier = result.fingerprint; input.bills.find(b => b.id === 'van').is_capex = false;
  assert.notEqual(calculate(input).fingerprint, earlier);
});

test('missing payroll blocks the total without suppressing covered-month details', () => {
  const input = base(); const august = receipt('aug', 100, '2026-08-01');
  input.jobReceipts.push(august); input.companyReceipts.push(august); input.bills.push(bill('aug-cost', 80, { invoice_date: '2026-08-01' }));
  const result = calculate(input);
  assert.equal(result.allocated, null); assert.equal(result.months[0].allocated, 5000);
  assert.equal(result.months[1].allocated, null); assert.equal(result.months[1].overhead, 8000);
  assert.match(result.blockers.join(' '), /2026-08.*payroll split/);
});

test('current/future months stay blocked despite an existing split, using the Eastern calendar boundary', () => {
  const input = base(); input.asOf = '2026-08-01T03:59:59Z';
  assert.equal(calculate(input).allocated, null);
  input.asOf = '2026-08-01T04:00:00Z'; assert.equal(calculate(input).allocated, 5000);
  input.asOf = '2026-06-15T20:00:00Z'; assert.match(calculate(input).blockers.join(' '), /future month/);
});

test('negative job net, nonpositive company denominator and no positive net receipts never become a zero guess', () => {
  const input = base(); input.jobReceipts = [receipt('job', -20)]; input.companyReceipts = [...input.jobReceipts, receipt('other', 10, undefined, 'other-job')];
  const result = calculate(input);
  assert.equal(result.allocated, null);
  assert.match(result.blockers.join(' '), /negative job net/); assert.match(result.blockers.join(' '), /company net receipts must be positive/); assert.match(result.blockers.join(' '), /no positive net/);
  input.jobReceipts = []; input.companyReceipts = []; assert.equal(calculate(input).allocated, null);
  input.jobReceipts = [receipt('job', 100), receipt('reversal', -100)]; input.companyReceipts = [...input.jobReceipts]; assert.equal(calculate(input).allocated, null);
  const excessive = base(); excessive.companyReceipts[1].amount = -50;
  assert.match(calculate(excessive).blockers.join(' '), /job receipts exceed company/);
});

test('cross-year receipts use each historical month pool and add rounded cents', () => {
  const input = base(); const prior = receipt('prior', 200, '2025-12-30');
  input.jobReceipts.push(prior); input.companyReceipts.push(prior, receipt('other-prior', 200, '2025-12-01', 'other-job'));
  input.payroll.push({ month: '2025-12-01', office_burdened: 300, fees: 0 });
  const result = calculate(input);
  assert.deepEqual(result.months.map(m => m.month), ['2025-12', '2026-07']); assert.equal(result.allocated, 20000);
});

test('fingerprint ignores ordering, unrelated months and wall-clock time; includes project, meaningful edits and additions', () => {
  const input = base(), fingerprint = calculate(input).fingerprint;
  input.asOf = '2026-11-15T10:00:00Z'; input.companyReceipts.reverse(); input.bills[0].updated_at = 'new timestamp';
  input.companyReceipts.push(receipt('irrelevant', 55, '2020-01-01', 'other-job'));
  assert.equal(calculate(input).fingerprint, fingerprint);
  input.bills[0].amount = 91; assert.notEqual(calculate(input).fingerprint, fingerprint);
  input.bills[0].amount = 90; input.companyReceipts.push(receipt('new-other', 1, undefined, 'other-job')); assert.notEqual(calculate(input).fingerprint, fingerprint);
  const previous = calculate(input).fingerprint, prior = receipt('new-year', 5, '2025-12-01');
  input.jobReceipts.push(prior); input.companyReceipts.push(prior); assert.notEqual(calculate(input).fingerprint, previous);
  const other = base(); other.projectId = 'different'; assert.notEqual(calculate(other).fingerprint, fingerprint);
});

test('receipt edits during independent reads, duplicate inventories and invalid financial values fail closed', () => {
  const missing = base(); missing.companyReceipts = missing.companyReceipts.filter(r => r.id !== 'job');
  assert.match(calculate(missing).blockers.join(' '), /missing from the company inventory/);
  const duplicate = base(); duplicate.companyReceipts.push(duplicate.companyReceipts[0]); assert.equal(calculate(duplicate).allocated, null);
  const invalid = base(); invalid.jobReceipts[0].received_date = '2026-02-30'; assert.match(calculate(invalid).blockers.join(' '), /valid received date/);
  const badAmount = base(); badAmount.bills[0].amount = null; assert.match(calculate(badAmount).blockers.join(' '), /valid amount/);
});

// Exercise the actual loader with an authenticated, read-only PostgREST fake,
// including a second page and a lifetime receipt added during its fetch.
async function serverModule(fake) {
  globalThis.__overheadTest = fake;
  let source = fs.readFileSync(new URL('../src/lib/finance/overhead.ts', import.meta.url), 'utf8');
  source = source.replace('import { createClient } from "@/lib/supabase/server";', 'const createClient = async () => globalThis.__overheadTest.db;')
    .replace('import { cache } from "react";', 'const cache = fn => fn;')
    .replace('import { getUser } from "@/lib/auth/get-user";', 'const getUser = async () => globalThis.__overheadTest.user;')
    .replace('import { canSeeBoardMoney } from "@/lib/auth/role-access";', 'const canSeeBoardMoney = role => role === "owner";')
    .replace('import { z } from "zod";', 'const z = { string: () => ({ uuid: () => ({ safeParse: value => ({ success: /^[0-9a-f-]{36}$/i.test(value) }) }) }) };')
    .replace('import { financialRows as fetchAllRows } from "@/lib/crew/load-labor-ledger";', 'const fetchAllRows = async factory => { const all = []; for (let from = 0;;from += 1000) { const {data,error} = await factory(from, from + 999); if (error || !data) throw new Error(error?.message ?? "load failed"); all.push(...data); if (data.length < 1000) return all; } };')
    .replace('"./overhead-allocation"', JSON.stringify(pureURL));
  return import(moduleURL(source));
}
function fakeDatabase(tables, options = {}) {
  const queries = []; let jobReads = 0;
  return { queries, user: { profile: { role: 'owner' } }, db: { from(table) {
    const filters = []; const query = {
      select() { return this; }, order() { return this; },
      eq(key, value) { filters.push(r => r[key] === value); if (table === 'payments_received' && key === 'project_id') jobReads++; return this; },
      is(key, value) { filters.push(r => (r[key] ?? null) === value); return this; },
      gte(key, value) { filters.push(r => r[key] >= value); return this; },
      lt(key, value) { filters.push(r => r[key] < value); return this; },
      in(key, values) { filters.push(r => values.includes(r[key])); return this; },
      async single() { const rows = tables[table].filter(r => filters.every(f => f(r))); return { data: rows[0] ?? null, error: null }; },
      async range(from, to) {
        queries.push({ table, from, to });
        if (options.failSecondPage && from === 1000) return { data: null, error: { message: 'Second page failed' } };
        let rows = tables[table].filter(r => filters.every(f => f(r)));
        if (options.newLifetimeReceipt && table === 'payments_received' && jobReads > 1) rows = [...rows, receipt('late', 5, '2024-01-01')];
        return { data: rows.slice(from, to + 1), error: null };
      },
    }; return query;
  } } };
}
const loaderTables = () => ({
  projects: [{ id: project, is_overhead: false }, { id: 'office', is_overhead: true }],
  payments_received: [receipt('job', 100, '2025-12-01'), ...Array.from({ length: 1001 }, (_, i) => receipt(`other-${i}`, 1, '2025-12-01', 'another'))],
  payroll_month_splits: [{ month: '2025-12-01', office_burdened: 100, fees: 0 }],
  invoices: [bill('rent', 10, { invoice_date: '2025-12-01' })],
});
test('existing overhead report preserves its totals and matches the allocation pool', async () => {
  const tables = loaderTables();
  tables.invoices.push(
    bill('manual-pay', 25, { invoice_date: '2025-12-01', estimate_line_items: { description: 'Office payroll' } }),
    bill('vendor-credit', -5, { invoice_date: '2025-12-01' }),
    bill('duplicate', 50, { invoice_date: '2025-12-01', duplicate_of_id: 'rent' }),
    bill('capex', 500, { invoice_date: '2025-12-01', is_capex: true }),
    bill('adp', 1000, { invoice_date: '2025-12-01', vendor_name: 'ADP payroll' }),
    bill('internal', 2000, { invoice_date: '2025-12-01', payment_method: 'internal' }),
  );
  const fake = fakeDatabase(tables), api = await serverModule(fake);
  const report = await api.getOverheadReport(2025), allocation = await api.getJobOverheadAllocation(project);
  assert.equal(report.totalOverhead, 130); assert.equal(report.totalCapex, 500); assert.equal(report.totalRevenue, 1101);
  assert.equal(report.months[0].officePayroll, 125); assert.equal(report.months[0].nonPayroll, 5);
  assert.equal(allocation.months[0].overhead, report.totalOverhead * 100);
  assert.equal(allocation.months[0].companyReceipts, report.totalRevenue * 100);
});
test('server loader includes a historical year and all company pages; source register retains every used receipt', async () => {
  const fake = fakeDatabase(loaderTables()); const { getJobOverheadAllocation } = await serverModule(fake);
  const result = await getJobOverheadAllocation(project);
  assert.deepEqual(result.blockers, []); assert.equal(result.months[0].companyReceipts, 110100); assert.equal(result.allocated, 999);
  assert.equal(Object.keys(result.source_register).filter(k => k.startsWith('overhead_company_receipts:')).length, 1002);
  assert.ok(fake.queries.some(q => q.table === 'payments_received' && q.from === 1000));
});
test('server loader refuses truncated inventories, races adding another receipt year, and unauthorized access', async () => {
  const failed = fakeDatabase(loaderTables(), { failSecondPage: true }); let api = await serverModule(failed);
  await assert.rejects(api.getJobOverheadAllocation(project), /Second page failed/);
  const raced = fakeDatabase(loaderTables(), { newLifetimeReceipt: true }); api = await serverModule(raced);
  await assert.rejects(api.getJobOverheadAllocation(project), /receipts changed/);
  const forbidden = fakeDatabase(loaderTables()); forbidden.user.profile.role = 'project_manager'; api = await serverModule(forbidden);
  await assert.rejects(api.getJobOverheadAllocation(project), /financial access/); assert.equal(forbidden.queries.length, 0);
});
