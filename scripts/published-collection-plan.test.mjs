import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
const require = createRequire(import.meta.url);
const ts = require('typescript');
function load(file) {
  const compiled = { exports: {} };
  const js = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  new Function('require', 'module', 'exports', js)(name => {
    if (name === 'server-only') return {};
    if (name === './collection-invoice-actions') return { CollectionInvoiceActions: () => null };
    return require(name);
  }, compiled, compiled.exports);
  return compiled.exports;
}
const { publishedCollectionPlan: plan } = load('src/lib/finance/published-collection-plan.ts');
const sum = items => items.reduce((total, item) => total + item.amount, 0);

test('published October totals reconcile to the dated sent email, excluding conditional collections', () => {
  assert.equal(plan.source.messageId, '1a121aa050ec68dd');
  assert.equal(plan.asOf, '2026-10-09');
  assert.equal(plan.focusWeekTarget, 20412509);
  assert.equal(sum(plan.weeks), 53765315);
  assert.equal(sum(plan.weeks), plan.monthPlan);
  assert.equal(sum(plan.weeks.filter(w => w.status === 'Reported collected')), plan.reportedCollected);
  assert.equal(plan.goal - plan.reportedCollected, 36529904);
  assert.equal(plan.monthPlan - plan.reportedCollected, 40295219);
  assert.equal(sum(plan.conditional), 20987600);
});
test('PM assignments and billing statuses reconcile to the focus week target', () => {
  for (const manager of plan.managers) assert.equal(sum(manager.items), manager.total, manager.name);
  const items = plan.managers.flatMap(manager => manager.items);
  assert.equal(sum(items), plan.focusWeekTarget);
  assert.equal(sum(items.filter(i => i.status === 'Invoiced')), plan.invoiced);
  assert.equal(sum(items.filter(i => i.status === 'Ready to bill')), plan.readyToBill);
  for (const week of plan.comingUp) assert.equal(sum(week.items), plan.weeks.find(w => w.label === week.label).amount);
});
test('render keeps provenance, dates, exact cents, reported actuals and conditional amounts visible', () => {
  const { CollectionPlanCard } = load('src/components/ceo/collection-plan-card.tsx');
  const html = require('react-dom/server').renderToStaticMarkup(require('react').createElement(CollectionPlanCard, { plan }));
  for (const value of ['$204,125.09', '$537,653.15', '$209,876.00', 'October 12–16', 'Oct 9, 2026', 'Reported collected', 'excluded from October plan', plan.source.messageId]) assert.ok(html.includes(value), value);
  assert.ok(!html.includes('Still to collect this week'));
  assert.ok(readFileSync('src/lib/finance/published-collection-plan.ts', 'utf8').includes('import "server-only"'));
});
