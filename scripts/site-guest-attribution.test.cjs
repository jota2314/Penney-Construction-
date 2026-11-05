/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
function load(file, mocks = {}) {
  const context = { exports: {}, console, require(name) {
    if (name in mocks) return mocks[name];
    if (name === "zod") return require("zod");
    return {};
  } };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, context);
  return context.exports;
}
const names = load("src/lib/site-qr/guest-author.ts");
assert.equal(names.siteGuestAuthorName(false, "Supplied name", "Trade", "Company"), null);
assert.equal(names.siteGuestAuthorName(true, "  Alex Rivera  ", " Electrician ", " Rivera Electric "), "Alex Rivera · Electrician · Rivera Electric");
assert.equal(names.siteGuestAuthorName(true, "Alex Rivera", "Electrician", " "), "Alex Rivera · Electrician");
assert.equal(names.siteGuestAuthorName(true, "Legacy name"), "Legacy name");
assert.equal(names.siteGuestAuthorName(true, null, null, null), "Job-site update");
const work = load("src/lib/crew/log-work-links.ts");
const job = "00000000-0000-4000-8000-000000000001";
const at = "2026-11-05T02:00:00.000Z";
const base = { project_id: job, project: { name: "Test job" }, kind: "post", status: "completed", text: null, started_at: at, ended_at: at, photo_storage_paths: ["photo.jpg"] };
const rows = [
  { ...base, id: "guest-named", is_site_guest: true, site_guest_name: "Alex Rivera", site_guest_trade: "Electrician", site_guest_company: "Rivera Electric", text: "Installed kitchen lighting and tested the circuits.", author_id: null, subcontractor_id: null },
  { ...base, id: "guest-unnamed", is_site_guest: true, site_guest_name: null, author_id: null, subcontractor_id: null },
  { ...base, id: "staff", is_site_guest: false, author_id: "staff-id", author: { full_name: "Crew member", email: "crew@example.test" } },
  { ...base, id: "sub", is_site_guest: false, subcontractor_id: "sub-id", sub: { contact_name: "Person", company_name: "Company" } },
];
const selected = [];
function query() {
  let linked = false;
  return {
    select(fields) { selected.push(fields); return this; },
    eq() { return this; }, not() { return this; }, order() { return this; }, limit() { return this; },
    in() { linked = true; return this; },
    then(resolve) { resolve({ data: linked ? [] : rows, error: null }); },
  };
}
const common = {
  "@/lib/site-qr/guest-author": names,
  "@/lib/supabase/server": { createClient: async () => ({ from: () => query() }) },
  "@/lib/auth/get-user": { getUser: async () => ({ profile: { role: "owner" } }) },
};
const logs = load("src/lib/actions/daily-logs.ts", {
  ...common,
  "@/lib/crew/log-work-links": work,
  "@/lib/actions/feed-comments": { listFeedCommentsForSources: async () => [] },
});
const photos = load("src/lib/actions/crew-job-folder.ts", common);
(async () => {
  const feed = await logs.listRecentDailyLogs(20, job, { signPhotos: false });
  assert.deepEqual(Array.from(feed, (r) => r.author_name), ["Alex Rivera · Electrician · Rivera Electric", "Job-site update", "Crew member", "Person — Company"]);
  assert.equal(feed[0].text, "Installed kitchen lighting and tested the circuits.", "work description stays in the daily log body");
  assert.equal(feed[0].author_id, "guest-named");
  assert.equal(feed[0].work_items.length, 0, "guest photo is not unallocated labor");
  assert.equal(feed[0].line_item_description, null);
  assert.equal(feed[2].author_id, "staff-id");
  assert.equal(feed[3].author_id, "sub-id");
  const album = await photos.getCrewJobPhotos(job);
  assert.equal(album[0].author_name, "Alex Rivera · Electrician · Rivera Electric");
  assert.equal(album[1].author_name, "Job-site update");
  assert.ok(selected.filter((q) => q.includes("photo_storage_paths")).every((q) => ["is_site_guest", "site_guest_name", "site_guest_trade", "site_guest_company"].every((field) => q.includes(field))));
  console.log("Passed: field feed and photo album show name, trade and company; work description stays in daily logs; legacy, staff/sub attribution and non-labor guest identity stay intact.");
})().catch((error) => { console.error(error); process.exitCode = 1; });
