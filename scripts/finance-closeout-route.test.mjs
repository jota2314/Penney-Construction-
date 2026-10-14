import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { z } from "zod";

// Execute the actual route with isolated auth/data adapters. No application
// credentials, database connection, browser, or financial mutation is used.
const source = fs.readFileSync(new URL("../src/app/api/finance-audit/route.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const PROJECT = "10000000-0000-4000-8000-000000000001";
const ACTOR = "20000000-0000-4000-8000-000000000002";
const RUN = "30000000-0000-4000-8000-000000000003";
const FILE = "40000000-0000-4000-8000-000000000004";
const FINAL = "50000000-0000-4000-8000-000000000005";
const TODAY = "2026-10-14";
const NOW = `${TODAY}T16:00:00Z`;
const fingerprint = value => JSON.stringify(value);
class FixedDate extends Date {
  constructor(...args) { super(...(args.length ? args : [NOW])); }
  static now() { return Date.parse(NOW); }
}

function harness() {
  const report = { id: FILE, filename: "final-audit.html", storage_path: "job/final.html", storage_bucket: "project-files" };
  const reportVersion = { id: "project-files/job/final.html", bucket: "project-files", path: report.storage_path, available: true, version: "v1", etag: "etag-1" };
  const state = {
    user: { id: ACTOR, email: "owner@example.test", isImpersonating: false, profile: { role: "owner", full_name: "Office reviewer" } },
    snapshot: { as_of: NOW, register: { "projects:job": "source-v1", "storage_objects:report": "document-v1" }, records: { project_files: [report], storage_objects: [reportVersion] } },
    evidence: [{ id: "evidence-1", classification: "verified_cost", refs: { "storage_objects:report": "document-v1" } }],
    review: { run_id: RUN, money: { contract: 1000000, recorded_cost: 600000, cost_budget: 700000, net_minutes: 1200, received: 900000, known_unbilled_commitments: 0 }, scopes: [{ id: "scope-1", cost: 600000 }], collections: [{ id: "client-invoice", remaining: 100000 }] },
    overhead: { method: "monthly_net_receipts", allocated: 50000, fingerprint: "overhead-v1", blockers: [], months: [{ month: "2026-09", allocated: 50000 }], source_register: { "overhead:invoice": "oh1" } },
    readinessBlockers: [], coverageRequirements: [{ key: "completion", label: "Completion evidence" }],
    head: null, headError: null, runError: null, rpcError: null,
    workspace: { jobs: [{ id: PROJECT, name: "Test job", cost: 600000, contract: 1000000, financialBasis: "basis-v1", audit: null, finalNeedsReview: false }], canFinalize: true, today: TODAY, auditError: null },
    calls: { workspace: 0, review: 0, snapshot: 0, overhead: 0, tables: [], rpc: [] },
  };
  state.run = { id: RUN, fingerprint: fingerprint(state.snapshot.register), checked_at: NOW };
  class Query {
    constructor(table) { this.table = table; this.filters = {}; }
    select() { return this; }
    eq(key, value) { this.filters[key] = value; return this; }
    neq() { return this; }
    order() { return this; }
    limit() { return this; }
    range() { return this; }
    result() {
      let data, error = null;
      if (this.table === "job_review_evidence") data = state.evidence;
      else if (this.table === "project_files") data = state.snapshot.records.project_files;
      else if (this.table === "project_finance_records") { data = state.head; error = state.headError; }
      else if (this.table === "job_review_runs") {
        assert.equal(this.filters.project_id, PROJECT);
        assert.equal(this.filters.actor_id, ACTOR);
        assert.equal(this.filters.id, RUN);
        data = state.run; error = state.runError;
      } else throw new Error(`Unexpected query: ${this.table}`);
      return { data: structuredClone(data), error };
    }
    single() { return Promise.resolve(this.result()); }
    maybeSingle() { return Promise.resolve(this.result()); }
    then(resolve, reject) { return Promise.resolve(this.result()).then(resolve, reject); }
  }
  const db = {
    from(table) { state.calls.tables.push(table); return new Query(table); },
    async rpc(name, args) {
      state.calls.rpc.push({ name, args: structuredClone(args) });
      return { data: FINAL, error: state.rpcError };
    },
  };
  const modules = {
    "next/server": { NextResponse: { json: (body, options) => Response.json(body, options) } },
    zod: { z },
    "@/lib/auth/get-user": { getUser: async () => state.user },
    "@/lib/supabase/admin": { createAdminClient: () => db },
    "@/lib/auth/role-access": { canSeeBoardMoney: role => ["owner", "precon_manager", "office_admin"].includes(role) },
    "@/lib/job-review/service": {
      loadSnapshot: async (actor, project) => { assert.equal(actor, ACTOR); assert.equal(project, PROJECT); state.calls.snapshot++; return structuredClone(state.snapshot); },
      reviewJob: async () => { state.calls.review++; return structuredClone(state.review); },
    },
    "@/lib/crew/load-labor-ledger": { financialRows: async query => { const result = await query(0, 999); if (result.error) throw new Error(result.error.message); return result.data; } },
    "@/lib/job-review/engine": { fingerprint, sourceRegister: snapshot => snapshot.register },
    "@/lib/finance/final-audit": {
      finalAuditReadiness: () => ({ review: structuredClone(state.review), blockers: [...state.readinessBlockers] }),
      finalAuditCoverageRequirements: () => state.coverageRequirements,
    },
    "@/lib/finance/workspace-data": { getFinanceWorkspace: async () => { state.calls.workspace++; return structuredClone(state.workspace); } },
    "@/lib/finance/overhead": { getJobOverheadAllocation: async project => { assert.equal(project, PROJECT); state.calls.overhead++; return structuredClone(state.overhead); } },
  };
  const exports = {};
  vm.runInNewContext(compiled, { exports, module: { exports }, require: name => {
    if (!(name in modules)) throw new Error(`Unmocked route dependency: ${name}`);
    return modules[name];
  }, Date: FixedDate, Intl, Error, console }, { filename: "finance-audit-route.cjs" });
  async function post(body, origin = "https://penney.test") {
    const response = await exports.POST({ headers: new Headers({ origin }), nextUrl: new URL("https://penney.test/api/finance-audit"), json: async () => structuredClone(body) });
    return { status: response.status, headers: response.headers, body: await response.json() };
  }
  return { state, post };
}

const finalize = changes => ({ action: "finalize", project_id: PROJECT, run_id: RUN, closed_on: "2026-09-30", report_file_id: FILE, note: "All original evidence and final obligations were reviewed.", payroll_burden: 10000, overhead_fingerprint: "overhead-v1", overhead_accepted: true, attested: true, ...changes });

test("status rejects foreign origins, unauthenticated/nonoffice users and impersonation before reading data", async () => {
  for (const variant of ["origin", "anonymous", "crew", "impersonation"]) {
    const { state, post } = harness();
    if (variant === "anonymous") state.user = null;
    if (variant === "crew") state.user.profile.role = "crew";
    if (variant === "impersonation") state.user.isImpersonating = true;
    const response = await post({ action: "status", project_id: PROJECT }, variant === "origin" ? "https://other.test" : undefined);
    assert.equal(response.status, 403, variant);
    assert.equal(state.calls.workspace, 0, variant);
    assert.deepEqual(state.calls.rpc, []);
  }
});

test("office administrators can read one job's status but cannot finalize it", async () => {
  const { state, post } = harness();
  state.user.profile.role = "office_admin";
  state.workspace.canFinalize = false;
  state.workspace.jobs.push({ id: "other-job", name: "Other private job" });
  const response = await post({ action: "status", project_id: PROJECT });
  assert.equal(response.status, 200);
  assert.equal(response.body.job.id, PROJECT);
  assert.equal(response.body.canFinalize, false);
  assert.equal(response.body.jobs, undefined);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal((await post(finalize())).status, 403);
  assert.equal(state.calls.review, 0);
  assert.deepEqual(state.calls.rpc, []);
});

test("status reports missing jobs and carries audit-history failures without inventing a final record", async () => {
  const { state, post } = harness();
  state.workspace.auditError = "Audit history could not load";
  const response = await post({ action: "status", project_id: PROJECT });
  assert.equal(response.body.auditError, "Audit history could not load");
  assert.equal(response.body.job.audit, null);
  state.workspace.jobs = [];
  assert.equal((await post({ action: "status", project_id: PROJECT })).status, 404);
});

test("prepare returns overhead and evidence blockers without finalizing, and filters inaccessible report choices", async () => {
  const { state, post } = harness();
  state.user.profile.role = "office_admin";
  state.readinessBlockers.push("Verify final inspections");
  state.overhead.blockers.push("Current month overhead is incomplete");
  state.overhead.allocated = null;
  state.snapshot.records.project_files.push({ id: "missing-storage", filename: "Not uploaded" });
  const response = await post({ action: "prepare", project_id: PROJECT });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.blockers, ["Verify final inspections", "Current month overhead is incomplete"]);
  assert.deepEqual(response.body.coverageRequirements, state.coverageRequirements);
  assert.equal(response.body.overhead.allocated, null);
  assert.deepEqual(response.body.files.map(file => file.id), [FILE]);
  assert.equal(state.calls.review, 1);
  assert.deepEqual(state.calls.rpc, []);
});

test("finalize rejects changed job sources, expired reviews and changed overhead previews without writes", async () => {
  for (const variant of ["job", "expired", "overhead"]) {
    const { state, post } = harness();
    if (variant === "job") state.snapshot.register["projects:job"] = "changed";
    if (variant === "expired") state.run.checked_at = "2026-10-14T15:29:00Z";
    if (variant === "overhead") state.overhead.fingerprint = "overhead-v2";
    const response = await post(finalize());
    assert.equal(response.status, 409, variant);
    assert.match(response.body.error, /changed|expired/i);
    assert.deepEqual(state.calls.rpc, []);
  }
});

test("finalize rejects forged manual overhead and requires explicit burden and acceptance", async () => {
  for (const changes of [{ allocated_overhead: 1 }, { profit: 9999999 }, { payroll_burden: undefined }, { payroll_burden: -1 }, { overhead_accepted: false }, { attested: false }]) {
    const { state, post } = harness();
    const response = await post(finalize(changes));
    assert.equal(response.status, 409);
    assert.match(response.body.error, /required audit fields/);
    assert.deepEqual(state.calls.rpc, []);
  }
});

test("finalize blocks unfinished overhead, unverified evidence and an inaccessible report", async () => {
  for (const variant of ["overhead", "evidence", "report", "existing-final"]) {
    const { state, post } = harness();
    if (variant === "overhead") { state.overhead.allocated = null; state.overhead.blockers.push("Missing receipt basis"); }
    if (variant === "evidence") state.readinessBlockers.push("Source cost is unverified");
    if (variant === "report") state.snapshot.records.storage_objects = [];
    if (variant === "existing-final") state.head = { id: FINAL, kind: "final" };
    const response = await post(finalize());
    assert.equal(response.status, 409, variant);
    assert.deepEqual(state.calls.rpc, []);
  }
});

test("finalize derives costs and profit from server data and appends the evidence/versioned snapshot", async () => {
  const { state, post } = harness();
  const before = structuredClone({ snapshot: state.snapshot, evidence: state.evidence, overhead: state.overhead });
  const response = await post(finalize());
  assert.equal(response.status, 200);
  assert.equal(response.body.id, FINAL);
  assert.equal(state.calls.rpc.length, 1);
  const { name, args } = state.calls.rpc[0];
  assert.equal(name, "append_project_finance_record");
  assert.equal(args.p_actor, ACTOR);
  assert.equal(args.p_project, PROJECT);
  assert.equal(args.p_kind, "final");
  assert.equal(args.p_run, RUN);
  assert.equal(args.p_expected_head, null);
  assert.equal(args.p_closed_on, "2026-09-30");
  assert.equal(args.p_payload.allocated_overhead, 50000);
  assert.equal(args.p_payload.final_cost, 660000);
  assert.equal(args.p_payload.gross_profit, 390000);
  assert.equal(args.p_payload.profit, 340000);
  assert.equal(args.p_payload.margin, 0.34);
  assert.equal(args.p_payload.received, 900000);
  assert.equal(args.p_payload.financial_basis, "basis-v1");
  assert.deepEqual(args.p_payload.overhead_allocation, before.overhead);
  assert.deepEqual(args.p_payload.report_version, before.snapshot.records.storage_objects[0]);
  assert.deepEqual(args.p_payload.source_register, before.snapshot.register);
  assert.deepEqual(args.p_payload.evidence, before.evidence);
  assert.deepEqual(args.p_evidence, before.evidence);
  assert.deepEqual(args.p_payload.scopes, state.review.scopes);
  assert.deepEqual(args.p_payload.collections, state.review.collections);
  assert.match(args.p_payload.attestation, /receivables\/payables/);
  assert.deepEqual({ snapshot: state.snapshot, evidence: state.evidence, overhead: state.overhead }, before);
});

test("explicit zero additional burden is accepted without inventing expense", async () => {
  const { state, post } = harness();
  const response = await post(finalize({ payroll_burden: 0 }));
  assert.equal(response.status, 200);
  const payload = state.calls.rpc[0].args.p_payload;
  assert.equal(payload.payroll_burden, 0);
  assert.equal(payload.final_cost, 650000);
  assert.equal(payload.profit, 350000);
});

test("reopen appends a reason against the expected final head without modifying its snapshot", async () => {
  const { state, post } = harness();
  state.head = { id: FINAL, kind: "final", payload: { profit: 340000 } };
  const before = structuredClone(state.head);
  const response = await post({ action: "reopen", project_id: PROJECT, record_id: FINAL, note: "A verified additional vendor bill requires a revised audit." });
  assert.equal(response.status, 200);
  assert.equal(state.calls.rpc[0].args.p_kind, "reopen");
  assert.equal(state.calls.rpc[0].args.p_expected_head, FINAL);
  assert.equal(state.calls.rpc[0].args.p_run, null);
  assert.deepEqual(state.head, before);
});
