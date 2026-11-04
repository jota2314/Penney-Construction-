/* eslint-disable @typescript-eslint/no-require-imports */
// Runs the real server actions against an in-memory DB. No emails or network writes.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

function fixture({ role = "owner", phone = null, access = null, testMode = false } = {}) {
  const sub = { id: "sub-1", company_name: "Plumbing Company", contact_name: "Victor", phone, email: "directory@example.com" };
  const tables = { subcontractors: [sub], sub_portal_access: access ? [{ id: "access-1", subcontractor_id: sub.id, token: "private-token", pin_hash: "private-hash", google_email: null, google_subject: null, enabled: true, view_count: 0, ...access }] : [], app_settings: [], email_logs: [] };
  const emails = [];
  const writes = [];
  class Query {
    constructor(table) { this.table = table; this.filters = []; this.mode = "select"; }
    select() { return this; }
    eq(k, v) { this.filters.push(row => row[k] === v); return this; }
    neq(k, v) { this.filters.push(row => row[k] !== v); return this; }
    is(k, v) { this.filters.push(row => row[k] === v); return this; }
    limit() { return this; }
    single() { this.one = true; this.required = true; return this; }
    maybeSingle() { this.one = true; return this; }
    insert(value) { this.mode = "insert"; this.value = value; return this; }
    update(value) { this.mode = "update"; this.value = value; return this; }
    then(resolve, reject) {
      try {
        let selected = tables[this.table].filter(row => this.filters.every(filter => filter(row)));
        if (this.mode !== "select") {
          if (this.value.google_email && tables[this.table].some(row => (this.mode === "insert" || !selected.includes(row)) && row.google_email === this.value.google_email)) {
            return Promise.resolve({ data: null, error: { code: "23505" } }).then(resolve, reject);
          }
          writes.push({ table: this.table, mode: this.mode, value: structuredClone(this.value) });
          if (this.mode === "insert") {
            selected = [{ id: "new-access", token: "private-token", enabled: true, google_subject: null, google_email: null, phone_login: null, pin_hash: null, view_count: 0, ...structuredClone(this.value) }];
            tables[this.table].push(...selected);
          } else selected.forEach(row => Object.assign(row, structuredClone(this.value)));
        }
        const error = this.required && !selected.length ? { code: "PGRST116" } : null;
        return Promise.resolve({ data: structuredClone(this.one ? selected[0] ?? null : selected), error }).then(resolve, reject);
      } catch (error) { return Promise.reject(error).then(resolve, reject); }
    }
  }
  const mocks = {
    "@/lib/auth/require-auth": { requireAuth: async () => ({ id: "office-1", email: "office@example.com", profile: { role, full_name: "Office User" } }) },
    "@/lib/supabase/admin": { createAdminClient: () => ({ from: table => new Query(table) }) },
    "@/lib/sub-portal/auth": { formatPhone: n => n, normalizePhone: n => n.replace(/\D/g, ""), hashPin: () => "hashed-new-pin" },
    "@/lib/sub-portal/et-day": {},
    "@/lib/finance/spend-category": {},
    "@/lib/google/gmail": { sendEmail: async email => { emails.push(email); return { id: "mock-message" }; } },
    "@/lib/notifications/test-mode": { TEST_MODE_RECIPIENT_EMAILS: ["tester@example.com"], isNotificationTestMode: async () => testMode, testModeSubject: title => `[TEST] ${title}` },
  };
  const context = { exports: {}, Date, console, require: name => name in mocks ? mocks[name] : require(name) };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/lib/actions/sub-portal.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, context);
  return { actions: context.exports, tables, writes, emails };
}

test("only office roles can grant a Google login", async () => {
  const f = fixture({ role: "field" });
  const result = await f.actions.setSubGoogleEmail("sub-1", "victor@gmail.com");
  assert.match(result.error, /Only the office/);
  assert.equal(f.writes.length, 0);
});

test("explicit Google setup normalizes email and needs no phone or PIN", async () => {
  const f = fixture();
  const result = await f.actions.setSubGoogleEmail("sub-1", " VICTOR@gmail.com ");
  assert.equal(result.status.google_email, "victor@gmail.com");
  assert.equal(result.status.has_pin, false);
  assert.equal(f.tables.sub_portal_access[0].created_by, "office-1");
  assert.equal("token" in result.status, false);
  assert.equal("pin_hash" in result.status, false);
  assert.equal(f.emails.length, 0);
});

