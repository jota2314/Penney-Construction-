/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");

function load(file, mocks = {}) {
  const code = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const result = { exports: {} };
  new Function("require", "module", "exports", code)((id) => {
    if (id === "server-only") return {};
    if (Object.hasOwn(mocks, id)) return mocks[id];
    if (id.startsWith("@/")) throw new Error(`Unexpected app dependency: ${id}`);
    return require(id);
  }, result, result.exports);
  return result.exports;
}

const visibility = load("src/lib/crew/crew-visibility.ts");
const statuses = load("src/lib/sub-portal/statuses.ts");
const site = load("src/lib/sub-portal/site-code.ts", {
  "@/lib/crew/crew-visibility": visibility,
  "@/lib/sub-portal/statuses": statuses,
});
const CODE = "ABCDEFGH";
const PROJECT = "12345678-1234-4234-8234-123456789abc";
const OTHER = "12345678-1234-4234-8234-123456789def";
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const baseProject = { id: PROJECT, name: "Example job", project_number: "PC-2026-123", city: "Example town", status: "in_progress", is_overhead: false };
const file = (n, extra = {}) => ({ id: uuid(n), project_id: PROJECT, filename: `Technical ${n}.pdf`, category: "construction_drawings", size: n, mime_type: "application/pdf", storage_path: `private/${n}.pdf`, storage_bucket: "project-files", ...extra });

function harness(options = {}) {
  const state = { project: baseProject, files: [file(1)], dismissed: [], overrides: [], reads: [], signed: [], pageCap: 1000, ...options };
  const admin = {
    from(table) {
      const q = { filters: [], fields: "", offset: 0, end: 999,
        select(fields, options) { this.fields = fields; this.options = options; return this; },
        eq(key, value) { this.filters.push([key, value]); return this; },
        order(key) { this.orderKey = key; return this; },
        range(from, to) { this.offset = from; this.end = to; return this; },
        async maybeSingle() {
          assert.equal(table, "projects"); assert.deepEqual(this.filters, [["site_code", CODE]]);
          state.reads.push({ table, filters: this.filters, fields: this.fields });
          return { data: state.project, error: state.failTable === table ? { message: "private backend detail" } : null };
        },
        then(resolve, reject) {
          assert.deepEqual(this.filters, [["project_id", PROJECT]]);
          assert.equal(this.options.count, "exact");
          state.reads.push({ table, filters: this.filters, offset: this.offset, fields: this.fields });
          const rows = table === "project_files" ? state.files.filter(row => row.project_id === PROJECT) : table === "project_dismissed_files" ? state.dismissed : state.overrides;
          return Promise.resolve({
            data: rows.slice(this.offset, Math.min(this.end + 1, this.offset + state.pageCap)),
            error: state.failTable === table ? { message: "private backend detail" } : null,
            count: state.missingCount ? null : rows.length,
          }).then(resolve, reject);
        },
      };
      return q;
    },
    storage: { from(bucket) { return { async createSignedUrl(path, ttl) {
      state.signed.push({ bucket, path, ttl });
      return { data: { signedUrl: `https://storage.example/${bucket}/${path}?token=temporary` }, error: state.signError ? { message: "private storage detail" } : null };
    } }; } },
  };
  return { admin, state };
}

let current = harness();
const service = load("src/lib/site-qr/guest-documents.ts", {
  "@/lib/crew/crew-visibility": visibility,
  "@/lib/sub-portal/site-code": site,
  "@/lib/supabase/admin": { createAdminClient: () => current.admin },
});
const expectStatus = (work, status) => assert.rejects(work, error => error instanceof service.GuestDocumentsError && error.status === status);

