/**
 * Single-email classifier using Haiku 4.5.
 * Returns sender_type, urgency, summary, action flag, and matched entity.
 *
 * Context: the model gets a compact DIRECTORY — open jobs (number, name,
 * client, address, aliases, status), clients with no open job, and
 * subcontractors/vendors — as plain names, not UUIDs. The old prompt pasted
 * every customer/sub/project id with no addresses, so the model couldn't match
 * a job by its address. The model answers with a job number and names; code
 * maps them back to ids and only accepts what it offered.
 *
 * Who SENT the email is resolved in code from the address first. Teammate and
 * shared no-reply addresses never resolve to a contact.
 *
 * Caching: system prompt + directory is identical across emails and clears
 * Haiku 4.5's 4,096-token cache minimum, so it carries cache_control.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAnthropicClientServer } from "@/lib/ai/claude-server";
import { logAiUsage } from "@/lib/ai/claude";
import { createAdminClient } from "@/lib/supabase/admin";
import { emailBodyToText, toWellFormedText } from "./body-text";

const MODEL = "claude-haiku-4-5-20251001";
const BODY_CHARS = 3000;
const TEAM_DOMAIN = "penneyconstructioninc.com";
// Finished jobs stay matchable this long so final bills and punch-list mail
// still find them. Cancelled jobs never match.
const FINISHED_MATCH_DAYS = 120;
const FINISHED_STATUSES = new Set(["completed", "audit"]);
// Demo/test records share real addresses and emails (e.g. "TEST – Invoice
// Demo" sits at a real client's address); keep them out of matching.
const TEST_RECORD = /^test(y)?\b/i;
// Shared senders: one address delivers mail for many businesses, so an exact
// address match to a contact record proves nothing. (billing@ or invoices@ on
// a company's own domain IS that company, so those aren't listed.)
const SHARED_LOCAL_PART = /^(no-?reply|do-?not-?reply|donotreply|notifications?|mailer(-daemon)?|bounces?)([+._-]|$)/i;
const PLATFORM_DOMAINS = [
  "joistapp.com", "intuit.com", "housecallpro.com", "getinvoicesimple.com", "bookipi.com",
  "docusign.net", "docusign.com", "opengov.com", "buildertrend.com", "companycam.com",
  "squareup.com", "square.com", "stripe.com", "paypal.com", "google.com",
];
// Personal mailbox providers: a shared domain says nothing about the company.
const FREEMAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "ymail.com", "rocketmail.com", "aol.com", "aim.com", "msn.com",
  "icloud.com", "me.com", "mac.com", "comcast.net", "verizon.net", "att.net", "sbcglobal.net",
  "bellsouth.net", "cox.net", "charter.net", "rcn.com", "earthlink.net", "optonline.net",
  "frontier.com", "juno.com", "netzero.net", "protonmail.com", "proton.me", "gmx.com", "gmx.net",
  "mail.com", "zoho.com", "fastmail.com", "hey.com", "tutanota.com",
]);
// Country variants: yahoo.co.uk, hotmail.fr, outlook.ie, live.ca ...
const FREEMAIL_FAMILY = /^(yahoo|hotmail|outlook|live|aol)\.[a-z.]+$/i;

export interface ClassificationProject {
  id: string;
  project_number: string | null;
  name: string;
  status: string | null;
  customer_id: string | null;
  client: string | null;
  address: string | null;
  aliases: string[];
}

export interface ClassificationContext {
  customers: { id: string; name: string; email: string | null }[];
  subs: { id: string; name: string; email: string | null; trades: string[] }[];
  projects: ClassificationProject[];
}

export interface ClassificationResult {
  sender_type: "client" | "sub" | "vendor" | "internal" | "personal" | "spam" | "unknown";
  urgency: "urgent" | "normal" | "low" | "junk";
  summary: string;
  action_required: boolean;
  content_type: "invoice" | "quote" | "payment_receipt" | "schedule" | "contract" | "inquiry" | "update" | "newsletter" | "other";
  matched_customer_id: string | null;
  matched_subcontractor_id: string | null;
  matched_project_id: string | null;
}

// Mirrors the inbox_emails CHECK constraints — anything else would make the
// persist update fail, which used to happen silently.
const SENDER_TYPES = new Set<ClassificationResult["sender_type"]>(["client", "sub", "vendor", "internal", "personal", "spam", "unknown"]);
const URGENCIES = new Set<ClassificationResult["urgency"]>(["urgent", "normal", "low", "junk"]);
const CONTENT_TYPES = new Set<ClassificationResult["content_type"]>(["invoice", "quote", "payment_receipt", "schedule", "contract", "inquiry", "update", "newsletter", "other"]);

/** Load classification context from DB once per batch */
export async function loadClassificationContext(
  supabase: SupabaseClient
): Promise<ClassificationContext> {
  const [customersRes, subsRes, projectsRes] = await Promise.all([
    // Ordered so duplicate names always render, and resolve, the same way.
    supabase.from("customers").select("id, first_name, last_name, email").order("id"),
    supabase.from("subcontractors").select("id, company_name, email, trades").order("id"),
    supabase
      .from("projects")
      .select("id, project_number, name, status, address, city, aliases, customer_id, updated_at, customer:customers(first_name, last_name)")
      .neq("status", "cancelled")
      .order("project_number", { ascending: true }),
  ]);
  // A partial load would save confident-looking "not in contacts" results
  // that nothing ever redoes. Fail the batch instead; it is retried.
  for (const [label, res] of [["Customers", customersRes], ["Subcontractors", subsRes], ["Job directory", projectsRes]] as const) {
    if (res.error) throw new Error(`${label} load failed: ${res.error.message}`);
  }

  const finishedCutoff = Date.now() - FINISHED_MATCH_DAYS * 86_400_000;
  const projects: ClassificationProject[] = [];
  for (const p of projectsRes.data ?? []) {
    if (TEST_RECORD.test(p.name ?? "")) continue;
    if (
      FINISHED_STATUSES.has(p.status ?? "") &&
      (!p.updated_at || new Date(p.updated_at).getTime() < finishedCutoff)
    ) {
      continue;
    }
    const customer = (Array.isArray(p.customer) ? p.customer[0] : p.customer) as
      | { first_name: string | null; last_name: string | null }
      | null
      | undefined;
    const client = customer
      ? `${customer.first_name ?? ""} ${customer.last_name ?? ""}`.trim() || null
      : null;
    const street = (p.address ?? "").trim();
    const city = (p.city ?? "").trim();
    const address =
      [street, city && !street.toLowerCase().includes(city.toLowerCase()) ? city : ""]
        .filter(Boolean)
        .join(", ") || null;
    projects.push({
      id: p.id,
      project_number: p.project_number,
      name: p.name,
      status: p.status,
      customer_id: p.customer_id,
      client,
      address,
      aliases: (p.aliases ?? []).filter((a: unknown): a is string => typeof a === "string" && a.trim() !== ""),
    });
  }

  return {
    customers: (customersRes.data ?? [])
      .map((c) => ({
        id: c.id,
        name: `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim(),
        email: c.email,
      }))
      .filter((c) => c.name !== "" && !TEST_RECORD.test(c.name)),
    subs: (subsRes.data ?? [])
      .map((s) => ({
        id: s.id,
        name: s.company_name ?? "",
        email: s.email,
        trades: s.trades ?? [],
      }))
      .filter((s) => s.name.trim() !== ""),
    projects,
  };
}

function clean(value: string | null | undefined): string {
  return (value ?? "").replace(/[|\n\r]+/g, " ").trim() || "-";
}

// Plain code-unit order (not localeCompare), ties broken by id: the cached
// prefix must be byte-identical across calls and runtimes.
const byName = (a: { id: string; name: string }, b: { id: string; name: string }) =>
  a.name < b.name ? -1 : a.name > b.name ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

function buildDirectoryBlock(ctx: ClassificationContext): string {
  const lines = ["## Job directory", "number | job | client | address | also called | status"];
  for (const p of ctx.projects) {
    lines.push(
      [
        clean(p.project_number),
        clean(p.name),
        clean(p.client),
        clean(p.address),
        clean(p.aliases.join("; ")),
        clean(p.status),
      ].join(" | ")
    );
  }

  const withJob = new Set(ctx.projects.map((p) => p.customer_id).filter(Boolean));
  lines.push("", "## Other clients (no open job above)");
  for (const c of [...ctx.customers].filter((c) => !withJob.has(c.id)).sort(byName)) {
    lines.push(`${clean(c.name)}${c.email ? ` <${clean(c.email)}>` : ""}`);
  }

  lines.push("", "## Subcontractors and vendors");
  for (const s of [...ctx.subs].sort(byName)) {
    lines.push(`${clean(s.name)}${s.trades.length ? ` (${clean(s.trades.join(", "))})` : ""}`);
  }
  return toWellFormedText(lines.join("\n"));
}

function normalizeEmail(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function domainOf(addr: string): string {
  return addr.split("@")[1] ?? "";
}

function isSharedSender(addr: string): boolean {
  const [local, domain = ""] = addr.split("@");
  return (
    SHARED_LOCAL_PART.test(local ?? "") ||
    PLATFORM_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`))
  );
}

function isFreemail(domain: string): boolean {
  return FREEMAIL_DOMAINS.has(domain) || FREEMAIL_FAMILY.test(domain);
}

interface SenderInfo {
  isTeam: boolean;
  domain: string;
  /** Records whose email IS the sender's address. */
  customers: ClassificationContext["customers"];
  /** Those plus same-name duplicates (one client entered twice). */
  customerFamily: ClassificationContext["customers"];
  subs: ClassificationContext["subs"];
  description: string;
}

/** Resolve who sent the email from Penney's records — no model needed. */
function resolveSender(fromEmail: string, ctx: ClassificationContext): SenderInfo {
  const addr = normalizeEmail(fromEmail);
  const domain = domainOf(addr);
  const isTeam = addr.endsWith(`@${TEAM_DOMAIN}`);
  // A teammate's or a shared platform's address on a contact record is a
  // data-entry slip (e.g. a test customer saved with Jorge's address); never
  // let it pin the email to that contact.
  const lookup = addr !== "" && !isTeam && !isSharedSender(addr);
  const customers = lookup ? ctx.customers.filter((c) => normalizeEmail(c.email) === addr) : [];
  const names = new Set(customers.map((c) => c.name.trim().toLowerCase()));
  const customerFamily = ctx.customers.filter((c) => names.has(c.name.trim().toLowerCase()));
  let subs = lookup ? ctx.subs.filter((s) => normalizeEmail(s.email) === addr) : [];
  // A colleague at the same company writes from another address on the same
  // business domain. Only when exactly one sub uses that domain.
  if (lookup && subs.length === 0 && customers.length === 0 && domain && !isFreemail(domain)) {
    const sameDomain = ctx.subs.filter((s) => domainOf(normalizeEmail(s.email)) === domain);
    if (sameDomain.length === 1) subs = sameDomain;
  }

  const parts: string[] = [];
  if (isTeam) {
    parts.push("A Penney Construction teammate (internal mail).");
  }
  if (customers.length > 0) {
    const ids = new Set(customerFamily.map((c) => c.id));
    const jobs = ctx.projects.filter((p) => p.customer_id && ids.has(p.customer_id));
    const jobList = jobs.length
      ? jobs.map((j) => `${j.project_number ?? "?"} (${j.name}, ${j.status ?? "?"})`).join("; ")
      : "none in the directory";
    parts.push(`A known CLIENT: ${customers.map((c) => c.name).join(" / ")}. Their jobs: ${jobList}.`);
  }
  if (subs.length > 0) {
    parts.push(
      `A known SUBCONTRACTOR or VENDOR: ${subs
        .map((s) => `${s.name}${s.trades.length ? ` (${s.trades.join(", ")})` : ""}`)
        .join(" / ")}.`
    );
  }
  if (parts.length === 0) {
    parts.push(isSharedSender(addr) ? "A shared or automated sending address (not tied to one contact)." : "Not in Penney's contacts.");
  }

  return { isTeam, domain, customers, customerFamily, subs, description: parts.join(" ") };
}

const SYSTEM_PROMPT = `You are an inbox classifier for Penney Construction, a residential general contractor in Massachusetts. For each email, return a JSON object with:

- sender_type: who sent it
  - "client" — a homeowner / customer / prospective customer
  - "sub" — a subcontractor (electrician, plumber, framer, etc.)
  - "vendor" — supplier (lumber yard, hardware, tool company, software service)
  - "internal" — a Penney Construction employee (anyone @penneyconstructioninc.com)
  - "personal" — non-business email to Jorge
  - "spam" — marketing/newsletters/cold outreach with no business value
  - "unknown" — can't tell
  The SENDER line in each email is looked up from Penney's own records — trust it.

- urgency:
  - "urgent" — needs reply / action today (deadline, problem on site, missed inspection, late payment, client unhappy, walkthrough request)
  - "normal" — needs attention soon (quote request, scheduling, project update)
  - "low" — informational, no action needed (FYI, automated notification, receipt)
  - "junk" — newsletters, ads, irrelevant outreach — basically delete-worthy

  IMPORTANT — distinguish "service notifications" from "real business emails delivered
  via a service":

  • Service NOTIFICATIONS from SaaS / accounting / PM tools (Buildertrend, Procore,
    CompanyCam, QuickBooks, Houzz, Gusto, Stripe, Indeed, LinkedIn, Slack, Asana, etc.)
    — i.e. the tool itself is talking to you about the tool ("daily digest",
    "subscription renewing", "you have 3 new leads", "weekly summary", "X just commented")
    — are almost never urgent. Default to "low". Weekly digests → "junk".

  • REAL emails delivered THROUGH a service (e.g. QuickBooks-delivered invoice from a
    sub for $12k, Buildertrend-routed client message, Stripe receipt for an actual
    payment Penney made/received, a quote PDF attached) ARE real business emails —
    classify by their actual content (quote → normal, overdue invoice → urgent, etc.).
    Look at the body and any attachments, not just the sender domain.

  Rule of thumb: if the email is a robot talking ABOUT the tool, it's low/junk. If a
  human or document is being delivered via the tool, classify the underlying content.

- summary: ONE concise sentence (max 12 words) describing what the email is about. Write it like Jorge would skim it. Examples: "Pedersen wants Friday walkthrough", "Plumber sub asking about timeline", "Home Depot receipt $234".

- action_required: true if Jorge (or anyone at Penney) needs to do something. false if informational only.
  - "please pay this invoice" = true. "payment received receipt" = false.
  - "new quote for review" = true. "quote acknowledged, will follow up" = false.
  - "schedule change" = true. "schedule confirmation" = false.
  - A client approving, signing, agreeing to a price or a change order, or sending a deposit = true (someone must act on it), even if the message is short.
  - Robot-style service notifications (Buildertrend daily digest, "your subscription
    renews", "weekly summary") = false. But a real invoice or quote delivered through
    QuickBooks/Buildertrend = true if it asks Penney to act.

- content_type: what KIND of email is it
  - "invoice" — a bill, invoice or statement asking PENNEY to pay
  - "quote" — bid, proposal, estimate, pricing from a sub or vendor
  - "payment_receipt" — confirmation of money received or paid
  - "schedule" — meeting invite, calendar update, walkthrough, scheduling discussion
  - "contract" — signed contract, change order, agreement
  - "inquiry" — new lead, question from a homeowner / prospective client
  - "update" — status update on a project (no action, just FYI)
  - "newsletter" — marketing, promotional, blog post
  - "other" — none of the above
  An invoice that Penney Construction itself sends to its own client (Penney is the biller, e.g. "Invoice #3 … | Penney Construction") is NOT a bill Penney owes: use "update".

- matched_project_number: the job this email is about, as its number from the job directory (e.g. "PC-2026-224"), or null.
  Match only on evidence in this email or its sender: the job number, the street address (ignore spelling of street suffixes like "Cir"/"Circle", but a different unit number is a different job), the client's name, or a name the job is also called.
  If the sender is a known client with exactly one job in the directory and nothing in the email points elsewhere, use that job.
  If the evidence fits more than one job, or you would be guessing, return null. A wrong job is worse than no job.

- matched_client: if the email is from or about one of Penney's clients, that client's name exactly as written in the directory (the job directory's client column or "Other clients"), name only, without the email address; otherwise null.

- matched_sub: if the email is from or about one of the listed subcontractors or vendors (for example an invoice or quote they sent through a billing service), its name exactly as listed, without the trades in parentheses; otherwise null.

Output ONLY a JSON object with exactly these keys: sender_type, urgency, summary, action_required, content_type, matched_project_number, matched_client, matched_sub. No other text.`;

export async function classifyEmail(opts: {
  email: {
    from_name: string;
    from_email: string;
    to_email?: string | null;
    subject: string;
    snippet: string;
    body?: string;
  };
  context: ClassificationContext;
  /** Per-request timeout. Callers racing a function deadline pass the time they have left. */
  timeoutMs?: number;
  maxRetries?: number;
}): Promise<ClassificationResult> {
  const { email, context } = opts;
  const client = await getAnthropicClientServer();

  const sender = resolveSender(email.from_email, context);
  const bodyText = emailBodyToText(email.body).slice(0, BODY_CHARS) || emailBodyToText(email.snippet);

  // Well-formed after the cut: slicing at a fixed length can split an emoji,
  // and a lone surrogate makes the request a permanent 400.
  const userMsg = toWellFormedText(`EMAIL TO CLASSIFY:
From: ${email.from_name} <${email.from_email}>${email.to_email ? `\nTo: ${email.to_email}` : ""}
Subject: ${email.subject}
SENDER (from Penney's records): ${sender.description}
${bodyText ? `\nBody (plain text, first ${BODY_CHARS} characters):\n${bodyText}` : "\n(no body)"}

Return classification JSON.`);

  const response = await client.messages.create(
    {
      model: MODEL,
      max_tokens: 400,
      // Classification: the same email should get the same answer every time.
      temperature: 0,
      system: [
        { type: "text", text: SYSTEM_PROMPT },
        { type: "text", text: buildDirectoryBlock(context), cache_control: { type: "ephemeral" } },
      ],
      messages: [{ role: "user", content: userMsg }],
    },
    { timeout: opts.timeoutMs ?? 30_000, maxRetries: opts.maxRetries ?? 1 }
  );

  await logAiUsage({
    supabase: createAdminClient(),
    endpoint: "email-classify",
    model: MODEL,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
    cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
    context: `cache_read=${response.usage.cache_read_input_tokens ?? 0} cache_write=${response.usage.cache_creation_input_tokens ?? 0}`,
  });

  const textBlock = response.content.find((c) => c.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new UnclassifiableError("No text response from Haiku");
  }

  // Take the outermost {...} so code fences or a stray sentence don't break parsing.
  const raw = textBlock.text;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) throw new UnclassifiableError("Classifier returned no JSON");
  let parsed: Partial<
    Omit<ClassificationResult, "matched_project_id" | "matched_customer_id" | "matched_subcontractor_id"> & {
      matched_project_number: string | null;
      matched_client: string | null;
      matched_sub: string | null;
    }
  >;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch (err) {
    throw new UnclassifiableError(`Classifier JSON unreadable: ${err instanceof Error ? err.message : String(err)}`);
  }

  const project = findProject(parsed.matched_project_number, context.projects);

  // Customer, when the sender IS a client: their record — the matched job's
  // client when they were entered twice, else the duplicate that owns a job,
  // else the oldest id (stable).
  const withJob = new Set(context.projects.map((p) => p.customer_id));
  const senderCustomer =
    sender.customerFamily.find((c) => c.id === project?.customer_id) ??
    sender.customerFamily.find((c) => withJob.has(c.id)) ??
    sender.customers[0] ??
    null;
  // Otherwise "who this email is about" (a client the email names, or the
  // matched job's client) — but only for mail from a teammate or a known sub.
  // From an unknown outsider, a named client is usually a referral, and
  // estimating intake reads matched_customer_id as the requester.
  const aboutAllowed = sender.isTeam || sender.subs.length > 0;
  const customer =
    senderCustomer ??
    (aboutAllowed
      ? findByName(parsed.matched_client, context.customers, project?.customer_id, sender.domain) ??
        (project?.customer_id ? context.customers.find((c) => c.id === project.customer_id) ?? null : null)
      : null);

  const sub = sender.subs[0] ?? findByName(parsed.matched_sub, context.subs, null, sender.domain);

  const senderType = sender.isTeam
    ? "internal"
    : SENDER_TYPES.has(parsed.sender_type as ClassificationResult["sender_type"])
      ? (parsed.sender_type as ClassificationResult["sender_type"])
      : "unknown";

  return {
    sender_type: senderType,
    urgency: URGENCIES.has(parsed.urgency as ClassificationResult["urgency"])
      ? (parsed.urgency as ClassificationResult["urgency"])
      : "normal",
    summary: toWellFormedText(String(parsed.summary ?? "").substring(0, 200)),
    action_required: !!parsed.action_required,
    content_type: CONTENT_TYPES.has(parsed.content_type as ClassificationResult["content_type"])
      ? (parsed.content_type as ClassificationResult["content_type"])
      : "other",
    matched_customer_id: customer?.id ?? null,
    matched_subcontractor_id: sub?.id ?? null,
    matched_project_id: project?.id ?? null,
  };
}

