import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
const cache = new Map();
function moduleURL(path) {
  if (cache.has(path)) return cache.get(path);
  let source = fs.readFileSync(new URL(path, import.meta.url), "utf8");
  for (const [from, to] of [
    ["@/lib/job-review/engine", "../src/lib/job-review/engine.ts"],
    ["../crew/labor-ledger", "../src/lib/crew/labor-ledger.ts"],
    ["../estimates/current", "../src/lib/estimates/current.ts"],
    [
      "../estimates/line-item-financials",
      "../src/lib/estimates/line-item-financials.ts",
    ],
  ])
    if (source.includes(`"${from}"`))
      source = source.replaceAll(`"${from}"`, JSON.stringify(moduleURL(to)));
  const url = `data:text/javascript;base64,${Buffer.from(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText).toString("base64")}`;
  cache.set(path, url);
  return url;
}
const {
  collectionBalance,
  closedPeriod,
  latestRecords,
  forecastFor,
  healthFor,
} = await import(moduleURL("../src/lib/finance/workspace-model.ts"));
const { finalAuditReadiness } = await import(
  moduleURL("../src/lib/finance/final-audit.ts")
);
const { sourceRegister } = await import(
  moduleURL("../src/lib/job-review/engine.ts")
);
const invoice = {
  amount: 1000,
  paid_amount: 200,
  status: "sent",
  sent_to_client_at: "2026-10-01",
};
test("partial receipts reduce AR once; discrepant amounts remain in review", () => {
  assert.deepEqual(collectionBalance(invoice, [{ amount: 200 }]), {
    balance: 80000,
    issue: null,
  });
  assert.equal(collectionBalance(invoice, [{ amount: 250 }]).balance, 75000);
  assert.match(collectionBalance(invoice, [{ amount: 250 }]).issue, /differ/);
  assert.match(
    collectionBalance({ ...invoice, status: "paid" }, [{ amount: 200 }]).issue,
    /Paid status/,
  );
  assert.match(
    collectionBalance({ ...invoice, amount: null }, []).issue,
    /Amount/,
  );
});
test("unsent drafts, cancelled and voided invoices never become receivables", () => {
  for (const status of ["draft", "void", "voided", "cancelled"])
    assert.equal(collectionBalance({ ...invoice, status }, []), null);
  assert.equal(
    collectionBalance({ ...invoice, sent_to_client_at: null }, []),
    null,
  );
});
const record = (id, kind, created, closed) => ({
  id,
  kind,
  created_at: created,
  closed_on: closed,
  payload: {
    cost: 60000,
    contract: 100000,
    remaining: 20000,
    budget: 75000,
    profit: 40000,
    note: "Reviewed",
    financial_basis: "a",
  },
});
test("closing period uses project date, not approval date; month and year both constrain", () => {
  const rows = [
    record("1", "final", "2027-01-05", "2026-12-31"),
    record("2", "final", "2026-02-02", "2026-01-31"),
    record("3", "reopen", "2027-01-10", null),
  ];
  assert.deepEqual(
    closedPeriod(rows, "2026", "12").map((r) => r.id),
    ["1"],
  );
  assert.equal(closedPeriod(rows, "2027", "all").length, 0);
  assert.equal(closedPeriod(rows, "all", "all").length, 2);
});
test("reopening supersedes final state without deleting prior final or forecasts", () => {
  const rows = [
    record("1", "final", "2026-10-01", "2026-09-30"),
    record("2", "forecast", "2026-10-03", null),
    record("3", "reopen", "2026-10-02", null),
  ];
  assert.equal(latestRecords(rows).audit.kind, "reopen");
  assert.equal(latestRecords(rows).forecast.id, "2");
  assert.equal(rows.length, 3);
});
const job = {
  cost: 60000,
  contract: 100000,
  budget: 75000,
  overdue: 0,
  warnings: [],
  audit: null,
  forecast: null,
  financialBasis: "a",
  finalNeedsReview: false,
};
test("missing and stale forecasts never imply a final or expected profit", () => {
  assert.equal(forecastFor(job), null);
  assert.equal(healthFor(job).label, "Forecast needed");
  const current = {
    ...job,
    forecast: record("f", "forecast", "2026-10-09", null),
  };
  assert.equal(forecastFor(current).profit, 20000);
  assert.equal(forecastFor(current).stale, false);
  assert.equal(forecastFor({ ...current, cost: 61000 }).stale, true);
  assert.equal(forecastFor({ ...current, financialBasis: "b" }).stale, true);
});
test("health differentiates unverified evidence, overrun, overdue and changed final", () => {
  assert.equal(
    healthFor({ ...job, warnings: ["Missing rates"] }).label,
    "Needs verification",
  );
  assert.equal(healthFor({ ...job, cost: 80000 }).label, "Over budget");
  assert.equal(healthFor({ ...job, overdue: 100 }).label, "Collection overdue");
  assert.equal(
    healthFor({
      ...job,
      audit: record("f", "final", "2026-10-09", "2026-10-09"),
      finalNeedsReview: true,
    }).label,
    "Final · new activity",
  );
});
const sources = [
  "projects",
  "estimates",
  "lines",
  "invoices",
  "daily_logs",
  "schedule_phases",
  "all_day_shifts",
  "employees",
  "rates",
  "breaks",
  "quotes",
  "material_orders",
  "material_returns",
  "time_entries",
  "job_ledger_entries",
  "change_orders",
  "payments_received",
  "client_invoices",
  "field_report_notes",
  "field_report_photos",
  "storage_objects",
];
function fixture() {
  return {
    as_of: "2026-10-09T12:00:00Z",
    records: {
      ...Object.fromEntries(sources.map((s) => [s, []])),
      projects: [
        {
          id: "p",
          name: "Test",
          status: "audit",
          contract_locked_amount: 1000,
          contract_estimate_id: "e",
        },
      ],
      estimates: [{ id: "e", version: 1 }],
      lines: [{ id: "l", estimate_id: "e", description: "Scope", cost: 500 }],
      invoices: [
        {
          id: "b",
          amount: 200,
          review_status: "ok",
          estimate_line_item_id: "l",
          attachment_storage_path: "bill.pdf",
        },
      ],
      storage_objects: [
        { id: "doc", path: "bill.pdf", available: true, etag: "v1" },
      ],
    },
  };
}
function verified(s) {
  const register = sourceRegister(s);
  return {
    id: "note",
    title: "Checked originals",
    action: "Retain verified source",
    classification: "verified_cost",
    line_id: "l",
    refs: Object.fromEntries(
      ["projects:p", "lines:l", "invoices:b", "storage_objects:doc"].map(
        (k) => [k, register[k]],
      ),
    ),
    reviewed_at: s.as_of,
    resolved: false,
  };
}
test("an automatic saved review does not satisfy final source verification", () => {
  const s = fixture();
  assert.ok(
    finalAuditReadiness(s, []).blockers.some((b) =>
      b.includes("Verify source costs"),
    ),
  );
  assert.deepEqual(finalAuditReadiness(s, [verified(s)]).blockers, []);
});
test("changed original, unresolved finding, pending CO and unbilled commitment block final audit", () => {
  const s = fixture(),
    e = verified(s);
  s.records.storage_objects[0].etag = "v2";
  assert.ok(
    finalAuditReadiness(s, [e]).blockers.some((b) =>
      b.includes("changed evidence"),
    ),
  );
  const f = fixture();
  f.records.change_orders = [{ id: "co", status: "draft" }];
  assert.ok(
    finalAuditReadiness(f, [verified(f)]).blockers.some((b) =>
      b.includes("change orders"),
    ),
  );
  const q = fixture();
  q.records.quotes = [
    {
      id: "q",
      status: "accepted",
      amount: 100,
      estimate_line_item_id: "other",
    },
  ];
  assert.ok(
    finalAuditReadiness(q, [verified(q)]).blockers.some((b) =>
      b.includes("commitments"),
    ),
  );
});

