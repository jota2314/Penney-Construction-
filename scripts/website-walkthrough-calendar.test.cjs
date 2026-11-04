// Every Google/database call is mocked. This suite never sends invitations or email.
const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const ts = require("typescript");
const NOW = Date.parse("2026-11-04T12:00:00Z");
class FixedDate extends Date {
  constructor(...args) { super(...(args.length ? args : [NOW])); }
  static now() { return NOW; }
}
let state;
const RYAN = "rpenney@penneyconstructioninc.com";
const OTHER = "work@example.com";
function load(file, imports, extras = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require(id) { if (!(id in imports)) throw new Error(`Unmocked import ${id}`); return imports[id]; },
    Date: FixedDate, Intl, URL, URLSearchParams, Headers, Response, Request, AbortSignal, Error, Set, console, ...extras });
  return exports;
}
const day = load("src/lib/sub-portal/et-day.ts", {});
const time = load("src/lib/inquiries/calendar-time.ts", { "@/lib/sub-portal/et-day": day });
function reset(patch = {}) {
  state = { primary: RYAN, profileEmail: RYAN, refresh: "test-refresh", event: null, busy: [], reservations: [],
    calendarError: false, reservationError: null, insertMode: "success", cancelMode: "success", calls: [], dbCalls: [], ...patch };
}
const db = {
  from(table) {
    const query = { table, filters: [] };
    state.dbCalls.push(query);
    const result = () => table === "profiles" ? { data: { email: state.profileEmail, google_refresh_token: state.refresh }, error: state.profileError } :
      table === "website_walkthrough_bookings" ? { data: state.reservations, error: state.reservationError } :
        { data: [{ key: "google_client_id", value: "test-id" }, { key: "google_client_secret", value: "test-secret" }], error: state.settingsError };
    return {
      select(columns) { query.columns = columns; return this; },
      eq(column, value) { query.filters.push([column, value]); return this; },
      in(column, value) { query.filters.push([column, value]); return this; },
      lt(column, value) { query.filters.push([column, value]); return this; },
      gt(column, value) { query.filters.push([column, value]); return this; },
      async maybeSingle() { return result(); },
      then(resolve) { return Promise.resolve(result()).then(resolve); },
    };
  },
};
const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
async function mockFetch(url, options = {}) {
  state.calls.push({ url, options });
  if (url === "https://oauth2.googleapis.com/token") {
    assert.equal(options.body.get("refresh_token"), "test-refresh");
    if (state.tokenError) return reply({ error: state.tokenError.reason, error_description: "PRIVATE_TOKEN_DETAILS" }, state.tokenError.status);
    return reply({ access_token: "test-access", ...(state.scopes ? { scope: state.scopes } : {}) });
  }
  assert.equal(options.headers.get("Authorization"), "Bearer test-access");
  const path = new URL(url).pathname;
  if (path.endsWith("/calendars/primary")) {
    if (state.primaryTimeout) throw Object.assign(new Error("PRIVATE_NETWORK_DETAILS"), { name: "TimeoutError" });
    return state.primaryError ? reply(state.primaryError.body, state.primaryError.status) : reply({ id: state.primary });
  }
  if (path.endsWith("/users/me/calendarList")) return state.listError ? reply(state.listError.body, state.listError.status) : reply({ items: [{ id: RYAN, primary: true }, { id: OTHER, selected: true }, { id: "unselected@example.com", selected: false }] });
  if (path.endsWith("/freeBusy")) {
    const sent = JSON.parse(options.body);
    assert.deepEqual(sent.items, [{ id: RYAN }, { id: OTHER }]);
    if (state.freeBusyError) return reply(state.freeBusyError.body, state.freeBusyError.status);
    return reply({ calendars: { [RYAN]: { busy: state.busy }, [OTHER]: state.calendarError ? { errors: [{ reason: "notFound" }] } : { busy: [] } } });
  }
  if (path.includes("/events/") && !options.method) return state.event ? reply(state.event) : reply({}, 404);
  if (path.includes("/events/") && options.method === "DELETE") {
    assert.equal(new URL(url).searchParams.get("sendUpdates"), "all");
    assert.equal(options.headers.get("If-Match"), '"test-etag"');
    if (state.cancelMode === "reject") return reply({}, 403);
    if (state.cancelMode === "changed") return reply({}, 412);
    if (state.cancelMode === "unknown") throw new Error("Network interrupted during cancellation");
    state.event = { id: state.event.id, status: "cancelled" };
    return new Response(null, { status: 204 });
  }
  if (path.endsWith("/events") && options.method === "POST") {
    assert.equal(new URL(url).searchParams.get("sendUpdates"), "all");
    const event = JSON.parse(options.body);
    assert.equal("sendUpdates" in event, false);
    assert.equal("conferenceData" in event, false);
    if (state.insertMode === "reject") return reply({}, 403);
    if (state.insertMode === "unknown") return reply({}, 503);
    state.event = { ...event, status: "confirmed", etag: '"test-etag"', htmlLink: "https://www.google.com/calendar/event?eid=test" };
    if (state.insertMode === "timeout") throw new Error("Network interrupted after insert");
    if (state.insertMode === "conflict") return reply({}, 409);
    return reply(state.event);
  }
  throw new Error(`Unexpected network call: ${url}`);
}
const calendar = load("src/lib/inquiries/calendar.ts", {
  "server-only": {}, "node:crypto": crypto, "@/lib/supabase/admin": { createAdminClient: () => db },
  "@/lib/sub-portal/et-day": day, "@/lib/inquiries/calendar-time": time,
}, { process: { env: {} }, fetch: mockFetch });
const input = {
  bookingId: "11111111-1111-4111-a111-111111111111", inquiryId: "22222222-2222-4222-a222-222222222222",
  clientName: "Test Homeowner", clientEmail: "homeowner@example.com", address: "Test property, Peabody, MA",
  start: "2026-11-05T14:00:00.000Z", end: "2026-11-05T15:00:00.000Z", description: "Reviewed walkthrough description",
};
const insertCount = () => state.calls.filter((x) => x.options.method === "POST" && new URL(x.url).pathname.endsWith("/events")).length;
const cancelCount = () => state.calls.filter((x) => x.options.method === "DELETE").length;

