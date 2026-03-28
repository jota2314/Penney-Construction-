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

## KNOWN PROJECTS — USE THESE EXACT NAMES
When you see emails related to these projects, use the EXACT project name listed here. DO NOT invent new names or variations.

| # | Project Name | Client | Client Email | Address | Status | Phase | Type | Scope |
|---|---|---|---|---|---|---|---|---|
| 1 | Gouthro Addition | Paul Gouthro | pgouthro@comcast.net | 14 Cameron Rd, Lynn, MA | contracted | pre_start | addition | Residential addition |
| 2 | Pedersen Residence | Eric Pedersen (architect: Steven DeFuria) | steve@phoenixarch.com, psandorse@phoenixarch.com | 57 Locksley Rd, Lynnfield, MA | estimating | preconstruction | addition | Large addition and full renovation |
| 3 | Schenkel Kitchen & Basement | Jessica Schenkel | jessica_schenkel@hotmail.com | 74 Cavendish Circle, Salem, MA | in_progress | rough_in | kitchen | Kitchen renovation and basement work |
| 4 | Welles Iler | Barbara Welles Iler | barbarawiler@gmail.com | 11 Cherry St, Wenham, MA | in_progress | rough_in | remodel | Renovation with kitchen, electrical, plumbing upgrades |
| 5 | Colten Kitchen & Bath | Leslie & Rick Colten | lcolten@beverlybootstraps.org, lrcolten@yahoo.com | 15 Robinson Rd, Beverly, MA | in_progress | finishing | kitchen | Kitchen and bathroom renovation |
| 6 | Danaher 2nd Floor | Kristen Danaher | kristendanaher@gmail.com | 44 William Fairfield Dr, Wenham, MA | in_progress | finishing | remodel | 2nd floor windows, bathroom, flooring, HVAC |
| 7 | Haley / Hamilton | Julee Haley | juleehaley@gmail.com | 80 Bridge St, South Hamilton, MA | estimating | preconstruction | other | Window replacement, trim, renovation work |
| 8 | Ouellette / Stewart Lane | John Ouellette, Jill Conrad | johno4444@gmail.com, jillconrad2010@gmail.com | 13 Stewart Ln, Beverly, MA | lead | preconstruction | remodel | TBD — site visit completed |
| 9 | Sutcliffe | Michael & Sandra Sutcliffe | msutcliffe78@yahoo.com, sandralc28@yahoo.com | TBD | in_progress | finishing | remodel | Renovation — cabinet installation, tile |
| 10 | Friedman | Sonia Friedman | Sonia.Friedman@tuftsmedicine.org | 208 Church St, West Roxbury, MA | proposal_sent | preconstruction | remodel | Renovation work |
| 11 | Sullivan Bathroom | Pam Sullivan | pspsullivan@gmail.com | TBD | proposal_sent | preconstruction | bathroom | Bathroom renovation |
| 12 | Lapointe | Diana Lapointe | dianapic1@gmail.com | TBD | in_progress | finishing | remodel | Renovation with additional piping/exhaust work |
| 13 | Kline | Juli Kline | julikln@yahoo.com | TBD | contracted | pre_start | remodel | Renovation project |
| 14 | Leiby | Alison Leiby | aeh3@hotmail.com | TBD | in_progress | finishing | remodel | Renovation — tile, cabinets, flooring |
| 15 | Burns | Edward Burns | edward.robert.gallegos@gmail.com | 16 Deer Hill, Essex, MA | in_progress | finishing | remodel | Basement + renovation |
| 16 | Breen | Patrick Breen | patbreen5@gmail.com | TBD | estimating | preconstruction | addition | Addition (upstairs scope) |
| 17 | Codair | Mike Codair | mecodair@comcast.net | TBD | proposal_sent | preconstruction | other | TBD |

**EMAIL-TO-PROJECT MATCHING:** When you see an email from/to any of these client emails, it belongs to that project. When you see addresses like "Cameron Rd" or "Locksley Rd" or "Cavendish Circle", match to the corresponding project. When you see names like "Gouthro", "Schenkel", "Danaher", "Haley" — those are projects above.

## KNOWN SUBCONTRACTORS — USE THESE EXACT NAMES
| Company | Contact | Email | Trades |
|---|---|---|---|
| MTP Electric | Michael Pagliarulo | michael@mtpelectric.com | electrical |
| Pedersen Electrical | Eric Pedersen | eric@pes1974.com | electrical |
| DL Services | Eric Lindstrom | dlserviceshvac@comcast.net | hvac |
| Essex County Craftsmen | Brad Noyes | ecchvac@gmail.com | hvac |
| Cosentino Plumbing | John Cosentino | cosentino.john@icloud.com | plumbing |
| Jackson Lumber | Chris Parello | cparello@jacksonlumber.com | windows, doors, lumber |
| Timberline | Jon Holmes | jonh@tlumber.com | windows |
| Building Center of Gloucester | Steve Black | SBlack@bcgloucester.com | lumber, doors, trim |
| ABC Supply | Jim Sullivan | jim.sullivan@abcsupply.com | siding |
| Wanderson Oliveira | Wanderson | wandersonbcimass@gmail.com | framing |
| Jonathan Tobar | Jonathan | jonathanmtobar@gmail.com | framing |
| Joe Mello | Joe | j4mello@yahoo.com | siding |
| Marcio Silva | Marcio | mgltileinc40_@hotmail.com | tile |
| Peter Nguyen | Peter | petermasterfloor@gmail.com | hardwood, flooring |
| Topcrete | Ryan | ryan@topcretedesigns.com | foundation, concrete |
| BCI Insulation | — | — | insulation |
| WarmlyYours | Troy | — | radiant heat |
| Phoenix Architecture | Steven DeFuria | steve@phoenixarch.com | architecture |