async function main() {
  const hidden = file(2, { filename: "Hidden drawing.pdf" });
  const renamedFinancial = file(3, { filename: "Invoice.pdf", category: "specs" });
  const innocentRenamed = file(4, { filename: "Technical 4.pdf", category: "specs" });
  const moved = file(5, { filename: "Valve cut sheet.pdf", category: "other", storage_bucket: "email-attachments" });
  current = harness({ pageCap: 2, files: [
    file(1), hidden, renamedFinancial, innocentRenamed, moved,
    file(6, { filename: "Plan-R1.pdf" }), file(7, { filename: "Plan-R2.pdf" }),
    file(8, { project_id: OTHER }),
    ...["Design-Presentation-R2.pdf", "DesignPackage.pdf", "Fixture-Selections-R3.pdf", "Finish Selections.pdf", "FixtureFinishSelections.pdf", "Selections-Sheet.pdf", "Plumbing-$500.pdf", "Valve-USD250.pdf", "Equipment-1,250.00.pdf"].map((filename, index) => file(20 + index, { filename, category: "specs" })),
    file(30, { filename: "Manufacturer fixture specifications.pdf", category: "specs" }),
    file(31, { filename: "drawing.png", mime_type: "image/png" }),
    file(32, { filename: "drawing.svg", mime_type: "image/svg+xml" }),
    file(33, { filename: "Technical 33.pdf", mime_type: "text/html" }),
    file(34, { filename: "Technical 34.docx", mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }),
    file(35, { storage_bucket: "email-credentials" }),
    file(36, { storage_path: "../secret.pdf" }),
    file(37, { category: "permits" }), file(38, { category: "photos" }),
    file(39, { filename: "Pricing set-R1.pdf" }),
  ], dismissed: [{ file_key: "unrelated|1" }, { file_key: "unrelated|2" }, { file_key: visibility.fileKey(hidden.filename, hidden.size) }], overrides: [
    { file_key: visibility.fileKey(renamedFinancial.filename, renamedFinancial.size), display_name: "Clean drawing.pdf", category: "construction_drawings" },
    { file_key: visibility.fileKey(innocentRenamed.filename, innocentRenamed.size), display_name: "Fixture Selections.pdf", category: "specs" },
    { file_key: visibility.fileKey(moved.filename, moved.size), display_name: "Valve specifications.pdf", category: "specs" },
  ] });
  const docs = await service.getGuestJobDocuments("abcdefgh");
  assert.deepEqual(docs.drawings.map(x => x.id), [1, 7, 31, 39].map(uuid));
  assert.deepEqual(docs.specs.map(x => x.id), [5, 30].map(uuid));
  assert.deepEqual(Object.keys(docs.project).sort(), ["name", "number", "town"]);
  assert.ok([...docs.drawings, ...docs.specs].every(row => Object.keys(row).sort().join() === "category,filename,id"));
  assert.equal(current.state.signed.length, 0, "Listing does not mint or expose signed URLs");
  assert.ok(current.state.reads.some(row => row.table === "project_dismissed_files" && row.offset === 2), "Complete hide list despite a low API row cap");
  assert.ok(!current.state.reads.some(row => /amount|cost|price|proposal|contract/.test(row.fields)), "Only nonfinancial metadata is queried");
  assert.match(await service.getGuestJobDocumentUrl(CODE, uuid(5)), /email-attachments\/private\/5.pdf/);
  assert.deepEqual(current.state.signed.at(-1), { bucket: "email-attachments", path: "private/5.pdf", ttl: 300 });
  for (const id of [2, 3, 4, 6, 8, 20, 21, 22, 23, 24, 25, 26, 27, 28, 32, 33, 34, 35, 36, 37, 38]) await expectStatus(() => service.getGuestJobDocumentUrl(CODE, uuid(id)), 404);
  await expectStatus(() => service.getGuestJobDocumentUrl(CODE, "../private/5.pdf"), 404);
  assert.equal(current.state.signed.length, 1, "Rejected files never reach Storage");
  // New revisions and office removals are re-evaluated for an already listed ID.
  current.state.files.push(file(40, { filename: "Plan-R3.pdf" }));
  await expectStatus(() => service.getGuestJobDocumentUrl(CODE, uuid(7)), 404);
  current.state.dismissed.push({ file_key: visibility.fileKey(moved.filename, moved.size) });
  await expectStatus(() => service.getGuestJobDocumentUrl(CODE, uuid(5)), 404);

  for (const project of [null, { ...baseProject, status: "cancelled" }, { ...baseProject, is_overhead: true }, { ...baseProject, name: "Shop" }, { ...baseProject, project_number: "PC-2026-162" }]) {
    current = harness({ project }); await expectStatus(() => service.getGuestJobDocuments(CODE), 404);
    assert.equal(current.state.reads.length, 1); assert.equal(current.state.signed.length, 0);
  }
  current = harness(); await expectStatus(() => service.getGuestJobDocuments("ABCDEFG0"), 404); assert.equal(current.state.reads.length, 0);
  for (const failTable of ["projects", "project_files", "project_dismissed_files", "project_file_overrides"]) {
    current = harness({ failTable }); await expectStatus(() => service.getGuestJobDocuments(CODE), 503);
  }
  current = harness({ missingCount: true }); await expectStatus(() => service.getGuestJobDocuments(CODE), 503);
  current = harness({ signError: true }); await expectStatus(() => service.getGuestJobDocumentUrl(CODE, uuid(1)), 503);

  const { NextResponse, NextRequest } = require("next/server");
  const route = load("src/app/api/site-documents/[code]/[fileId]/route.ts", { "@/lib/site-qr/guest-documents": service });
  assert.equal(route.POST, undefined, "No anonymous write/action export");
  current = harness();
  let response = await route.GET(new NextRequest(`https://app.example/api/site-documents/${CODE}/${uuid(1)}?bucket=private-bank&path=secret.pdf&projectId=${OTHER}`), { params: Promise.resolve({ code: CODE, fileId: uuid(1) }) });
  assert.ok(response instanceof NextResponse); assert.equal(response.status, 307);
  assert.equal(response.headers.get("Referrer-Policy"), "no-referrer");
  assert.match(response.headers.get("Cache-Control"), /no-store/);
  assert.match(response.headers.get("Location"), /project-files\/private\/1.pdf/);
  const signedBefore = current.state.signed.length;
  response = await route.GET(new NextRequest(`https://app.example/api/site-documents/${CODE}/${uuid(1)}`, { headers: { "next-action": "private-action" } }), { params: Promise.resolve({ code: CODE, fileId: uuid(1) }) });
  assert.equal(response.status, 400); assert.equal(current.state.signed.length, signedBefore);
  current = harness({ failTable: "project_files" });
  response = await route.GET(new NextRequest(`https://app.example/api/site-documents/${CODE}/${uuid(1)}`), { params: Promise.resolve({ code: CODE, fileId: uuid(1) }) });
  assert.equal(response.status, 503); assert.ok(!(await response.text()).includes("private backend detail"));
  console.log("Passed: code-scoped drawings/specs, complete hide/override/revision metadata, private package exclusions, fixed buckets, no financial metadata, short-lived signing, backend failures and GET/action isolation.");
}

main().catch(error => { console.error(error); process.exit(1); });
