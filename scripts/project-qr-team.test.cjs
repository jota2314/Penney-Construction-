/* eslint-disable @typescript-eslint/no-require-imports */
// Behavior tests with read-only mocked sessions; no browser or production writes.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");

function load(file, mocks = {}) {
  const code = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const result = { exports: {} };
  const importModule = (id) => {
    if (id === "server-only") return {};
    if (Object.hasOwn(mocks, id)) return mocks[id];
    return require(id);
  };
  new Function("require", "module", "exports", code)(importModule, result, result.exports);
  return result.exports;
}

const returnPaths = load("src/lib/auth/return-path.ts");
const { safeReturnPath, AUTH_RETURN_PATH_COOKIE, AUTH_RETURN_COOKIE_PATH } = returnPaths;
const visibility = load("src/lib/crew/crew-visibility.ts");
const sitePath = "/sub/j/ABCDEFGH";
const project = {
  id: "00000000-0000-4000-8000-000000000001", name: "Test job", project_number: "PC-2026-123",
  is_overhead: false, address: "123 Test St", city: "Salem", state: "MA", zip: "01970",
  latitude: null, longitude: null, scope_of_work: "Field work",
};
function teamLoader(user, row = project, error = null) {
  const calls = [];
  const query = {
    select(fields) { calls.push(["select", fields]); return this; },
    eq(key, value) { calls.push(["eq", key, value]); return this; },
    async maybeSingle() { return { data: row, error }; },
  };
  const loaded = load("src/lib/site-qr/team-job.ts", {
    "@/lib/auth/get-user": { getUser: async () => user },
    "@/lib/supabase/server": { createClient: async () => ({ from(table) { calls.push(["from", table]); return query; } }) },
    "@/lib/sub-portal/site-code": { normalizeSiteCode: (s) => s.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16) },
    "@/lib/crew/crew-visibility": visibility,
  });
  return { ...loaded, calls };
}
function findElement(element, type) {
  if (!element || typeof element !== "object") return null;
  if (element.type === type) return element;
  const children = element.props?.children;
  for (const child of Array.isArray(children) ? children : [children]) {
    const result = findElement(child, type);
    if (result) return result;
  }
  return null;
}

