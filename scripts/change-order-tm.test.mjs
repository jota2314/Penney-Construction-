import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import ts from "typescript";
import { PDFParse } from "pdf-parse";

const require = createRequire(import.meta.url);
const compile = (path) => ts.transpileModule(readFileSync(path, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function load(path, mocks = {}, fetch = async () => { throw new Error("Unexpected network call"); }) {
  const module = { exports: {} };
  new Function("require", "module", "exports", "fetch", "process", compile(path))(
    (id) => id in mocks ? mocks[id] : require(id), module, module.exports, fetch,
    { env: {}, cwd: () => process.cwd() },
  );
  return module.exports;
}
const billing = load("src/lib/change-orders/billing.ts");
const money = load("src/lib/money.ts");
class MockResponse extends Response {
  static json(body, options = {}) { return new MockResponse(JSON.stringify(body), { status: options.status ?? 200 }); }
}
const base = {
  id: "00000000-0000-4000-8000-000000000001", project_id: "project", change_order_number: 1,
  title: "Slab replacement", description: "Remove the deteriorated slab and replace it.",
  status: "submitted", sent_to_client_at: "2026-10-23T12:00:00Z", updated_at: "2026-10-23T12:00:00Z",
  billing_type: "time_materials", tm_terms: "Labor: $80 per hour. Materials at actual cost. No markup.",
  price_impact: 0, cost_impact: 999, client_signature: null, client_view_count: 0,
  projects: { name: "Fixture project", contract_value: 10000, customers: { first_name: "Test", last_name: "Client", email: "test@example.invalid" } },
};
function database(co, { others = [], lines = [], conflict = false } = {}) {
  const calls = [];
  const db = {
    auth: { getUser: async () => ({ data: { user: { id: "user", email: "staff@example.invalid" } } }) },
    from(table) {
      const call = { table, filters: [], mutation: null };
      calls.push(call);
      const q = new Proxy({}, { get(_, prop) {
        if (prop === "then") return (resolve) => resolve({ data: table === "estimate_line_items" ? lines : others, error: null });
        return (...args) => {
          if (prop === "select") call.columns = args[0];
          if (prop === "update" || prop === "insert") call.mutation = args[0];
          if (["eq", "neq", "is"].includes(prop)) call.filters.push([prop, ...args]);
          if (prop === "single" || prop === "maybeSingle") return Promise.resolve({ data: call.mutation ? conflict ? null : { id: co.id } : co, error: null });
          return q;
        };
      } });
      return q;
    },
  };
  return { db, calls };
}
function mocks(db) {
  return {
    "next/server": { NextResponse: MockResponse },
    "@supabase/supabase-js": { createClient: () => db },
    "@/lib/supabase/server": { createClient: async () => db },
    "@/lib/supabase/admin": { createAdminClient: () => db },
    "@/lib/change-orders/billing": billing,
    "@/lib/money": money,
  };
}
const request = (body) => ({ url: "https://app.invalid/api?token=abcdefghijklmnopqrstuv", headers: new Headers(), nextUrl: { origin: "https://app.invalid" }, json: async () => body });
const version = (co) => createHash("sha256").update(JSON.stringify([
  co.id, co.title, co.description, co.billing_type, co.tm_terms,
  co.price_impact, co.status, co.sent_to_client_at, co.updated_at,
])).digest("hex");
const approvalBody = { token: "abcdefghijklmnopqrstuv", signature: "Test Client", version: version(base) };

for (const patch of [{ status: "draft" }, { status: "rejected" }, { status: "void" }, { sent_to_client_at: null }, { tm_terms: " " }]) {
  test(`public approval refuses ${JSON.stringify(patch)} without mutation`, async () => {
    const { db, calls } = database({ ...base, ...patch });
    const route = load("src/app/api/approve-change-order/route.ts", mocks(db));
    const response = await route.POST(request(approvalBody));
    assert.equal(response.status, 409);
    assert.equal(calls.filter(c => c.mutation).length, 0);
    const get = await route.GET(request());
    assert.equal(get.status, 409);
  });
}

test("T&M signature authorizes terms with concurrency protection and no invoice writes", async () => {
  const { db, calls } = database(base);
  const route = load("src/app/api/approve-change-order/route.ts", mocks(db));
  const response = await route.POST(request(approvalBody));
  assert.equal(response.status, 200);
  const writes = calls.filter(c => c.mutation);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].table, "change_orders");
  assert.equal(writes[0].mutation.status, "approved");
  assert.ok(writes[0].filters.some(f => f[1] === "status" && f[2] === "submitted"));
  assert.ok(writes[0].filters.some(f => f[1] === "updated_at" && f[2] === base.updated_at));
  assert.equal(writes[0].mutation.price_impact, undefined);
});