(async () => {
  // Calendar rules follow Eastern time, including DST, without UTC/server-local guesses.
  assert.equal(time.easternTime("2027-03-12", 9), "2027-03-12T14:00:00.000Z");
  assert.equal(time.easternTime("2027-03-15", 9), "2027-03-15T13:00:00.000Z");
  assert.equal(time.easternTime("2026-10-30", 9), "2026-10-30T13:00:00.000Z");
  assert.equal(time.easternTime("2026-11-02", 9), "2026-11-02T14:00:00.000Z");
  assert.equal(time.validCalendarDay("2026-02-31"), false);
  assert.equal(time.validAvailabilityDay("2026-11-03"), false);
  assert.equal(time.validAvailabilityDay("2027-02-01"), false);
  assert.equal(time.validWalkthroughSlot(input.start, input.end), true);
  assert.equal(time.validWalkthroughSlot("2026-11-07T14:00:00Z", "2026-11-07T15:00:00Z"), false);
  assert.equal(time.validWalkthroughSlot("2026-11-04T18:00:00Z", "2026-11-04T19:00:00Z"), false);
  const slots = time.walkthroughSlots("2026-11-05", [{ start: "2026-11-05T15:00:00Z", end: "2026-11-05T16:00:00Z" }]);
  assert(!slots.some((x) => x.start === input.start)); // no travel gap before 10 AM event
  assert(slots.some((x) => x.start === "2026-11-05T16:30:00.000Z")); // exactly 30-minute gap is valid
  assert(slots.every((x) => ![0, 6].includes(day.weekdayOf(day.etDate(x.start)))));

  reset();
  let result = await calendar.getRyanAvailability("2026-11-05");
  assert.equal(result.connected, true); assert(result.slots.length > 0);
  assert.equal(state.calls.some((x) => x.options.method === "POST" && x.url.includes("/events")), false);
  assert(state.dbCalls.some((q) => q.table === "profiles" && q.filters.some(([key, id]) => key === "id" && id === "7a44f1ab-70db-4d9a-af26-dc2a37f89091")));
  reset({ reservations: [{ start_at: input.start, end_at: input.end }] });
  result = await calendar.getRyanAvailability("2026-11-05");
  assert.equal(result.connected, true); assert(!result.slots.some((x) => x.start === input.start));
  for (const patch of [{ primary: "wrong@example.com" }, { profileEmail: "wrong@example.com" }, { refresh: null }, { calendarError: true }, { reservationError: { message: "unavailable" } }]) {
    reset(patch); result = await calendar.getRyanAvailability("2026-11-05");
    assert.equal(result.connected, false); assert.equal(result.slots.length, 0);
  }

  // Diagnostics identify failure stages without reflecting response bodies, IDs or tokens.
  const insufficient = { status: 403, body: { error: { errors: [{ reason: "insufficientPermissions" }], message: "PRIVATE_GOOGLE_MESSAGE" } } };
  for (const [patch, stage, reason, status] of [
    [{ tokenError: { reason: "unauthorized_client", status: 401 } }, "refresh", "unauthorized_client", 401],
    [{ tokenError: { reason: "invalid_grant", status: 400 } }, "refresh", "invalid_grant", 400],
    [{ tokenError: { reason: "PRIVATE_UNKNOWN_ERROR", status: 400 } }, "refresh", "http_error", 400],
    [{ primaryError: insufficient }, "primary", "insufficientPermissions", 403],
    [{ listError: { status: 403, body: { error: { details: [{ reason: "SERVICE_DISABLED", metadata: { secret: "PRIVATE_METADATA" } }] } } } }, "calendar_list", "SERVICE_DISABLED", 403],
    [{ freeBusyError: { status: 503, body: { error: { errors: [{ reason: "PRIVATE_BAD_REASON" }], message: "PRIVATE_GOOGLE_MESSAGE" } } } }, "free_busy", "http_error", 503],
    [{ calendarError: true }, "free_busy", "notFound", 200],
    [{ primaryTimeout: true }, "primary", "timeout", undefined],
    [{ profileError: { message: "PRIVATE_DB_ERROR" } }, "profile", "database_error", undefined],
    [{ settingsError: { message: "PRIVATE_CONFIG_ERROR" } }, "configuration", "database_error", undefined],
    [{ reservationError: { message: "PRIVATE_RESERVATION_ERROR" } }, "reservations", "database_error", undefined],
    [{ primary: "PRIVATE_WRONG_ACCOUNT@example.com" }, "primary", "account_mismatch", 200],
  ]) {
    reset(patch); result = await calendar.getRyanAvailability("2026-11-05");
    assert.equal(result.connected, false); assert.equal(result.diagnostic.stage, stage); assert.equal(result.diagnostic.reason, reason); assert.equal(result.diagnostic.status, status);
    assert.equal(JSON.stringify(result).includes("PRIVATE_"), false);
    assert.equal(JSON.stringify(result).includes("test-access"), false);
    assert.equal(JSON.stringify(result).includes("test-refresh"), false);
  }
  reset({ primaryError: insufficient, scopes: "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/gmail.send" });
  result = await calendar.getRyanAvailability("2026-11-05");
  assert.deepEqual(JSON.parse(JSON.stringify(result.diagnostic.scopes)), { calendarMetadata: false, calendarList: false, freeBusy: false, calendarWrite: true });
  assert.match(result.message, /Calendar permissions/);
  reset({ scopes: "https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events" });
  result = await calendar.getRyanAvailability("2026-11-05");
  assert.equal(result.diagnostic.stage, "complete");
  assert(Object.values(result.diagnostic.scopes).every(Boolean));

  reset();
  result = await calendar.ensureRyanWalkthroughEvent(input);
  assert.match(result.id, /^[a-v0-9]{5,1024}$/); assert.equal(insertCount(), 1);
  assert.deepEqual(JSON.parse(JSON.stringify(state.event.attendees)), [{ email: input.clientEmail }]);
  const firstId = result.id;
  result = await calendar.ensureRyanWalkthroughEvent(input);
  assert.equal(result.id, firstId); assert.equal(insertCount(), 1); // retry never repeats the invitation
  for (const responseStatus of ["declined", "tentative"]) {
    state.event.attendees[0].responseStatus = responseStatus;
    const observed = await calendar.findRyanWalkthroughEvent(input);
    assert(observed.warning.includes(responseStatus));
    assert.equal(insertCount(), 1); // RSVP is observed, never changed or re-invited
    assert.equal((await calendar.ensureRyanWalkthroughEvent(input)).id, firstId);
    assert.equal(insertCount(), 1);
  }
  for (const responseStatus of ["needsAction", "accepted"]) {
    state.event.attendees[0].responseStatus = responseStatus;
    assert.equal((await calendar.findRyanWalkthroughEvent(input)).warning, undefined);
  }
  state.event.location = "Changed address";
  await assert.rejects(calendar.ensureRyanWalkthroughEvent(input), (error) => error.retrySafe === false);
  assert.equal(insertCount(), 1);
  reset({ busy: [{ start: input.start, end: input.end }] });
  await assert.rejects(calendar.ensureRyanWalkthroughEvent(input), (error) => error.retrySafe === true);
  assert.equal(insertCount(), 0);
  for (const mode of ["timeout", "conflict"]) {
    reset({ insertMode: mode }); result = await calendar.ensureRyanWalkthroughEvent(input);
    assert.equal(result.id, firstId); assert.equal(insertCount(), 1);
  }
  reset({ insertMode: "reject" });
  await assert.rejects(calendar.ensureRyanWalkthroughEvent(input), (error) => error.retrySafe === true);
  reset({ insertMode: "unknown" });
  await assert.rejects(calendar.ensureRyanWalkthroughEvent(input), (error) => error.retrySafe === false);

  reset();
  await calendar.ensureRyanWalkthroughEvent(input);
  assert.equal((await calendar.cancelRyanWalkthroughEvent(input)).cancelled, true);
  assert.equal(cancelCount(), 1);
  assert.equal((await calendar.cancelRyanWalkthroughEvent(input)).cancelled, true);
  assert.equal(cancelCount(), 1); // cancelled-event replay sends no duplicate notification
  reset();
  assert.equal((await calendar.cancelRyanWalkthroughEvent(input)).cancelled, true);
  assert.equal(cancelCount(), 0); // already missing is verified as cancelled
  reset();
  await calendar.ensureRyanWalkthroughEvent(input);
  state.event.location = "A different property";
  await assert.rejects(calendar.cancelRyanWalkthroughEvent(input), (error) => error.retrySafe === false);
  assert.equal(cancelCount(), 0);
  for (const [cancelMode, retrySafe] of [["reject", true], ["changed", true], ["unknown", false]]) {
    reset({ cancelMode }); await calendar.ensureRyanWalkthroughEvent(input);
    await assert.rejects(calendar.cancelRyanWalkthroughEvent(input), (error) => error.retrySafe === retrySafe);
    assert.equal(cancelCount(), 1); // no automatic DELETE retries after any failure
  }

  // The website service endpoint rejects untrusted callers and only exports open slots.
  let availabilityCalls = 0;
  const route = load("src/app/api/website-walkthrough/availability/route.ts", {
    "node:crypto": crypto, "next/server": { NextResponse: Response },
    "@/lib/inquiries/calendar-time": time,
    "@/lib/inquiries/calendar": { async getRyanAvailability() { availabilityCalls++; return { connected: true, timeZone: "America/New_York", durationMinutes: 60, slots: [{ start: input.start, end: input.end }], busy: [{ start: input.start, end: input.end }], calendarUrl: "PRIVATE", diagnostic: { stage: "complete", reason: "ok" } }; } },
  }, { process: { env: { SUPABASE_SERVICE_ROLE_KEY: "test-server-key" } } });
  for (const authorization of ["", "test-server-key", "Bearer bad-key"]) {
    const response = await route.GET(new Request("https://app.example.com/api/website-walkthrough/availability?from=2026-11-05&diagnostics=1", { headers: { authorization } }));
    assert.equal(response.status, 401);
  }
  assert.equal(availabilityCalls, 0);
  let response = await route.GET(new Request("https://app.example.com/api/website-walkthrough/availability?from=2026-11-05", { headers: { authorization: "Bearer test-server-key" } }));
  const payload = await response.json();
  assert.equal(payload.connected, true); assert.equal("busy" in payload, false); assert.equal("calendarUrl" in payload, false); assert.equal("diagnostic" in payload, false);
  response = await route.GET(new Request("https://app.example.com/api/website-walkthrough/availability?from=2026-11-05&diagnostics=1", { headers: { authorization: "Bearer test-server-key" } }));
  const diagnosticPayload = await response.json();
  assert.deepEqual(diagnosticPayload.diagnostic, { stage: "complete", reason: "ok" });
  assert.equal("busy" in diagnosticPayload, false); assert.equal("calendarUrl" in diagnosticPayload, false);
  response = await route.GET(new Request("https://app.example.com/api/website-walkthrough/availability?from=2026-02-31", { headers: { authorization: "Bearer test-server-key" } }));
  assert.equal(response.status, 400);
  assert.equal(availabilityCalls, 2);
  console.log("Walkthrough calendar tests passed: DST, timing, travel, reservations, identity, privacy, conflicts, recovery and invitation deduplication.");
})().catch((error) => { console.error(error); process.exitCode = 1; });
