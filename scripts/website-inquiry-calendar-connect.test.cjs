// Calendar connection status, the Connect Google Calendar action and lead-source labels.
// Google, Supabase and the database are mocked. Nothing is sent and no account is touched.
const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const ts = require("typescript");
const jsx = require("react/jsx-runtime");

const NOW = Date.parse("2026-11-14T15:00:00Z");
class FixedDate extends Date {
  constructor(...args) { super(...(args.length ? args : [NOW])); }
  static now() { return NOW; }
}
function load(file, imports, extras = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { exports, require(id) { if (!(id in imports)) throw new Error(`Unmocked import ${id}`); return imports[id]; },
    Date: FixedDate, Intl, URL, URLSearchParams, Headers, Response, Request, AbortSignal, Error, Set, console, ...extras });
  return exports;
}
const RYAN = "rpenney@penneyconstructioninc.com";
const day = load("src/lib/sub-portal/et-day.ts", {});
const time = load("src/lib/inquiries/calendar-time.ts", { "@/lib/sub-portal/et-day": day });
const model = load("src/lib/inquiries/model.ts", { "@/lib/sub-portal/et-day": day });

// ---- Lead source on the card -------------------------------------------------------------
const lead = (source, heardAbout) => ({ website_inquiry: { source, heardAbout } });
assert.deepEqual({ ...model.inquirySource(lead({ referrer: "", utmSource: "chatgpt.com" }, "")) }, { label: "ChatGPT", ai: true }, "a ChatGPT link has a UTM tag and no referrer");
assert.deepEqual({ ...model.inquirySource(lead({ referrer: "www.perplexity.ai" }, "Google search")) }, { label: "Perplexity", ai: true }, "an AI referrer outranks the self-report");
assert.deepEqual({ ...model.inquirySource(lead({ referrer: "" }, "ChatGPT / AI assistant")) }, { label: "AI assistant", ai: true });
assert.deepEqual({ ...model.inquirySource(lead({ referrer: "www.google.com" }, "Referral from a friend or past client")) }, { label: "Referral", ai: false }, "what the homeowner said outranks the search they used to find the site");
assert.deepEqual({ ...model.inquirySource(lead({ referrer: "www.google.com" }, "Saw a job sign or truck")) }, { label: "Job sign or truck", ai: false });
assert.deepEqual({ ...model.inquirySource(lead({ referrer: "www.google.com" }, "(not answered)")) }, { label: "Google", ai: false });
assert.deepEqual({ ...model.inquirySource(lead({ referrer: "www.google.com" }, "Other")) }, { label: "Google", ai: false });
assert.equal(model.inquirySource(lead({ referrer: "", utmSource: "" }, "")), null, "unknown stays blank instead of guessing");
assert.equal(model.inquirySource({ website_inquiry: null }), null);
assert.equal(model.inquiryDayLabel("2026-11-13T22:00:00Z"), "Nov 13");
assert.equal(model.inquiryDayLabel(null), "Not set");
assert.equal(model.isRyan(" RPenney@PenneyConstructionInc.com "), true);
assert.equal(model.isRyan("jbetancur@penneyconstructioninc.com"), false);

// ---- What the calendar check tells the office to do ----------------------------------------
let state;
const reset = (patch = {}) => { state = { refresh: "test-refresh", profileEmail: RYAN, primary: RYAN, ...patch }; };
const db = { from(table) {
  const result = () => table === "profiles" ? { data: { email: state.profileEmail, google_refresh_token: state.refresh }, error: null } :
    table === "website_walkthrough_bookings" ? { data: [], error: null } :
      { data: [{ key: "google_client_id", value: "test-id" }, { key: "google_client_secret", value: "test-secret" }], error: null };
  const query = { select: () => query, eq: () => query, in: () => query, lt: () => query, gt: () => query,
    maybeSingle: async () => result(), then: (resolve) => Promise.resolve(result()).then(resolve) };
  return query;
} };
const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
async function mockFetch(url) {
  if (url === "https://oauth2.googleapis.com/token") return state.tokenError ? reply({ error: state.tokenError }, 400) : reply({ access_token: "test-access" });
  const path = new URL(url).pathname;
  if (path.endsWith("/calendars/primary")) {
    if (state.timeout) throw Object.assign(new Error("slow"), { name: "TimeoutError" });
    return state.primaryError ? reply({ error: { errors: [{ reason: state.primaryError }] } }, 403) : reply({ id: state.primary });
  }
  if (path.endsWith("/users/me/calendarList")) return reply({ items: [{ id: RYAN, primary: true }] });
  if (path.endsWith("/freeBusy")) return reply({ calendars: { [RYAN]: { busy: [] } } });
  throw new Error(`Unexpected network call: ${url}`);
}
const calendar = load("src/lib/inquiries/calendar.ts", {
  "server-only": {}, "node:crypto": crypto, "@/lib/supabase/admin": { createAdminClient: () => db },
  "@/lib/sub-portal/et-day": day, "@/lib/inquiries/calendar-time": time,
}, { process: { env: {} }, fetch: mockFetch });

