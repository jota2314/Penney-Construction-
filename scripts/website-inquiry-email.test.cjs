// All Google, email, and database transports are mocked. This test never sends mail.
const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const ts = require("typescript");

function load(file, imports = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require(id) { if (!(id in imports)) throw new Error(`Unmocked import ${id}`); return imports[id]; }, Date, Intl, Error, console });
  return exports;
}
const days = load("src/lib/sub-portal/et-day.ts");
const model = load("src/lib/inquiries/model.ts", { "@/lib/sub-portal/et-day": days });
const roleAccess = load("src/lib/auth/role-access.ts", { "@/lib/inquiries/model": model, "@/lib/marketing/access": load("src/lib/marketing/access.ts") });
const inquiryId = "11111111-1111-4111-a111-111111111111";
const requestId = "22222222-2222-4222-a222-222222222222";
const userId = "33333333-3333-4333-a333-333333333333";
const stamp = "2026-11-04T15:00:00.000Z";
const email = "jbetancur@penneyconstructioninc.com";
const clientEmail = "homeowner@example.com";
const input = { id: inquiryId, requestId, expectedUpdatedAt: stamp, expectedRecipient: clientEmail, expectedSender: email, subject: "Your website inquiry", body: "Hi Pat,\n\nThank you for reaching out." };
let state;
function reset(patch = {}) {
  state = {
    user: { id: userId, email, profile: { id: userId, email, role: "owner" }, realProfile: { id: userId, email, role: "owner" }, isImpersonating: false },
    member: true,
    inquiry: { id: inquiryId, updated_at: stamp, contact_name: "Pat", description: "Email: homeowner@example.com", website_inquiry: { email: clientEmail }, intake_status: "new", status: "open" },
    prior: null, history: [], mailbox: email, googleOk: true, googleError: null,
    inquiryError: null, priorError: null,
    claim: { data: { id: requestId, status: "sending", claimed: true }, error: null },
    finish: { data: { id: requestId, status: "sent" }, error: null },
    uncertain: { data: { id: requestId, status: "uncertain" }, error: null },
    failed: { data: { id: requestId, status: "failed" }, error: null },
    deleted: { data: { id: inquiryId, deleted: true }, error: null },
    sent: { id: "gmail-message-test", threadId: "gmail-thread-test" }, sendError: null,
    queries: [], adminCalls: [], sessionCalls: [], sendCalls: [], googleCalls: [], invalidations: [], adminCreated: 0,
    ...patch,
  };
}
const db = {
  async rpc(name, args) {
    state.sessionCalls.push({ name, args });
    if (name === "can_access_website_inquiries") return { data: state.member, error: null };
    if (name === "delete_website_inquiry") return state.deleted;
    throw new Error(`Unexpected session RPC ${name}`);
  },
  from(table) {
    const query = { table, filters: [] };
    state.queries.push(query);
    return {
      select(columns) { query.columns = columns; return this; },
      eq(column, value) { query.filters.push([column, value]); return this; },
      order() { return this; }, range() { return this; },
      async maybeSingle() {
        if (table === "todos") return { data: state.inquiry, error: state.inquiryError };
        if (table === "website_inquiry_emails") return { data: state.prior, error: state.priorError };
        throw new Error(`Unexpected table ${table}`);
      },
      async throwOnError() { return { data: state.history, error: null }; },
    };
  },
};
const shared = {
  "next/cache": { revalidatePath(path) { if (state.refreshThrows) throw new Error("Cache unavailable"); state.invalidations.push(path); } },
  "@/lib/auth/get-user": { getUser: async () => state.user },
  "@/lib/auth/role-access": roleAccess,
  "@/lib/supabase/server": { createClient: async () => db },
  "@/lib/supabase/fetch-all": { fetchAllRows: async (fetch) => (await fetch(0, 999)).data },
  "@/lib/inquiries/model": model,
};
const actions = load("src/lib/actions/website-inquiry-email.ts", {
  ...shared,
  "@/lib/supabase/admin": { createAdminClient() {
    state.adminCreated++;
    return { async rpc(name, args) {
      state.adminCalls.push({ name, args });
      if (name === "begin_website_inquiry_email") return state.claim;
      if (name === "finish_website_inquiry_email") { if (state.finishThrows) throw new Error("Database connection lost"); return state.finish; }
      if (name === "mark_website_inquiry_email_uncertain") { if (state.uncertainThrows) throw new Error("Database connection lost"); return state.uncertain; }
      if (name === "mark_website_inquiry_email_failed") return state.failed;
      throw new Error(`Unexpected admin RPC ${name}`);
    } };
  } },
  "@/lib/google/auth": { async googleFetch(url) {
    state.googleCalls.push(url);
    if (state.googleError) throw state.googleError;
    return { ok: state.googleOk, async json() { return { emailAddress: state.mailbox }; } };
  } },
  "@/lib/google/gmail": { async sendEmail(payload) {
    state.sendCalls.push(payload);
    if (state.sendError) throw state.sendError;
    return state.sent;
  } },
});
const inquiryActions = load("src/lib/actions/website-inquiries.ts", shared);
const prior = (status) => ({ id: requestId, inquiry_id: inquiryId, sender_profile_id: userId, recipient_email: clientEmail, subject: input.subject, body: input.body, status, gmail_message_id: status === "sent" ? "prior-message" : null });

