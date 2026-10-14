import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";

const modules = new Map();
function moduleURL(path) {
  if (modules.has(path)) return modules.get(path);
  let source = fs.readFileSync(new URL(path, import.meta.url), "utf8");
  for (const [from, to] of [
    ["@/lib/job-review/engine", "../src/lib/job-review/engine.ts"],
    ["../crew/labor-ledger", "../src/lib/crew/labor-ledger.ts"],
    ["../estimates/current", "../src/lib/estimates/current.ts"],
    ["../estimates/line-item-financials", "../src/lib/estimates/line-item-financials.ts"],
  ]) {
    if (source.includes(`"${from}"`))
      source = source.replaceAll(`"${from}"`, JSON.stringify(moduleURL(to)));
  }
  const url = `data:text/javascript;base64,${Buffer.from(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText).toString("base64")}`;
  modules.set(path, url);
  return url;
}
const { finalAuditReadiness, finalAuditCoverageRequirements } = await import(
  moduleURL("../src/lib/finance/final-audit.ts"),
);
const { calculateReview, costEvidenceDependencies, sourceRegister } = await import(
  moduleURL("../src/lib/job-review/engine.ts"),
);
const sources = [
  "projects", "estimates", "lines", "invoices", "daily_logs", "schedule_phases",
  "all_day_shifts", "employees", "rates", "breaks", "quotes", "material_orders",
  "material_returns", "time_entries", "job_ledger_entries", "change_orders",
  "payments_received", "client_invoices", "field_report_notes", "field_report_photos",
  "storage_objects", "project_files",
];
function fixture(source = "time_entries") {
  return {
    as_of: "2026-10-14T16:00:00Z",
    records: {
      ...Object.fromEntries(sources.map((key) => [key, []])),
      projects: [{ id: "p", status: "audit", contract_locked_amount: 1000, contract_estimate_id: "e" }],
      estimates: [{ id: "e", version: 1 }],
      lines: [{ id: "l", estimate_id: "e", description: "Carpentry", cost: 500 }],
      invoices: [{ id: "b", amount: 200, review_status: "ok", estimate_line_item_id: "l", attachment_storage_path: "bill.pdf" }],
      project_files: [{ id: "report", project_id: "p", storage_path: "audit.pdf", storage_bucket: "project-files" }],
      storage_objects: [
        { id: "bill", path: "bill.pdf", bucket: "email-attachments", available: true, etag: "v1" },
        { id: "report", path: "audit.pdf", bucket: "project-files", available: true, etag: "v1" },
      ],
      [source]: [{ id: "separate", status: "delivered", amount: 200 }],
    },
  };
}
function verified(snapshot) {
  const register = sourceRegister(snapshot);
  const scope = calculateReview(snapshot).scopes.find((s) => s.id === "l");
  return {
    id: "verified", classification: "verified_cost", title: "Original bill checked",
    action: "Verified original and correct job scope.", line_id: "l", resolved: false,
    reviewed_at: snapshot.as_of,
    refs: Object.fromEntries(costEvidenceDependencies(snapshot, scope).map((key) => [key, register[key]])),
  };
}
function resolution(snapshot) {
  const requirement = finalAuditCoverageRequirements(snapshot)[0];
  assert.ok(requirement, "fixture should have a resolvable coverage warning");
  const register = sourceRegister(snapshot);
  return {
    id: "resolution", title: requirement.title, classification: "question", line_id: null,
    action: "Source report reconciles these records to booked costs; no remaining amount.",
    resolved: true, reviewed_at: snapshot.as_of,
    refs: { ...requirement.refs, "project_files:report": register["project_files:report"] },
  };
}
const readiness = (snapshot, notes) => finalAuditReadiness(snapshot, notes).blockers;

for (const source of ["material_returns", "time_entries", "job_ledger_entries"]) {
  test(`${source}: explicit complete evidence resolves the presence warning, retaining the review caveat`, () => {
    const snapshot = fixture(source);
    const note = resolution(snapshot);
    assert.ok(readiness(snapshot, [verified(snapshot)]).includes(note.title));
    const result = finalAuditReadiness(snapshot, [verified(snapshot), note]);
    assert.deepEqual(result.blockers, []);
    assert.ok(result.review.coverage.gaps.includes(note.title));
    assert.equal(result.review.money.final_profit, null);
  });
}

test("generic, unresolved, wrong-classification and incomplete notes cannot clear coverage", () => {
  const snapshot = fixture();
  const complete = resolution(snapshot);
  for (const note of [
    { ...complete, title: "Everything reviewed" },
    { ...complete, resolved: false },
    { ...complete, classification: "verified_cost" },
    { ...complete, action: "Done" },
    { ...complete, refs: { "projects:p": complete.refs["projects:p"] } },
    { ...complete, refs: Object.fromEntries(Object.entries(complete.refs).filter(([key]) => key !== "time_entries:separate")) },
  ]) assert.ok(readiness(snapshot, [verified(snapshot), note]).includes(complete.title));
});

