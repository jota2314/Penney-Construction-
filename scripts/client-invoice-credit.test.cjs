const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const test = require('node:test');
const ts = require('typescript');
const exportsObj = {};
const code = ts.transpileModule(fs.readFileSync('src/lib/finance/client-invoice-credits.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
vm.runInNewContext(code, { exports: exportsObj });
const { containsChangeOrderCredit, canCreditSentInvoice } = exportsObj;
const credit = { id: 'source-credit', change_order_number: 1 };

test('excludes explicit legacy credits without confusing other COs or equal amounts', () => {
  for (const description of ['Change Order #1, owner supplied doors', 'CO #01 credit', 'credit (co 1)', 'Change  Order 001']) {
    assert.equal(containsChangeOrderCredit([{ description, amount: -2340 }], credit), true, description);
  }
  for (const description of ['CO #10 credit', 'CO #1A credit', 'other credit', 'changeorder1', 'disco 1']) {
    assert.equal(containsChangeOrderCredit([{ description, amount: -2340 }], credit), false, description);
  }
  assert.equal(containsChangeOrderCredit([{ description: 'CO #1', amount: 2340 }], credit), false);
  assert.equal(containsChangeOrderCredit([{ change_order_id: credit.id, amount: -548.23 }], credit), true);
  assert.equal(containsChangeOrderCredit(null, credit), false);
});

test('only shows sent, unpaid, unsynced invoices as credit candidates', () => {
  const invoice = { status: 'sent', sent_to_client_at: '2026-10-21', paid_at: null, paid_amount: null,
    quickbooks_invoice_id: null, quickbooks_id: null, quickbooks_doc_number: null, amount: 10676.67 };
  assert.equal(canCreditSentInvoice(invoice), true);
  for (const patch of [{ status: 'draft' }, { status: 'paid' }, { sent_to_client_at: null },
    { paid_at: '2026-10-21' }, { paid_amount: 1 }, { amount: 0 }, { quickbooks_id: 'external' },
    { quickbooks_invoice_id: 'external' }, { quickbooks_doc_number: 'external' }]) {
    assert.equal(canCreditSentInvoice({ ...invoice, ...patch }), false);
  }
});
