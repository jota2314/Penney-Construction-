const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');
const code = ts.transpileModule(fs.readFileSync('src/lib/finance/receipt-invoice-groups.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const context = { exports: {} };
vm.runInNewContext(code, context);
const { groupReceiptInvoices: group } = context.exports;
const row = (id, split, amount, extra = {}) => ({ id, split_group_id: split, amount,
  invoice_number: '396618', vendor_name: 'Jackson Lumber & Millwork Co. Inc.', invoice_date: '2026-09-10', ...extra });
const allocations = [row('a', 'first', 638.13), row('b', 'first', 549.12)];
assert.equal(group(allocations)[0].amount, 1187.25);
assert.equal(group(allocations)[0].allocationCount, 2);
const repeated = [...allocations, row('c', 'second', 638.13), row('d', 'second', 549.12)];
const result = group(repeated);
assert.equal(result.length, 1);
assert.equal(result[0].amount, 1187.25);
assert.equal(result[0].submissionCount, 2);
assert.equal(result[0].rows.length, 4); // Retain all records for review.
assert.equal(group([...allocations, row('c', null, 1200)])[0].amount, null);
assert.equal(group([row('a', 'first', null), allocations[1]])[0].amount, null);
assert.equal(group([row('a', null, 10, { invoice_number: null }), row('b', null, 10, { invoice_number: null })]).length, 2);
assert.equal(group([allocations[0], row('b', null, 10, { vendor_name: 'Another vendor' })]).length, 2);
assert.equal(group([allocations[0], row('b', null, 10, { invoice_date: '2026-09-09' })]).length, 2);
assert.equal(group([row('a', 'first', -0.1), row('b', 'first', -0.2)])[0].amount, -0.3);
assert.equal(group([row('a', 'first', 10, { project_id: 'one' }), row('b', 'first', 20, { project_id: 'two' })])[0].amount, 30);
assert.equal(allocations[0].amount, 638.13);
console.log('PASS: splits, repeat submissions, missing totals, unrelated invoices, credits, cross-job allocations, and immutability');
