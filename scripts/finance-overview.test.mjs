import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

// Render the actual server component with fixture adapters. This suite uses no
// browser, authenticated session, live database, or financial write operation.
const require = createRequire(import.meta.url);
const source = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const NOW = "2026-11-05T16:00:00Z";
class FixedDate extends Date {
  constructor(...args) { super(...(args.length ? args : [NOW])); }
  static now() { return Date.parse(NOW); }
}
function evaluate(text, modules = {}, filename = "finance-fixture.cjs") {
  const compiled = ts.transpileModule(text, {
    fileName: filename === "finance-overview.cjs" ? "overview.tsx" : "fixture.ts",
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, {
    exports, module: { exports }, Date: FixedDate, Intl, console,
    require(name) {
      if (!(name in modules)) throw new Error(`Unmocked finance dependency: ${name}`);
      return modules[name];
    },
  }, { filename });
  return exports;
}
const ledgerSource = source("src/lib/crew/load-labor-ledger.ts");
const { financialRows } = evaluate(ledgerSource.slice(
  ledgerSource.indexOf("export async function financialRows"),
  ledgerSource.indexOf("export async function loadLaborLedger"),
));
const model = evaluate(source("src/lib/finance/workspace-model.ts"));
const category = evaluate(source("src/lib/finance/spend-category.ts"));
const expenses = evaluate(source("src/lib/finance/expense-model.ts"), { "./spend-category": category });
const icon = props => React.createElement("svg", { ...props, "aria-hidden": true });
const Link = ({ href, children, ...props }) => React.createElement("a", { href, ...props }, children);

function bill(overrides = {}) {
  return {
    id: "expense-1", vendor_name: "Fixture supplier", vendor_type: "supplier", trade: "materials",
    description: "Materials", invoice_number: "F-1", amount: 125, paid_amount: 0,
    invoice_date: "2026-11-03", payment_status: "unpaid", payment_method: "capital_one",
    project_id: "project-open", split_group_id: null, estimate_line_item_id: "line-1",
    review_status: "ok", source: "manual", duplicate_of_id: null,
    projects: { name: "Open job", project_number: "PC-FIXTURE", is_overhead: false },
    ...overrides,
  };
}
function collection(id, balance, overrides = {}) {
  return {
    id, projectId: `project-${id}`, projectName: `${id} client`, number: 101,
    title: "Progress invoice", amount: balance, balance, due: "2026-11-01",
    daysLate: 4, daysWaiting: 10, sent: "2026-10-26", issue: null, loggedPayment: null,
    ...overrides,
  };
}
function harness() {
  const state = {
    workspaceError: false, paceError: false, expenseError: false, bankError: false,
    bank: [{ txn_date: "2026-10-31" }],
    expenseRows: [bill(), bill({ id: "credit-1", amount: -25, paid_amount: 0, invoice_number: "C-1" })],
    pace: { month: { collected: 543210 }, thisWeek: { collected: 123456, label: "Nov 2–8" } },
    workspace: {
      collections: [
        collection("open", 120000),
        collection("matching", 70000, { loggedPayment: { amount: 70000, date: "2026-11-04", reference: "42" } }),
        collection("flagged", 80000, { issue: "Receipt amount needs reconciliation" }),
      ],
      jobs: [{ id: "watch-job", name: "Watch job", number: "PC-WATCH", cost: 1000000, budget: 500000,
        contract: 2000000, overdue: 0, warnings: ["Bills need source review"], audit: null,
        forecast: null, financialBasis: "fixture", finalNeedsReview: false }],
      bills: { total: 350, reviewBalance: 900, review: [{ id: "unresolved-bill" }], bills: [
        { id: "vendor-bill", vendor: "Fixture vendor", projects: ["Open job"], amount: 350,
          dueDate: "2026-11-04", approved: false },
      ] },
      auditError: null,
    },
    queries: [],
  };
  class Query {
    constructor(table) { this.table = table; this.calls = []; state.queries.push(this); }
    select(...args) { this.calls.push(["select", ...args]); return this; }
    is(...args) { this.calls.push(["is", ...args]); return this; }
    gte(...args) { this.calls.push(["gte", ...args]); return this; }
    lte(...args) { this.calls.push(["lte", ...args]); return this; }
    like(...args) { this.calls.push(["like", ...args]); return this; }
    order(...args) { this.calls.push(["order", ...args]); return this; }
    limit(...args) { this.calls.push(["limit", ...args]); return this; }
    range(from, to) { this.from = from; this.to = to; return this; }
    result() {
      if (this.table === "invoices") return state.expenseError
        ? { data: null, error: { message: "Expense source failed" } }
        : { data: structuredClone(state.expenseRows.slice(this.from, this.to + 1)), error: null };
      if (this.table === "bank_transactions") return state.bankError
        ? { data: null, error: { message: "Bank source failed" } }
        : { data: structuredClone(state.bank), error: null };
      throw new Error(`Unexpected table ${this.table}`);
    }
    then(resolve, reject) { return Promise.resolve(this.result()).then(resolve, reject); }
  }
  const db = { from: table => new Query(table) };
  const modules = {
    "react/jsx-runtime": require("react/jsx-runtime"),
    "next/link": Link,
    "lucide-react": { ArrowDownLeft: icon, ArrowUpRight: icon, CircleAlert: icon, Receipt: icon, Wallet: icon },
    "@/lib/supabase/server": { createClient: async () => db },
    "@/lib/crew/load-labor-ledger": { financialRows },
    "@/lib/finance/workspace-data": { getFinanceWorkspace: async () => {
      if (state.workspaceError) throw new Error("Workspace source failed");
      return structuredClone(state.workspace);
    } },
    "@/lib/finance/collection-pace": { getCollectionPace: async () => {
      if (state.paceError) throw new Error("Receipt source failed");
      return structuredClone(state.pace);
    } },
    "@/lib/finance/workspace-model": model,
    "@/lib/finance/expense-model": expenses,
  };
  const { default: Overview } = evaluate(source("src/components/finances/sections/overview.tsx"), modules, "finance-overview.cjs");
  return { state, render: async () => renderToStaticMarkup(await Overview()) };
}
const textOf = html => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim();
function metric(html, label) {
  const anchor = [...html.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/g)].find(match => textOf(match[0]).startsWith(label));
  assert.ok(anchor, `Metric ${label} must render`);
  return textOf(anchor[0]);
}
const hrefs = html => [...html.matchAll(/href="([^"]+)"/g)].map(match => match[1].replace(/&amp;/g, "&"));