const ledgerSource = fs.readFileSync(
  new URL("../src/lib/crew/load-labor-ledger.ts", import.meta.url),
  "utf8",
);
const pagingSource = ledgerSource.slice(
  ledgerSource.indexOf("export async function financialRows"),
  ledgerSource.indexOf("export async function loadLaborLedger"),
);
const pagingModule =
  "data:text/javascript;base64," +
  Buffer.from(
    ts.transpileModule(pagingSource, {
      compilerOptions: { module: ts.ModuleKind.ESNext },
    }).outputText,
  ).toString("base64");
const { financialRows } = await import(pagingModule);
test("complete inventories paginate beyond former 200/500/1000 limits", async () => {
  const all = Array.from({ length: 2405 }, (_, id) => ({ id }));
  const result = await financialRows((f, t) =>
    Promise.resolve({ data: all.slice(f, t + 1), error: null }),
  );
  assert.deepEqual(result, all);
});
test("a failed later page never returns a partial financial total", async () => {
  await assert.rejects(
    () =>
      financialRows((f) =>
        Promise.resolve(
          f === 0
            ? { data: Array(1000).fill({ id: "row" }), error: null }
            : { data: null, error: { message: "Page failed" } },
        ),
      ),
    /Page failed/,
  );
  await assert.rejects(
    () => financialRows(() => Promise.resolve({ data: null, error: null })),
    /could not load/,
  );
});
