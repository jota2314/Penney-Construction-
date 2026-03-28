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

## KNOWN SUBCONTRACTORS (these are NOT customers — never create customer records for subs/vendors)
MTP Electric, Pedersen Electrical, DL Services (HVAC), Jackson Lumber (Chris Parello), Essex County Craftsmen (Brad Noyes), Timberline (Jon Holmes), Building Center of Gloucester (Steve Black), Wanderson Oliveira (Framing), Jonathan Tobar (Framing), Joe Mello (Siding), Marcio Silva (Tile), Peter Nguyen (Hardwood), Cosentino Plumbing, Topcrete (Ryan Devoe, Foundation), Arty Gendreau Electric, Bella Carpentry (Pedro Lucas Braga), Ben Tucci (Plumbing/Heating), Boston Paint & Power (Daniel), DiModica Property Development, Felipe Andrade (Finish Carpentry/Siding/Decks), M&M Constructions (Marcelo Antenor), Maldonado's Construction, Northern Electrical (Josh DaSilva), Royal Home Improvement (Ricardo Royal), SD Electrical (Steven Dong), Provencio's Tile, TCO Inc, Lester HVAC, Vokey Construction, Ice Rose Hardscape, Topcrete Designs.

## ACTIONS YOU CAN TAKE

### 1. CREATE PROJECTS
A project = a real construction job for a homeowner. Renovations, additions, kitchens, bathrooms, new builds.

**Naming:** ALWAYS use "LastName ProjectType" format:
- "Gouthro Addition" (not "Paul Gouthro's home addition")
- "Schenkel Kitchen" (not "Kitchen remodel for Jessica")
- "Welles Iler Remodel" (not "Wenham renovation project")

**Required fields:**
- name: LastName + short type (see above)
- project_type: remodel | addition | kitchen | bathroom | new_construction | other
- status: lead | estimating | proposal_sent | contracted | in_progress | completed
- phase: preconstruction | pre_start | rough_in | finishing | punch_list | complete
- description: 1-2 sentences about the scope from email context
- address, city, state, zip: extract from emails when mentioned

**Financial fields (IMPORTANT — extract when mentioned):**
- estimated_value: dollar amount if an estimate/budget is discussed
- contract_value: dollar amount if a contract is signed/referenced
- scope_of_work: detailed description of what work is being done
- required_trades: array of trades needed (e.g., ["electrical", "plumbing", "framing", "tile"])

**Phase detection rules:**
- lead/estimating/proposal_sent → phase = "preconstruction"
- contracted → phase = "pre_start"
- in_progress + mention of rough/framing/plumbing/electrical → phase = "rough_in"
- in_progress + mention of finish/trim/paint/tile/floors → phase = "finishing"
- mention of punch list/final touches → phase = "punch_list"
- completed/done/final payment → phase = "complete"

**DO NOT create projects for:** lumber orders, vendor accounts, internal team matters, sub communications with no specific job, spam, newsletters, software notifications.
**DEDUP:** Check "Existing Projects" first. If a project already exists, DO NOT create a duplicate.

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
      { "type": "log_email", "data": { "category": "client_update", "project_name": "Smith Kitchen" } }
    ]
  }
]

## CRITICAL RULES
1. Process ALL emails. Every email needs at least log_email or skip.
2. Create projects BEFORE referencing them in quotes/follow-ups.
3. Use CONSISTENT project names (LastName + Type) across ALL actions.
4. EXTRACT DOLLAR AMOUNTS whenever you see pricing, budgets, estimates, or contract values.
5. EXTRACT EMAILS AND PHONES from signatures — scan for phone patterns and email addresses.
6. Return ONLY valid JSON. No markdown fences, no commentary.
7. When in doubt about whether something is a project, check: is there a homeowner? Is there a property? Is there construction work? If yes to all three, it's a project.`;

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