test("overview uses actionable collections and retains reconciliation queues plus native links", async () => {
  const { state, render } = harness();
  const html = await render();
  assert.match(metric(html, "Recorded receipts"), /\$5,432\.10/);
  assert.match(metric(html, "Recorded expenses"), /\$100\.00/);
  assert.match(metric(html, "Customer invoices to follow up"), /\$1,200\.00.*1 issued invoices.*1 possible receipt matches excluded/);
  assert.doesNotMatch(metric(html, "Customer invoices to follow up"), /\$2,700\.00/);
  assert.match(metric(html, "Reviewed vendor bills open"), /\$350\.00.*\$900\.00 unresolved/);
  assert.match(textOf(html), /2 invoice checks.*1 balance discrepancies.*1 possible receipt matches/);
  assert.match(textOf(html), /Over budget/);
  assert.match(textOf(html), /Latest imported Eastern transaction: Oct 31, 2026/);
  assert.match(textOf(html), /do not confirm statement completeness or today’s bank balance/);
  const links = hrefs(html);
  for (const href of [
    "/finances?section=weekly", "/finances?section=income&range=month", "/finances?section=expenses&range=month",
    "/finances?section=collections&collection=project-open", "/spent/vendor-bill", "/projects/watch-job?tab=finances", "/finances?section=cash",
  ]) assert.ok(links.includes(href), `Missing native link ${href}`);
  assert.ok(!links.some(href => /collection=project-(matching|flagged)/.test(href)));
  const invoiceQuery = state.queries.find(query => query.table === "invoices");
  assert.ok(invoiceQuery.calls.some(call => call[0] === "gte" && call[1] === "invoice_date" && call[2] === "2026-11-01"));
  assert.ok(invoiceQuery.calls.some(call => call[0] === "lte" && call[1] === "invoice_date" && call[2] === "2026-11-05"));
});

