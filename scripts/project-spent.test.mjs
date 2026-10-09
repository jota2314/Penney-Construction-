import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
const passthrough = ({ children }) => children ?? null;
const ui = new Proxy({}, { get: () => passthrough });
function load(path) {
  const compiled = { exports: {} };
  const js = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function('require', 'module', 'exports', js)(name => {
    if (name.startsWith('react')) return require(name);
    if (name === 'next/navigation') return { useRouter: () => ({ refresh() {} }) };
    if (name === '@/lib/money') return load('src/lib/money.ts');
    if (name === '@/lib/estimates/current') return load('src/lib/estimates/current.ts');
    if (name === 'lucide-react' || name.startsWith('@/components/') || name.startsWith('./')) return ui;
    if (name.startsWith('@/lib/actions/')) return {}; // Read-only rendering must not call actions.
    throw new Error(`Unexpected import: ${name}`);
  }, compiled, compiled.exports);
  return compiled.exports;
}
const { ProjectFinancesTab } = load('src/components/projects/project-finances-tab.tsx');
const invoice = (id, amount, paid_amount, line = 'scope', status = 'paid') => ({
  id, amount, paid_amount, estimate_line_item_id: line, payment_status: status, vendor_name: id,
});
function render(invoices, overrides = {}) {
  return renderToStaticMarkup(React.createElement(ProjectFinancesTab, {
    projectId: 'test', estimates: [], quoteRequests: [], invoices,
    paymentsReceived: [{ id: 'receipt', amount: 68506.75 }], changeOrders: [], clientInvoices: [],
    timeEntries: [], laborTotalCost: 0, contractValue: 68506.75, estimatedValue: null,
    budgetVsActual: [{ line_item_id: 'scope', description: 'Scope', budgeted_cost: 49773.61,
      budgeted_price: 68506.75, budgeted_profit: 18733.14,
      actual_invoiced: invoices.filter(i => i.estimate_line_item_id === 'scope').reduce((s, i) => s + i.amount, 0),
      variance: 0, percent_spent: 0 }],
    ...overrides,
  })).replace(/<[^>]+>/g, '');
}

test('Spent includes zero-paid, unpaid, unlinked and old-estimate expenses, and net credits once', () => {
  const text = render([
    invoice('paid', 41893.32, 41893.32),
    invoice('ledger labor', 6840.53, 0),
    invoice('unassigned', 3000, 0, null, 'unpaid'),
    invoice('old estimate', 400, 0, 'obsolete-line'),
    invoice('credit', -164.25, 0, null),
  ]);
  assert.match(text, /Spent \$51,969\.60/); // Progress header and tile use the same incurred total.
  assert.match(text, /Spent\$51,969\.60All recorded costs, including unlinked/);
  assert.match(text, /Projected Profit\$16,537\.15/); // Full cost exceeds budget.
  assert.match(text, /\$26,613\.43 cash/); // Unpaid costs must not reduce the cash figure.
  assert.match(text, /Spent\$48,733\.85/);
  assert.match(text, /Unlinked Expenses3Auto-Link to Budget\$3,235\.75/);
});

test('partial payments do not change cost; only incremental shared labor is added', () => {
  const bills = [invoice('bill', 1000, 200, null, 'partial')];
  assert.match(render(bills, { laborTotalCost: 125.25 }), /Spent \$1,125\.25/);
  assert.match(render(bills, { laborTotalCost: 125.25 }), /\$68,181\.50 cash/);
  assert.match(render(bills, { laborTotalCost: 0 }), /Spent \$1,000/);
});

test('ledger-costed jobs do not add clocked wages a second time', () => {
  const text = render([invoice('payroll', 1000, 0)], {
    laborTotalCost: 0,
    timeEntries: [{ id: 'shift', employee_id: 'worker', employee_name: 'Crew', hourly_rate: 50,
      clock_in: '2026-08-10T08:00:00Z', clock_out: '2026-08-10T16:00:00Z',
      paid_minutes: 480, project_cost_cents: 40000 }],
  });
  assert.match(text, /Spent \$1,000/);
  assert.doesNotMatch(text, /Spent \$1,400/);
});
