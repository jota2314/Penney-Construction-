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
  isActionableCollection,
  closedPeriod,
  latestRecords,
  forecastFor,
  healthFor,
  wipFor,
  isOpenJob,
  underbilledBy,
} = await import(moduleURL("../src/lib/finance/workspace-model.ts"));
const { findAttention } = await import(moduleURL("../src/lib/finance/attention.ts"));
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
test("partial receipts reduce AR once; only unbacked payments are flagged", () => {
  assert.deepEqual(collectionBalance(invoice, [{ amount: 200 }]), {
    balance: 80000,
    issue: null,
  });
  // More checks linked than the paid field says: the balance uses the checks.
  assert.deepEqual(collectionBalance(invoice, [{ amount: 250 }]), { balance: 75000, issue: null });
  // Overpaid by cents is paid (O'Mealia #7, $4,410.35 against $4,410.00).
  assert.deepEqual(
    collectionBalance({ ...invoice, amount: 4410, paid_amount: 4410, status: "paid" }, [{ amount: 4410.35 }]),
    { balance: 0, issue: null },
  );
  assert.match(collectionBalance(invoice, []).issue, /no check linked/);
  assert.match(
    collectionBalance({ ...invoice, status: "paid" }, [{ amount: 200 }]).issue,
    /Marked paid/,
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
test("collection totals consistently exclude unapplied matching receipts and reconciliation issues", () => {
  const rows = [
    { id: "open", projectId: "p", balance: 80000, daysLate: 10, issue: null, loggedPayment: null },
    { id: "not-due", projectId: "p", balance: 20000, daysLate: 0, issue: null, loggedPayment: null },
    { id: "receipt", projectId: "p", balance: 60000, daysLate: 15, issue: null, loggedPayment: { amount: 60000, date: "2026-11-01", reference: "Check 42" } },
    { id: "disputed", projectId: "p", balance: 30000, daysLate: 20, issue: "Linked receipts and invoice paid amount differ", loggedPayment: null },
    { id: "other-job", projectId: "q", balance: 10000, daysLate: 0, issue: null, loggedPayment: null },
  ];
  const original = structuredClone(rows);
  const actionable = rows.filter(isActionableCollection);
  assert.deepEqual(actionable.map(row => row.id), ["open", "not-due", "other-job"]);
  assert.equal(actionable.reduce((sum, row) => sum + row.balance, 0), 110000);
  const jobRows = rows.filter(row => row.projectId === "p" && isActionableCollection(row));
  assert.equal(jobRows.reduce((sum, row) => sum + row.balance, 0), 100000);
  assert.equal(jobRows.filter(row => row.daysLate > 0).reduce((sum, row) => sum + row.balance, 0), 80000);
  assert.deepEqual(rows, original, "Display eligibility must not apply receipts or alter invoices");
});
test("needs attention lists only duplicates and wrong-job records", () => {
  const bill = (id, o = {}) => ({
    id, project_id: "pelkey", vendor_name: "Building Center of Essex", invoice_number: null,
    invoice_date: "2026-11-05", amount: 100, split_group_id: null, estimate_line_item_id: null, ...o,
  });
  const bills = [
    // Same split bill entered twice on one job.
    bill("a1", { invoice_number: "373837", amount: 126.3, split_group_id: "s1" }),
    bill("a2", { invoice_number: "373837", amount: 1129.66, split_group_id: "s1" }),
    bill("b1", { invoice_number: "373837", amount: 126.3, split_group_id: "s2" }),
    bill("b2", { invoice_number: "373837", amount: 1129.66, split_group_id: "s2" }),
    // Same bill on two jobs.
    bill("ez1", { vendor_name: "EZ Disposal Service Inc", invoice_number: "152528", invoice_date: "2026-09-04", amount: 425, project_id: "parziale" }),
    bill("ez2", { vendor_name: "EZ Disposal Service Inc", invoice_number: "152528", invoice_date: "2026-09-04", amount: 425, project_id: "buckley" }),
    // One credit legitimately spread across jobs: different amounts, not a copy.
    bill("cr1", { invoice_number: "17126", amount: -118.18, project_id: "grelle" }),
    bill("cr2", { invoice_number: "17126", amount: -105.97, project_id: "omealia" }),
    // Porta-potty rentals: same vendor, day and price, no bill number. Normal.
    bill("p1", { vendor_name: "The Rest Stop", amount: 192.4, project_id: "gouthro" }),
    bill("p2", { vendor_name: "The Rest Stop", amount: 192.4, project_id: "disalvo" }),
    // Coded to another job's budget line; and on no job at all.
    bill("line", { invoice_number: "9", project_id: "pelkey", estimate_line_item_id: "haight-line" }),
    bill("ok-line", { invoice_number: "10", project_id: "pelkey", estimate_line_item_id: "pelkey-line" }),
    bill("nojob", { vendor_name: "Capital One Crd Cd", project_id: null, amount: 1500 }),
  ];
  const invoices = [
    { id: "i1", project_id: "ouellette", invoice_number: 2, title: "Foundation and framing", amount: 75000, status: "paid", sent_to_client_at: "2026-07-30T12:00:00Z" },
    { id: "i2", project_id: "ouellette", invoice_number: 5, title: "Drywall complete", amount: 75000, status: "sent", sent_to_client_at: "2026-10-27T12:00:00Z" },
    { id: "i3", project_id: "white", invoice_number: 3, title: "Final invoice", amount: 1000, status: "sent", sent_to_client_at: "2026-10-01T12:00:00Z" },
    { id: "i4", project_id: "white", invoice_number: 4, title: "Final  Invoice", amount: 1000, status: "sent", sent_to_client_at: "2026-10-02T12:00:00Z" },
    { id: "i5", project_id: "white", invoice_number: 5, title: "Final invoice", amount: 1000, status: "void", sent_to_client_at: "2026-10-03T12:00:00Z" },
  ];
  const receipts = [
    { id: "r1", project_id: "cleary", client_invoice_id: null, amount: 8623, received_date: "2026-06-29", reference_number: "CK-6280" },
    { id: "r2", project_id: "cleary", client_invoice_id: null, amount: 8623, received_date: "2026-06-29", reference_number: "CK-6286" },
    { id: "r3", project_id: "danti", client_invoice_id: null, amount: 500, received_date: "2026-10-25", reference_number: "374" },
    { id: "r4", project_id: "danti", client_invoice_id: null, amount: 500, received_date: "2026-10-26", reference_number: "Check 374" },
    { id: "r5", project_id: "harmon", client_invoice_id: "i2", amount: 75000, received_date: "2026-11-03", reference_number: "869" },
  ];
  const names = new Map(["pelkey", "parziale", "buckley", "haight", "danti", "harmon", "ouellette", "white"].map(id => [id, id[0].toUpperCase() + id.slice(1)]));
  const input = { bills, receipts, invoices, names, lineJob: new Map([["haight-line", "haight"], ["pelkey-line", "pelkey"]]) };
  const before = structuredClone({ bills, receipts, invoices });
  const items = findAttention(input);
  assert.deepEqual(structuredClone({ bills, receipts, invoices }), before, "Finding problems must not change records");
  const view = items.map(i => [i.kind, i.title, i.detail, i.amount]);
  assert.deepEqual(view, [
    ["duplicate", "Building Center of Essex #373837", "Entered twice on Pelkey", 125596],
    ["duplicate", "Check 374", "Logged twice on Danti", 50000],
    ["duplicate", "White", "Client invoices #3 and #4 are the same invoice", 100000],
    ["wrong_job", "Building Center of Essex #9", "On Pelkey, coded to a Haight budget line", 10000],
    ["wrong_job", "Capital One Crd Cd", "Not on any job", 150000],
    ["wrong_job", "Check 869", "Logged on Harmon, applied to Ouellette invoice #5", 7500000],
    ["wrong_job", "EZ Disposal Service Inc #152528", "Same bill on Parziale and Buckley", 42500],
  ]);
  assert.ok(items.every(i => i.href.startsWith("/")));
  assert.equal(items.find(i => i.title.includes("373837")).href, "/spent/b1");
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
  status: "in_progress",
  cost: 60000,
  contract: 100000,
  budget: 75000,
  received: 0,
  invoiced: 0,
  overdue: 0,
  warnings: [],
  audit: null,
  forecast: null,
  financialBasis: "a",
  finalNeedsReview: false,
};
test("missing and stale forecasts never imply a final or expected profit", () => {
  assert.equal(forecastFor(job), null);
  assert.equal(healthFor(job).label, "On track");
  const current = {
    ...job,
    forecast: record("f", "forecast", "2026-10-09", null),
  };
  assert.equal(forecastFor(current).profit, 20000);
  assert.equal(forecastFor(current).stale, false);
  assert.equal(forecastFor({ ...current, cost: 61000 }).stale, true);
  assert.equal(forecastFor({ ...current, financialBasis: "b" }).stale, true);
});
test("health differentiates loss, overrun, overdue, unbilled work and changed final", () => {
  // Bookkeeping gaps are data checks, not the headline.
  assert.equal(healthFor({ ...job, warnings: ["Missing rates"] }).label, "On track");
  assert.equal(healthFor({ ...job, cost: 80000 }).label, "Over budget");
  assert.equal(healthFor({ ...job, cost: 101000 }).label, "Loss risk");
  assert.equal(healthFor({ ...job, budget: 110000 }).label, "Loss risk");
  assert.equal(healthFor({ ...job, overdue: 100 }).label, "Collection overdue");
  assert.equal(healthFor({ ...job, contract: 10000000, budget: 7500000, cost: 6000000, received: 0 }).label, "Underbilled");
  assert.equal(healthFor({ ...job, contract: null }).label, "No contract price");
  assert.equal(healthFor({ ...job, budget: null }).label, "No cost budget");
  assert.equal(
    healthFor({
      ...job,
      audit: record("f", "final", "2026-10-09", "2026-10-09"),
      finalNeedsReview: true,
    }).label,
    "Final · new activity",
  );
});
test("recorded loss and budget overruns remain prominent when source review is also needed", () => {
  assert.deepEqual(healthFor({ ...job, cost: 110000, warnings: ["Missing rates"] }), { label: "Loss risk", tone: "bad" });
  assert.deepEqual(healthFor({ ...job, cost: 80000, warnings: ["Bills need review"] }), { label: "Over budget", tone: "bad" });
  // Bookkeeping warnings are per-job data checks, not the headline.
  assert.deepEqual(healthFor({ ...job, contract: null, budget: null, warnings: ["Contract amount needs verification"] }), { label: "No contract price", tone: "neutral" });
  assert.deepEqual(healthFor({ ...job, cost: 110000, warnings: ["Changed source"], audit: record("f", "final", "2026-10-09", "2026-10-09"), finalNeedsReview: true }), { label: "Final · new activity", tone: "warn" });
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

test("WIP: cost-to-cost percent complete, earned revenue, over/under billing and projected profit", () => {
  // $100k contract, $75k estimated cost, $60k spent → 80% complete, $80k earned.
  const w = wipFor({ ...job, received: 50000, invoiced: 90000 });
  assert.equal(w.basis, "budget");
  assert.equal(w.pct, 0.8);
  assert.equal(w.earned, 80000);
  assert.equal(w.billed, 90000, "billed is invoices sent, or payments received when higher");
  assert.equal(w.overUnder, 10000);
  assert.equal(w.estimatedCost, 75000);
  assert.equal(w.toFinish, 15000);
  assert.equal(w.profit, 25000);
  assert.equal(w.margin, 0.25);
  assert.equal(wipFor({ ...job, received: 95000, invoiced: 20000 }).billed, 95000);
});
test("WIP: past the budget the job is held at cost (100%) until a forecast says otherwise", () => {
  const w = wipFor({ ...job, cost: 90000 });
  assert.equal(w.estimatedCost, 90000);
  assert.equal(w.pct, 1);
  assert.equal(w.toFinish, 0);
  assert.equal(w.profit, 10000);
  const withForecast = { ...job, cost: 90000, forecast: { ...record("f", "forecast", "2026-10-09", null), payload: { ...record("f", "forecast", "2026-10-09", null).payload, cost: 90000, remaining: 20000 } } };
  const f = wipFor(withForecast);
  assert.equal(f.basis, "forecast");
  assert.equal(f.estimatedCost, 110000);
  assert.equal(f.profit, -10000);
  assert.equal(healthFor(withForecast).label, "Loss risk");
});
test("WIP: no price or no budget means no percent, earned or profit — never a made-up number", () => {
  const tm = wipFor({ ...job, contract: null, received: 4000 });
  assert.equal(tm.earned, null);
  assert.equal(tm.profit, null);
  assert.equal(tm.overUnder, null);
  assert.equal(tm.billed, 4000);
  const nb = wipFor({ ...job, budget: null });
  assert.equal(nb.pct, null);
  assert.equal(nb.profit, null);
  assert.equal(wipFor({ ...job, budget: 0 }).pct, null);
});
test("underbilling must be material: 5% of the contract and at least $2,500", () => {
  assert.equal(underbilledBy({ ...job, contract: 10000000, budget: 7500000, cost: 6000000 }), 8000000);
  assert.equal(underbilledBy({ ...job, contract: 10000000, budget: 7500000, cost: 6000000, received: 7600000 }), 0);
  assert.equal(underbilledBy(job), 0, "$800 unbilled on a $1,000 job is under the $2,500 floor");
});
test("open jobs exclude leads, cancelled work and financially closed jobs", () => {
  assert.equal(isOpenJob(job), true);
  assert.equal(isOpenJob({ ...job, status: "audit" }), true);
  assert.equal(isOpenJob({ ...job, status: "proposal_sent" }), false);
  assert.equal(isOpenJob({ ...job, status: "cancelled" }), false);
  const final = record("f", "final", "2026-10-09", "2026-10-09");
  assert.equal(isOpenJob({ ...job, audit: final }), false);
  assert.equal(isOpenJob({ ...job, audit: final, finalNeedsReview: true }), true);
});
