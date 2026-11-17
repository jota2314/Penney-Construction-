/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");

function load(file, dependencies = {}) {
  const code = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const result = { exports: {} };
  new Function("require", "module", "exports", code)(id => {
    if (id === "server-only" || id.startsWith("@/") || id.startsWith("./")) return dependencies[id] ?? {};
    return require(id);
  }, result, result.exports);
  return result.exports;
}

const projectId = "00000000-0000-4000-8000-000000000001";
const subId = "00000000-0000-4000-8000-000000000002";
const project = { id: projectId, name: "Kitchen", project_type: "kitchen", contract_estimate_id: "internal-pointer", description: "office draft" };
const sub = { id: subId, company_name: "Example", trades: ["plumbing"] };
const files = [ ["plans", "Layout-R2.pdf"], ["photos", "photo.jpg"], ["specs", "Valve.pdf"] ]
  .map(([category, filename]) => ({ id: filename, filename, category, storage_path: filename, mime_type: "application/pdf" }));
const scope = { project: { name: "internal projection metadata" }, source: { status: "signed", label: "Current approved job scope", date: null },
  sections: [{ id: "plumbing", label: "Plumbing", items: [{ title: "Valve", description: "Install at 36 inches." }] }], unavailableReason: null };
const visibility = load("src/lib/crew/crew-visibility.ts");
const inputs = {
  "@/lib/money": load("src/lib/money.ts"),
  "@/lib/site-qr/scope-text": load("src/lib/site-qr/scope-text.ts"),
  "@/lib/crew/crew-visibility": visibility,
  "@/lib/schedule/parked": load("src/lib/schedule/parked.ts"),
  "./et-day": load("src/lib/sub-portal/et-day.ts"),
  "./statuses": load("src/lib/sub-portal/statuses.ts"),
  "./flags": { subAgreementsEnabled: () => false },
};

async function check({ view = true, post = true, linkStatus = null, fileError = false, scopeError = false, brokenLink = null, phase = {} } = {}) {
  const reads = { scope: 0, files: 0, signed: [] };
  const { loadSubJob } = load("src/lib/sub-portal/load-sub-portal-data.ts", {
    ...inputs,
    "./active-jobs": { canSubViewJob: async () => ({ view, post }), isSubOnJob: async () => post },
    "@/lib/crew/field-project-files": { loadFieldProjectFiles: async (_, jobId) => {
      assert.equal(jobId, projectId); reads.files++;
      if (fileError) throw new Error("simulated metadata read failure");
      return files;
    } },
    "@/lib/site-qr/guest-scope": { loadApprovedFieldScope: async (_, row) => {
      assert.equal(row.id, projectId); reads.scope++;
      if (scopeError) throw new Error("simulated scope read failure");
      return scope;
    } },
    "@/lib/storage/signed-url-cache": { cachedSignedUrls: async (_, bucket, paths) => {
      reads.signed.push(...paths);
      return { data: paths.filter(p => p !== brokenLink).map(path => ({ path, signedUrl: "https://example.test/document" })) };
    } },
  });
  const db = {
    from(table) {
      const query = {
        select() { return this; }, eq() { return this; }, contains() { return this; },
        order() { return this; }, limit() { return this; }, or() { return this; },
        async maybeSingle() { return { data: table === "projects" ? project : table === "subcontractors" ? sub : null }; },
        then(resolve) {
          const fixtures = {
            project_subcontractors: [{ status: linkStatus, scope_summary: "Frame opening at 48 inches. Budget $900." }],
            schedule_phases: [{ id: "phase", project_id: projectId, name: "Rough-in", description: "Allow for 2 showers. Price $900.",
              sub_response_note: "I can do Thursday.", is_confirmed: true, start_date: "2026-11-18", ...phase }],
            client_selections: [{ id: "selection", category: "Valve", selected_value: "Matte black ($500)", description: "Check the 3/4-inch supply. Payment $950." }],
          };
          resolve({ data: fixtures[table] ?? [] });
        },
      };
      return query;
    },
    rpc(name, args) {
      assert.equal(name, "sub_portal_trade_scope");
      assert.deepEqual(args, { p_sub_id: subId, p_project_ids: [projectId] });
      return { data: [
        { project_id: projectId, trade: "Plumbing", description: "Install 2 sinks for $2,500.", scope: "Use 2-inch pipe. Markup 15%." },
        { project_id: projectId, trade: "Plumbing", description: "$3,200" },
        { project_id: "different-job", description: "Wrong job" },
      ] };
    },
  };
  return { result: await loadSubJob({ projectId, subId, supabase: db, mode: "preview", now: new Date("2026-11-17T13:00:00Z") }), reads };
}

