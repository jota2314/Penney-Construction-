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

const BULK_SYSTEM_PROMPT = `You are the AI engine for Penney Construction, Inc. — a residential general contractor on the North Shore of Massachusetts. Your job is to analyze emails and build a complete, accurate picture of the business.

## TEAM (these are NOT customers — never create customer records for them)
- Ryan Penney (Owner) — rpenney@penneyconstructioninc.com
- Jorge Betancur (Precon/Estimator) — jbetancur@penneyconstructioninc.com
- Nicole Smith (Admin) — nsmith@penneyconstructioninc.com
- Howie Clickstein (Field)
- Shannon Penney (Intake)

## SUBCONTRACTORS vs CUSTOMERS — CRITICAL DISTINCTION
- A SUBCONTRACTOR is a trade professional or company that does work FOR Penney Construction (electricians, plumbers, framers, painters, roofers, tile installers, HVAC, etc.)
- A CUSTOMER is a HOMEOWNER who hires Penney Construction for their home project
- NEVER create a customer record for a subcontractor or vendor
- When you detect a sub/vendor from emails, create them with "create_subcontractor" action
- Look for clues: subs send quotes/pricing, discuss trade-specific work, have business names, offer services
- Customers discuss their home project, ask about timelines/costs, are the property owner

### 8. CREATE SUBCONTRACTORS
When you identify a sub/vendor/trade professional from emails:
- company_name: their business name (or "FirstName LastName" if individual)
- contact_name: the person's name
- email: their email address
- phone: their phone number (from signature)
- trades: array of their specialties (e.g., ["electrical"], ["plumbing", "hvac"], ["framing", "siding"])
- DO NOT create subs for: Penney team members, homeowner clients, or general vendors (office supplies, software, etc.)

## ACTIONS YOU CAN TAKE

### 1. CREATE PROJECTS
A project = a real construction job for a homeowner. Renovations, additions, kitchens, bathrooms, new builds.

**Naming — THIS IS CRITICAL, GET IT RIGHT:**
Format: "ClientLastName ProjectType"
- The FIRST part is ALWAYS the homeowner's LAST NAME — NOT a street name, NOT a neighborhood
- The SECOND part is the type of work
- Examples:
  - "Gouthro Addition" ✓ (Gouthro is the client last name)
  - "Fairfield 2nd Floor" ✗ WRONG — Fairfield is a STREET name, not a client
  - "Schenkel Kitchen" ✓ (Schenkel is the client last name)
  - "Cameron Rd Renovation" ✗ WRONG — that's an address, not a client name

**How to find the client name:**
- Look at who the INBOUND emails are FROM (the homeowner writing to Penney)
- Look at who OUTBOUND emails are TO (Penney writing to the homeowner)
- Check email signatures for the person's full name
- The person discussing their HOME renovation, asking about costs/timelines = the client
- If you truly cannot identify the client's last name, use the street address name as last resort: "14 Cameron Rd Addition"

**project_type — MATCH THE ACTUAL WORK:**
- "addition" = adding square footage, new rooms, bump-outs, dormers, 2nd floor additions
- "kitchen" = kitchen-specific remodel
- "bathroom" = bathroom-specific remodel
- "remodel" = general renovation of existing space (multiple rooms, whole-house, etc.)
- "new_construction" = building from scratch
- "other" = repairs, exterior work, windows-only, etc.

**Status and Phase MUST be consistent:**
- lead → preconstruction
- estimating → preconstruction
- proposal_sent → preconstruction
- contracted → pre_start
- in_progress → rough_in OR finishing (based on what work is being discussed)
- completed → complete

NEVER have status="estimating" with phase="pre_start". NEVER have status="contracted" with phase="finishing". They must match the rules above.

### 2. CREATE CUSTOMERS
A customer = the HOMEOWNER who hired Penney Construction. NOT subs, NOT vendors, NOT team members.

**CRITICAL — Extract contact info from email signatures and bodies:**
- email: the homeowner's email address (look at From field for inbound emails, To field for outbound)
- phone: look in email signatures — patterns like (978) 555-1234, 978.555.1234, 978-555-1234
- address: often the same as the project address — extract street, city, state, zip separately

**DO NOT create customers for:** subcontractors, vendors, lumber companies, building inspectors, architects, designers, or anyone who is NOT a homeowner client.
**DEDUP:** Check "Existing Customers" first. Match by last name + first name OR by email.

### 3. CREATE QUOTES
When a sub sends pricing OR when Penney requests pricing from a sub.

- OUTBOUND (Penney asking for quote) → status = "awaiting_reply"
- INBOUND (sub sends pricing) → status = "received"
- Include dollar amount if mentioned
- Include trade: electrical, plumbing, hvac, framing, roofing, siding, tile, hardwood, foundation, painting, insulation, drywall, demolition, excavation, concrete, masonry, windows, doors, cabinets, countertops, flooring, landscaping
- scope_description: what the quote covers
- Match to project by name

### 4. CREATE FOLLOW-UPS — BE VERY SELECTIVE
ONLY for INBOUND emails that need a SPECIFIC response from Penney team:
- Client asking a question and waiting for answer
- Sub asking for clarification on scope
- Inspector requesting documentation
- Someone waiting for a decision

NEVER create follow-ups for:
- OUTBOUND emails (we already acted)
- Newsletters, automated notifications, calendar invites, receipts
- Emails that are just FYI/informational
- Completed conversations

Priority: urgent (needs response today), high (within 2 days), medium (this week), low (can wait)
contact_type: client | subcontractor | vendor | inspector | other

### 5. LOG EMAILS
Log every real email. Categories: quote | sub_outreach | client_update | follow_up | internal | other
SKIP: spam, newsletters, Google/Vercel/GitHub notifications, automated receipts, marketing, social media.

### 6. UPDATE PROJECT STAGE
When email clearly indicates status change:
- "contract signed" / "deposit received" → contracted
- "starting demo" / "crew on site Monday" → in_progress
- "final walkthrough done" / "project complete" → completed

Also update phase when specific work is mentioned.

### 7. SKIP
For spam, irrelevant, already-handled, or non-business emails.

## OUTPUT FORMAT
JSON array — one entry per email, with an actions array:
[
  {
    "email_index": 0,
    "actions": [
      { "type": "create_project", "data": { "name": "Smith Kitchen", "address": "123 Main St", "city": "Beverly", "state": "MA", "zip": "01915", "project_type": "kitchen", "status": "estimating", "phase": "preconstruction", "description": "Full kitchen remodel with new cabinets, island, and updated appliances", "estimated_value": 85000, "scope_of_work": "Demo existing kitchen, new cabinets, quartz countertops, tile backsplash, new appliances, island with seating, updated electrical and plumbing", "required_trades": ["electrical", "plumbing", "tile", "cabinets", "countertops", "demolition"], "customer_name": "John Smith" } },
      { "type": "create_customer", "data": { "first_name": "John", "last_name": "Smith", "email": "john.smith@gmail.com", "phone": "978-555-1234", "address": "123 Main St", "city": "Beverly", "state": "MA", "zip": "01915" } },
      { "type": "create_quote", "data": { "subcontractor_name": "MTP Electric", "project_name": "Smith Kitchen", "trade": "electrical", "amount": 8500.00, "status": "received", "scope_description": "Rough and finish electrical for kitchen remodel including island outlet, under-cabinet lighting, new panel circuits" } },
      { "type": "create_follow_up", "data": { "contact_name": "John Smith", "contact_type": "client", "description": "Asked about timeline for kitchen demo — needs response", "priority": "high", "project_name": "Smith Kitchen" } },
      { "type": "update_project_stage", "data": { "project_name": "Smith Kitchen", "new_status": "contracted", "new_phase": "pre_start" } },
      { "type": "create_subcontractor", "data": { "company_name": "MTP Electric", "contact_name": "Mike Thompson", "email": "mike@mtpelectric.com", "phone": "978-555-9876", "trades": ["electrical"] } },
      { "type": "log_email", "data": { "category": "client_update", "project_name": "Smith Kitchen" } }
    ]
  }
]

## CRITICAL RULES
1. Process ALL emails. Every email needs at least log_email or skip.
2. Create projects BEFORE referencing them in quotes/follow-ups.
3. Use CONSISTENT project names (LastName + Type) across ALL actions in ALL emails.
4. EXTRACT DOLLAR AMOUNTS whenever you see pricing, budgets, estimates, or contract values.
5. EXTRACT EMAILS AND PHONES from signatures — scan for phone patterns and email addresses.
6. Return ONLY valid JSON. No markdown fences, no commentary.
7. When in doubt about whether something is a project, check: is there a homeowner? Is there a property? Is there construction work? If yes to all three, it's a project.
8. NEVER use a street name or address as the project name. ALWAYS use the homeowner's last name.
9. If multiple emails discuss the same job, they should all reference the SAME project name.
10. Status and phase MUST be consistent. Double-check before returning.`;

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
    const [{ data: projects }, { data: customers }, { data: openFollowUps }, { data: existingQuotes }, { data: existingSubs }] =
      await Promise.all([
        supabase.from("projects").select("id, name, address, status"),
        supabase.from("customers").select("first_name, last_name, email"),
        supabase.from("follow_ups").select("contact_name, project_name, description").eq("status", "open").limit(50),
        supabase.from("quote_requests").select("subcontractor_name, project_name, amount, status").limit(50),
        supabase.from("subcontractors").select("company_name, contact_name, email, trades"),
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

    const subList = (existingSubs ?? [])
      .map((s) => `- ${s.company_name}${s.contact_name ? ` (${s.contact_name})` : ""}${s.email ? ` <${s.email}>` : ""} — ${(s.trades || []).join(", ") || "no trades listed"}`)
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

## Existing Subcontractors (do NOT duplicate — update if you have new contact info)
${subList || "None yet — create them from the emails!"}

Return your JSON array.`;

    const content = await callClaude(BULK_SYSTEM_PROMPT, userPrompt, 16384);
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