(async () => {
  reset();
  assert.equal((await actions.getWebsiteInquiryEmailSender()).email, email);
  assert.equal(state.sendCalls.length, 0); assert.equal(state.adminCreated, 0);
  assert.equal(state.googleCalls[0], "https://gmail.googleapis.com/gmail/v1/users/me/profile");
  for (const [signedIn, mailbox] of [[email, "jorgebetancurfx@gmail.com"], ["jorgebetancurfx@gmail.com", email]]) {
    reset({ mailbox }); state.user.email = signedIn; state.user.profile.email = signedIn; state.user.realProfile.email = signedIn;
    assert.equal((await actions.getWebsiteInquiryEmailSender()).email, mailbox);
    assert.equal((await actions.sendWebsiteInquiryEmail({ ...input, expectedSender: mailbox })).success, true);
  }
  reset({ mailbox: "rpenney@penneyconstructioninc.com" });
  assert.equal((await actions.getWebsiteInquiryEmailSender()).email, null);
  assert.equal((await actions.sendWebsiteInquiryEmail({ ...input, expectedSender: state.mailbox })).success, false);
  assert.equal(state.sendCalls.length, 0);

  for (const user of [null, { id: userId, email: "other@example.com", profile: { email }, realProfile: { email } },
    { id: userId, email, profile: { email: "other@example.com" }, realProfile: { email } },
    { id: userId, email, profile: { email }, realProfile: { email: "other@example.com" } },
    { id: userId, email, profile: { email }, realProfile: { email }, isImpersonating: true }]) {
    reset({ user });
    assert.equal((await actions.sendWebsiteInquiryEmail(input)).success, false);
    assert.equal((await actions.getWebsiteInquiryEmailSender()).email, null);
    assert.equal(state.adminCreated, 0); assert.equal(state.googleCalls.length, 0); assert.equal(state.sendCalls.length, 0);
  }
  reset({ member: false });
  assert.equal((await actions.sendWebsiteInquiryEmail(input)).success, false); assert.equal(state.queries.length, 0); assert.equal(state.adminCreated, 0);
  await assert.rejects(() => actions.listWebsiteInquiryEmails(inquiryId), /access could not be confirmed/);

  for (const patch of [{ id: "invalid" }, { requestId: "invalid" }, { expectedUpdatedAt: "bad" }, { subject: "" }, { subject: "a".repeat(201) }, { subject: "Hello\r\nBcc: someone@example.com" }, { body: " " }, { body: "a".repeat(20001) }, { body: "hello\u0000world" }, { expectedRecipient: "a@example.com,b@example.com" }, { expectedSender: "a@example.com\r\nBcc:b@example.com" }]) {
    reset(); assert.equal((await actions.sendWebsiteInquiryEmail({ ...input, ...patch })).success, false); assert.equal(state.adminCreated, 0); assert.equal(state.sendCalls.length, 0);
  }
  for (const patch of [{ inquiry: null }, { inquiryError: { message: "no access" } }, { priorError: { message: "unavailable" } },
    { inquiry: { description: "Email: replaced@example.com", website_inquiry: null } },
    { inquiry: { description: "", website_inquiry: { email: "invalid" } } },
    { googleOk: false }, { googleError: new Error("not connected") }, { mailbox: "someone-else@example.com" }]) {
    reset(patch); assert.equal((await actions.sendWebsiteInquiryEmail(input)).success, false); assert.equal(state.adminCreated, 0); assert.equal(state.sendCalls.length, 0);
  }
  reset(); assert.equal((await actions.sendWebsiteInquiryEmail({ ...input, expectedSender: "rpenney@penneyconstructioninc.com" })).success, false); assert.equal(state.adminCreated, 0);

  reset();
  const body = 'Hi <Pat>,\n\nWe can discuss "A&B" and your <img src="https://example.com/pixel">.';
  const success = await actions.sendWebsiteInquiryEmail({ ...input, body });
  assert.equal(success.success, true); assert.equal(success.messageId, "gmail-message-test");
  assert.equal(state.sendCalls.length, 1);
  assert.equal(state.sendCalls[0].to, clientEmail);
  assert.equal(state.sendCalls[0].body, 'Hi &lt;Pat&gt;,\n\nWe can discuss &quot;A&amp;B&quot; and your &lt;img src=&quot;https://example.com/pixel&quot;&gt;.');
  assert.equal(Object.keys(state.sendCalls[0]).sort().join(","), "body,subject,to");
  assert.equal(state.adminCalls[0].name, "begin_website_inquiry_email");
  assert.equal(state.adminCalls[0].args.p_body, body);
  assert.equal(state.adminCalls[0].args.p_sender_profile_id, userId);
  assert.equal(state.adminCalls[0].args.p_expected_updated_at, stamp);
  assert.equal(state.adminCalls[1].name, "finish_website_inquiry_email");
  assert.equal(state.adminCalls[1].args.p_gmail_message_id, "gmail-message-test");
  assert.ok(state.queries[0].filters.some(([key, value]) => key === "source" && value === "website"));
  assert.ok(state.invalidations.includes(`/command-center/inquiries/${inquiryId}`));

  reset({ prior: prior("sent") });
  const repeated = await actions.sendWebsiteInquiryEmail(input);
  assert.equal(repeated.success, true); assert.equal(repeated.alreadySent, true);
  assert.equal(state.sendCalls.length, 0); assert.equal(state.googleCalls.length, 0); assert.equal(state.adminCreated, 0);
  for (const status of ["sending", "uncertain"]) {
    reset({ prior: prior(status) });
    assert.equal((await actions.sendWebsiteInquiryEmail(input)).deliveryUncertain, true); assert.equal(state.sendCalls.length, 0); assert.equal(state.adminCreated, 0);
  }
  reset({ prior: { ...prior("sent"), body: "Different draft" } });
  assert.equal((await actions.sendWebsiteInquiryEmail(input)).success, false); assert.equal(state.sendCalls.length, 0);
  reset({ prior: prior("failed") });
  assert.equal((await actions.sendWebsiteInquiryEmail(input)).success, true); assert.equal(state.sendCalls.length, 1);
  reset({ claim: { data: { claimed: false, status: "sent", gmail_message_id: "raced-message" }, error: null } });
  assert.equal((await actions.sendWebsiteInquiryEmail(input)).alreadySent, true); assert.equal(state.sendCalls.length, 0);
  reset({ claim: { data: { claimed: false, status: "sending" }, error: null } });
  assert.equal((await actions.sendWebsiteInquiryEmail(input)).deliveryUncertain, true); assert.equal(state.sendCalls.length, 0);
  reset({ claim: { data: null, error: { message: "Inquiry changed; refresh before sending" } } });
  assert.match((await actions.sendWebsiteInquiryEmail(input)).error, /changed/); assert.equal(state.sendCalls.length, 0);

  for (const patch of [{ sendError: new Error("network connection lost") }, { sent: {} }, { sendError: new Error('Failed to send email: {"error":{"code":500}}') }, { sendError: new Error("Failed to send email: unrecognized response") }, { sendError: new Error("network connection lost"), uncertainThrows: true }]) {
    reset(patch);
    const result = await actions.sendWebsiteInquiryEmail(input);
    assert.equal(result.success, false); assert.equal(result.deliveryUncertain, true); assert.equal(result.retrySafe, undefined);
    assert.equal(state.sendCalls.length, 1); assert.equal(state.adminCalls[1].name, "mark_website_inquiry_email_uncertain");
    assert.equal(state.adminCalls.some((call) => call.name === "finish_website_inquiry_email"), false);
  }
  const limited = new Error("Rate limited"); limited.name = "GmailRateLimitError";
  for (const sendError of [limited, new Error('Failed to send email: {"error":{"code":403,"message":"Rejected"}}')]) {
    reset({ sendError });
    const result = await actions.sendWebsiteInquiryEmail(input);
    assert.equal(result.success, false); assert.equal(result.retrySafe, true); assert.equal(result.deliveryUncertain, undefined);
    assert.equal(state.sendCalls.length, 1); assert.equal(state.adminCalls[1].name, "mark_website_inquiry_email_failed");
  }
  reset({ sendError: limited, failed: { data: null, error: { message: "DB down" } } });
  assert.equal((await actions.sendWebsiteInquiryEmail(input)).deliveryUncertain, true);
  for (const patch of [{ finish: { data: null, error: { message: "DB unavailable" } } }, { finishThrows: true }]) {
    reset(patch);
    const result = await actions.sendWebsiteInquiryEmail(input);
    assert.equal(result.success, true); assert.match(result.warning, /Do not send it again/);
    assert.equal(state.sendCalls.length, 1);
  }
  reset({ refreshThrows: true }); assert.equal((await actions.sendWebsiteInquiryEmail(input)).success, true); assert.equal(state.sendCalls.length, 1);

  reset({ history: [
    { ...prior("sent"), sender: { full_name: "Jorge Betancur" } },
    { ...prior("failed"), sender: [{ full_name: "Ryan Penney" }] },
    { ...prior("uncertain"), sender: null },
  ] });
  const history = await actions.listWebsiteInquiryEmails(inquiryId);
  assert.equal(history.length, 3);
  assert.equal(history[0].sender_name, "Jorge Betancur");
  assert.equal(history[1].sender_name, "Ryan Penney");
  assert.equal(history[2].sender_name, null);
  assert.equal("sender" in history[0], false);
  assert.equal(state.adminCreated, 0); assert.equal(state.queries[0].table, "website_inquiry_emails");
  assert.ok(state.queries[0].columns.endsWith("sender:profiles!website_inquiry_emails_sender_profile_id_fkey(full_name)"));
  assert.ok(state.queries[0].filters.some(([key, value]) => key === "inquiry_id" && value === inquiryId));

  reset(); assert.equal((await inquiryActions.deleteWebsiteInquiry({ id: inquiryId, expectedUpdatedAt: stamp })).error, null);
  assert.equal(state.sessionCalls[0].name, "delete_website_inquiry");
  assert.equal(state.sessionCalls[0].args.p_expected_updated_at, stamp); assert.equal(state.adminCreated, 0);
  reset({ deleted: { data: null, error: { message: "An email is still sending" } } });
  assert.match((await inquiryActions.deleteWebsiteInquiry({ id: inquiryId, expectedUpdatedAt: stamp })).error, /still sending/);
  reset({ deleted: { data: { deleted: true, id: userId }, error: null } });
  assert.match((await inquiryActions.deleteWebsiteInquiry({ id: inquiryId, expectedUpdatedAt: stamp })).error, /could not be confirmed/);
  reset(); assert.ok((await inquiryActions.deleteWebsiteInquiry({ id: "bad", expectedUpdatedAt: stamp })).error); assert.equal(state.sessionCalls.length, 0);
  reset(); state.user.isImpersonating = true;
  assert.ok((await inquiryActions.deleteWebsiteInquiry({ id: inquiryId, expectedUpdatedAt: stamp })).error); assert.equal(state.sessionCalls.length, 0);

  console.log("PASS: named/session permissions, actual sender review, fixed saved recipient, validation/HTML escaping, atomic idempotency, explicit-rejection retry, uncertain-delivery lock, confirmed-send warning, private history, and guarded deletion. All transports mocked; no emails sent.");
})().catch((error) => { console.error(error); process.exit(1); });