// ---- The Connect Google Calendar action ---------------------------------------------------
const returnPaths = load("src/lib/auth/return-path.ts", {});
function loadAuth(email) {
  const seen = { oauth: null, cookie: null };
  const actions = load("src/lib/auth/actions.ts", {
    "next/navigation": { redirect(url) { throw new Error(`redirect:${url}`); } },
    "next/headers": {
      headers: async () => new Headers({ host: "www.penneyconstruction.build" }),
      cookies: async () => ({ set: (...args) => { seen.cookie = args; } }),
    },
    "@/lib/supabase/server": { createClient: async () => ({ auth: {
      getUser: async () => ({ data: { user: email ? { email } : null } }),
      signInWithOAuth: async (args) => { seen.oauth = args; return { data: { url: "https://accounts.example/oauth" }, error: null }; },
    } }) },
    "@/lib/sub-portal/auth": {},
    "@/lib/auth/return-path": returnPaths,
  });
  return { actions, seen };
}

// ---- The banner ---------------------------------------------------------------------------
const banner = load("src/components/inquiries/calendar-connection-banner.tsx", {
  "react/jsx-runtime": jsx,
  "lucide-react": { CalendarCheck2: "CalendarCheck2", CalendarX2: "CalendarX2", Info: "Info" },
  "@/lib/auth/actions": { connectRyanCalendar: "connectRyanCalendar" },
  "@/lib/inquiries/calendar": calendar,
  "@/lib/inquiries/model": model,
  "@/components/inquiries/calendar-connect-button": { CalendarConnectButton: "CalendarConnectButton" },
});
function nodes(tree) {
  if (tree == null || typeof tree === "boolean") return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (typeof tree !== "object") return [];
  return [tree, ...nodes(tree.props?.children)];
}
function words(tree) {
  if (tree == null || typeof tree === "boolean") return "";
  if (Array.isArray(tree)) return tree.map(words).join("");
  if (typeof tree !== "object") return String(tree);
  return words(tree.props?.children);
}
const notice = (connection, props = {}) => banner.CalendarConnectionNotice({ connection, viewerIsRyan: false, readOnly: false, attempt: "", ...props });
const form = (tree) => nodes(tree).find((node) => node.type === "form");

