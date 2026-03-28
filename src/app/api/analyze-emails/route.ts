import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchMessagesByIds } from "@/lib/google/gmail-sync";
import { callClaude } from "@/lib/ai/claude";

const COMPANY_EMAILS = [
  "jbetancur@penneyconstructioninc.com",
  "rpenney@penneyconstructioninc.com",
  "nsmith@penneyconstructioninc.com",
  "info@penneyconstructioninc.com",
];

const BULK_SYSTEM_PROMPT = `You are the AI engine for Penney Construction, Inc., a residential general contractor on the North Shore of Massachusetts.

Team: Ryan Penney (Owner), Jorge Betancur (Precon/Estimator), Nicole Smith (Admin), Howie Clickstein (Field), Shannon Penney (Intake).

Known subs: MTP Electric, Pedersen Electrical, DL Services (HVAC), Jackson Lumber (Chris Parello), Essex County Craftsmen (Brad Noyes), Timberline (Jon Holmes), Building Center of Gloucester (Steve Black), Wanderson Oliveira (Framing), Jonathan Tobar (Framing), Joe Mello (Siding), Marcio Silva (Tile), Peter Nguyen (Hardwood), Cosentino Plumbing, Topcrete (Foundation).

Each email is labeled INBOUND or OUTBOUND.

You can take these actions:

## 1. CREATE PROJECTS — VERY IMPORTANT
- Identify construction PROJECTS from emails. A project is a real job: a homeowner's renovation, addition, kitchen remodel, bathroom remodel, new build, etc.
- Name projects by the CLIENT LAST NAME + short description. Examples: "Smith Kitchen Remodel", "Johnson Addition", "Garcia Master Bath".
- If the address is mentioned, include it.
- Determine project_type: remodel, addition, kitchen, bathroom, new_construction, or other.
- Determine status from context:
  - "lead" = new inquiry, just heard about it
  - "estimating" = walkthrough done or estimate being prepared
  - "proposal_sent" = proposal/bid was sent to client
  - "contracted" = client signed, job is awarded
  - "in_progress" = construction is happening
  - "completed" = job is done
- DO NOT create projects for: internal company matters, vendor relationships (lumber orders, etc.), or generic sub communications with no specific job.
- Check the "Existing Projects" list carefully. If a project already exists (even with slightly different name), DO NOT create a duplicate — use the existing name for quotes/follow-ups.
- When multiple emails reference the same job, create ONE project, not many.

## 2. CREATE CUSTOMERS
- When you identify a project client (homeowner), create a customer record.
- Extract: first_name, last_name, email, phone (if visible in email body or signature).
- LOOK CAREFULLY at email signatures — they often contain phone numbers, addresses, and full names.
- Extract the client's home address if visible (this is often the project address too).
- DO NOT create customers for: subcontractors, vendors, team members, or other businesses.
- Check "Existing Customers" — do NOT create duplicates.

## 3. CREATE QUOTES
- Only when a sub/vendor sends ACTUAL PRICING with dollar amounts, or when Penney team requests a quote from a sub.
- If the quote request was OUTBOUND (Penney asking for pricing), status = "awaiting_reply".
- If the quote is INBOUND (sub providing pricing), status = "received".
- Match to the correct project using EXACT name from the project list (or a project you're creating in this batch).
- Include the trade (electrical, plumbing, hvac, framing, roofing, siding, tile, hardwood, foundation, painting, insulation, drywall, etc.).

## 4. CREATE FOLLOW-UPS — BE SELECTIVE
- ONLY for INBOUND emails needing a specific response from the Penney team.
- NEVER for OUTBOUND emails (we already took action).
- NEVER for: newsletters, automated notifications, calendar invites, receipts, spam.
- Only if there is a SPECIFIC ACTION NEEDED: question to answer, decision required, quote expected, client waiting.
- Check "Existing Follow-ups" — no duplicates.
- When in doubt, DON'T create one. Less is more.

## 5. LOG EMAILS
- Log every non-spam email with a category and project match.
- Categories: quote, sub_outreach, client_update, follow_up, internal, other
- Skip: spam, automated notifications, Google Calendar, Vercel, GitHub, newsletters, marketing.

## 6. UPDATE PROJECT STAGE
- If an email clearly indicates a project has moved to a new stage (e.g., "contract signed" → contracted, "starting demo Monday" → in_progress), update it.

## 7. SKIP
- Use for spam, irrelevant, or already-handled emails.

## OUTPUT FORMAT
Return a JSON array — one entry per email. Each entry has actions (can be multiple per email):
[
  {
    "email_index": 0,
    "actions": [
      { "type": "create_project", "data": { "name": "Smith Kitchen Remodel", "address": "123 Main St", "city": "Beverly", "state": "MA", "project_type": "kitchen", "status": "estimating", "description": "Full kitchen remodel with new cabinets and island", "customer_name": "John Smith" } },
      { "type": "create_customer", "data": { "first_name": "John", "last_name": "Smith", "email": "john@example.com", "phone": "978-555-1234" } },
      { "type": "create_quote", "data": { "subcontractor_name": "MTP Electric", "project_name": "Smith Kitchen Remodel", "trade": "electrical", "amount": 8500.00, "status": "received", "scope_description": "Rough and finish electrical for kitchen remodel" } },
      { "type": "create_follow_up", "data": { "contact_name": "John Smith", "contact_type": "client", "description": "Wants to schedule walkthrough for kitchen remodel", "priority": "high", "project_name": "Smith Kitchen Remodel" } },
      { "type": "update_project_stage", "data": { "project_name": "Smith Kitchen Remodel", "new_status": "contracted" } },
      { "type": "log_email", "data": { "category": "client_update", "project_name": "Smith Kitchen Remodel" } },
      { "type": "skip" }
    ]
  }
]

IMPORTANT RULES:
- Process ALL emails. Every email must appear in the output with at least a log_email or skip action.
- Create projects BEFORE referencing them in quotes/follow-ups within the same batch.
- Use CONSISTENT project names across all actions in all emails.
- Return ONLY valid JSON, no markdown fences.`;

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  try {
    const { emailIds } = await request.json();

    if (!emailIds || !Array.isArray(emailIds) || emailIds.length === 0) {
      return NextResponse.json({ error: "emailIds required" }, { status: 400 });
    }

    const emails = await fetchMessagesByIds(emailIds);
    if (emails.length === 0) {
      return NextResponse.json({ decisions: [], emails: [] });
    }

    // Get full context for AI
    const [{ data: projects }, { data: customers }, { data: openFollowUps }, { data: existingQuotes }] =
      await Promise.all([
        supabase.from("projects").select("id, name, address, status"),
        supabase.from("customers").select("first_name, last_name, email"),
        supabase.from("follow_ups").select("contact_name, project_name, description").eq("status", "open").limit(50),
        supabase.from("quote_requests").select("subcontractor_name, project_name, amount, status").limit(50),
      ]);

    const projectList = (projects ?? [])
      .map((p) => `- "${p.name}" (${p.address || "no address"}) [${p.status}]`)
      .join("\n");

    const customerList = (customers ?? [])
      .map((c) => `- ${c.first_name} ${c.last_name}${c.email ? ` <${c.email}>` : ""}`)
      .join("\n");

    const followUpList = (openFollowUps ?? [])
      .map((f) => `- ${f.contact_name} → ${f.project_name || "general"}: ${f.description}`)
      .join("\n");

    const quoteList = (existingQuotes ?? [])
      .map((q) => `- ${q.subcontractor_name} → ${q.project_name}: $${q.amount || "pending"} [${q.status}]`)
      .join("\n");

    // Build email summaries WITH direction labels and attachment info
    const emailSummaries = emails.map((e, i) => {
      const isOutbound = COMPANY_EMAILS.some(
        (ce) => e.fromEmail.toLowerCase() === ce.toLowerCase()
      );
      const attachmentList = e.attachments.length > 0
        ? `\nAttachments: ${e.attachments.map((a) => `${a.filename} (${a.mimeType})`).join(", ")}`
        : "";
      return `--- EMAIL ${i} [${isOutbound ? "OUTBOUND" : "INBOUND"}] ---
From: ${e.from} <${e.fromEmail}>
To: ${e.to} <${e.toEmail}>
Date: ${e.date}
Subject: ${e.subject}${attachmentList}
Body: ${e.body.substring(0, 2000)}`;
    }).join("\n\n");

    const userPrompt = `Analyze these ${emails.length} emails. Create projects and customers when you identify real construction jobs with homeowner clients. Be selective with follow-ups.

${emailSummaries}

## Existing Projects (use these names — do NOT create duplicates)
${projectList || "No projects yet — create them from the emails above!"}

## Existing Customers (do NOT create duplicates)
${customerList || "None yet"}

## Existing Open Follow-ups (do NOT duplicate)
${followUpList || "None"}

## Existing Quotes (do NOT duplicate)
${quoteList || "None"}

Return your JSON array.`;

    const content = await callClaude(BULK_SYSTEM_PROMPT, userPrompt);
    const cleaned = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

    let decisions;
    try {
      decisions = JSON.parse(cleaned);
    } catch {
      return NextResponse.json(
        { error: `JSON parse error: ${cleaned.substring(0, 200)}` },
        { status: 500 }
      );
    }

    const emailsData = emails.map((e) => ({
      id: e.id,
      subject: e.subject,
      fromEmail: e.fromEmail,
      toEmail: e.toEmail,
      direction: e.direction,
      date: e.date,
      from: e.from,
    }));

    return NextResponse.json({ decisions, emails: emailsData });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
