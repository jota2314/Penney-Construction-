// Exercises scheduling review and recovery without a browser or any live sends.
const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const ts = require("typescript");
const jsx = require("react/jsx-runtime");
const NOW = Date.parse("2026-11-04T17:00:00Z");
class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : [NOW])); } static now() { return NOW; } }
function load(file, imports = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { exports, require(key) { if (!(key in imports)) throw new Error(`Unexpected import ${key}`); return imports[key]; }, console, Date: FixedDate, Intl, URL, crypto });
  return exports;
}
let frame;
const tasks = [];
const hooks = {
  useState(initial) { const current = frame, index = current.index++; if (!(index in current.values)) current.values[index] = typeof initial === "function" ? initial() : initial; return [current.values[index], (next) => { current.values[index] = typeof next === "function" ? next(current.values[index]) : next; }]; },
  useRef(initial) { const current = frame, index = current.index++; if (!(index in current.values)) current.values[index] = { current: initial }; return current.values[index]; },
  useEffect(effect, deps) { const current = frame, index = current.index++, previous = current.values[index]; if (!previous || deps.some((value, i) => value !== previous[i])) { current.values[index] = deps; current.effects.push(effect); } },
  useTransition() { return [false, (task) => tasks.push(Promise.resolve(task()))]; },
};
function mount(component, props) { const current = { values: [], index: 0, effects: [] }; return { render() { current.index = 0; frame = current; const tree = component(props); for (const effect of current.effects.splice(0)) effect(); return tree; } }; }
function nodes(tree) { if (tree == null || typeof tree !== "object") return []; if (Array.isArray(tree)) return tree.flatMap(nodes); return [tree, ...nodes(tree.props?.children)]; }
function words(tree) { if (tree == null || typeof tree === "boolean") return ""; if (Array.isArray(tree)) return tree.map(words).join(""); if (typeof tree !== "object") return String(tree); return words(tree.props?.children); }
function button(tree, label) { const found = nodes(tree).find((node) => node.type === "Button" && words(node) === label); assert.ok(found, `Missing ${label}`); return found; }
function input(tree, selector) { const found = nodes(tree).find((node) => node.type === "input" && selector(node.props)); assert.ok(found, "Missing input"); return found; }
async function settle() { await Promise.all(tasks.splice(0)); await new Promise((resolve) => setImmediate(resolve)); }

const days = load("src/lib/sub-portal/et-day.ts");
const model = load("src/lib/inquiries/model.ts", { "@/lib/sub-portal/et-day": days });
const bookingModel = load("src/lib/inquiries/booking-model.ts", { "@/lib/inquiries/model": model });
const requested = { start: "2026-11-06T15:00:00Z", end: "2026-11-06T16:00:00Z", timeZone: "America/New_York", address: "1 Example Street, Example Town, MA" };
const alternate = { start: "2026-11-06T18:00:00Z", end: "2026-11-06T19:00:00Z" };
const inquiry = { id: crypto.randomUUID(), updated_at: "2026-11-04T16:00:00Z", created_at: "2026-11-04T15:00:00Z", contact_name: "Pat Homeowner", description: "", status: "open", intake_status: "new", assignee: "Ryan", due_date: "2026-11-05T22:00:00Z", snooze_until: null, lead_id: null, website_inquiry: { name: "Pat Homeowner", email: "pat@example.com", projectType: "addition", walkthrough: requested } };
const availability = { connected: true, timeZone: "America/New_York", durationMinutes: 60, slots: [requested, alternate], busy: [], calendarUrl: "https://calendar.google.com/calendar/u/0/r?cid=rpenney%40penneyconstructioninc.com" };
let context, result, cancelResult;
const confirmations = [], proposals = [], cancellations = [];
function reset(overrides = {}) { context = { availability, booking: null, sender: { email: "reviewer@example.com" }, ...overrides }; result = { success: true }; cancelResult = null; confirmations.length = 0; proposals.length = 0; cancellations.length = 0; }
const ui = load("src/components/inquiries/inquiry-booking.tsx", {
  react: hooks, "react/jsx-runtime": jsx,
  "next/navigation": { useRouter: () => ({ refresh() {} }) },
  "lucide-react": Object.fromEntries(["ArrowRight", "CalendarCheck2", "CalendarDays", "Check", "ChevronLeft", "ChevronRight", "Clock3", "ExternalLink", "Loader2", "Mail", "MapPin", "RefreshCw", "Send", "XCircle"].map((key) => [key, key])),
  "@/components/ui/button": { Button: "Button" },
  "@/components/ui/dialog": Object.fromEntries(["Dialog", "DialogContent", "DialogDescription", "DialogFooter", "DialogHeader", "DialogTitle"].map((key) => [key, key])),
  "@/lib/actions/website-inquiry-booking": { getInquiryBookingContext: async () => context, confirmInquiryWalkthrough: async (input) => { confirmations.push(input); return result; }, cancelInquiryWalkthrough: async (input) => { cancellations.push(input); const outcome = cancelResult || { success: true, booking: { ...context.booking, status: "cancelled" } }; if (outcome.booking) context = { ...context, booking: outcome.booking }; return outcome; } },
  "@/lib/actions/website-inquiry-email": { sendWebsiteInquiryEmail: async (input) => { proposals.push(input); return { success: true, messageId: "mock-message" }; } },
  "@/lib/inquiries/booking-model": bookingModel, "@/lib/inquiries/model": model, "@/lib/sub-portal/et-day": days,
});
const props = { inquiry, senderName: "Jorge", readOnly: false, emailBlocked: false };

