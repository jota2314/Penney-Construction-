/**
 * Single-email classifier using Haiku 4.5.
 * Returns sender_type, urgency, summary, action flag, and matched entity.
 *
 * Caching: the customer/sub/project context block is large but identical
 * across emails in the same batch, so we wrap it with cache_control.
 * Saves ~90% on input tokens during backfill (667 emails).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { getAnthropicClientServer } from "@/lib/ai/claude-server";

const MODEL = "claude-haiku-4-5-20251001";

export interface ClassificationContext {
  customers: { id: string; name: string; email: string | null }[];
  subs: { id: string; name: string; email: string | null; trades: string[] }[];
  projects: { id: string; name: string; status: string | null }[];
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

/** Load classification context from DB once per batch */
export async function loadClassificationContext(
  supabase: SupabaseClient
): Promise<ClassificationContext> {
  const [customersRes, subsRes, projectsRes] = await Promise.all([
    supabase.from("customers").select("id, first_name, last_name, email"),
    supabase.from("subcontractors").select("id, company_name, email, trades"),
    supabase.from("projects").select("id, name, status").neq("status", "archived"),
  ]);

  return {
    customers: (customersRes.data ?? []).map((c) => ({
      id: c.id,
      name: `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim(),
      email: c.email,
    })),
    subs: (subsRes.data ?? []).map((s) => ({
      id: s.id,
      name: s.company_name,
      email: s.email,
      trades: s.trades ?? [],
    })),
    projects: (projectsRes.data ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      status: p.status,
    })),
  };
}

function buildContextBlock(ctx: ClassificationContext): string {
  const lines: string[] = [];
  lines.push("## Active Customers");
  for (const c of ctx.customers) {
    lines.push(`- [${c.id}] ${c.name}${c.email ? ` <${c.email}>` : ""}`);
  }
  lines.push("\n## Active Subcontractors");
  for (const s of ctx.subs) {
    lines.push(`- [${s.id}] ${s.name}${s.email ? ` <${s.email}>` : ""}${s.trades.length ? ` — ${s.trades.join(", ")}` : ""}`);
  }
  lines.push("\n## Active Projects");
  for (const p of ctx.projects) {
    lines.push(`- [${p.id}] ${p.name}${p.status ? ` (${p.status})` : ""}`);
  }
  return lines.join("\n");
}

const SYSTEM_PROMPT = `You are an inbox classifier for Penney Construction, a residential general contractor in Massachusetts. For each email, return a JSON object with:

- sender_type: who sent it
  - "client" — a homeowner / customer / prospective customer
  - "sub" — a subcontractor (electrician, plumber, framer, etc.)
  - "vendor" — supplier (lumber yard, hardware, tool company, software service)
  - "internal" — a Penney Construction employee (Ryan, Jorge, Nicole, Howie, Shannon)
  - "personal" — non-business email to Jorge
  - "spam" — marketing/newsletters/cold outreach with no business value
  - "unknown" — can't tell

- urgency:
  - "urgent" — needs reply / action today (deadline, problem on site, missed inspection, late payment, client unhappy, walkthrough request)
  - "normal" — needs attention soon (quote request, scheduling, project update)
  - "low" — informational, no action needed (FYI, automated notification, receipt)
  - "junk" — newsletters, ads, irrelevant outreach — basically delete-worthy

  IMPORTANT — automated notifications from SaaS / project-management / accounting tools
  (Buildertrend, Procore, CompanyCam, QuickBooks, Houzz, Gusto, Stripe, Indeed, LinkedIn,
  Slack, Asana, etc.) are almost never "urgent" — they are robots, not humans. Default
  them to "low". Only escalate to "urgent" if the body explicitly states a hard deadline
  today (e.g. "payment due in 2 hours", "client e-signed — countersign required today").
  Weekly digests / summaries / "X new things this week" from these services → "junk".

- summary: ONE concise sentence (max 12 words) describing what the email is about. Write it like Jorge would skim it. Examples: "Pedersen wants Friday walkthrough", "Plumber sub asking about timeline", "Home Depot receipt $234".

- action_required: true if Jorge (or anyone at Penney) needs to do something. false if informational only.
  - "please pay this invoice" = true. "payment received receipt" = false.
  - "new quote for review" = true. "quote acknowledged, will follow up" = false.
  - "schedule change" = true. "schedule confirmation" = false.
  - SaaS automated notifications (Buildertrend daily digest, QuickBooks reminder, etc.)
    = false unless they describe a real human deadline.

- content_type: what KIND of email is it
  - "invoice" — bill, invoice, statement (anything asking for payment)
  - "quote" — bid, proposal, estimate, pricing from a sub or vendor
  - "payment_receipt" — confirmation of money received or paid
  - "schedule" — meeting invite, calendar update, walkthrough, scheduling discussion
  - "contract" — signed contract, change order, agreement
  - "inquiry" — new lead, question from a homeowner / prospective client
  - "update" — status update on a project (no action, just FYI)
  - "newsletter" — marketing, promotional, blog post
  - "other" — none of the above

- matched_customer_id: if the sender or content matches a customer in the provided list, return that ID. Otherwise null.
- matched_subcontractor_id: same for subs. Null if no match.
- matched_project_id: if the email mentions a specific project (by name, address, or context), return that project's ID. Otherwise null.

Use the provided lists below to match by email address first, then by name mentions in subject/snippet.

Output ONLY valid JSON, no other text.`;

export async function classifyEmail(opts: {
  email: {
    from_name: string;
    from_email: string;
    subject: string;
    snippet: string;
    body?: string;
  };
  context: ClassificationContext;
}): Promise<ClassificationResult> {
  const { email, context } = opts;
  const client = await getAnthropicClientServer();

  const contextBlock = buildContextBlock(context);
  const bodyExcerpt = (email.body || email.snippet || "").substring(0, 1500);

  const userMsg = `EMAIL TO CLASSIFY:
From: ${email.from_name} <${email.from_email}>
Subject: ${email.subject}
Snippet: ${email.snippet}
${bodyExcerpt ? `\nBody (excerpt):\n${bodyExcerpt}` : ""}

Return classification JSON.`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 400,
    system: [
      { type: "text", text: SYSTEM_PROMPT },
      { type: "text", text: contextBlock, cache_control: { type: "ephemeral" } },
    ],
    messages: [{ role: "user", content: userMsg }],
  });

  const textBlock = response.content.find((c) => c.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No text response from Haiku");
  }

  // Strip code fences if present
  const raw = textBlock.text.trim().replace(/^```json\s*/, "").replace(/```$/, "").trim();
  const parsed = JSON.parse(raw) as ClassificationResult;

  return {
    sender_type: parsed.sender_type ?? "unknown",
    urgency: parsed.urgency ?? "normal",
    summary: (parsed.summary ?? "").substring(0, 200),
    action_required: !!parsed.action_required,
    content_type: parsed.content_type ?? "other",
    matched_customer_id: parsed.matched_customer_id || null,
    matched_subcontractor_id: parsed.matched_subcontractor_id || null,
    matched_project_id: parsed.matched_project_id || null,
  };
}

/** Apply classification result to a row */
export async function persistClassification(
  supabase: SupabaseClient,
  emailId: string,
  result: ClassificationResult
): Promise<void> {
  await supabase
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
}