**When you see emails from these people, they are SUBCONTRACTORS/VENDORS — NOT customers.**

## SUBCONTRACTORS vs CUSTOMERS — CRITICAL DISTINCTION
- A SUBCONTRACTOR does work FOR Penney Construction (electricians, plumbers, framers, etc.)
- A CUSTOMER is a HOMEOWNER who hires Penney Construction
- NEVER create a customer record for a sub, vendor, architect, or team member
- If someone sends pricing/quotes, discusses trade work, has a business name → they are a SUB
- If someone discusses their home project, asks about timelines/costs, is the property owner → they are a CUSTOMER

## ACTIONS YOU CAN TAKE

### 1. CREATE PROJECTS
Only create a project if it's a REAL construction job that is NOT in the Known Projects list above.
If the email matches a known project, DO NOT create a new one — reference the existing name.

**Naming:** "ClientLastName ProjectType" — NEVER use street names.
- ✓ "Smith Kitchen" — ✗ "Fairfield 2nd Floor" (Fairfield is a street)
- ✓ "Danaher 2nd Floor" — the client's name is Danaher

**project_type:** addition | kitchen | bathroom | remodel | new_construction | other
**Status/Phase MUST match:**
- lead/estimating/proposal_sent → preconstruction
- contracted → pre_start
- in_progress → rough_in OR finishing (based on work described)
- completed → complete

**Also extract when mentioned:** address, city, state, zip, estimated_value, contract_value, scope_of_work, required_trades, description, customer_name

### 2. CREATE CUSTOMERS
Only for HOMEOWNER clients NOT already in the Known Projects client list above.
Extract: first_name, last_name, email, phone (from signatures), address, city, state, zip.
DO NOT create customers for subs, vendors, architects, inspectors, or team members.

### 3. CREATE SUBCONTRACTORS
Only for trade professionals NOT in the Known Subcontractors list above.
Extract: company_name, contact_name, email, phone, trades[].
DO NOT create sub records for homeowner clients or team members.

### 4. CREATE QUOTES
When a sub sends pricing OR Penney requests pricing:
- OUTBOUND request → status = "awaiting_reply"
- INBOUND with pricing → status = "received"
- Include: subcontractor_name, project_name (EXACT from known list), trade, amount, scope_description

### 5. CREATE FOLLOW-UPS — BE VERY SELECTIVE
ONLY for INBOUND emails needing a specific response from the Penney team.
NEVER for outbound emails, newsletters, automated notifications, receipts.
Include: contact_name, contact_type (client|subcontractor|vendor|inspector), description, priority (urgent|high|medium|low), project_name

### 6. LOG EMAILS
Log every real email. Categories: quote | sub_outreach | client_update | follow_up | internal | other
SKIP: spam, newsletters, Google/Vercel/GitHub notifications, automated receipts, marketing.
Match to project_name using the Known Projects list.

### 7. UPDATE PROJECT STAGE
When email clearly shows status changed: "contract signed" → contracted, "starting demo" → in_progress, "project complete" → completed.

### 8. SKIP
For spam, irrelevant, or non-business emails.

## OUTPUT FORMAT
JSON array — one entry per email:
[
  {
    "email_index": 0,
    "actions": [
      { "type": "create_project", "data": { "name": "...", "address": "...", "city": "...", "state": "MA", "project_type": "...", "status": "...", "phase": "...", "description": "...", "customer_name": "..." } },
      { "type": "create_customer", "data": { "first_name": "...", "last_name": "...", "email": "...", "phone": "..." } },
      { "type": "create_subcontractor", "data": { "company_name": "...", "contact_name": "...", "email": "...", "trades": ["..."] } },
      { "type": "create_quote", "data": { "subcontractor_name": "...", "project_name": "...", "trade": "...", "amount": 0, "status": "received", "scope_description": "..." } },
      { "type": "create_follow_up", "data": { "contact_name": "...", "contact_type": "...", "description": "...", "priority": "...", "project_name": "..." } },
      { "type": "update_project_stage", "data": { "project_name": "...", "new_status": "...", "new_phase": "..." } },
      { "type": "log_email", "data": { "category": "...", "project_name": "..." } },
      { "type": "skip" }
    ]
  }
]

## CRITICAL RULES
1. Process ALL emails — every email needs at least log_email or skip.
2. MATCH emails to Known Projects FIRST before creating new projects.
3. Use EXACT project names from the Known Projects table. Do not rename them.
4. Create projects BEFORE referencing them in quotes/follow-ups.
5. EXTRACT dollar amounts whenever you see pricing, budgets, estimates, or contract values.
6. EXTRACT emails and phone numbers from signatures.
7. Return ONLY valid JSON. No markdown fences, no commentary.
8. NEVER use a street name as a project name. ALWAYS use the client's last name.
9. Status and phase MUST be consistent — double-check before returning.
10. When in doubt whether someone is a sub or client, check the Known Subcontractors list first.`;

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

    const userPrompt = `Analyze these ${emails.length} emails. Match to Known Projects first. Only create new projects/customers if they don't match anything known.

${emailSummaries}

## Already in Database — Projects (do NOT create duplicates, use these exact names)
${projectList || "Empty — create from Known Projects list + emails above"}

## Already in Database — Customers
${customerList || "Empty — create from Known Projects client list + emails above"}

## Already in Database — Subcontractors
${subList || "Empty — create from Known Subcontractors list + emails above"}

## Already in Database — Open Follow-ups (do NOT duplicate)
${followUpList || "None"}

## Already in Database — Quotes (do NOT duplicate)
${quoteList || "None"}

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
