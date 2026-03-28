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

const BULK_SYSTEM_PROMPT = `You are the AI engine for Penney Construction, Inc. (North Shore MA, residential GC).

Team: Ryan Penney (Owner), Jorge Betancur (Precon/Estimator), Nicole Smith (Admin), Howie Clickstein (Field), Shannon Penney (Intake).

Known subs: MTP Electric, Pedersen Electrical, DL Services (HVAC), Jackson Lumber (Chris Parello), Essex County Craftsmen (Brad Noyes), Timberline (Jon Holmes), Building Center of Gloucester (Steve Black), Wanderson Oliveira (Framing), Jonathan Tobar (Framing), Joe Mello (Siding), Marcio Silva (Tile), Peter Nguyen (Hardwood), Cosentino Plumbing, Topcrete (Foundation).

Each email is labeled INBOUND or OUTBOUND.

## RULES FOR FOLLOW-UPS — BE VERY SELECTIVE
- **ONLY create follow-ups for INBOUND emails** that need a specific response from the Penney team
- **NEVER create follow-ups for OUTBOUND emails** — those are emails WE sent, we already took action
- **NEVER create follow-ups for:** newsletters, automated notifications, calendar invites, receipts, read receipts, delivery confirmations
- **Only create a follow-up if there is a SPECIFIC ACTION NEEDED:** someone asked a question, a quote is expected but not received, a client needs a decision, a sub needs info to proceed
- **Check the "Existing Follow-ups" list** — if a similar follow-up already exists for that contact+project, DO NOT create a duplicate
- When in doubt, DON'T create a follow-up. Less is more.

## RULES FOR QUOTES
- Only create quotes when a sub/vendor sends ACTUAL PRICING with dollar amounts
- Check "Existing Quotes" — don't duplicate
- Match to the correct project using EXACT name from the project list

## RULES FOR EMAIL LOGGING
- Log every non-spam email with a category and project match
- Categories: quote, sub_outreach, client_update, follow_up, internal, other
- Skip: spam, automated notifications, Google Calendar, Vercel, GitHub, newsletters

Return JSON array — one entry per email:
[
  {
    "email_index": 0,
    "actions": [
      { "type": "create_quote", "data": { "subcontractor_name": "...", "project_name": "EXACT name", "trade": "...", "amount": 1234.00, "status": "received" } },
      { "type": "create_follow_up", "data": { "contact_name": "...", "contact_type": "subcontractor|client|internal", "description": "SPECIFIC action needed", "priority": "low|medium|high|urgent", "project_name": "EXACT name" } },
      { "type": "log_email", "data": { "category": "...", "project_name": "EXACT name or null" } },
      { "type": "skip" }
    ]
  }
]

Return ONLY valid JSON, no markdown fences.`;

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
      .map((p) => `- "${p.name}" (${p.address || "?"}) [${p.status}]`)
      .join("\n");

    const followUpList = (openFollowUps ?? [])
      .map((f) => `- ${f.contact_name} → ${f.project_name || "general"}: ${f.description}`)
      .join("\n");

    const quoteList = (existingQuotes ?? [])
      .map((q) => `- ${q.subcontractor_name} → ${q.project_name}: $${q.amount || "pending"} [${q.status}]`)
      .join("\n");

    // Build email summaries WITH direction labels
    const emailSummaries = emails.map((e, i) => {
      const isOutbound = COMPANY_EMAILS.some(
        (ce) => e.fromEmail.toLowerCase() === ce.toLowerCase()
      );
      return `--- EMAIL ${i} [${isOutbound ? "OUTBOUND" : "INBOUND"}] ---
From: ${e.from} <${e.fromEmail}>
To: ${e.to} <${e.toEmail}>
Date: ${e.date}
Subject: ${e.subject}
Body: ${e.body.substring(0, 1500)}`;
    }).join("\n\n");

    const userPrompt = `Analyze these ${emails.length} emails. Remember: ONLY create follow-ups for INBOUND emails needing specific action. Be very selective.

${emailSummaries}

## Existing Projects (match to these — DO NOT create new ones)
${projectList || "No projects yet"}

## Existing Customers
${(customers ?? []).slice(0, 20).map((c) => `- ${c.first_name} ${c.last_name}`).join("\n") || "None"}

## Existing Open Follow-ups (DO NOT create duplicates of these)
${followUpList || "None"}

## Existing Quotes (DO NOT create duplicates of these)
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