test("approval refuses a change order edited during signing", async () => {
  const { db } = database(base, { conflict: true });
  const route = load("src/app/api/approve-change-order/route.ts", mocks(db));
  const response = await route.POST(request(approvalBody));
  assert.equal(response.status, 409);
});

test("approval refuses terms changed since the client reviewed them", async () => {
  const { db, calls } = database({ ...base, tm_terms: "A different labor rate" });
  const route = load("src/app/api/approve-change-order/route.ts", mocks(db));
  const response = await route.POST(request(approvalBody));
  assert.equal(response.status, 409);
  assert.equal(calls.filter(c => c.mutation).length, 0);
});

test("public approval data excludes internal costs and T&M from fixed contract totals", async () => {
  const { db } = database(base, { others: [
    { billing_type: "fixed_price", price_impact: 500 },
    { billing_type: "fixed_price", price_impact: -100 },
    { billing_type: "time_materials", price_impact: 9000 },
  ] });
  const route = load("src/app/api/approve-change-order/route.ts", mocks(db));
  const response = await route.GET(request());
  const body = await response.json();
  assert.equal(body.approved_cos_total, 400);
  assert.equal(body.cost_impact, undefined);
  assert.equal(body.tm_terms, base.tm_terms);
  assert.equal(body.has_time_materials, true);
});

async function pdfText(co, others = []) {
  const { db } = database(co, { others });
  const route = load("src/app/api/generate-change-order/route.ts", mocks(db));
  const response = await route.GET({ url: `https://app.invalid/api?changeOrderId=${co.id}`, headers: new Headers() });
  assert.equal(response.status, 200);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const parser = new PDFParse({ data: bytes });
  try {
    if (process.env.TM_PDF_QA_DIR) {
      mkdirSync(process.env.TM_PDF_QA_DIR, { recursive: true });
      writeFileSync(join(process.env.TM_PDF_QA_DIR, `${co.billing_type}.pdf`), bytes);
      const screenshots = await parser.getScreenshot({ scale: 1.5 });
      screenshots.pages.forEach((page, index) => writeFileSync(join(process.env.TM_PDF_QA_DIR, `${co.billing_type}-${index + 1}.png`), page.data));
    }
    return (await parser.getText()).text;
  } finally { await parser.destroy(); }
}

test("native T&M PDF has terms, TBD final, and separate fixed contract amount", async () => {
  const text = await pdfText(base, [
    { ...base, id: "other-tm", status: "approved", price_impact: 9999 },
    { id: "fixed", billing_type: "fixed_price", status: "approved", price_impact: 500 },
  ]);
  assert.match(text, /TIME & MATERIALS BILLING TERMS/);
  assert.match(text, /Labor: \$80 per hour/);
  assert.match(text, /To be determined/);
  assert.match(text, /FIXED-PRICE CONTRACT TOTAL\s+\$10,500(?:\.00)?/);
  assert.doesNotMatch(text, /\$9,999|CHANGE ORDER TOTAL\s+\$0|NEW CONTRACT TOTAL|adjusted contract amount/);
  assert.match(text, /does not establish a fixed total/);
});

test("fixed-price PDF retains exact amount, adjusted total and fixed authorization", async () => {
  const text = await pdfText({ ...base, billing_type: "fixed_price", tm_terms: null, price_impact: 1234.56 });
  assert.match(text, /CHANGE ORDER\s+TOTAL\s+\$1,234\.56/);
  assert.match(text, /NEW CONTRACT TOTAL\s+\$11,234\.56/);
  assert.match(text, /adjusted contract amount/);
  assert.doesNotMatch(text, /TIME & MATERIALS BILLING TERMS/);
});