/** The model's answer can't be used; retrying the same email won't help. */
export class UnclassifiableError extends Error {}

/**
 * Map the model's job number back to a project we actually offered. Anything
 * not in the directory (hallucinated, cancelled, malformed) becomes null.
 */
function findProject(
  value: string | null | undefined,
  projects: ClassificationProject[]
): ClassificationProject | null {
  if (!value || typeof value !== "string") return null;
  const wanted = value.match(/PC-\d{4}-\d+/i)?.[0]?.toUpperCase();
  if (!wanted) return null;
  return projects.find((p) => p.project_number?.toUpperCase() === wanted) ?? null;
}

/**
 * Map a name the model copied from the directory back to its record. Exact
 * (case-insensitive) match after dropping a copied "<email>" or "(trades)"
 * tail. Duplicate names (one company entered twice) resolve to the preferred
 * id, then a record on the sender's email domain, then one with an email,
 * then the oldest id — never at random.
 */
function findByName<T extends { id: string; name: string; email: string | null }>(
  value: string | null | undefined,
  records: T[],
  preferId?: string | null,
  senderDomain?: string
): T | null {
  if (!value || typeof value !== "string") return null;
  const wanted = value
    .replace(/<[^>]*>\s*$/, "")
    .replace(/\([^)]*\)\s*$/, "")
    .trim()
    .replace(/[.,;:]+$/, "")
    .toLowerCase();
  if (!wanted) return null;
  const hits = records.filter((r) => r.name.trim().toLowerCase() === wanted);
  if (hits.length <= 1) return hits[0] ?? null;
  return (
    hits.find((r) => r.id === preferId) ??
    (senderDomain ? hits.find((r) => domainOf(normalizeEmail(r.email)) === senderDomain) : undefined) ??
    hits.find((r) => r.email) ??
    hits[0]
  );
}

