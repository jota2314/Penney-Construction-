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
const allowedEmails = ["jbetancur@penneyconstructioninc.com", "jorgebetancurfx@gmail.com", "rpenney@penneyconstructioninc.com", "nsmith@penneyconstructioninc.com", "spenney@penneyconstructioninc.com"];
const deniedEmails = [null, "", "owner", "office_admin", "precon_manager", "bcrowley@penneyconstructioninc.com", "lrueda@penneyconstructioninc.com", "another-owner@example.com"];
for (const email of deniedEmails) assert.equal(model.canManageWebsiteInquiries(email), false);
for (const email of allowedEmails) {
  assert.equal(model.canManageWebsiteInquiries(email), true);
  assert.equal(model.canManageWebsiteInquiries(`  ${email.toUpperCase()}  `), true);
}
const roleAccess = load("src/lib/auth/role-access.ts", {
  "@/lib/marketing/access": load("src/lib/marketing/access.ts"),
  "@/lib/inquiries/model": model,
});
for (const role of ["owner", "office_admin", "precon_manager", "project_manager", "field"]) {
  for (const email of [...allowedEmails, ...deniedEmails]) {
    for (const path of ["/command-center/inquiries", `/command-center/inquiries/${id}`]) {
      assert.equal(roleAccess.canAccessPath({ role, email }, path), allowedEmails.includes(email), `${role} ${email} ${path}`);
    }
  }
}

let state;
const db = {
  from(table) {
    assert.equal(table, "profiles");
    return { select() { return this; }, async in(column, values) {
      assert.equal(column, "email");
      assert.equal(JSON.stringify(values), JSON.stringify(allowedEmails));
      return { data: [{ full_name: "Shannon Penney" }, { full_name: "Jorge Betancur" }], error: null };
    } };
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
  state = { user: { id, profile: { role: "owner", email: allowedEmails[0] }, realProfile: { role: "owner", email: allowedEmails[0] }, isImpersonating: false }, calls: [], invalidations: [], clients: 0, response: { data: { id, updated_at: stamp }, error: null }, ...patch };
}
const input = { id, expectedUpdatedAt: stamp, status: "new", assignee: "Shannon", dueDay: "2026-11-04" };

const queries = [];
const scopedDb = {
  from(table) {
    const query = { table, filters: [] };
    queries.push(query);
    const builder = {
      select() { return this; }, order() { return this; }, limit() { return this; },
      eq(column, value) { query.filters.push(["eq", column, value]); return this; },
      is(column, value) { query.filters.push(["is", column, value]); return this; },
      or(value) { query.filters.push(["or", value]); return this; },
      then(resolve) { return Promise.resolve({ data: [], count: 0, error: null }).then(resolve); },
    };
    return builder;
  },
};
const scopedImports = {
  "next/cache": { revalidatePath() {} },
  "@/lib/auth/get-user": { getUser: async () => state.user },
  "@/lib/supabase/server": { createClient: async () => scopedDb },
  "@/lib/inquiries/model": model,
};
const todoActions = load("src/lib/actions/command-center.ts", {
  ...scopedImports,
  "@/lib/actions/notify-assignee": {},
  "@/lib/subs/resolve-subcontractor": {},
});
const notificationActions = load("src/lib/actions/notifications.ts", { ...scopedImports, zod: { z: {} } });

(async () => {
  reset(); assert.equal((await actions.updateWebsiteInquiry(input)).error, null);
  assert.equal(state.calls.length, 1); assert.equal(state.calls[0].name, "update_website_inquiry");
  assert.equal(state.calls[0].args.p_expected_updated_at, stamp);
  assert.equal(state.calls[0].args.p_due_date, "2026-11-04T22:00:00.000Z");
  assert.ok(state.invalidations.includes("/command-center/inquiries"));
  for (const patch of [{ dueDay: "" }, { dueDay: "2026-02-30" }, { assignee: "Unknown" }, { status: "deleted" }, { expectedUpdatedAt: "" }, { id: "not-an-id" }]) {
    reset(); assert.ok((await actions.updateWebsiteInquiry({ ...input, ...patch })).error); assert.equal(state.calls.length, 0);
  }
  const deniedUsers = [null,
    { profile: { role: "owner", email: allowedEmails[0] }, realProfile: { role: "owner", email: "another-owner@example.com" } },
    { profile: { role: "owner", email: "another-owner@example.com" }, realProfile: { role: "owner", email: allowedEmails[0] } },
    ...deniedEmails.map((email) => ({ profile: { role: "owner", email }, realProfile: { role: "owner", email } })),
  ];
  for (const user of deniedUsers) {
    reset({ user }); assert.ok((await actions.updateWebsiteInquiry(input)).error); assert.equal(state.calls.length, 0); assert.equal(state.clients, 0);
    assert.ok((await actions.convertWebsiteInquiry(id)).error); assert.equal(state.calls.length, 0);
    for (const read of [() => actions.listWebsiteInquiries(), () => actions.getWebsiteInquirySummary(), () => actions.getWebsiteInquiry(id), () => actions.listInquiryAssignees(), () => actions.listMatchingInquiryLeads(id)]) {
      await assert.rejects(read, /only to Jorge, Ryan, Nico, and Shannon/);
      assert.equal(state.clients, 0);
    }
  }
  for (const email of allowedEmails) {
    reset({ user: { profile: { role: "owner", email }, realProfile: { role: "owner", email }, isImpersonating: false } });
    assert.equal((await actions.updateWebsiteInquiry(input)).error, null);
    assert.equal(state.calls.length, 1);
  }
  reset({ user: { profile: { email: allowedEmails[2] }, realProfile: { email: allowedEmails[0] }, isImpersonating: true } });
  assert.ok((await actions.updateWebsiteInquiry(input)).error); assert.equal(state.clients, 0);
  assert.ok((await actions.convertWebsiteInquiry(id)).error); assert.equal(state.clients, 0);
  assert.equal((await actions.listInquiryAssignees()).join(","), "Jorge,Shannon");
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

  for (const user of [
    { id, profile: { id, email: allowedEmails[0] }, realProfile: { email: allowedEmails[0] } },
    { id, profile: { id: leadId, email: "another-owner@example.com" }, realProfile: { email: allowedEmails[0] }, isImpersonating: true },
    { id, profile: { id, email: "another-owner@example.com" }, realProfile: { email: "another-owner@example.com" } },
  ]) {
    reset({ user }); queries.length = 0;
    await todoActions.getTodos();
    await todoActions.getTodoCategoryCounts();
    await notificationActions.listMyNotifications();
    const excluded = user.profile.email === "another-owner@example.com";
    assert.equal(queries.length, 4);
    for (const query of queries) {
      const filter = query.table === "todos" ? "source.is.null,source.neq.website" : "source_type.is.null,and(source_type.neq.website_inquiry,source_type.neq.website_inquiry_overdue)";
      assert.equal(query.filters.some(([op, value]) => op === "or" && value === filter), excluded, `filter ${query.table} during View as`);
      if (query.table === "app_notifications") assert.ok(query.filters.some(([op, column, value]) => op === "eq" && column === "recipient_profile_id" && value === user.profile.id));
    }
  }

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
  console.log("PASS: exact inquiry allowlist across roles and routes, read/write and View as guards, assignee allowlist, legacy intake, deadlines, RPC validation, lead conversion, and cron protection.");
})().catch((error) => { console.error(error); process.exit(1); });