async function checkPostPagination() {
  const timestamp = "2026-11-16T15:00:00Z";
  const cursor = Buffer.from(`${timestamp}|${projectId}`).toString("base64url");
  const rows = Array.from({ length: 21 }, (_, i) => ({
    id: "00000000-0000-4000-8000-" + String(i + 1).padStart(12, "0"),
    project_id: projectId, kind: "post", started_at: timestamp, photo_storage_paths: [`image${i}`],
  }));
  let allowed = true;
  let failLogs = false;
  const queries = [];
  const signed = [];
  const db = { from(table) {
    queries.push(table);
    assert.ok(["daily_logs", "subcontractors"].includes(table));
    const query = {
      select: () => query, order: () => query, limit: value => { assert.equal(value, 21); return query; },
      eq: (column, value) => { assert.equal(value, column === "project_id" ? projectId : subId); return query; },
      or: (filter) => {
        assert.ok(filter.includes(timestamp) && filter.includes(projectId));
        return { data: failLogs ? null : rows, error: failLogs ? "unavailable" : null };
      },
      maybeSingle: () => ({ data: { company_name: "Fixture Trade" } }),
    };
    return query;
  } };
  const { loadSubJobPosts } = load("src/lib/sub-portal/load-sub-portal-data.ts", {
    ...inputs,
    "./active-jobs": { canSubViewJob: async () => ({ view: allowed }) },
    "@/lib/image/transform-signed-url": { signThumbUrls: async () => new Map() },
    "@/lib/storage/signed-url-cache": { cachedSignedUrls: async (_db, _bucket, paths) => {
      signed.push(...paths);
      return { data: paths.map(path => ({ path, signedUrl: "/example/" + path })) };
    } },
  });
  const opts = { subId, projectId, cursor, mode: "sub", supabase: db };
  const first = await loadSubJobPosts(opts);
  assert.deepEqual(queries, ["subcontractors", "daily_logs"]);
  assert.deepEqual(Object.keys(first.data).sort(), ["items", "next_cursor"]);
  assert.equal(first.data.items.length, 20);
  assert.equal(first.data.items[0].photos[0].full, "/example/image0");
  assert.equal(first.data.items[0].author_label, "Fixture Trade");
  assert.ok(!signed.includes("image20"), "Only displayed photos are signed");
  assert.equal(Buffer.from(first.data.next_cursor, "base64url").toString(), timestamp + "|" + rows[19].id);
  failLogs = true;
  assert.equal((await loadSubJobPosts(opts)).status, 503);
  queries.length = 0;
  allowed = false;
  assert.equal((await loadSubJobPosts(opts)).status, 404);
  assert.equal((await loadSubJobPosts({ ...opts, cursor: "bad" })).status, 400);
  assert.deepEqual(queries, []);

  for (const preview of [false, true]) {
    const mock = (kind) => async (args) => ({ ok: true, data: { kind, mode: args.mode, id: args.projectId } });
    const api = preview ? "src/app/api/sub-portal/preview-data/route.ts" : "src/app/api/sub-portal/job/[id]/route.ts";
    const { GET } = load(api, {
      "@/lib/sub-portal/load-sub-portal-data": { loadSubJob: mock("full"), loadSubJobPosts: mock("posts") },
      "@/lib/sub-portal/access": { resolveSubAccessResult: async () => ({ ok: true, access: { subId, supabase: db } }) },
      "@/lib/sub-portal/staff-guard": { refuseStaffBrowser: async () => null },
      "@/lib/auth/get-user": { getUser: async () => ({ profile: { role: "admin" } }) },
      "@/lib/supabase/admin": { createAdminClient: () => db },
    });
    const url = new URL("https://example.test/?cursor=" + cursor);
    if (preview) { url.searchParams.set("subId", subId); url.searchParams.set("job", projectId); }
    const args = { params: Promise.resolve({ id: projectId }) };
    assert.equal((await (await GET({ nextUrl: url }, args)).json()).kind, "full");
    url.searchParams.set("part", "posts");
    const result = await (await GET({ nextUrl: url }, args)).json();
    assert.deepEqual(result, { kind: "posts", mode: preview ? "preview" : "sub", id: projectId });
  }
}

(async () => {
  const { result, reads } = await check();
  assert.equal(result.ok, true);
  assert.equal(result.data.job.project_type, "kitchen");
  assert.deepEqual(result.data.approved_scope.sections, scope.sections);
  assert.deepEqual(result.data.scope, [{ trade: "Plumbing", description: "Install 2 sinks", scope: "Use 2-inch pipe." }]);
  assert.equal(result.data.assignment_summary, "Frame opening at 48 inches.");
  assert.equal(result.data.dates[0].description, "Allow for 2 showers.");
  assert.equal(result.data.dates[0].sub_response_note, "I can do Thursday.");
  assert.equal(result.data.dates[0].needs_answer, true);
  for (const phase of [{ status: "on_hold" }, { status: "completed" }, { sub_response: "declined" }, { start_date: null }]) {
    const { result } = await check({ phase });
    assert.equal(result.data.dates[0].needs_answer, false);
  }
  assert.equal(result.data.selections[0].selected_value, "Matte black");
  assert.equal(result.data.selections[0].description, "Check the 3/4-inch supply.");
  assert.doesNotMatch(JSON.stringify(result.data), /internal-pointer|office draft|internal projection|Wrong job|markup|\$2,500/i);
  assert.deepEqual(reads.signed, ["Layout-R2.pdf", "Valve.pdf"]);
  assert.deepEqual(result.data.files.map(g => g.key), ["drawings", "specs"]);
  assert.equal(result.data.files_unavailable, false);
  const denied = await check({ view: false, post: false });
  assert.equal(denied.result.status, 404);
  assert.deepEqual(denied.reads, { scope: 0, files: 0, signed: [] });
  const past = await check({ post: false });
  assert.equal(past.reads.scope, 0);
  assert.equal(past.result.data.approved_scope, null);
  assert.equal(past.result.data.assignment_summary, null);
  assert.equal((await check({ linkStatus: "removed" })).result.data.assignment_summary, null);
  const offline = await check({ fileError: true, scopeError: true });
  assert.deepEqual(offline.reads.signed, []);
  assert.equal(offline.result.data.files_unavailable, true);
  assert.equal(offline.result.data.approved_scope, null);
  assert.ok(offline.result.data.scope.length);
  const partial = await check({ brokenLink: "Valve.pdf" });
  assert.equal(partial.result.data.files_unavailable, true);
  assert.deepEqual(partial.result.data.files.map(g => g.key), ["drawings"]);
  await checkPostPagination();
  console.log("Passed sub portal brief data, access, price-free trade scope, drawing availability and older-post pagination checks.");
})().catch(error => { console.error(error); process.exitCode = 1; });