(async () => {
  assert.equal(bookingModel.readWalkthroughRequest({ website_inquiry: { walkthrough: { ...requested, start: "not-a-date" } } }), null);
  assert.equal(bookingModel.readWalkthroughRequest({ website_inquiry: { walkthrough: { ...requested, timeZone: "UTC" } } }), null);
  assert.equal(bookingModel.sameWalkthroughSlot(requested, { start: "2026-11-06T10:00:00-05:00", end: "2026-11-06T11:00:00-05:00" }), true);

  reset();
  const view = mount(ui.InquiryBooking, props);
  let tree = view.render();
  assert.equal(button(tree, "Review confirmation").props.disabled, true, "Cannot review before availability is checked");
  await settle(); tree = view.render();
  assert.equal(confirmations.length + proposals.length, 0, "Opening inquiry only reads the calendar");
  assert.equal(button(tree, "Review confirmation").props.disabled, false);
  button(tree, "Review confirmation").props.onClick(); tree = view.render();
  input(tree, (p) => p.maxLength === 200).props.onChange({ target: { value: "Reviewed subject" } }); tree = view.render();
  nodes(tree).find((node) => node.type === "textarea").props.onChange({ target: { value: "Reviewed confirmation message" } }); tree = view.render();
  const form = nodes(tree).find((node) => node.type === "form");
  form.props.onSubmit({ preventDefault() {} });
  form.props.onSubmit({ preventDefault() {} });
  await settle();
  assert.equal(confirmations.length, 1, "Immediate double click cannot send twice");
  assert.equal(confirmations[0].subject, "Reviewed subject");
  assert.equal(confirmations[0].body, "Reviewed confirmation message");
  assert.equal(confirmations[0].expectedRecipient, "pat@example.com");

  reset();
  const other = mount(ui.InquiryBooking, props);
  other.render(); await settle(); tree = other.render();
  nodes(tree).find((node) => node.type === "button" && words(node) === "1:00 PM").props.onClick(); tree = other.render();
  button(tree, "Review suggested time").props.onClick(); tree = other.render();
  assert.ok(words(tree).includes("appointment stays unconfirmed"));
  nodes(tree).find((node) => node.type === "form").props.onSubmit({ preventDefault() {} }); await settle();
  assert.equal(confirmations.length, 0, "Changing time alone never books an appointment");
  assert.equal(proposals.length, 1);
  assert.ok(proposals[0].body.includes("This time is proposed"));

  reset();
  const agreed = mount(ui.InquiryBooking, props);
  agreed.render(); await settle(); tree = agreed.render();
  nodes(tree).find((node) => node.type === "button" && words(node) === "1:00 PM").props.onClick(); tree = agreed.render();
  input(tree, (p) => p.type === "checkbox").props.onChange({ target: { checked: true } }); tree = agreed.render();
  assert.equal(button(tree, "Review confirmation").props.disabled, true, "Agreement needs an evidence reference");
  input(tree, (p) => p.maxLength === 1000).props.onChange({ target: { value: "Homeowner email reply November 4" } }); tree = agreed.render();
  assert.equal(button(tree, "Review confirmation").props.disabled, false);
  button(tree, "Review confirmation").props.onClick(); tree = agreed.render();
  nodes(tree).find((node) => node.type === "form").props.onSubmit({ preventDefault() {} }); await settle();
  assert.equal(confirmations[0].homeownerConfirmed, true);
  assert.equal(confirmations[0].confirmationSource, "Homeowner email reply November 4");

  const saved = { id: crypto.randomUUID(), inquiry_id: inquiry.id, status: "calendar_created", start_at: requested.start, end_at: requested.end, address: requested.address, sender_profile_id: crypto.randomUUID(), recipient_email: "pat@example.com", sender_email: "reviewer@example.com", subject: "Original subject", body: "Original reviewed message", requested_updated_at: inquiry.updated_at, confirmation_source: "Website requested time", calendar_event_id: "mock-event", calendar_event_url: "https://calendar.google.com/calendar/event?eid=example", confirmation_email_id: crypto.randomUUID(), error: null, created_at: inquiry.created_at };
  reset({ booking: saved, availability: { ...availability, slots: [] } });
  const resume = mount(ui.InquiryBooking, { ...props, emailBlocked: true });
  resume.render(); await settle(); tree = resume.render();
  assert.equal(button(tree, "Review saved confirmation").props.disabled, false, "Existing event may occupy its own slot; resume the saved request");
  button(tree, "Review saved confirmation").props.onClick(); tree = resume.render();
  assert.equal(input(tree, (p) => p.maxLength === 200).props.disabled, true, "Saved draft is immutable on retry");
  nodes(tree).find((node) => node.type === "form").props.onSubmit({ preventDefault() {} }); await settle();
  assert.equal(confirmations[0].requestId, saved.id);
  assert.equal(confirmations[0].body, saved.body);

  reset({ availability: { ...availability, connected: false, slots: [], message: "Reconnect Ryan’s Google account" } });
  const offline = mount(ui.InquiryBooking, props);
  offline.render(); await settle(); tree = offline.render();
  assert.equal(button(tree, "Review confirmation").props.disabled, true);
  assert.ok(words(tree).includes("Reconnect Ryan’s Google account"));

  reset({ booking: { ...saved, status: "confirmed" }, calendarWarning: "This event was moved in Google Calendar. Review the appointment before relying on its saved time." });
  const changed = mount(ui.InquiryBooking, props);
  changed.render(); await settle(); tree = changed.render();
  assert.ok(words(tree).includes("Calendar needs review"), "Calendar drift cannot retain an unqualified confirmed badge");
  assert.ok(words(tree).includes("Previously confirmed walkthrough"));
  assert.ok(!words(tree).includes("Your confirmed walkthrough"));
  assert.equal(confirmations.length + proposals.length, 0, "Reading a changed event never recreates it");

  reset({ booking: { ...saved, status: "confirmed" } });
  const cancelView = mount(ui.InquiryBooking, props);
  cancelView.render(); await settle(); tree = cancelView.render();
  button(tree, "Cancel walkthrough").props.onClick(); tree = cancelView.render();
  assert.equal(cancellations.length, 0, "Cancel first opens a review with the date and homeowner");
  assert.ok(words(tree).includes("pat@example.com"));
  assert.ok(words(tree).includes("sends the homeowner a calendar cancellation"));
  button(tree, "Cancel & notify homeowner").props.onClick();
  button(tree, "Cancel & notify homeowner").props.onClick();
  await settle(); tree = cancelView.render(); await settle(); tree = cancelView.render();
  assert.equal(cancellations.length, 1, "Cancellation double-click is guarded");
  assert.equal(cancellations[0].bookingId, saved.id);
  assert.equal(cancellations[0].inquiryId, inquiry.id);
  assert.ok(words(tree).includes("Cancelled walkthrough"));
  nodes(tree).find((node) => node.type === "button" && words(node) === "10:00 AM").props.onClick(); tree = cancelView.render();
  assert.equal(button(tree, "Review suggested time").props.disabled, false, "Even the original time becomes a proposal after cancellation");
  input(tree, (p) => p.type === "checkbox").props.onChange({ target: { checked: true } }); tree = cancelView.render();
  assert.equal(button(tree, "Review confirmation").props.disabled, true);
  input(tree, (p) => p.maxLength === 1000).props.onChange({ target: { value: "Homeowner confirmed replacement by phone" } }); tree = cancelView.render();
  button(tree, "Review confirmation").props.onClick(); tree = cancelView.render();
  nodes(tree).find((node) => node.type === "form").props.onSubmit({ preventDefault() {} }); await settle();
  assert.equal(confirmations[0].homeownerConfirmed, true);
  assert.notEqual(confirmations[0].requestId, saved.id, "A replacement uses a new booking, never reuses the cancelled event");

  reset({ booking: { ...saved, status: "confirmed" } });
  const readonlyCancel = mount(ui.InquiryBooking, { ...props, readOnly: true });
  readonlyCancel.render(); await settle(); tree = readonlyCancel.render();
  assert.equal(button(tree, "Cancel walkthrough").props.disabled, true);

  reset({ booking: { ...saved, status: "needs_attention", cancel_requested_at: "2026-11-04T17:00:00Z" } });
  const unfinishedCancel = mount(ui.InquiryBooking, props);
  unfinishedCancel.render(); await settle(); tree = unfinishedCancel.render();
  assert.ok(words(tree).includes("Cancellation needs attention"));
  assert.ok(button(tree, "Review cancellation"));
  assert.ok(!nodes(tree).some((node) => node.type === "Button" && words(node) === "Review saved confirmation"), "Cancellation intent can never expose confirmation recovery");
  console.log("Walkthrough UI: review gates, alternatives, duplicate guards, saved recovery, calendar drift, cancellation and renewed agreement passed.");
})().catch((error) => { console.error(error); process.exitCode = 1; });