/** Apply classification result to a row */
export async function persistClassification(
  supabase: SupabaseClient,
  emailId: string,
  result: ClassificationResult,
  opts: { linkProject?: boolean } = {}
): Promise<void> {
  const { error } = await supabase
    .from("inbox_emails")
    .update({
      sender_type: result.sender_type,
      urgency: result.urgency,
      ai_summary: result.summary,
      ai_action_required: result.action_required,
      content_type: result.content_type,
      matched_customer_id: result.matched_customer_id,
      matched_subcontractor_id: result.matched_subcontractor_id,
      matched_project_id: result.matched_project_id,
      ai_classified_at: new Date().toISOString(),
    })
    .eq("id", emailId);
  if (error) throw new Error(`Saving classification failed: ${error.message}`);

  // The project page lists mail by project_id. The old auto-triage cron copied
  // the classifier's match across for NEW mail; it no longer runs, so the
  // sync paths ask for the link here. Never overwrites a job a person picked,
  // and manual re-classification of old mail doesn't link.
  if (opts.linkProject && result.matched_project_id) {
    await supabase
      .from("inbox_emails")
      .update({ project_id: result.matched_project_id })
      .eq("id", emailId)
      .is("project_id", null);
  }
}

// Saved when the model's answer can never be used, so the email shows up for
// a person instead of being retried every tick.
const UNSORTED: ClassificationResult = {
  sender_type: "unknown",
  urgency: "normal",
  summary: "Couldn't sort automatically. Open it.",
  action_required: true,
  content_type: "other",
  matched_customer_id: null,
  matched_subcontractor_id: null,
  matched_project_id: null,
};

