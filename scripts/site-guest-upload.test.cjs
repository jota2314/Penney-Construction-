/* eslint-disable @typescript-eslint/no-require-imports */
// Real image normalization + mocked persistence. No browser or production writes.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
const sharp = require("sharp");

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
const service = load("src/lib/site-qr/guest-upload.ts", { "@/lib/sub-portal/site-code": site });
const { parseGuestPhotoForm, saveGuestPhotos, normalizeGuestPhoto, GUEST_PHOTO_BYTES, GUEST_BODY_BYTES } = service;
const ID = "12345678-1234-4234-8234-123456789abc";
const PROJECT = "12345678-1234-4234-8234-123456789def";
const OTHER = "12345678-1234-4234-8234-123456789fed";
const CODE = "ABCDEFGH";
const project = { id: PROJECT, name: "Example job", project_number: "PC-2026-123", status: "in_progress", is_overhead: false };
const image = new Blob(["test image bytes"], { type: "image/jpeg" });

function form(overrides = {}, photos = [image]) {
  const data = new FormData();
  const values = { code: CODE, submissionId: ID, name: "", note: "", ...overrides };
  for (const [key, value] of Object.entries(values)) if (value !== undefined) data.set(key, value);
  for (const photo of photos) data.append("photos", photo);
  return data;
}

function harness(options = {}) {
  const state = {
    project, row: null, count: 0, findError: null, countError: null,
    reads: [], uploads: [], removed: [], inserts: [], ...options,
  };
  const admin = {
    from(table) {
      const q = { table, filters: [], fields: "", options: {},
        select(fields, options = {}) { this.fields = fields; this.options = options; return this; },
        eq(key, value) { this.filters.push([key, value]); return this; },
        gte(key, value) { this.filters.push([key, value]); return this; },
        async maybeSingle() {
          state.reads.push({ table, fields: this.fields, filters: this.filters });
          if (table === "projects") {
            assert.deepEqual(this.filters, [["site_code", CODE]]);
            return { data: state.project, error: null };
          }
          assert.equal(table, "daily_logs");
          assert.deepEqual(this.filters, [["id", ID]]);
          return { data: state.row, error: state.findError };
        },
        async single() {
          assert.equal(table, "daily_logs");
          assert.equal(this.fields, "photo_storage_paths");
          return { data: state.row, error: state.photoReadError ?? null };
        },
        then(resolve, reject) {
          assert.equal(table, "daily_logs");
          assert.deepEqual(this.options, { count: "exact", head: true });
          assert.deepEqual(this.filters.slice(0, 2), [["project_id", PROJECT], ["is_site_guest", true]]);
          return Promise.resolve({ count: state.count, error: state.countError }).then(resolve, reject);
        },
        async insert(row) {
          state.inserts.push(structuredClone(row));
          const mode = state.insertMode ?? "ok";
          if (mode === "ok") { state.row = structuredClone(row); return { error: null }; }
          if (mode === "committed") state.row = structuredClone(row);
          if (mode === "duplicate") state.row = { id: ID, project_id: PROJECT, is_site_guest: true, photo_storage_paths: [`${ID}/other-attempt.jpg`] };
          if (mode === "foreign") state.row = { id: ID, project_id: OTHER, is_site_guest: true, photo_storage_paths: ["other.jpg"] };
          if (mode === "unknown") state.findError = { message: "Read unavailable" };
          return { error: { code: mode === "duplicate" || mode === "foreign" ? "23505" : "503", message: state.insertMessage ?? "response unavailable" } };
        },
      };
      return q;
    },
    storage: { from(bucket) {
      assert.equal(bucket, "daily-log-photos");
      return {
        async upload(path, buffer, options) {
          state.uploads.push(path);
          assert.ok(Buffer.isBuffer(buffer));
          assert.deepEqual(options, { contentType: "image/jpeg", upsert: false });
          return { error: state.failUpload === state.uploads.length ? { message: "No signal" } : null };
        },
        async remove(paths) { state.removed.push([...paths]); return { error: null }; },
      };
    } },
  };
  return { admin, state };
}
const fastNormalize = async () => Buffer.from("normalized jpeg");
const input = (photos = [image]) => parseGuestPhotoForm(form({}, photos));
async function expectStatus(work, status) {
  await assert.rejects(work, error => error instanceof service.GuestUploadError && error.status === status);
}

