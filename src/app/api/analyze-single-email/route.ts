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

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    const { emailId } = await request.json();
    if (!emailId) return NextResponse.json({ error: "emailId required" }, { status: 400 });

    // 1. Fetch this one email
    const emails = await fetchMessagesByIds([emailId]);
    if (emails.length === 0) return NextResponse.json({ error: "Email not found" }, { status: 404 });
    const email = emails[0];

    const isOutbound = COMPANY_EMAILS.some(
      (ce) => email.fromEmail.toLowerCase() === ce.toLowerCase()
    );

    // 2. Get existing data from database
    const [{ data: projects }, { data: customers }, { data: subs }] = await Promise.all([
      supabase.from("projects").select("id, name, address, city, status, project_type, customer_id"),
      supabase.from("customers").select("id, first_name, last_name, email"),
      supabase.from("subcontractors").select("id, company_name, contact_name, email"),
    ]);

    const projectList = (projects ?? [])
      .map((p) => `- "${p.name}" [${p.status}] ${p.address || ""} ${p.city || ""}`.trim())
      .join("\n");

    const customerList = (customers ?? [])
      .map((c) => `- ${c.first_name} ${c.last_name}${c.email ? ` <${c.email}>` : ""}`)
      .join("\n");

    const subList = (subs ?? [])
      .map((s) => `- ${s.company_name}${s.contact_name ? ` (${s.contact_name})` : ""}${s.email ? ` <${s.email}>` : ""}`)
      .join("\n");

    // 3. Send to AI — one email, minimal prompt, focused
    const systemPrompt = `You are analyzing ONE email for Penney Construction (residential GC, North Shore MA).

Team (NOT customers): Ryan Penney (Owner), Jorge Betancur (Estimator), Nicole Smith (Admin), Howie Clickstein (Field), Shannon Penney (Intake).

## EXISTING PROJECTS IN DATABASE
${projectList || "No projects yet"}

## EXISTING CUSTOMERS
${customerList || "None yet"}

## EXISTING SUBCONTRACTORS
${subList || "None yet"}

## YOUR JOB
1. Check if this email matches an EXISTING project (by client name, address, or context)
2. If it matches → return which project and what to do (log it, create quote, create follow-up)
3. If it does NOT match any project AND it's about a real construction job → suggest creating a new project with all details
4. If it's spam, newsletter, or irrelevant → return skip

## RULES
- A PROJECT is a real construction job for a homeowner (not vendor orders, not internal)
- A CUSTOMER is a homeowner — NOT a sub, vendor, or team member
- Project names: "ClientLastName ProjectType" (e.g., "Smith Kitchen", "Gouthro Addition")
- Extract: address, city, state, phone, email from signatures
- Only create follow-ups for inbound emails that NEED a response

## OUTPUT — Return ONE JSON object:
{
  "match": "existing" or "new_project" or "skip",
  "project_name": "the project name (existing or new)",
  "summary": "One sentence: what this email is about",
  "actions": [
    { "type": "create_project", "data": { "name": "...", "address": "...", "city": "...", "state": "MA", "project_type": "...", "status": "...", "phase": "...", "description": "...", "customer_name": "..." } },
    { "type": "create_customer", "data": { "first_name": "...", "last_name": "...", "email": "...", "phone": "..." } },
    { "type": "create_subcontractor", "data": { "company_name": "...", "contact_name": "...", "email": "...", "trades": ["..."] } },
    { "type": "create_quote", "data": { "subcontractor_name": "...", "project_name": "...", "trade": "...", "amount": 0, "status": "received" } },
    { "type": "create_follow_up", "data": { "contact_name": "...", "description": "...", "priority": "high", "project_name": "..." } },
    { "type": "log_email", "data": { "category": "...", "project_name": "..." } }
  ]
}

Return ONLY valid JSON. No markdown fences.`;

    const userPrompt = `--- EMAIL [${isOutbound ? "OUTBOUND" : "INBOUND"}] ---
From: ${email.from} <${email.fromEmail}>
To: ${email.to} <${email.toEmail}>
Date: ${email.date}
Subject: ${email.subject}
${email.attachments.length > 0 ? `Attachments: ${email.attachments.map((a) => a.filename).join(", ")}` : ""}

${email.body.substring(0, 3000)}`;

    const content = await callClaude(systemPrompt, userPrompt, 2048);
    const cleaned = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

    let analysis;
    try {
      analysis = JSON.parse(cleaned);
    } catch {
      return NextResponse.json({ error: `AI returned invalid JSON` }, { status: 500 });
    }

    return NextResponse.json({
      analysis,
      email: {
        id: email.id,
        subject: email.subject,
        from: email.from,
        fromEmail: email.fromEmail,
        to: email.to,
        toEmail: email.toEmail,
        date: email.date,
        direction: isOutbound ? "outbound" : "inbound",
        snippet: email.body.substring(0, 500),
        attachments: email.attachments.map((a) => ({
          filename: a.filename, mimeType: a.mimeType,
          attachmentId: a.attachmentId, size: a.size,
        })),
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
