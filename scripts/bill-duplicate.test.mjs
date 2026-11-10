// The bill drop's duplicate rule (src/lib/bills/duplicate.ts).
// Run: node --test scripts/bill-duplicate.test.mjs
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';

const source = ts.transpileModule(readFileSync('src/lib/bills/duplicate.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const mod = { exports: {} };
new Function('require', 'module', 'exports', source)(() => ({}), mod, mod.exports);
const { pickBookedDuplicate, billNumberKey, vendorFamilyToken, duplicateReviewReason, findBookedDuplicate } = mod.exports;

const now = Date.parse('2026-11-10T17:00:00Z');
const row = (id, amount, extra = {}) => ({
  id, vendor_name: 'Sygma Stone Inc', invoice_number: '16789', invoice_date: '2026-11-09', amount,
  split_group_id: 'g1', created_at: '2026-11-10T12:17:51Z', ...extra,
});
// Sygma Stone #16789 on Ouellette, as Bill filed it at 12:17 on 11/10/2026.
const sygma = [row('a', 863), row('b', 2725), row('c', '4260.44')];

test('a split bill is caught whole by its invoice number', () => {
  const d = pickBookedDuplicate(sygma, { invoiceNumber: '16789', amount: 7848.44 }, now);
  assert.equal(d.matchedOn, 'invoice_number');
  assert.equal(d.amount, 7848.44);
  assert.equal(d.lines, 3);
  assert.equal(d.invoiceId, 'a');
});

test('a split bill is caught whole by its total when no number was read', () => {
  const d = pickBookedDuplicate(sygma, { invoiceNumber: null, amount: 7848.44 }, now);
  assert.equal(d.matchedOn, 'amount');
  assert.equal(d.lines, 3);
});

test('the old single-row rule still holds', () => {
  const single = [row('x', 650, { split_group_id: null, invoice_number: null, vendor_name: 'WRD Pro Painting' })];
  assert.equal(pickBookedDuplicate(single, { invoiceNumber: null, amount: 650 }, now).matchedOn, 'amount');
});

test('the same number written differently still matches', () => {
  for (const n of ['INV-016789', '#16789', 'Invoice 16789', ' 16789 ']) {
    assert.ok(pickBookedDuplicate(sygma, { invoiceNumber: n, amount: 1 }, now), n);
  }
  assert.equal(billNumberKey('INV-016789'), '16789');
  assert.equal(billNumberKey('N/A'), null);
  assert.equal(billNumberKey(''), null);
});

test('a different bill from the same vendor is not a duplicate', () => {
  assert.equal(pickBookedDuplicate(sygma, { invoiceNumber: '16790', amount: 1200 }, now), null);
  // one piece of the split on its own is not the whole bill
  assert.equal(pickBookedDuplicate(sygma, { invoiceNumber: null, amount: 863 }, now), null);
});

test('a same-total match only counts for the last 45 days; a number match always counts', () => {
  const old = [row('o', 500, { split_group_id: null, invoice_number: 'A-1', created_at: '2026-08-01T00:00:00Z' })];
  assert.equal(pickBookedDuplicate(old, { invoiceNumber: null, amount: 500 }, now), null);
  assert.equal(pickBookedDuplicate(old, { invoiceNumber: 'A-1', amount: 500 }, now).matchedOn, 'invoice_number');
});

test('a credit is never matched to the charge it reverses', () => {
  assert.equal(pickBookedDuplicate(sygma, { invoiceNumber: '16789', amount: -863 }, now), null);
  const credit = [row('cr', -40, { split_group_id: null, invoice_number: 'CM-9' })];
  assert.ok(pickBookedDuplicate(credit, { invoiceNumber: 'CM-9', amount: -40 }, now));
});

test('a number match wins over an amount match on another bill', () => {
  const rows = [row('same-total', 7848.44, { split_group_id: null, invoice_number: '99999' }), ...sygma];
  assert.equal(pickBookedDuplicate(rows, { invoiceNumber: '16789', amount: 7848.44 }, now).invoiceId, 'a');
});

test('vendor family token: first word, safe for ilike, too short means no check', () => {
  assert.equal(vendorFamilyToken('Sygma Stone'), 'Sygma');
  assert.equal(vendorFamilyToken('100%_Pure, Inc'), '100Pure');
  assert.equal(vendorFamilyToken('AB Co'), null);
});

test('the review note names the bill, its total and how it was split', () => {
  const reason = duplicateReviewReason(pickBookedDuplicate(sygma, { invoiceNumber: '16789', amount: 7848.44 }, now));
  assert.match(reason, /Sygma Stone Inc #16789/);
  assert.match(reason, /\$7,848\.44 across 3 budget lines/);
  assert.match(reason, /same invoice number/);
});

test('the lookup stays on the job and the vendor family', async () => {
  const calls = [];
  const q = new Proxy({}, { get(_, prop) {
    if (prop === 'then') return resolve => resolve({ data: sygma, error: null });
    return (...args) => { calls.push([prop, ...args]); return q; };
  } });
  const d = await findBookedDuplicate({ from: t => { calls.push(['from', t]); return q; } },
    { projectId: 'job', vendorName: 'Sygma Stone', invoiceNumber: '16789', amount: 7848.44 });
  assert.equal(d.lines, 3);
  assert.deepEqual(calls.find(c => c[0] === 'from'), ['from', 'invoices']);
  assert.deepEqual(calls.find(c => c[0] === 'ilike'), ['ilike', 'vendor_name', 'Sygma%']);
  assert.deepEqual(calls.find(c => c[0] === 'eq'), ['eq', 'project_id', 'job']);
  // a bill with no job is only compared with other no-job bills
  calls.length = 0;
  await findBookedDuplicate({ from: () => q }, { projectId: null, vendorName: 'Sygma Stone', invoiceNumber: null, amount: 1 });
  assert.deepEqual(calls.find(c => c[0] === 'is'), ['is', 'project_id', null]);
});