async function main() {
  // Only the server-resolved code determines job and attribution.
  const parsed = parseGuestPhotoForm(form({ code: "abcdefgh", name: "  Electrician  ", note: "  Rough wiring  ", projectId: OTHER, author_id: OTHER, storage_path: "other.jpg" }));
  assert.deepEqual(Object.keys(parsed).sort(), ["code", "name", "note", "photos", "submissionId"]);
  assert.equal(parsed.code, CODE); assert.equal(parsed.name, "Electrician"); assert.equal(parsed.note, "Rough wiring");
  assert.equal(parseGuestPhotoForm(form()).name, "", "name is optional");
  for (const [patch, photos, status] of [
    [{ code: "bad" }, [image], 404], [{ code: "ABCDEFG0" }, [image], 404],
    [{ submissionId: "bad" }, [image], 400], [{ website: "spam" }, [image], 400],
    [{ name: "a".repeat(101) }, [image], 400], [{ note: "a".repeat(2001) }, [image], 400],
    [{}, [], 400], [{}, Array(7).fill(image), 400], [{}, [new Blob([], { type: "image/jpeg" })], 413],
    [{}, [new Blob([Buffer.alloc(GUEST_PHOTO_BYTES + 1)], { type: "image/jpeg" })], 413],
    [{}, [new Blob(["<svg/>"], { type: "image/svg+xml" })], 400], [{}, ["not a file"], 413],
  ]) assert.throws(() => parseGuestPhotoForm(form(patch, photos)), error => error.status === status);

  // MIME and names are not trusted: decode actual pixels and remove EXIF.
  const png = await sharp({ create: { width: 2200, height: 1100, channels: 3, background: "orange" } }).png().withMetadata().toBuffer();
  const normalized = await normalizeGuestPhoto(new Blob([png], { type: "image/jpeg" }));
  const metadata = await sharp(normalized).metadata();
  assert.equal(metadata.format, "jpeg"); assert.equal(metadata.width, 1600); assert.equal(metadata.height, 800); assert.equal(metadata.exif, undefined);
  await expectStatus(() => normalizeGuestPhoto(new Blob(["<script>alert(1)</script>"], { type: "image/jpeg" })), 400);
  await expectStatus(() => normalizeGuestPhoto(new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>'], { type: "image/jpeg" })), 400);

  for (const [patch, status] of [
    [{ project: null }, 404], [{ project: { ...project, status: "completed" } }, 409],
    [{ project: { ...project, is_overhead: true } }, 409], [{ count: 60 }, 429],
    [{ findError: { message: "Unavailable" } }, 503], [{ countError: { message: "Unavailable" } }, 503],
  ]) {
    const h = harness(patch); await expectStatus(() => saveGuestPhotos(h.admin, input(), fastNormalize), status);
    assert.equal(h.state.uploads.length, 0); assert.equal(h.state.inserts.length, 0);
  }
  {
    const h = harness(); await expectStatus(() => saveGuestPhotos(h.admin, input(), normalizeGuestPhoto), 400);
    assert.equal(h.state.uploads.length, 0, "validate all images before storage");
  }
  {
    const h = harness(); const result = await saveGuestPhotos(h.admin, parsed, fastNormalize);
    assert.equal(result.projectId, PROJECT); assert.equal(result.duplicate, false);
    const row = h.state.inserts[0];
    assert.equal(row.author_id, null); assert.equal(row.subcontractor_id, null); assert.equal(row.is_site_guest, true);
    assert.equal(row.site_guest_name, "Electrician"); assert.equal(row.kind, "post"); assert.equal(row.status, "completed");
    assert.equal(row.started_at, row.ended_at); assert.equal(row.report_required, false); assert.equal(row.line_item_needs_review, false);
    assert.equal(row.project_id, PROJECT); assert.equal(row.id, ID); assert.deepEqual(row.photo_storage_paths, h.state.uploads);
    assert.ok(h.state.uploads.every(path => path.startsWith(`${ID}/`) && path.endsWith(".jpg")));
    h.state.project = { ...project, status: "completed" };
    const retry = await saveGuestPhotos(h.admin, parsed, fastNormalize);
    assert.equal(retry.duplicate, true); assert.equal(h.state.uploads.length, 1); assert.equal(h.state.inserts.length, 1);
  }
  for (const row of [{ id: ID, project_id: OTHER, is_site_guest: true }, { id: ID, project_id: PROJECT, is_site_guest: false }]) {
    const h = harness({ row }); await expectStatus(() => saveGuestPhotos(h.admin, input(), fastNormalize), 409);
    assert.equal(h.state.uploads.length, 0);
  }
  {
    const h = harness({ failUpload: 2 }); await expectStatus(() => saveGuestPhotos(h.admin, input([image, image]), fastNormalize), 503);
    assert.equal(h.state.inserts.length, 0); assert.deepEqual(h.state.removed, [h.state.uploads]);
  }
  for (const [mode, status] of [["rejected", 503], ["foreign", 409]]) {
    const h = harness({ insertMode: mode }); await expectStatus(() => saveGuestPhotos(h.admin, input(), fastNormalize), status);
    assert.deepEqual(h.state.removed, [h.state.uploads]);
  }
  {
    const h = harness({ insertMode: "rejected", insertMessage: "site_guest_hourly_limit" });
    await expectStatus(() => saveGuestPhotos(h.admin, input(), fastNormalize), 429);
    assert.deepEqual(h.state.removed, [h.state.uploads]);
  }
  for (const mode of ["duplicate", "committed"]) {
    const h = harness({ insertMode: mode }); const result = await saveGuestPhotos(h.admin, input(), fastNormalize);
    assert.equal(result.duplicate, true);
    assert.deepEqual(h.state.removed, mode === "duplicate" ? [h.state.uploads] : [], "never delete photos referenced by a committed post");
  }
  {
    const h = harness({ insertMode: "unknown" }); await expectStatus(() => saveGuestPhotos(h.admin, input(), fastNormalize), 503);
    assert.deepEqual(h.state.removed, [], "unknown commit outcome must preserve possible saved photos");
  }

  // HTTP boundary: real multipart parsing, bounded streaming, no login dependency.
  const savedInputs = []; let clients = 0;
  const route = load("src/app/api/site-photos/route.ts", {
    "next/server": { NextResponse: { json: (body, init) => Response.json(body, init) } },
    "@/lib/supabase/admin": { createAdminClient() { clients++; return {}; } },
    "@/lib/schedule/revalidate": { revalidateSchedule(id) { assert.equal(id, PROJECT); } },
    "@/lib/site-qr/guest-upload": { ...service, saveGuestPhotos: async (_admin, value) => {
      savedInputs.push(value); return { ok: true, logId: ID, duplicate: false, projectId: PROJECT };
    } },
  });
  const request = (body = form(), headers = {}) => new Request("https://www.penneyconstruction.build/api/site-photos", { method: "POST", body, headers });
  let response = await route.POST(request(form({ projectId: OTHER, author_id: OTHER }), { origin: "https://www.penneyconstruction.build" }));
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { ok: true, logId: ID, duplicate: false });
  assert.equal(savedInputs.length, 1); assert.equal(savedInputs[0].projectId, undefined); assert.equal(savedInputs[0].author_id, undefined);
  for (const headers of [{ origin: "https://other.example" }, { "sec-fetch-site": "cross-site" }]) {
    response = await route.POST(request(form(), headers)); assert.equal(response.status, 403);
  }
  response = await route.POST(request(form(), { "content-length": String(GUEST_BODY_BYTES + 1) })); assert.equal(response.status, 413);
  let cancelled = false;
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(GUEST_BODY_BYTES + 1)); }, cancel() { cancelled = true; } });
  response = await route.POST(new Request("https://www.penneyconstruction.build/api/site-photos", { method: "POST", body: stream, duplex: "half", headers: { "content-type": "multipart/form-data; boundary=test" } }));
  assert.equal(response.status, 413); assert.equal(cancelled, true);
  response = await route.POST(request("not multipart", { "content-type": "text/plain" })); assert.equal(response.status, 400);
  assert.equal(clients, 1, "reject malformed and cross-site inputs before creating privileged client");
  for (let i = 0; i < 31; i++) {
    response = await route.POST(request("no", { "content-type": "text/plain", "x-forwarded-for": "192.0.2.23" }));
    assert.equal(response.status, i === 30 ? 429 : 400);
  }

  // A stale team cookie cannot cause a login redirect for the guest flow.
  // The exemption is narrow: project tools and every server action still authenticate.
  let authGate = 0;
  const middleware = load("src/lib/supabase/middleware.ts", {
    "@supabase/ssr": { createServerClient() { authGate++; throw new Error("AUTH_GATE_REACHED"); } },
    "next/server": { NextResponse: { next: () => ({ pass: true }) } },
    "@/lib/auth/impersonation-config": {},
    "@/lib/auth/role-access": {},
  });
  const middlewareRequest = (method, path, headers = {}) => ({
    method, nextUrl: new URL(path, "https://www.penneyconstruction.build"), headers: new Headers(headers),
    cookies: { getAll() { throw new Error("Guest flow must not inspect stale team cookies"); } },
  });
  for (const [method, path] of [["GET", `/sub/j/${CODE}`], ["GET", `/sub/j/${CODE}/`], ["POST", "/api/site-photos"]]) {
    assert.deepEqual(await middleware.updateSession(middlewareRequest(method, path)), { pass: true });
  }
  assert.equal(authGate, 0);
  for (const [method, path, headers] of [
    ["GET", `/sub/j/${CODE}?tools=1`, {}], ["GET", `/sub/j/${CODE}`, { "next-action": "some-action" }],
    ["POST", "/api/site-photos", { "next-action": "some-action" }], ["POST", `/sub/j/${CODE}`, {}],
    ["GET", "/api/site-photos", {}], ["GET", `/sub/j/${CODE}/private`, {}], ["GET", `/projects/${PROJECT}`, {}],
  ]) await assert.rejects(middleware.updateSession(middlewareRequest(method, path, headers)), /AUTH_GATE_REACHED/);
  assert.equal(authGate, 7);
  console.log("Passed: no-login guest photo parsing, real image normalization, project scope, idempotency, upload cleanup, uncertain commits, rate/body caps, HTTP origin checks and narrow guest middleware exemption.");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
