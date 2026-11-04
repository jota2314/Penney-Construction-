// Transport-mocked orchestration tests. No live calendar or email calls occur.
const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const ts = require("typescript");

function load(file, imports) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require(id) { if (!(id in imports)) throw new Error(`Unmocked import ${id}`); return imports[id]; }, Date, Intl, Error, console });
  return exports;
}
const days = load("src/lib/sub-portal/et-day.ts", {});
const model = load("src/lib/inquiries/model.ts", { "@/lib/sub-portal/et-day": days });
const inquiryId = "11111111-1111-4111-a111-111111111111";
const bookingId = "22222222-2222-4222-a222-222222222222";
const emailId = "33333333-3333-4333-a333-333333333333";
const userId = "44444444-4444-4444-a444-444444444444";
const senderEmail = "jbetancur@penneyconstructioninc.com";
const clientEmail = "homeowner@example.com";
const updatedAt = "2026-11-04T18:00:00Z";
const input = {
  inquiryId, requestId: bookingId, expectedUpdatedAt: updatedAt,
  start: "2026-11-06T14:00:00Z", end: "2026-11-06T15:00:00Z", address: "Test property, Peabody, MA",
  expectedRecipient: clientEmail, expectedSender: senderEmail, subject: "Walkthrough confirmed", body: "Your reviewed confirmation.",
};
const event = { id: "pc1234", htmlLink: "https://www.google.com/calendar/event?eid=test" };
const template = {
  id: bookingId, inquiry_id: inquiryId, sender_profile_id: userId, recipient_email: clientEmail, sender_email: senderEmail,
  requested_updated_at: updatedAt, start_at: input.start, end_at: input.end, address: input.address,
  subject: input.subject, body: input.body, confirmation_source: "Requested by homeowner on website", confirmation_email_id: emailId,
  status: "confirming", calendar_event_id: null, calendar_event_url: null, error: null, created_at: updatedAt,
};
let state;
function reset(patch = {}) {
  state = {
    user: { id: userId, email: senderEmail, profile: { email: senderEmail }, realProfile: { email: senderEmail }, isImpersonating: false },
    member: true, inquiry: { id: inquiryId, updated_at: updatedAt, contact_name: "Test Homeowner", description: "",
      website_inquiry: { name: "Test Homeowner", email: clientEmail, walkthrough: { start: input.start, end: input.end, address: input.address, timeZone: "America/New_York" } } },
    prior: null, reserved: { ...template }, sender: { email: senderEmail },
    claimed: true, newlyCreated: true, reserveError: null, eventError: null, recordError: null, finishError: null,
    contextError: null, currentError: null, emailResult: { success: true, messageId: "gmail-test" },
    operationId: null, events: [], calls: [], adminCalls: [], emailCalls: [], calendarCalls: [], cancelCalls: [], availabilityCalls: [], lookupCalls: [],
    ...patch,
  };
}
class CalendarBookingError extends Error {
  constructor(message, retrySafe) { super(message); this.retrySafe = retrySafe; }
}
const db = {
  async rpc(name) {
    if (name === "can_access_website_inquiries") return { data: state.member, error: null };
    throw new Error(`Unexpected session RPC ${name}`);
  },
  from(table) {
    let selected;
    const filters = [];
    return {
      select(value) { selected = value; return this; }, eq(key, value) { filters.push([key, value]); return this; }, order() { return this; }, limit() { return this; },
      async maybeSingle() {
        if (table === "todos") return selected === "updated_at" ? { data: { updated_at: "2026-11-04T18:30:00Z" }, error: state.currentError } : { data: state.inquiry, error: null };
        if (table === "website_walkthrough_bookings") return { data: state.prior && filters.every(([key, value]) => state.prior[key] === value) ? state.prior : null, error: state.contextError };
        throw new Error(`Unexpected table ${table}`);
      },
    };
  },
};
const admin = {
  async rpc(name, args) {
    state.calls.push(name); state.adminCalls.push({ name, args });
    if (name === "begin_website_walkthrough") {
      if (state.reserveError) return { data: null, error: state.reserveError };
      if (state.reserved.cancel_requested_at) return { data: null, error: { message: "Cancellation is in progress or complete" } };
      if (state.claimed && !state.operationId) state.operationId = args.p_operation_id;
      const claimed = state.claimed && state.operationId === args.p_operation_id;
      return { data: { ...state.reserved, claimed, newly_created: state.newlyCreated && claimed }, error: null };
    }
    if (name === "begin_cancel_website_walkthrough") {
      if (state.reserveError) return { data: null, error: state.reserveError };
      if (state.reserved.status === "cancelled") return { data: { ...state.reserved, claimed: false }, error: null };
      if (state.claimed && !state.operationId) state.operationId = args.p_operation_id;
      const claimed = state.claimed && state.operationId === args.p_operation_id;
      if (claimed) state.reserved = { ...state.reserved, status: "cancelling", cancel_requested_at: updatedAt };
      return { data: { ...state.reserved, claimed }, error: null };
    }
    assert.equal(args.p_operation_id, state.operationId, `${name} must be owned by this operation's lease`);
    if (name === "record_website_walkthrough_event") {
      if (state.recordError) return { data: null, error: state.recordError };
      state.reserved = { ...state.reserved, status: "calendar_created", calendar_event_id: args.p_event_id, calendar_event_url: args.p_event_url };
      return { data: { ...state.reserved }, error: null };
    }
    if (name === "mark_website_walkthrough_problem") {
      if (state.reserved.status !== "confirmed") state.reserved = { ...state.reserved,
        status: state.reserved.cancel_requested_at ? "cancelling" : args.p_definitely_not_created && !state.reserved.calendar_event_id ? "failed" : "needs_attention", error: args.p_error };
      return { data: { ...state.reserved }, error: null };
    }
    if (name === "finish_website_walkthrough") {
      if (state.finishError) return { data: null, error: state.finishError };
      state.reserved = { ...state.reserved, status: "confirmed" };
      return { data: { ...state.reserved }, error: null };
    }
    if (name === "finish_cancel_website_walkthrough") {
      if (state.finishError) return { data: null, error: state.finishError };
      state.reserved = { ...state.reserved, status: "cancelled" };
      return { data: { ...state.reserved }, error: null };
    }
    throw new Error(`Unexpected admin RPC ${name}`);
  },
};
const actions = load("src/lib/actions/website-inquiry-booking.ts", {
  "node:crypto": crypto,
  "next/cache": { revalidatePath() {} },
  "@/lib/auth/get-user": { getUser: async () => state.user },
  "@/lib/supabase/server": { createClient: async () => db },
  "@/lib/supabase/admin": { createAdminClient: () => admin },
  "@/lib/inquiries/model": model,
  "@/lib/sub-portal/et-day": days,
  "@/lib/inquiries/calendar": {
    CalendarBookingError,
    async getRyanAvailability(fromDay) { state.availabilityCalls.push(fromDay); return { connected: true, timeZone: "America/New_York", durationMinutes: 60, slots: [], busy: [] }; },
    async findRyanWalkthroughEvent(value) { state.lookupCalls.push(value); if (state.lookupError) throw state.lookupError; return state.lookupResult === undefined ? event : state.lookupResult; },
    async ensureRyanWalkthroughEvent(value) {
      state.calls.push("calendar"); state.calendarCalls.push(value);
      if (state.calendarGate) await state.calendarGate;
      if (state.eventError) throw state.eventError;
      return event;
    },
    async cancelRyanWalkthroughEvent(value) {
      state.calls.push("cancelCalendar"); state.cancelCalls.push(value);
      if (state.calendarGate) await state.calendarGate;
      if (state.eventError) throw state.eventError;
      return { cancelled: true };
    },
  },
  "@/lib/actions/website-inquiry-email": {
    async getWebsiteInquiryEmailSender() { return state.sender; },
    async sendWebsiteInquiryEmail(value) { state.calls.push("email"); state.emailCalls.push(value); return state.emailResult; },
  },
});