test("independent source failures show unavailable figures without replacing balances with zero", async () => {
  for (const failure of ["workspaceError", "paceError", "expenseError", "bankError"]) {
    const { state, render } = harness();
    state[failure] = true;
    const html = await render();
    assert.match(html, /role="alert"/, failure);
    assert.match(textOf(html), /Some finance sources could not load/, failure);
    assert.match(metric(html, "Recorded receipts"), failure === "paceError" ? /Unavailable/ : /\$5,432\.10/, failure);
    assert.match(metric(html, "Recorded expenses"), failure === "expenseError" ? /Unavailable/ : /\$100\.00/, failure);
    assert.match(metric(html, "Customer invoices to follow up"), failure === "workspaceError" ? /Unavailable/ : /\$1,200\.00/, failure);
    assert.match(metric(html, "Reviewed vendor bills open"), failure === "workspaceError" ? /Unavailable/ : /\$350\.00/, failure);
    const unavailableLabels = failure === "workspaceError" ? ["Customer invoices to follow up", "Reviewed vendor bills open"]
      : failure === "paceError" ? ["Recorded receipts"] : failure === "expenseError" ? ["Recorded expenses"] : [];
    for (const label of unavailableLabels) assert.doesNotMatch(metric(html, label), /\$0\.00/, `${label}: missing is not zero`);
    assert.match(textOf(html), failure === "bankError" ? /Bank coverage could not load/ : /Latest imported Eastern transaction/, failure);
    if (failure !== "workspaceError") {
      assert.match(textOf(html), /Collection follow-up/);
      assert.match(textOf(html), /Bills coming due/);
      assert.match(textOf(html), /Watch job/);
    }
    assert.doesNotMatch(textOf(html), /No Eastern transactions imported/, failure);
  }
});

test("an invalid expense amount displays needs review instead of a complete total", async () => {
  const { state, render } = harness();
  state.expenseRows.push(bill({ id: "unknown-amount", amount: null }));
  const html = await render();
  assert.match(metric(html, "Recorded expenses"), /Needs review/);
  assert.match(metric(html, "Recorded expenses"), /Bill amounts are incomplete/);
  assert.match(metric(html, "Recorded expenses"), /allocations need review/);
  assert.doesNotMatch(metric(html, "Recorded expenses"), /Recorded expenses \$100\.00/);
  assert.doesNotMatch(metric(html, "Recorded expenses"), /\$125\.00 charges/);
  assert.match(metric(html, "Customer invoices to follow up"), /\$1,200\.00/);
});

test("empty imported bank inventory is distinct from a failed bank source", async () => {
  const { state, render } = harness();
  state.bank = [];
  const html = await render();
  assert.match(textOf(html), /No Eastern transactions imported/);
  assert.doesNotMatch(html, /role="alert"/);
  assert.doesNotMatch(textOf(html), /Bank coverage could not load/);
});

function paceHarness(rows, failFrom = null) {
  const calls = [];
  class Query {
    select() { return this; }
    gte() { return this; }
    lte() { return this; }
    order() { return this; }
    range(from, to) {
      calls.push([from, to]);
      return Promise.resolve(from === failFrom
        ? { data: null, error: { message: "Later receipt page unavailable" } }
        : { data: rows.slice(from, to + 1), error: null });
    }
  }
  const db = { from: table => { assert.equal(table, "payments_received"); return new Query(); } };
  const { getCollectionPace } = evaluate(source("src/lib/finance/collection-pace.ts"), {
    "server-only": {},
    "@/lib/supabase/server": { createClient: async () => db },
    "@/lib/crew/load-labor-ledger": { financialRows },
    "@/lib/finance/published-collection-plan": { publishedCollectionPlan: { monthKey: "2026-10", weeks: [], goal: 0 } },
  }, "collection-pace.cjs");
  return { calls, load: () => getCollectionPace(db) };
}
const receipt = (id, amount = 1) => ({ id, amount, received_date: "2026-11-03", payment_type: "progress", projects: { name: "Fixture customer" } });

test("collection pace rejects a failed later page instead of returning partial collections", async () => {
  const { calls, load } = paceHarness(Array.from({ length: 1001 }, (_, i) => receipt(String(i))), 1000);
  await assert.rejects(load(), /Later receipt page unavailable/);
  assert.deepEqual(calls, [[0, 999], [1000, 1999]]);
});

test("collection pace includes all pages and signed reversals, and refuses missing amounts", async () => {
  const rows = Array.from({ length: 1001 }, (_, i) => receipt(String(i)));
  rows.push(receipt("reversal", -100));
  const { load } = paceHarness(rows);
  assert.equal((await load()).month.collected, 90100);
  await assert.rejects(paceHarness([receipt("missing", null)]).load(), /amount needs verification/);
});
