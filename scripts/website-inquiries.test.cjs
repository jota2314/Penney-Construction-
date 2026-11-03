const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const ts = require("typescript");

function load(file, imports = {}, extras = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require(id) { if (!(id in imports)) throw new Error(`Unmocked import ${id}`); return imports[id]; }, Date, Intl, console, ...extras });
  return exports;
}
const days = load("src/lib/sub-portal/et-day.ts");
const model = load("src/lib/inquiries/model.ts", { "@/lib/sub-portal/et-day": days });
const id = "11111111-1111-4111-a111-111111111111";
const leadId = "22222222-2222-4222-a222-222222222222";
const stamp = "2026-11-03T15:00:00Z";
const row = { id, description: "WEBSITE INQUIRY — ADU in Beverly\nName: A Homeowner\nEmail: homeowner@example.com\nConfigurator: cottage", contact_name: "A Homeowner", status: "open", intake_status: null, due_date: "2026-11-02T22:00:00Z", snooze_until: null, website_inquiry: null };

assert.equal(model.inquiryText(row, "email"), "homeowner@example.com");
assert.equal(model.inquiryText(row, "projectType"), "adu");
assert.equal(model.inquiryText(row, "town"), "Beverly");
assert.equal(model.inquiryText({ ...row, website_inquiry: { email: "updated@example.com" } }, "email"), "updated@example.com");
assert.equal(model.intakeStatus({ ...row, status: "done" }), "closed");
assert.equal(model.isOverdueInquiry(row, Date.parse(stamp)), true);
assert.equal(model.isOverdueInquiry({ ...row, status: "snoozed", snooze_until: "2026-11-04T22:00:00Z" }, Date.parse(stamp)), false);
assert.equal(model.isOverdueInquiry({ ...row, intake_status: "qualified" }, Date.parse(stamp)), false);
assert.equal(model.inquiryDueIso("2026-03-08"), "2026-03-08T21:00:00.000Z");
assert.equal(model.inquiryDueIso("2026-11-01"), "2026-11-01T22:00:00.000Z");
assert.equal(model.inquiryDueIso("2026-02-30"), null);
for (const role of [null, "field", "project_manager", "authenticated"]) assert.equal(model.canManageWebsiteInquiries(role), false);
for (const role of ["owner", "office_admin", "precon_manager"]) assert.equal(model.canManageWebsiteInquiries(role), true);

let state;
const db = {
  from(table) {
    assert.equal(table, "profiles");
    return { select() { return this; }, async in() { return { data: [{ full_name: "Shannon Penney" }, { full_name: "Jorge Betancur" }], error: null }; } };
  },
  async rpc(name, args) { state.calls.push({ name, args }); return state.response; },
};
const actions = load("src/lib/actions/website-inquiries.ts", {
  "next/cache": { revalidatePath: (path) => state.invalidations.push(path) },
  "@/lib/auth/get-user": { getUser: async () => state.user },
  "@/lib/supabase/server": { createClient: async () => { state.clients++; return db; } },
  "@/lib/supabase/fetch-all": {},
  "@/lib/inquiries/model": model,
});
function reset(patch = {}) {
  state = { user: { id, profile: { role: "owner" }, realProfile: { role: "owner" }, isImpersonating: false }, calls: [], invalidations: [], clients: 0, response: { data: { id, updated_at: stamp }, error: null }, ...patch };
}
const input = { id, expectedUpdatedAt: stamp, status: "new", assignee: "Shannon", dueDay: "2026-11-04" };

(async () => {
  reset(); assert.equal((await actions.updateWebsiteInquiry(input)).error, null);
  assert.equal(state.calls.length, 1); assert.equal(state.calls[0].name, "update_website_inquiry");
  assert.equal(state.calls[0].args.p_expected_updated_at, stamp);
  assert.equal(state.calls[0].args.p_due_date, "2026-11-04T22:00:00.000Z");
  assert.ok(state.invalidations.includes("/command-center/inquiries"));
  for (const patch of [{ dueDay: "" }, { dueDay: "2026-02-30" }, { assignee: "Unknown" }, { status: "deleted" }, { expectedUpdatedAt: "" }, { id: "not-an-id" }]) {
    reset(); assert.ok((await actions.updateWebsiteInquiry({ ...input, ...patch })).error); assert.equal(state.calls.length, 0);
  }
  for (const user of [null, { profile: { role: "owner" }, realProfile: { role: "field" } }, { profile: { role: "field" }, realProfile: { role: "owner" } }, { profile: { role: "owner" }, realProfile: { role: "owner" }, isImpersonating: true }]) {
    reset({ user }); assert.ok((await actions.updateWebsiteInquiry(input)).error); assert.equal(state.calls.length, 0); assert.equal(state.clients, 0);
    assert.ok((await actions.convertWebsiteInquiry(id)).error); assert.equal(state.calls.length, 0);
  }
  reset({ response: { data: null, error: { message: "Inquiry changed; refresh before editing" } } });
  assert.match((await actions.updateWebsiteInquiry(input)).error, /changed/); assert.equal(state.invalidations.length, 0);
  reset({ response: { data: leadId, error: null } });
  assert.equal((await actions.convertWebsiteInquiry(id)).leadId, leadId);
  assert.equal(state.calls[0].name, "convert_website_inquiry_to_lead"); assert.equal(state.calls[0].args.p_todo_id, id);
  assert.equal(state.calls[0].args.p_existing_lead_id, null);
  reset({ response: { data: leadId, error: null } });
  assert.equal((await actions.convertWebsiteInquiry(id, leadId)).leadId, leadId);
  assert.equal(state.calls[0].args.p_existing_lead_id, leadId);
  reset(); assert.ok((await actions.convertWebsiteInquiry(id, "invalid")).error); assert.equal(state.calls.length, 0);
  reset(); assert.ok((await actions.convertWebsiteInquiry("invalid")).error); assert.equal(state.calls.length, 0);

  const env = { CRON_SECRET: "test-secret" };
  let reminders = 0;
  const cron = load("src/app/api/cron/website-inquiries/route.ts", {
    "next/server": { NextResponse: { json: (body, options) => Response.json(body, options) } },
    "@/lib/supabase/admin": { createAdminClient: () => ({ rpc: async (name) => { assert.equal(name, "remind_website_inquiries"); reminders++; return { data: 2, error: null }; } }) },
  }, { process: { env }, Request, Response });
  assert.equal((await cron.GET(new Request("https://example.com/api/cron/website-inquiries"))).status, 401); assert.equal(reminders, 0);
  const res = await cron.GET(new Request("https://example.com/api/cron/website-inquiries", { headers: { authorization: "Bearer test-secret" } }));
  assert.equal((await res.json()).reminders, 2); assert.equal(reminders, 1);
  delete env.CRON_SECRET;
  assert.equal((await cron.GET(new Request("https://example.com/api/cron/website-inquiries", { headers: { authorization: "Bearer undefined" } }))).status, 401); assert.equal(reminders, 1);
  console.log("PASS: legacy intake visibility, status/snooze handling, ET deadlines across DST, office/impersonation guards, optimistic RPC forwarding, validation, human-only lead conversion, and cron secret protection.");
})().catch((error) => { console.error(error); process.exit(1); });