/**
 * Classify recent inbound mail that sync stored but didn't classify — it hit
 * the function deadline, or the API call failed. Bounded by count and deadline
 * so it can share a cron tick.
 */
export async function classifyPendingInbound(
  supabase: SupabaseClient,
  opts: { deadlineMs: number; limit?: number; lookbackDays?: number }
): Promise<{ classified: number; failed: number; unsorted: number }> {
  const summary = { classified: 0, failed: 0, unsorted: 0 };
  const now = Date.now();
  // Keyed on when WE stored it (created_at), not the sender's Date header,
  // so late-arriving mail still gets caught. The 1-minute floor leaves rows a
  // sync is classifying right now alone.
  const since = new Date(now - (opts.lookbackDays ?? 2) * 86_400_000).toISOString();
  const settled = new Date(now - 60_000).toISOString();

  const { data: pending, error } = await supabase
    .from("inbox_emails")
    .select("id, from_name, from_email, to_email, subject, snippet, body")
    .eq("direction", "inbound")
    .is("ai_classified_at", null)
    .gte("created_at", since)
    .lt("created_at", settled)
    .order("created_at", { ascending: false })
    .limit(opts.limit ?? 8);
  if (error) {
    console.error("[classify] pending lookup failed:", error.message);
    return summary;
  }
  if (!pending || pending.length === 0) return summary;

  const context = await loadClassificationContext(supabase);
  for (const email of pending) {
    const remaining = opts.deadlineMs - Date.now();
    if (remaining < 4_000) break;
    try {
      const result = await classifyEmail({
        email: {
          from_name: email.from_name || "",
          from_email: email.from_email || "",
          to_email: email.to_email,
          subject: email.subject || "(no subject)",
          snippet: email.snippet || "",
          body: email.body || "",
        },
        context,
        timeoutMs: Math.min(15_000, remaining),
        maxRetries: 0,
      });
      await persistClassification(supabase, email.id, result, { linkProject: true });
      summary.classified += 1;
    } catch (err) {
      console.error(`[classify] email ${email.id} failed:`, err instanceof Error ? err.message : String(err));
      // A 400 about this request, or an unusable answer, will fail the same
      // way every tick: park it for a person. Account problems (credit, usage
      // limits) also come back as 400 but say nothing about the email — like
      // timeouts, 429s and 5xx, those stay pending for a retry.
      const accountProblem =
        err instanceof Anthropic.APIError && /credit balance|usage limit|billing|quota/i.test(err.message);
      if (err instanceof UnclassifiableError || (err instanceof Anthropic.BadRequestError && !accountProblem)) {
        try {
          await persistClassification(supabase, email.id, UNSORTED);
          summary.unsorted += 1;
        } catch (persistErr) {
          console.error(`[classify] parking ${email.id} failed:`, persistErr instanceof Error ? persistErr.message : String(persistErr));
          summary.failed += 1;
        }
      } else {
        summary.failed += 1;
      }
    }
  }
  return summary;
}
