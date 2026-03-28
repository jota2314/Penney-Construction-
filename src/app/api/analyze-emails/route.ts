import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchMessagesByIds } from "@/lib/google/gmail-sync";
import { callClaude } from "@/lib/ai/claude";

const BULK_SYSTEM_PROMPT = `You are the AI engine for Penney Construction, Inc. (North Shore MA, residential GC).

Team: Ryan Penney (Owner), Jorge Betancur (Precon/Estimator), Nicole Smith (Admin), Howie Clickstein (Field), Shannon Penney (Intake).

Known subs: MTP Electric, Pedersen Electrical, DL Services (HVAC), Jackson Lumber (Chris Parello), Essex County Craftsmen (Brad Noyes), Timberline (Jon Holmes), Building Center of Gloucester (Steve Black), Wanderson Oliveira (Framing), Jonathan Tobar (Framing), Joe Mello (Siding), Marcio Silva (Tile), Peter Nguyen (Hardwood), Cosentino Plumbing, Topcrete (Foundation).

You will receive multiple emails. For each email, match it to an existing project and extract useful data.

## Your job:
1. **Match to a project** — Use the EXACT project name from the "Existing Projects" list.
2. **Extract quotes** — If a sub sends pricing/bid with $ amounts, create a quote.
3. **Create follow-ups** — If something needs action.
4. **Log the email** — Categorize every non-spam email.

## DO NOT create new projects. Projects already exist in the database.
## Skip: spam, automated notifications, Google Calendar, Vercel, GitHub, newsletters.
## Extract $ amounts from quotes (look for $X,XXX patterns).

Return JSON array — one entry per email:
[
  {
    "email_index": 0,
    "actions": [
      { "type": "create_quote", "data": { "subcontractor_name": "...", "project_name": "EXACT name from list", "trade": "...", "amount": 1234.00, "status": "received|just_sent|awaiting_reply" } },
      { "type": "create_follow_up", "data": { "contact_name": "...", "contact_type": "subcontractor|client|internal", "description": "...", "priority": "low|medium|high|urgent", "project_name": "EXACT name from list" } },
      { "type": "log_email", "data": { "category": "quote|sub_outreach|client_update|follow_up|internal|other", "project_name": "EXACT name or null" } },
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

    const [{ data: projects }, { data: customers }] = await Promise.all([
      supabase.from("projects").select("id, name, address, status"),
      supabase.from("customers").select("first_name, last_name, email"),
    ]);

    const projectList = (projects ?? [])
      .map((p) => `- "${p.name}" (${p.address || "?"}) [${p.status}]`)
      .join("\n");

    const emailSummaries = emails.map((e, i) =>
      `--- EMAIL ${i} ---
From: ${e.from} <${e.fromEmail}>
To: ${e.to} <${e.toEmail}>
Date: ${e.date}
Subject: ${e.subject}
Body: ${e.body.substring(0, 1500)}`
    ).join("\n\n");

    const userPrompt = `Analyze these ${emails.length} emails:

${emailSummaries}

## Existing Projects (match to these — DO NOT create new ones)
${projectList || "No projects yet"}

## Existing Customers
${(customers ?? []).slice(0, 20).map((c) => `- ${c.first_name} ${c.last_name}`).join("\n") || "None"}

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
