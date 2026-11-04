/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");

function load(file, mocks, extra = "") {
  const code = ts.transpileModule(fs.readFileSync(file, "utf8") + extra, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  new Function("require", "exports", code)(name => {
    if (name in mocks) return mocks[name];
    if (name === "server-only" || name.startsWith("@/") || name.startsWith("./")) return {};
    return require(name);
  }, exports);
  return exports;
}

function harness({ phoneLogin = null, googleEmail = "invited@gmail.com", pinHash = null, enabled = true } = {}) {
  const sub = { id: "sub-1", company_name: "Trade Company", legal_name: null, contact_name: "Victor", phone: "9785550100", aliases: [], is_active: true };
  const access = { id: "access-1", subcontractor_id: sub.id, google_email: googleEmail, phone_login: phoneLogin, pin_hash: pinHash, enabled, created_by: "office-1", created_at: "2020-01-01" };
  const tables = { subcontractors: [sub], sub_portal_access: [access] };
  const writes = [];
  let sessionCount = 0;
  class Query {
    constructor(table) { this.rows = tables[table] ?? []; this.filters = []; }
    select() { return this; }
    eq(key, value) { this.filters.push(row => row[key] === value); return this; }
    is(key, value) { return this.eq(key, value); }
    gte(key, value) { this.filters.push(row => row[key] >= value); return this; }
    in(key, values) { this.filters.push(row => values.includes(row[key])); return this; }
    not(key, op, value) { assert.equal(op, "is"); this.filters.push(row => row[key] !== value); return this; }
    ilike(key, pattern) { this.filters.push(row => row[key]?.includes(pattern.replaceAll("%", ""))); return this; }
    or(expression) {
      const keys = expression.split(",").map(item => item.split(".")[0]);
      this.filters.push(row => keys.some(key => row[key] !== null && row[key] !== undefined));
      return this;
    }
    limit() { return this; }
    order() { return this; }
    maybeSingle() { this.one = true; return this; }
    insert(value) { writes.push(value); throw new Error("QR must not create another account"); }
    update(value) { writes.push(value); throw new Error("QR must not change existing access"); }
    then(resolve, reject) {
      const selected = this.rows.filter(row => this.filters.every(filter => filter(row)));
      return Promise.resolve({ data: this.one ? selected[0] ?? null : selected, count: selected.length, error: null }).then(resolve, reject);
    }
  }
  const db = { from: table => new Query(table) };
  const mocks = {
    "next/server": { NextResponse: { json: (body, options) => ({ body, status: options?.status ?? 200 }) }, after: () => {} },
    "@/lib/sub-portal/auth": { getSubPortalClient: () => db, normalizePhone: n => n.replace(/\D/g, ""), formatPhone: n => n, setSubPortalCookie: () => { sessionCount += 1; } },
    "@/lib/sub-portal/staff-guard": { refuseStaffBrowser: async () => null },
    "@/lib/sub-portal/site-code": {
      findProjectBySiteCode: async () => ({ id: "job-1", name: "Job", project_number: "PC-001" }),
      isSiteOpen: () => true,
      firstNameOf: name => name?.split(" ")[0] ?? null,
      normalizeCompanyName: name => name.toLowerCase().trim(),
    },
    "@/lib/portal-kit/format": { fmtShort: value => value },
  };
  const api = load("src/app/api/sub-portal/site/route.ts", mocks);
  const preview = load("src/lib/sub-portal/load-sub-portal-data.ts", mocks,
    "\nexport { loadPreviewAccess as previewAccessForTest, previewMeta as previewMetaForTest };\n");
  return { db, api, preview, writes, sessions: () => sessionCount };
}

const signup = (phone = "9785550199") => ({ json: async () => ({ action: "signup", code: "SITE", name: "Victor", company: "Trade Company", phone, pin: "2468" }) });

test("QR recognizes an invited Google company without creating a PIN, account or session", async () => {
  const h = harness();
  const result = await h.api.POST(signup());
  assert.equal(result.status, 200);
  assert.equal(result.body.known.hasLogin, true);
  assert.equal(result.body.known.sameFirstName, true);
  assert.equal(h.sessions(), 0);
  assert.equal(h.writes.length, 0);
  assert.equal(JSON.stringify(result).includes("invited@gmail.com"), false);
});

test("QR matching a Google-only login phone tells the user to authenticate", async () => {
  const h = harness({ phoneLogin: "9785550100" });
  const result = await h.api.POST(signup("9785550100"));
  assert.equal(result.status, 409);
  assert.equal(result.body.hasLogin, true);
  assert.match(result.body.error, /Google account/);
  assert.equal(h.sessions(), 0);
  assert.equal(h.writes.length, 0);
});

test("QR matching a directory phone respects Google login and disabled access", async () => {
  for (const enabled of [true, false]) {
    const h = harness({ enabled });
    const result = await h.api.POST(signup("9785550100"));
    assert.equal(result.status, 409);
    assert.equal(result.body.hasLogin, enabled);
    assert.match(result.body.error, enabled ? /Google account/ : /turned off/);
    assert.equal(h.sessions(), 0);
    assert.equal(h.writes.length, 0);
  }
});

test("staff preview identifies Google-only access without warning of a missing PIN", async () => {
  const h = harness();
  const access = await h.preview.previewAccessForTest(h.db, "sub-1");
  const meta = h.preview.previewMetaForTest("Trade Company", access);
  assert.match(meta.detail, /Google sign-in ready/);
  assert.doesNotMatch(meta.detail, /No PIN|No login method/);
  assert.equal(meta.pin_set, false);
});

test("staff preview still reports PIN-only and unconfigured login states accurately", async () => {
  for (const [pinHash, expected] of [["hash", /PIN set/], [null, /No login method yet/]]) {
    const h = harness({ googleEmail: null, pinHash });
    const access = await h.preview.previewAccessForTest(h.db, "sub-1");
    assert.match(h.preview.previewMetaForTest("Trade Company", access).detail, expected);
  }
});
