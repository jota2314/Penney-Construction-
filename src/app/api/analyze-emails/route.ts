import { NextResponse } from "next/server";
import OpenAI from "openai";
import { createClient } from "@/lib/supabase/server";
import { fetchMessagesByIds } from "@/lib/google/gmail-sync";

const BULK_SYSTEM_PROMPT = `You are the AI engine for Penney Construction, Inc. (North Shore MA, residential GC).

Team: Ryan Penney (Owner), Jorge Betancur (Precon/Estimator), Nicole Smith (Admin), Howie Clickstein (Field), Shannon Penney (Intake).

Known subs: MTP Electric, Pedersen Electrical, DL Services (HVAC), Jackson Lumber (Chris Parello), Essex County Craftsmen (Brad Noyes), Timberline (Jon Holmes), Building Center of Gloucester (Steve Black), Wanderson Oliveira (Framing), Jonathan Tobar (Framing), Joe Mello (Siding), Marcio Silva (Tile), Peter Nguyen (Hardwood), Cosentino Plumbing, Topcrete (Foundation).

You will receive multiple emails. For each email, match it to an existing project and extract useful data.

## Your job:
1. **Match to a project** — Look at the email content (addresses, client names, project references) and match to the "Existing Projects" list. Use the EXACT project name from the list.
2. **Extract quotes** — If a sub sends pricing/bid with $ amounts, create a quote linked to the matched project.
3. **Create follow-ups** — If something needs action (reply needed, question asked, decision pending).
4. **Log the email** — Categorize every non-spam email.

## DO NOT create new projects. Projects already exist in the database.
## Skip: spam, automated notifications, Google Calendar, Vercel, GitHub, newsletters.
## Extract $ amounts from quotes (look for $X,XXX patterns).

Return JSON array — one entry per email:
[
  {
    "email_index": 0,
    "actions": [
      { "type": "create_quote", "data": { "subcontractor_name": "...", "project_name": "EXACT name from existing list", "trade": "electrical|plumbing|hvac|framing|roofing|siding|windows|insulation|tile|hardwood|painting|foundation|drywall|cabinets|lumber", "amount": 1234.00, "status": "received|just_sent|awaiting_reply" } },
      { "type": "create_follow_up", "data": { "contact_name": "...", "contact_type": "subcontractor|client|internal", "description": "...", "priority": "low|medium|high|urgent", "project_name": "EXACT name from existing list" } },
      { "type": "log_email", "data": { "category": "quote|sub_outreach|client_update|follow_up|internal|other", "project_name": "EXACT name from existing list or null" } },
      { "type": "skip" }
    ]
  }
]

Return ONLY valid JSON, no markdown fences.`;

export async function POST(request: Request) {
  // Use OPENAI_API_KEY (proven to work on Vercel) or ANTHROPIC_API_KEY as fallback
  const openaiKey = process.env.OPENAI_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  if (!openaiKey && !anthropicKey) {
    return NextResponse.json(
      { error: "No AI API key configured. Set OPENAI_API_KEY or ANTHROPIC_API_KEY in Vercel env vars." },
      { status: 500 }
    );
  }

  // Auth check
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

    // Fetch email content from Gmail
    const emails = await fetchMessagesByIds(emailIds);

    if (emails.length === 0) {
      return NextResponse.json({ decisions: [], emails: [] });
    }

    // Get existing data for AI context
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

## Existing Projects (match emails to these — DO NOT create new ones)
${projectList || "No projects yet"}

## Existing Customers
${(customers ?? []).slice(0, 20).map((c) => `- ${c.first_name} ${c.last_name}`).join("\n") || "None"}

Return your JSON array.`;

    // Call AI — use OpenAI (gpt-4o) since its env var is confirmed working
    let content: string;

    if (openaiKey) {
      const openai = new OpenAI({ apiKey: openaiKey });
      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        temperature: 0.1,
        max_tokens: 4000,
        messages: [
          { role: "system", content: BULK_SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
      });
      content = completion.choices[0]?.message?.content?.trim() || "";
    } else {
      // Anthropic fallback (if key ever becomes available)
      const Anthropic = (await import("@anthropic-ai/sdk")).default;
      const anthropic = new Anthropic({ apiKey: anthropicKey! });
      const message = await anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4096,
        system: BULK_SYSTEM_PROMPT,
        messages: [{ role: "user", content: userPrompt }],
      });
      content = message.content[0]?.type === "text" ? message.content[0].text.trim() : "";
    }

    if (!content) {
      return NextResponse.json({ error: "No AI response" }, { status: 500 });
    }

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

    // Return decisions + email metadata for DB writes
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