(async () => {
  reset();
  const context = await actions.getInquiryBookingContext(inquiryId);
  assert.equal(context.availability.connected, true);
  assert.equal(state.calendarCalls.length, 0); assert.equal(state.emailCalls.length, 0); assert.equal(state.adminCalls.length, 0);
  reset({ prior: { ...template, status: "confirmed", calendar_event_id: event.id, calendar_event_url: event.htmlLink } });
  let verified = await actions.getInquiryBookingContext(inquiryId);
  assert(verified.calendarVerifiedAt); assert.equal(verified.calendarWarning, undefined);
  assert.equal(state.lookupCalls.length, 1); assert.equal(state.calendarCalls.length, 0); assert.equal(state.emailCalls.length, 0);
  for (const patch of [{ lookupResult: null }, { lookupError: new CalendarBookingError("Calendar appointment changed", false) },
    { lookupResult: { ...event, warning: "The homeowner declined this calendar invitation." } },
    { lookupResult: { ...event, warning: "The homeowner marked this calendar invitation as tentative." } }]) {
    reset({ prior: { ...template, status: "confirmed", calendar_event_id: event.id, calendar_event_url: event.htmlLink }, ...patch });
    verified = await actions.getInquiryBookingContext(inquiryId);
    assert(verified.calendarWarning); assert.equal(verified.calendarVerifiedAt, undefined);
    assert.equal(state.calendarCalls.length, 0); assert.equal(state.emailCalls.length, 0); assert.equal(state.adminCalls.length, 0);
  }
  for (const patch of [{ user: null }, { member: false }, { user: { id: userId, email: "outsider@example.com", profile: { email: senderEmail }, realProfile: { email: senderEmail } } },
    { user: { id: userId, email: senderEmail, profile: { email: senderEmail }, realProfile: { email: "outsider@example.com" } } },
    { user: { id: userId, email: senderEmail, profile: { email: senderEmail }, realProfile: { email: senderEmail }, isImpersonating: true } }]) {
    reset(patch); const result = await actions.confirmInquiryWalkthrough(input);
    assert.equal(result.success, false); assert.equal(state.adminCalls.length, 0); assert.equal(state.calendarCalls.length, 0); assert.equal(state.emailCalls.length, 0);
  }
  for (const changed of [{ requestId: "bad-id" }, { end: input.start }, { address: "x" }, { subject: "Bad\nheader" }, { expectedRecipient: "other@example.com" }, { expectedSender: "other@example.com" }]) {
    reset(); assert.equal((await actions.confirmInquiryWalkthrough({ ...input, ...changed })).success, false); assert.equal(state.adminCalls.length, 0);
  }
  reset({ reserveError: { message: "This inquiry changed" } });
  assert.equal((await actions.confirmInquiryWalkthrough(input)).success, false);
  assert.equal(state.calendarCalls.length, 0); assert.equal(state.emailCalls.length, 0);
  reset({ claimed: false });
  assert.equal((await actions.confirmInquiryWalkthrough(input)).success, false);
  assert.equal(state.calendarCalls.length, 0); assert.equal(state.emailCalls.length, 0);

  reset();
  let result = await actions.confirmInquiryWalkthrough(input);
  assert.equal(result.success, true); assert.equal(result.booking.status, "confirmed");
  assert.deepEqual(state.calls, ["begin_website_walkthrough", "calendar", "record_website_walkthrough_event", "email", "finish_website_walkthrough"]);
  assert.equal(state.emailCalls[0].requestId, emailId); // durable email id, never a fresh retry identity
  assert.equal(state.emailCalls[0].expectedUpdatedAt, "2026-11-04T18:30:00Z");
  assert.equal(state.calendarCalls[0].bookingId, bookingId);
  assert.equal(state.adminCalls[0].args.p_homeowner_confirmed, false);
  reset({ reserved: { ...template, status: "confirmed", calendar_event_id: event.id, calendar_event_url: event.htmlLink } });
  result = await actions.confirmInquiryWalkthrough(input);
  assert.equal(result.success, true); assert.equal(state.calendarCalls.length, 0); assert.equal(state.emailCalls.length, 0);

  reset({ eventError: new CalendarBookingError("Google rejected the request", true) });
  result = await actions.confirmInquiryWalkthrough(input);
  assert.equal(result.success, false); assert.equal(state.emailCalls.length, 0);
  assert.equal(state.adminCalls.find((x) => x.name === "mark_website_walkthrough_problem").args.p_definitely_not_created, true);
  reset({ newlyCreated: false, reserved: { ...template, status: "needs_attention" }, eventError: new CalendarBookingError("Reconnect account", true) });
  result = await actions.confirmInquiryWalkthrough(input);
  assert.equal(result.success, false); assert.equal(result.booking.status, "needs_attention");
  assert.equal(state.adminCalls.find((x) => x.name === "mark_website_walkthrough_problem").args.p_definitely_not_created, false);
  reset({ eventError: new CalendarBookingError("Creation outcome unknown", false) });
  result = await actions.confirmInquiryWalkthrough(input);
  assert.equal(result.booking.status, "needs_attention"); assert.equal(state.emailCalls.length, 0);
  reset({ recordError: { message: "Receipt save unavailable" } });
  result = await actions.confirmInquiryWalkthrough(input);
  assert.equal(result.success, false); assert.equal(result.eventUrl, event.htmlLink); assert.equal(state.emailCalls.length, 0);
  for (const emailResult of [{ success: false, error: "Delivery uncertain", deliveryUncertain: true }, { success: true, messageId: "sent", warning: "Receipt unavailable" }]) {
    reset({ emailResult }); result = await actions.confirmInquiryWalkthrough(input);
    assert.equal(result.success, false); assert.equal(result.booking.status, "needs_attention");
    assert.equal(state.adminCalls.some((x) => x.name === "finish_website_walkthrough"), false);
  }
  reset({ finishError: { message: "Status update failed" } });
  result = await actions.confirmInquiryWalkthrough(input);
  assert.equal(result.success, false); assert.equal(state.emailCalls.length, 1); assert.equal(state.calendarCalls.length, 1);
  reset({ currentError: { message: "Inquiry read failed" } });
  result = await actions.confirmInquiryWalkthrough(input);
  assert.equal(result.success, false); assert.equal(result.booking.status, "needs_attention"); assert.equal(state.emailCalls.length, 0);

  // A replay while the first invocation owns the lease cannot reach either transport.
  let release;
  reset({ calendarGate: new Promise((resolve) => { release = resolve; }) });
  const first = actions.confirmInquiryWalkthrough(input);
  while (state.calendarCalls.length === 0) await new Promise((resolve) => setImmediate(resolve));
  const second = await actions.confirmInquiryWalkthrough(input);
  assert.equal(second.success, false); assert.equal(state.calendarCalls.length, 1); assert.equal(state.emailCalls.length, 0);
  release();
  assert.equal((await first).success, true); assert.equal(state.calendarCalls.length, 1); assert.equal(state.emailCalls.length, 1);

  const confirmedBooking = { ...template, status: "confirmed", calendar_event_id: event.id, calendar_event_url: event.htmlLink };
  const cancelInput = { inquiryId, bookingId, requestId: "55555555-5555-4555-a555-555555555555" };
  reset({ prior: confirmedBooking, reserved: { ...confirmedBooking } });
  result = await actions.cancelInquiryWalkthrough(cancelInput);
  assert.equal(result.success, true); assert.equal(result.booking.status, "cancelled");
  assert.deepEqual(state.calls, ["begin_cancel_website_walkthrough", "cancelCalendar", "finish_cancel_website_walkthrough"]);
  assert.equal(state.emailCalls.length, 0); assert.equal(state.calendarCalls.length, 0);
  assert.equal(state.cancelCalls[0].bookingId, bookingId);
  reset({ prior: { ...confirmedBooking, status: "cancelled" }, reserved: { ...confirmedBooking, status: "cancelled" } });
  result = await actions.cancelInquiryWalkthrough(cancelInput);
  assert.equal(result.success, true); assert.equal(state.cancelCalls.length, 0);
  reset({ prior: confirmedBooking, reserved: { ...confirmedBooking }, claimed: false });
  result = await actions.cancelInquiryWalkthrough(cancelInput);
  assert.equal(result.success, false); assert.equal(state.cancelCalls.length, 0);
  for (const patch of [{ prior: null }, { prior: { ...confirmedBooking, inquiry_id: "66666666-6666-4666-a666-666666666666" } },
    { prior: { ...confirmedBooking, id: "66666666-6666-4666-a666-666666666666" } }, { member: false },
    { user: { id: userId, email: senderEmail, profile: { email: senderEmail }, realProfile: { email: senderEmail }, isImpersonating: true } }]) {
    reset({ prior: confirmedBooking, reserved: { ...confirmedBooking }, ...patch });
    result = await actions.cancelInquiryWalkthrough(cancelInput);
    assert.equal(result.success, false); assert.equal(state.adminCalls.length, 0); assert.equal(state.cancelCalls.length, 0);
  }
  for (const eventError of [new CalendarBookingError("Cancellation outcome unknown", false), new CalendarBookingError("Google rejected cancellation", true)]) {
    reset({ prior: confirmedBooking, reserved: { ...confirmedBooking }, eventError });
    result = await actions.cancelInquiryWalkthrough(cancelInput);
    assert.equal(result.success, false); assert.equal(result.booking.status, "cancelling");
    assert.equal(state.adminCalls.find((x) => x.name === "mark_website_walkthrough_problem").args.p_definitely_not_created, false);
    assert.equal(state.adminCalls.some((x) => x.name === "finish_cancel_website_walkthrough"), false);
    assert.equal(state.calendarCalls.length, 0); assert.equal(state.emailCalls.length, 0);
  }
  reset({ prior: confirmedBooking, reserved: { ...confirmedBooking }, finishError: { message: "Ledger write unavailable" } });
  result = await actions.cancelInquiryWalkthrough(cancelInput);
  assert.equal(result.success, false); assert.equal(result.booking.status, "cancelling"); assert.equal(state.cancelCalls.length, 1);
  reset({ reserved: { ...template, status: "cancelling", cancel_requested_at: updatedAt }, newlyCreated: false });
  result = await actions.confirmInquiryWalkthrough(input);
  assert.equal(result.success, false); assert.equal(state.calendarCalls.length, 0); assert.equal(state.emailCalls.length, 0);
  reset({ prior: confirmedBooking, reserved: { ...confirmedBooking }, calendarGate: new Promise((resolve) => { release = resolve; }) });
  const firstCancel = actions.cancelInquiryWalkthrough(cancelInput);
  while (state.cancelCalls.length === 0) await new Promise((resolve) => setImmediate(resolve));
  const secondCancel = await actions.cancelInquiryWalkthrough(cancelInput);
  assert.equal(secondCancel.success, false); assert.equal(state.cancelCalls.length, 1);
  release();
  assert.equal((await firstCancel).success, true); assert.equal(state.cancelCalls.length, 1);
  console.log("Walkthrough booking tests passed: authorization, stale drafts, leases, ordered side effects, durable retries, failure recovery and duplicate-click protection.");
})().catch((error) => { console.error(error); process.exitCode = 1; });