test("changing Google email clears its subject but preserves PIN and bearer token", async () => {
  const f = fixture({ access: { google_email: "old@gmail.com", google_subject: "old-subject" } });
  await f.actions.setSubGoogleEmail("sub-1", "new@gmail.com");
  const row = f.tables.sub_portal_access[0];
  assert.equal(row.google_subject, null);
  assert.equal(row.pin_hash, "private-hash");
  assert.equal(row.token, "private-token");
  assert.equal(row.enabled, true);
});

test("re-saving the same Google email keeps the bound subject", async () => {
  const f = fixture({ access: { google_email: "victor@gmail.com", google_subject: "google-subject" } });
  await f.actions.setSubGoogleEmail("sub-1", "VICTOR@gmail.com");
  assert.equal(f.tables.sub_portal_access[0].google_subject, "google-subject");
});

test("disabled portals cannot be reactivated by setting Google email", async () => {
  const f = fixture({ access: { enabled: false } });
  assert.match((await f.actions.setSubGoogleEmail("sub-1", "victor@gmail.com")).error, /turned off/);
  assert.equal(f.writes.length, 0);
});

test("duplicate Google accounts are not transferred between subs", async () => {
  const f = fixture();
  f.tables.sub_portal_access.push({ id: "another-access", subcontractor_id: "another-sub", google_email: "victor@gmail.com" });
  assert.match((await f.actions.setSubGoogleEmail("sub-1", "victor@gmail.com")).error, /already belongs/);
  assert.equal(f.writes.length, 0);
});

test("Google invite uses the authorized email without a cell or PIN", async () => {
  const f = fixture({ access: { google_email: "victor@gmail.com", pin_hash: null } });
  const { preview } = await f.actions.previewSubInvite("sub-1", "email");
  assert.equal(preview.problems.length, 0);
  assert.equal(preview.email, "victor@gmail.com");
  assert.match(preview.email_body, /Continue with Google/);
  assert.match(preview.email_body, /victor@gmail.com/);
  assert.doesNotMatch(preview.email_body, /PIN:|Cell:/);
  const { result } = await f.actions.inviteSubToPortal("sub-1", { channel: "copy" });
  assert.equal(result.google_email, "victor@gmail.com");
  assert.equal(result.pin, null);
  assert.equal(result.stamped, true);
  assert.equal(f.tables.sub_portal_access[0].pin_hash, null);
  assert.equal(f.emails.length, 0);
});

test("Google text invitations still require a cell", async () => {
  const f = fixture({ access: { google_email: "victor@gmail.com" } });
  const { preview } = await f.actions.previewSubInvite("sub-1", "text");
  assert.match(preview.problems[0], /Add a cell/);
  assert.match((await f.actions.inviteSubToPortal("sub-1", { channel: "text" })).error, /Add a cell/);
  assert.equal(f.writes.length, 0);
});

test("email test mode leaves a real sub's Google access and invite stamp alone", async () => {
  const f = fixture({ testMode: true, access: { google_email: "victor@gmail.com", google_subject: "bound-subject", link_sent_at: "before" } });
  const { result } = await f.actions.inviteSubToPortal("sub-1", { channel: "email" });
  assert.equal(result.stamped, false);
  assert.equal(f.emails[0].to, "tester@example.com");
  assert.equal(f.tables.sub_portal_access[0].link_sent_at, "before");
  assert.equal(f.tables.sub_portal_access[0].google_subject, "bound-subject");
  assert.equal(f.writes.filter(w => w.table === "sub_portal_access").length, 0);
});

test("legacy PIN invitations still create a PIN and tell the sub how to sign in", async () => {
  const f = fixture({ phone: "9785550100", access: { pin_hash: null } });
  const { result } = await f.actions.inviteSubToPortal("sub-1", { channel: "copy" });
  assert.match(result.pin, /^\d{4}$/);
  assert.match(result.text, /PIN:/);
  assert.equal(result.google_email, null);
  assert.equal(f.tables.sub_portal_access[0].pin_hash, "hashed-new-pin");
});