(async () => {
  assert.equal(safeReturnPath(sitePath), sitePath);
  assert.equal(safeReturnPath("/projects/123?tab=files#plans"), "/projects/123?tab=files#plans");
  for (const bad of [null, "https://outside.test/", "//outside.test", "/\\outside.test", "/%2foutside.test", "/%5coutside.test", "/%0aoutside.test", "javascript:alert(1)", "/bad%escape"]) {
    assert.equal(safeReturnPath(bad), null, `reject unsafe return path ${bad}`);
  }

  for (const user of [null, { profile: null }, { profile: { role: "unknown" } }]) {
    const check = teamLoader(user);
    assert.equal((await check.getTeamSiteJob("ABCDEFGH")).kind, user ? "unavailable" : "signed_out");
    assert.equal(check.calls.length, 0, "no project read without supported team identity");
  }
  const field = { profile: { role: "field" } };
  for (const [row, error] of [[null, null], [project, { message: "RLS denied" }], [{ ...project, is_overhead: true }, null]]) {
    assert.equal((await teamLoader(field, row, error).getTeamSiteJob("ABCDEFGH")).kind, "unavailable");
  }
  const invalid = teamLoader(field);
  assert.equal((await invalid.getTeamSiteJob("TOO-LONG-INVALID-CODE")).kind, "unavailable");
  assert.equal(invalid.calls.length, 0);

  for (const role of ["field", "owner", "precon_manager", "project_manager", "office_admin"]) {
    const check = teamLoader({ profile: { role } });
    const result = await check.getTeamSiteJob("abcdefgh");
    assert.equal(result.kind, "ready");
    assert.equal(result.job.id, project.id);
    assert.equal(result.backHref, role === "field" ? "/crew" : `/projects/${project.id}`);
    assert.equal(result.job.clocked_in, false, "scan does not clock in");
    assert.deepEqual(check.calls.map((c) => c[0]), ["from", "select", "eq"]);
    assert.deepEqual(check.calls.at(-1), ["eq", "site_code", "ABCDEFGH"]);
    assert.ok(!/price|cost|budget|invoice|contract_amount/.test(check.calls[1][1]));
  }

  const route = async (team) => load("src/app/sub/j/[code]/page.tsx", {
    "next/link": "Link",
    "@/components/sub-portal/site-join": { SiteJoin: "SiteJoin" },
    "@/components/crew/crew-job-folder": { CrewJobFolder: "CrewJobFolder" },
    "@/components/site-qr/guest-site-photos": { GuestSitePhotos: "GuestSitePhotos" },
    "@/components/portal-kit": { PortalTheme: "PortalTheme", PortalHeader: "PortalHeader" },
    "@/lib/supabase/admin": {},
    "@/lib/sub-portal/site-code": {},
    "@/components/schedule/upload-queue-banner": { UploadQueueBanner: "UploadQueueBanner" },
    "@/lib/site-qr/team-job": { getTeamSiteJob: async () => team },
  }).default({ params: Promise.resolve({ code: "ABCDEFGH" }), searchParams: Promise.resolve({ tools: "1" }) });
  const publicPage = await route({ kind: "signed_out" });
  assert.equal(publicPage.type, "SiteJoin");
  assert.deepEqual(publicPage.props, { code: "ABCDEFGH" }, "public route has no project documents or prices");
  assert.equal(findElement(publicPage, "UploadQueueBanner"), null, "public portal cannot resume team uploads");
  const ready = await teamLoader(field).getTeamSiteJob("ABCDEFGH");
  const folder = findElement(await route(ready), "CrewJobFolder");
  assert.equal(folder.props.initialJobId, project.id);
  assert.equal(folder.props.siteMode, true);
  assert.deepEqual(folder.props.jobs, [ready.job]);
  assert.ok(findElement(await route(ready), "UploadQueueBanner"), "team route resumes and retries photo uploads");
  assert.equal(findElement(await route({ kind: "unavailable" }), "CrewJobFolder"), null);

  let oauthOptions;
  let returnCookie;
  const actions = load("src/lib/auth/actions.ts", {
    "next/navigation": { redirect(url) { throw new Error(`redirect:${url}`); } },
    "next/headers": {
      headers: async () => new Headers({ host: "www.penneyconstruction.build" }),
      cookies: async () => ({ set: (...args) => { returnCookie = args; } }),
    },
    "@/lib/supabase/server": { createClient: async () => ({ auth: { signInWithOAuth: async (args) => {
      oauthOptions = args.options; return { data: { url: "https://accounts.example/oauth" }, error: null };
    } } }) },
    "@/lib/sub-portal/auth": {},
    "@/lib/auth/return-path": returnPaths,
  });
  await assert.rejects(actions.signInWithGoogle(sitePath), /redirect:/);
  assert.equal(oauthOptions.redirectTo, "https://www.penneyconstruction.build/auth/callback", "registered callback stays fixed");
  assert.deepEqual(returnCookie, [AUTH_RETURN_PATH_COOKIE, sitePath, {
    httpOnly: true, secure: true, sameSite: "lax", path: AUTH_RETURN_COOKIE_PATH, maxAge: 600,
  }]);
  await assert.rejects(actions.signInWithGoogle(), /redirect:/);
  assert.equal(oauthOptions.redirectTo, "https://www.penneyconstruction.build/auth/callback");
  assert.equal(returnCookie[2].maxAge, 0, "normal login clears an earlier QR return");
  await assert.rejects(actions.signInWithGoogle("//outside.test"), /redirect:/);
  assert.equal(new URL(oauthOptions.redirectTo).search, "");
  assert.equal(returnCookie[1], "");
  assert.equal(returnCookie[2].maxAge, 0);

  let cookieValue = sitePath;
  let exchangeError = null;
  const callback = load("src/app/(auth)/auth/callback/route.ts", {
    "next/server": { NextResponse: { redirect(url) {
      return { url, clearedCookies: [], cookies: { set(...args) { this.saved = args; } } };
    } } },
    "next/headers": { cookies: async () => ({ get: () => ({ value: cookieValue }) }) },
    "@/lib/supabase/server": { createClient: async () => ({ auth: {
      exchangeCodeForSession: async () => ({ data: { session: null }, error: exchangeError }),
    } }) },
    "@/lib/auth/return-path": returnPaths,
  });
  const completed = await callback.GET(new Request("https://www.penneyconstruction.build/auth/callback?code=test"));
  assert.equal(completed.url, `https://www.penneyconstruction.build${sitePath}`);
  assert.equal(completed.cookies.saved[0], AUTH_RETURN_PATH_COOKIE);
  assert.equal(completed.cookies.saved[2].maxAge, 0, "return consumed after successful callback");
  cookieValue = "//outside.test";
  assert.equal((await callback.GET(new Request("https://www.penneyconstruction.build/auth/callback?code=test"))).url,
    "https://www.penneyconstruction.build/command-center");
  cookieValue = sitePath;
  exchangeError = { message: "expired code" };
  const failed = await callback.GET(new Request("https://www.penneyconstruction.build/auth/callback?code=test"));
  assert.equal(failed.cookies.saved[2].maxAge, 0, "failed callback clears stale return");
  console.log("Passed: project QR team identity, RLS reads, safe OAuth return, scanned project selection, no scan writes.");
})().catch((error) => { console.error(error); process.exitCode = 1; });