(async () => {
  reset();
  assert.deepEqual({ ...(await calendar.getRyanCalendarConnection()) }, { state: "connected" });
  reset({ refresh: null });
  assert.deepEqual({ ...(await calendar.getRyanCalendarConnection()) }, { state: "disconnected", fix: "reconnect" }, "no saved connection");
  reset({ tokenError: "invalid_grant" });
  assert.deepEqual({ ...(await calendar.getRyanCalendarConnection()) }, { state: "disconnected", fix: "reconnect" }, "Google revoked or expired it");
  reset({ primaryError: "insufficientPermissions" });
  assert.deepEqual({ ...(await calendar.getRyanCalendarConnection()) }, { state: "disconnected", fix: "permissions" }, "the Calendar boxes were not ticked");
  reset({ primary: "someone-else@example.com" });
  assert.deepEqual({ ...(await calendar.getRyanCalendarConnection()) }, { state: "disconnected", fix: "wrong_account" });
  reset({ tokenError: "invalid_client" });
  assert.deepEqual({ ...(await calendar.getRyanCalendarConnection()) }, { state: "disconnected", fix: "setup" }, "the app's own Google settings");
  reset({ timeout: true });
  assert.deepEqual({ ...(await calendar.getRyanCalendarConnection()) }, { state: "unknown" }, "a slow Google never raises a false alarm");
  assert.equal(calendar.calendarFixFor({ stage: "free_busy", reason: "notFound" }), "calendars");
  assert.equal(calendar.calendarFixFor({ stage: "calendar_list", reason: "too_many_calendars" }), "calendars");
  assert.equal(calendar.calendarFixFor({ stage: "primary", reason: "http_error" }), "other");
  assert.equal(calendar.calendarFixFor({ stage: "primary", reason: "rateLimitExceeded" }), null);
  assert.equal(calendar.calendarFixFor(undefined), null);

  // Only Ryan, signed in as himself, reaches Google.
  for (const email of ["jbetancur@penneyconstructioninc.com", "spenney@penneyconstructioninc.com", null]) {
    const { actions, seen } = loadAuth(email);
    await assert.rejects(actions.connectRyanCalendar(), /redirect:\/command-center\/inquiries\?calendar=ryan-only$/);
    assert.equal(seen.oauth, null, "nobody else starts a Google sign-in");
    assert.equal(seen.cookie, null);
  }
  const { actions, seen } = loadAuth("RPenney@penneyconstructioninc.com");
  await assert.rejects(actions.connectRyanCalendar(), /redirect:https:\/\/accounts\.example\/oauth$/);
  assert.equal(seen.oauth.options.redirectTo, "https://www.penneyconstruction.build/auth/callback", "the registered callback stays fixed");
  assert.equal(seen.oauth.options.queryParams.login_hint, RYAN, "Google preselects Ryan's account");
  assert.equal(seen.oauth.options.queryParams.access_type, "offline");
  assert.equal(seen.oauth.options.queryParams.prompt, "consent");
  for (const scope of ["calendar.readonly", "calendar.events"]) assert.ok(seen.oauth.options.scopes.includes(`https://www.googleapis.com/auth/${scope}`), `asks for ${scope}`);
  assert.equal(seen.cookie[0], returnPaths.AUTH_RETURN_PATH_COOKIE);
  assert.equal(seen.cookie[1], "/command-center/inquiries?calendar=check", "Google returns to the page that re-checks the calendar");
  assert.equal(returnPaths.safeReturnPath(seen.cookie[1]), seen.cookie[1], "the callback accepts that return path");
  assert.equal(seen.cookie[2].path, returnPaths.AUTH_RETURN_COOKIE_PATH);

  // Nothing when all is well. For Ryan, only the button. One quiet line for everyone else.
  assert.equal(notice({ state: "connected" }), null);
  assert.equal(notice({ state: "unknown" }), null);
  assert.ok(words(notice({ state: "connected" }, { attempt: "check" })).includes("Google Calendar is connected"));
  const forRyan = notice({ state: "disconnected", fix: "permissions" }, { viewerIsRyan: true });
  assert.equal(forRyan.type, "form", "no box around it");
  assert.equal(form(forRyan).props.action, "connectRyanCalendar");
  assert.equal(nodes(forRyan).find((node) => node.type === "CalendarConnectButton").props.label, "Connect Google Calendar");
  assert.equal(words(forRyan), "", "just the button: no heading, no explanation, no hint");
  const forOffice = notice({ state: "disconnected", fix: "reconnect" });
  assert.equal(form(forOffice), undefined, "no button for anyone but Ryan");
  assert.ok(words(forOffice).includes("Only Ryan can connect it"));
  assert.equal(form(notice({ state: "disconnected", fix: "reconnect" }, { viewerIsRyan: true, readOnly: true })), undefined, "View as never connects");
  const setup = notice({ state: "disconnected", fix: "setup" }, { viewerIsRyan: true });
  assert.equal(form(setup), undefined, "no button when reconnecting cannot fix it");
  assert.ok(words(setup).includes("needs Jorge"));
  const again = notice({ state: "disconnected", fix: "permissions" }, { viewerIsRyan: true, attempt: "check" });
  assert.ok(words(again).includes("Still not connected"), "after a try that did not work, one line says why");
  assert.ok(words(again).includes("Select all"), "and which box to tick");
  assert.equal(nodes(again).find((node) => node.type === "CalendarConnectButton").props.label, "Connect Google Calendar");
  console.log("PASS: lead source labels, calendar status to next step, Ryan-only connect action with fixed callback and return path, and banner states. All Google and database calls mocked.");
})().catch((error) => { console.error(error); process.exit(1); });