test("send validation refuses T&M without terms before email or PDF calls", async () => {
  const { db } = database({ ...base, tm_terms: null });
  const route = load("src/app/api/send-change-order/route.ts", { ...mocks(db), "@/lib/google/gmail": { sendEmail: () => { throw new Error("Email should not be sent"); } } });
  const response = await route.POST(request({ changeOrderId: base.id }));
  assert.equal(response.status, 400);
});

test("send template describes T&M without a fixed $0 charge", async () => {
  const { db } = database(base);
  let sent;
  const route = load("src/app/api/send-change-order/route.ts", { ...mocks(db), "@/lib/google/gmail": { sendEmail: async (email) => { sent = email; return { id: "test" }; } } }, async () => new Response("PDF bytes"));
  const response = await route.POST(request({ changeOrderId: base.id }));
  assert.equal(response.status, 200);
  assert.match(sent.body, /Billing basis: Time & Materials/);
  assert.match(sent.body, /does not establish a fixed total/);
  assert.ok(sent.body.includes(base.tm_terms));
  assert.doesNotMatch(sent.body, /Amount: \$0/);
});

test("PDF failure stops the send before contacting the client", async () => {
  const { db } = database(base);
  let sends = 0;
  const route = load("src/app/api/send-change-order/route.ts", { ...mocks(db), "@/lib/google/gmail": { sendEmail: async () => { sends++; } } }, async () => new Response("Failure", { status: 500 }));
  const response = await route.POST(request({ changeOrderId: base.id }));
  assert.equal(response.status, 502);
  assert.equal(sends, 0);
});

test("T&M authorization cannot push a fixed estimate to QuickBooks, even with stale nonzero price", async () => {
  const { db, calls } = database({ ...base, status: "approved", price_impact: 1234.56 });
  const unexpected = () => { throw new Error("QuickBooks side effect should not run"); };
  const module = load("src/lib/quickbooks/change-orders.ts", {
    ...mocks(db),
    "./auth": { isQuickBooksConnected: async () => true, getValidAccessToken: unexpected },
    "./client": { qbQuery: unexpected, qbPost: unexpected },
    "./customers": { pushProjectToQuickBooks: unexpected },
    "./invoices": { ensureServiceItem: unexpected },
  });
  const result = await module.pushChangeOrderToQuickBooks(base.id);
  assert.match(result.error, /no fixed amount to push/);
  assert.equal(calls.filter(c => c.mutation).length, 0);
});

for (const blocked of [true, false]) test(`CO deletion ${blocked ? "preserves source lines when ledger history blocks it" : "cleans up lines only after scoped parent deletion"}`, async () => {
  const calls = [];
  const db = {
    auth: { getUser: async () => ({ data: { user: { id: "user" } } }) },
    from(table) {
      const call = { table, deleted: false, filters: [] }; calls.push(call);
      const q = new Proxy({}, { get(_, prop) {
        if (prop === "then") return resolve => resolve(table === "change_orders"
          ? blocked ? { data: null, error: { code: "23503", message: "linked history" } } : { data: [{ id: base.id }], error: null }
          : { data: [{ id: "budget-line" }], error: null });
        return (...args) => {
          if (prop === "delete") call.deleted = true;
          if (["eq", "in", "is"].includes(prop)) call.filters.push([prop, ...args]);
          return q;
        };
      } });
      return q;
    },
  };
  const actions = load("src/lib/actions/change-orders.ts", {
    ...mocks(db), "next/cache": { revalidatePath() {} },
    "@/lib/estimates/line-item-financials": {}, "@/lib/quickbooks/change-orders": {},
  });
  const result = await actions.deleteChangeOrder(base.id, "project");
  const deletions = calls.filter(c => c.deleted);
  assert.equal(deletions[0].table, "change_orders");
  assert.ok(deletions[0].filters.some(f => f[1] === "project_id" && f[2] === "project"));
  if (blocked) {
    assert.match(result.error, /linked history/);
    assert.equal(deletions.length, 1);
  } else {
    assert.equal(result.success, true);
    assert.equal(deletions[1].table, "estimate_line_items");
    assert.ok(deletions[1].filters.some(f => f[0] === "is" && f[1] === "change_order_id" && f[2] === null));
  }
});