test("supporting report must be referenced, available, versioned and in its correct storage bucket", () => {
  for (const change of [
    (s) => { s.records.project_files = []; },
    (s) => { s.records.storage_objects[1].available = false; },
    (s) => { s.records.storage_objects[1].etag = null; },
    (s) => { s.records.storage_objects[1].bucket = "email-attachments"; },
  ]) {
    const snapshot = fixture();
    change(snapshot);
    const note = resolution(snapshot);
    assert.ok(readiness(snapshot, [verified(snapshot), note]).includes(note.title));
  }
  const snapshot = fixture(), note = resolution(snapshot);
  delete note.refs["project_files:report"];
  assert.ok(readiness(snapshot, [verified(snapshot), note]).includes(note.title));
});

test("changed, removed and newly added reconciliation sources reopen the coverage warning", () => {
  for (const change of [
    (s) => { s.records.time_entries[0].amount = 201; },
    (s) => { s.records.time_entries.push({ id: "new", amount: 20 }); },
    (s) => { s.records.invoices.push({ ...s.records.invoices[0], id: "new" }); },
    (s) => { s.records.change_orders.push({ id: "new", status: "approved", price_impact: 50 }); },
    (s) => { s.records.invoices = []; },
    (s) => { s.records.storage_objects[1].etag = "v2"; },
  ]) {
    const snapshot = fixture(), note = resolution(snapshot);
    change(snapshot);
    assert.ok(readiness(snapshot, [verified(snapshot), note]).includes(note.title));
  }
});

test("superseded resolution cannot clear coverage after it is reopened", () => {
  const snapshot = fixture(), note = resolution(snapshot);
  const reopened = { ...note, id: "reopened", supersedes_id: note.id, resolved: false };
  assert.ok(readiness(snapshot, [verified(snapshot), note, reopened]).includes(note.title));
});

test("header-only material orders fail closed until their item inventory is loaded", () => {
  const snapshot = fixture("material_orders");
  assert.deepEqual(finalAuditCoverageRequirements(snapshot), []);
  const headerNote = {
    ...resolution(fixture()),
    title: calculateReview(snapshot).coverage.gaps[0],
    refs: sourceRegister(snapshot),
  };
  assert.ok(readiness(snapshot, [verified(snapshot), headerNote]).some((b) => /order items are missing/i.test(b)));
  snapshot.records.material_order_items = [{ id: "item", order_id: "separate", quantity: 2, quantity_fulfilled: 2 }];
  const note = resolution(snapshot);
  assert.ok("material_order_items:item" in note.refs);
  assert.deepEqual(readiness(snapshot, [verified(snapshot), note]), []);
  snapshot.records.material_order_items[0].quantity = 3;
  assert.ok(readiness(snapshot, [verified(snapshot), note]).includes(note.title));
});

test("coverage reconciliation does not replace per-scope original-cost verification", () => {
  const snapshot = fixture();
  assert.ok(readiness(snapshot, [resolution(snapshot)]).some((b) => /Verify source costs/.test(b)));
  snapshot.records.invoices[0].attachment_storage_path = null;
  assert.ok(readiness(snapshot, [resolution(snapshot)]).some((b) => /original cost documents/.test(b)));
});

test("resolved coverage cannot dismiss calculated financial and labor faults", () => {
  const cases = [
    [(s) => { s.records.invoices[0].amount = null; }, /no usable amount/],
    [(s) => { s.records.projects[0].contract_locked_amount = null; }, /signed contract/],
    [(s) => { s.records.change_orders = [{ id: "co", status: "approved", price_impact: null }]; }, /missing its price impact/],
    [(s) => { s.records.change_orders = [{ id: "co", status: "draft", price_impact: 20 }]; }, /pending change orders/],
    [(s) => { s.records.payments_received = [{ id: "receipt", amount: null }]; }, /receipt is missing/],
    [(s) => {
      s.records.client_invoices = [{ id: "client", invoice_number: 1, status: "sent", sent_to_client_at: "2026-10-01", amount: 300, paid_amount: 10 }];
      s.records.payments_received = [{ id: "receipt", amount: 20, client_invoice_id: "client" }];
    }, /linked receipts and paid amount differ/],
    [(s) => { s.records.all_day_shifts = [{ id: "shift", author_id: "worker", project_id: "p", estimate_line_item_id: "l", started_at: "2026-10-13T12:00:00Z", ended_at: "2026-10-13T13:00:00Z" }]; }, /Missing historical wage/],
    [(s) => {
      s.records.all_day_shifts = [{ id: "shift", author_id: "worker", project_id: "p", estimate_line_item_id: "l", started_at: "2026-10-14T12:00:00Z", ended_at: null }];
      s.records.employees = [{ id: "worker", profile_id: "worker", hourly_rate: 30 }];
    }, /still open/],
    [(s) => { s.records.quotes = [{ id: "quote", status: "accepted", amount: 300, estimate_line_item_id: "l" }]; }, /unlinked bills must be reconciled/],
    [(s) => { s.records.quotes = [{ id: "quote", status: "accepted", amount: 300, estimate_line_item_id: "other" }]; }, /remaining vendor commitments/],
  ];
  for (const [change, expected] of cases) {
    const snapshot = fixture();
    change(snapshot);
    const note = resolution(snapshot);
    const blockers = readiness(snapshot, [verified(snapshot), note]);
    assert.ok(!blockers.includes(note.title));
    assert.ok(blockers.some((b) => expected.test(b)), `Expected hard blocker ${expected}; got ${blockers}`);
  }
});
