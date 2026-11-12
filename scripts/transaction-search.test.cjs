/* eslint-disable @typescript-eslint/no-require-imports -- Standalone regression test. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
const compile = (source) => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
require.extensions[".ts"] = (module, filename) => module._compile(compile(fs.readFileSync(filename, "utf8")), filename);
const { searchTransactions } = require("../src/lib/finance/transaction-search.ts");
const { canSeeBoardMoney } = require("../src/lib/auth/role-access.ts");

const project = { id: "job", name: "Sample kitchen", project_number: "DEMO-01" };
const expense = {
  id: "bill", project_id: "job", amount: 1250.25, description: "Cabinet materials", source: "office_entry", review_status: "ok",
  projects: project, vendor_name: "Sample supplier", invoice_number: "INV-100", invoice_date: "2024-01-04",
  split_group_id: null, payment_status: "unpaid", payment_method: "check", duplicate_of_id: null,
};
const income = {
  id: "receipt", project_id: "job", amount: 2000, description: "Progress payment", source: "manual", review_status: "ok",
  projects: project, payer_name: "Sample customer", received_date: "2026-10-01", reference_number: "CHK-500", method: "check",
};
const clientInvoice = {
  id: "client", project_id: "job", invoice_number: 430, title: "Sample milestone", amount: 2000, paid_amount: 0,
  description: "Final completion", line_items: [{ description: "Custom cabinet installation", amount: 2000 }],
  source: "penney",
  status: "draft", invoice_date: "2026-09-29", created_at: "2026-09-28T12:00:00Z", due_date: "2026-10-29",
};
const bank = {
  id: "bank", project_id: "job", txn_date: "2026-10-02", description: "Sample bank debit", amount: 1250.25,
  direction: "debit", check_number: "900", category_key: "card_payoff", source: "eastern_statement",
  vendor_name: null, external_ref: null, card_last4: null, cardholder: null,
};
const data = (changes = {}) => ({ expenses: [expense], income: [income], clientInvoices: [clientInvoice], bank: [bank], projects: [project], ...changes });

test("search covers all transaction types, all dates, names, job labels and existing detail flows", () => {
  const found = searchTransactions(data(), "Sample");
  assert.equal(found.total, 4);
  assert.deepEqual(found.results.map(row => row.kind), ["bank", "income", "client_invoice", "expense"]);
  assert.equal(found.results.find(row => row.kind === "bank").href, null);
  assert.match(found.results.find(row => row.kind === "expense").href, /section=activity&panel=expense&id=bill&month=2024-01/);
  assert.match(found.results.find(row => row.kind === "income").href, /panel=income&id=receipt/);
  assert.equal(found.results.find(row => row.kind === "client_invoice").href, "/api/generate-client-invoice?invoiceId=client");
  assert.equal(searchTransactions(data(), "demo-01").total, 4);
  assert.equal(searchTransactions(data(), "sAmPlE supplier").total, 1);
});

test("currency, references, calendar formats, source and method are searchable", () => {
  for (const query of ["$1,250.25", "1250.25", "INV-100", "1/4/2024", "01/04/2024", "1/4/24", "2024-01-04", "January 4 2024", "Jan 4, 2024", "office entry"]) {
    assert.ok(searchTransactions(data(), query).results.some(row => row.id === "expense:bill"), query);
  }
  assert.equal(searchTransactions(data(), "check CHK-500").results[0].id, "income:receipt");
  assert.equal(searchTransactions(data(), "card payoff debit").results[0].id, "bank:bank");
  assert.equal(searchTransactions(data(), "#430").results[0].id, "client_invoice:client");
  assert.equal(searchTransactions(data(), "10/29/2026").results[0].id, "client_invoice:client");
  assert.equal(searchTransactions(data(), "no such supplier").total, 0);
});

test("complete split groups search every allocation while retaining full amount and review state", () => {
  const input = data({ expenses: [
    { ...expense, split_group_id: "group", amount: 1000 },
    { ...expense, id: "child", split_group_id: "group", project_id: "second-job", projects: { name: "Porch", project_number: "DEMO-02" },
      amount: 250.25, description: "Unique hardware", invoice_number: "CHILD-REF", invoice_date: "2024-02-05", source: "field_capture", payment_method: "capital_one", review_status: "needs_review" },
  ] });
  for (const query of ["unique hardware", "250.25", "CHILD-REF", "2/5/2024", "Porch", "field capture", "capital one"]) {
    const found = searchTransactions(input, query);
    assert.equal(found.total, 1, query);
    assert.equal(found.results[0].amount, 1250.25);
    assert.equal(found.results[0].review, true);
    assert.equal(found.results[0].date, null);
    assert.match(found.results[0].description, /Unique hardware/);
    assert.match(found.results[0].reference, /CHILD-REF/);
  }
});

test("duplicate submissions stay a single reviewed result; excluded imports/internal entries do not return", () => {
  const found = searchTransactions(data({ expenses: [
    expense, { ...expense, id: "again", amount: 1400, description: "Possible duplicate" },
    { ...expense, id: "retired", duplicate_of_id: "bill" },
    { ...expense, id: "internal", payment_method: "internal" },
    { ...expense, id: "qb", source: "qb_import" },
  ], income: [{ ...income, source: "quickbooks" }], clientInvoices: [{ ...clientInvoice, source: "qb_import" }], bank: [{ ...bank, source: "qb_import" }] }), "Sample");
  assert.equal(found.total, 1);
  assert.equal(found.results[0].review, true);
  assert.equal(found.results[0].amount, null);
  assert.equal(searchTransactions(data({ expenses: [{ ...expense, amount: -25.15 }] }), "-$25.15").results[0].amount, -25.15);
});

test("undated and missing amounts remain discoverable; a missing due date is not an undated invoice", () => {
  const input = data({ expenses: [{ ...expense, amount: null, invoice_date: null }], clientInvoices: [{ ...clientInvoice, due_date: null }] });
  const found = searchTransactions(input, "undated");
  assert.equal(found.total, 1);
  assert.equal(found.results[0].id, "expense:bill");
  assert.equal(found.results[0].amount, null);
  assert.equal(found.results[0].review, true);
});

test("client invoice body and individual line descriptions are searchable with malformed JSON handled safely", () => {
  const input = data();
  for (const query of ["Final completion", "Custom cabinet installation"]) {
    const found = searchTransactions(input, query);
    assert.equal(found.total, 1);
    assert.equal(found.results[0].id, "client_invoice:client");
    assert.match(found.results[0].description, /Final completion/);
    assert.match(found.results[0].description, /Custom cabinet installation/);
  }
  for (const line_items of [null, "invalid", {}, [null, 9, "invalid", { description: 42 }]]) {
    assert.equal(searchTransactions(data({ clientInvoices: [{ ...clientInvoice, line_items }] }), "Final completion").total, 1);
  }
  assert.equal(searchTransactions(input, "Final completion").results[0].source, "penney");
});

test("bank vendor, external reference and card details remain searchable and visible", () => {
  const input = data({ bank: [{ ...bank, vendor_name: "Hardware store", external_ref: "TRACE-482", card_last4: "5501", cardholder: "Sample cardholder", check_number: null }] });
  for (const query of ["Hardware store", "TRACE-482", "5501", "Sample cardholder", "Sample bank debit"]) {
    const found = searchTransactions(input, query);
    assert.equal(found.total, 1, query);
    assert.equal(found.results[0].name, "Hardware store");
    assert.equal(found.results[0].reference, "TRACE-482");
    assert.match(found.results[0].description, /Sample bank debit/);
    assert.match(found.results[0].description, /Sample cardholder/);
    assert.match(found.results[0].method, /5501/);
  }
});

test("result pagination is stable, reports complete totals and clamps a page after the result set shrinks", () => {
  const input = data({ expenses: Array.from({ length: 75 }, (_, i) => ({ ...expense, id: `bill-${String(i).padStart(3, "0")}`, invoice_number: `INV-${i}` })), income: [], bank: [], clientInvoices: [] });
  const first = searchTransactions(input, "Sample", 1);
  const second = searchTransactions(input, "Sample", 2);
  assert.equal(first.total, 75);
  assert.equal(first.pageSize, 30);
  assert.equal(first.results.length, 30);
  assert.equal(second.results.length, 30);
  assert.equal(new Set([...first.results, ...second.results].map(row => row.id)).size, 60);
  assert.equal(searchTransactions(input, "Sample", 3).results.length, 15);
  assert.deepEqual(searchTransactions(input, "Sample", 4), searchTransactions(input, "Sample", 3));
  assert.equal(searchTransactions(data(), "Sample", 2).page, 1);
  assert.deepEqual(searchTransactions(input, "no matching transaction", 4), { results: [], total: 0, page: 1, pageSize: 30 });
});

// Exercise the actual route and paging helper with a read-only in-memory Data API.
// Unknown imports/query methods throw, so these tests cannot access auth files,
// credentials, the network or any database mutation method.
const ledgerSource = fs.readFileSync(path.join(root, "src/lib/crew/load-labor-ledger.ts"), "utf8");
const pagingSource = ledgerSource.slice(ledgerSource.indexOf("export async function financialRows"), ledgerSource.indexOf("export async function loadLaborLedger"));
const pagingModule = { exports: {} };
new Function("module", "exports", compile(pagingSource))(pagingModule, pagingModule.exports);
const { financialRows } = pagingModule.exports;
const routeSource = compile(fs.readFileSync(path.join(root, "src/app/api/finances/search/route.ts"), "utf8"));

function routeFor({ user = { profile: { role: "owner" } }, tables = {}, failure } = {}) {
  const calls = [];
  let clients = 0;
  const db = {
    from(table) {
      const filters = [];
      const builder = {
        select(fields) { assert.notEqual(fields, "*"); return builder; },
        is(column, value) { filters.push(row => row[column] === value); return builder; },
        order(column) { assert.equal(column, "id"); return builder; },
        range(from, to) {
          calls.push({ table, from, to });
          if (failure?.(table, from)) return Promise.resolve({ data: null, error: { message: "Synthetic read failure" } });
          return Promise.resolve({ data: (tables[table] || []).filter(row => filters.every(filter => filter(row))).slice(from, to + 1), error: null });
        },
      };
      return builder;
    },
  };
  const dependencies = {
    "next/server": { NextResponse: { json: (body, init) => Response.json(body, init) } },
    "@/lib/auth/get-user": { getUser: async () => user },
    "@/lib/auth/role-access": { canSeeBoardMoney },
    "@/lib/supabase/server": { createClient: async () => { clients++; return db; } },
    "@/lib/crew/load-labor-ledger": { financialRows },
    "@/lib/finance/transaction-search": require("../src/lib/finance/transaction-search.ts"),
  };
  const routeModule = { exports: {} };
  new Function("require", "module", "exports", routeSource)((name) => {
    if (!(name in dependencies)) throw new Error(`Unexpected import: ${name}`);
    return dependencies[name];
  }, routeModule, routeModule.exports);
  return { get: (query) => routeModule.exports.GET({ nextUrl: new URL(`http://test.local/api/finances/search?${query}`) }), calls, clients: () => clients };
}

test("route rejects unauthenticated and non-financial callers before reading transactions", async () => {
  for (const [user, status] of [[null, 401], [{ profile: { role: "field" } }, 403], [{ profile: { role: "project_manager" } }, 403]]) {
    const route = routeFor({ user });
    const response = await route.get("q=Sample");
    assert.equal(response.status, status);
    assert.equal(route.clients(), 0);
    assert.match(response.headers.get("cache-control"), /no-store/);
  }
});

test("route validates query/page and skips reads for blank search", async () => {
  for (const query of ["page=0", "page=-1", "page=1.5", "page=Infinity", "page=9007199254740992", `q=${"a".repeat(201)}`]) {
    const route = routeFor();
    assert.equal((await route.get(query)).status, 400, query);
    assert.equal(route.clients(), 0);
  }
  const route = routeFor();
  const response = await route.get("q=%20%20");
  assert.deepEqual(await response.json(), { results: [], total: 0, page: 1, pageSize: 30 });
  assert.equal(route.clients(), 0);
});

test("route reads beyond 1000 records before searching and returns accurate paged totals", async () => {
  const rows = Array.from({ length: 1105 }, (_, i) => ({ ...expense, id: `bill-${String(i).padStart(4, "0")}`, invoice_number: `INV-${i}` }));
  const route = routeFor({ tables: { invoices: rows, payments_received: [income], client_invoices: [clientInvoice], bank_transactions: [bank], projects: [project] } });
  const response = await route.get("q=Sample&page=37");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control"), /private, no-store/);
  const result = await response.json();
  assert.equal(result.total, 1108);
  assert.equal(result.results.length, 28);
  assert.equal(result.results.at(-1).id, "expense:bill-1104");
  assert.ok(route.calls.some(call => call.table === "invoices" && call.from === 1000));
  assert.equal(new Set(route.calls.map(call => call.table)).size, 5);
});

test("a failed source or later page fails the whole search without misleading partial results", async () => {
  const rows = Array.from({ length: 1001 }, (_, i) => ({ ...expense, id: `bill-${i}`, invoice_number: `INV-${i}` }));
  for (const failure of [(table) => table === "bank_transactions", (table, from) => table === "invoices" && from === 1000]) {
    const route = routeFor({ tables: { invoices: rows }, failure });
    const response = await route.get("q=Sample");
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.match(body.error, /could not load all records/);
    assert.equal(body.results, undefined);
    assert.match(response.headers.get("cache-control"), /no-store/);
  }
});
