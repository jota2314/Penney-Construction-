import { NextResponse } from "next/server";
import OpenAI from "openai";
import { createClient } from "@/lib/supabase/server";

const getOpenAI = () => new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

interface EmailForProcessing {
  id: string;
  subject: string;
  from: string;
  fromEmail: string;
  to: string;
  toEmail: string;
  date: string;
  body: string;
  direction: "inbound" | "outbound";
  attachmentNames: string[];
}

interface AIDecision {
  actions: AIAction[];
  summary: string;
}

interface AIAction {
  type:
    | "create_project"
    | "create_customer"
    | "create_quote"
    | "create_follow_up"
    | "update_project_stage"
    | "log_client_update"
    | "log_email"
    | "skip";
  data: Record<string, unknown>;
  reason: string;
}

const SYSTEM_PROMPT = `You are the AI operations engine for Penney Construction, Inc., a residential general contracting company on the North Shore of Massachusetts.

## Your Role
You read emails and decide what database actions to take. You understand construction project lifecycles and know the team.

## Team Members
- Ryan Penney — Owner/Principal (rpenney@penneyconstructioninc.com)
- Jorge Betancur — Preconstruction Manager / Estimator (jbetancur@penneyconstructioninc.com)
- Nicole Smith — Office/Admin (nsmith@penneyconstructioninc.com)
- Howie Clickstein — Field Supervisor
- Shannon Penney — Admin/Intake

## Key Subcontractors
- Michael Pagliarulo / MTP Electric — Electrical
- Eric Pedersen / Pedersen Electrical — Electrical
- DL Services — HVAC
- Chris Parello / Jackson Lumber — Windows/Doors
- Brad Noyes / Essex County Craftsmen — HVAC
- Jon Holmes / Timberline — Windows
- Steve Black / Building Center of Gloucester — Lumber/Materials
- Wanderson Oliveira — Framing
- Jonathan Tobar — Framing
- Joe Mello — Siding
- Marcio Silva — Tile
- Peter Nguyen — Hardwood Floors
- Cosentino Plumbing — Plumbing
- Topcrete (Ryan) — Foundation & Slab

## Project Stages
Projects go through these stages:
1. lead — New inquiry, someone asking about a job
2. estimating — Walkthrough done, working on estimate
3. proposal_sent — Estimate sent to client
4. contracted — Client approved, contract signed
5. in_progress — Construction underway

## Project Phases (construction detail)
- preconstruction — Before construction starts
- pre_start — About to start, permits/materials being arranged
- rough_in — Framing, electrical, plumbing rough-in
- finishing — Trim, paint, tile, flooring
- punch_list — Final fixes before handoff
- complete — Done

## How to Analyze Each Email
Look at the sender, recipient, subject, and body. Decide:

1. **Is this about a NEW project?** (client inquiry, Ryan forwarding a new job, someone asking for work)
   → create_project + create_customer
2. **Is this a QUOTE from a sub?** (pricing, bid, proposal, estimate from a known or unknown sub)
   → create_quote with amount if found
3. **Does this need FOLLOW-UP?** (question asked, confirmation needed, waiting for response)
   → create_follow_up
4. **Does this update a PROJECT STAGE?** (walkthrough scheduled, estimate sent, client approved, construction starting)
   → update_project_stage
5. **Is this a CLIENT UPDATE?** (weekly update, progress report to client)
   → log_client_update
6. **Is this just routine/spam/irrelevant?**
   → skip

## Rules
- ALWAYS log_email for every non-spam email
- Extract dollar amounts when found (quotes, estimates, invoices)
- Match to existing projects by name, address, or client name when possible
- When creating a project, extract: name (use client last name or address), address, city, state, client name, client email, project type
- Project types: remodel, addition, kitchen, bathroom, new_construction, other
- Trade detection: electrical, plumbing, hvac, framing, roofing, siding, windows, insulation, tile, hardwood, painting, foundation, drywall, cabinets, demolition, lumber
- For follow-ups, set priority: urgent (needs response today), high (within 2 days), medium (this week), low (whenever)

## Response Format
Return a JSON object with:
{
  "actions": [
    {
      "type": "create_project" | "create_customer" | "create_quote" | "create_follow_up" | "update_project_stage" | "log_client_update" | "log_email" | "skip",
      "data": { ... fields specific to the action ... },
      "reason": "Brief explanation of why this action"
    }
  ],
  "summary": "One sentence summary of what this email is about"
}

### Action Data Fields:

**create_project:**
{ "name": "Client Last Name or Address", "client_name": "Full Name", "client_email": "email", "client_phone": "phone if found", "address": "street", "city": "city", "state": "MA", "zip": "zip", "project_type": "kitchen|bathroom|addition|remodel|new_construction|other", "description": "scope description", "status": "lead|estimating", "phase": "preconstruction" }

**create_customer:**
{ "first_name": "First", "last_name": "Last", "email": "email", "phone": "phone", "address": "address", "city": "city", "state": "state", "zip": "zip" }

**create_quote:**
{ "subcontractor_name": "Company or person name", "project_name": "matched project name", "trade": "electrical|plumbing|etc", "amount": 12345.00 or null, "scope_description": "what the quote covers", "status": "received|just_sent|awaiting_reply" }

**create_follow_up:**
{ "contact_name": "Who to follow up with", "contact_type": "subcontractor|client|internal", "description": "What needs to happen", "priority": "low|medium|high|urgent", "project_name": "matched project name or null" }

**update_project_stage:**
{ "project_name": "project to update", "new_status": "lead|estimating|proposal_sent|contracted|in_progress", "new_phase": "preconstruction|pre_start|rough_in|finishing|punch_list|complete", "reason": "why the stage changed" }

**log_client_update:**
{ "client_name": "Client Name", "project_name": "Project", "summary": "What was communicated" }

**log_email:**
{ "category": "quote|sub_outreach|client_update|follow_up|internal|other" }

IMPORTANT: Return ONLY valid JSON, no markdown fences, no extra text.`;

export async function POST(request: Request) {
  try {
    const { emails, existingProjects, existingCustomers, existingSubcontractors } =
      await request.json();

    const openai = getOpenAI();
    const results: { emailId: string; decisions: AIDecision }[] = [];

    // Process emails in batches of 5 to avoid rate limits
    const batchSize = 5;
    for (let i = 0; i < emails.length; i += batchSize) {
      const batch = emails.slice(i, i + batchSize);

      const batchResults = await Promise.all(
        batch.map(async (email: EmailForProcessing) => {
          try {
            const userPrompt = buildEmailPrompt(
              email,
              existingProjects,
              existingCustomers,
              existingSubcontractors
            );

            const completion = await openai.chat.completions.create({
              model: "gpt-4o-mini",
              temperature: 0.1,
              max_tokens: 1500,
              messages: [
                { role: "system", content: SYSTEM_PROMPT },
                { role: "user", content: userPrompt },
              ],
            });

            const content = completion.choices[0]?.message?.content?.trim();
            if (!content) {
              return {
                emailId: email.id,
                decisions: { actions: [{ type: "skip" as const, data: {}, reason: "No AI response" }], summary: "Could not process" },
              };
            }

            const decisions = JSON.parse(content) as AIDecision;
            return { emailId: email.id, decisions };
          } catch (err) {
            return {
              emailId: email.id,
              decisions: {
                actions: [{ type: "skip" as const, data: {}, reason: `Error: ${err instanceof Error ? err.message : "unknown"}` }],
                summary: "Processing error",
              },
            };
          }
        })
      );

      results.push(...batchResults);
    }

    return NextResponse.json({ results });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}

function buildEmailPrompt(
  email: EmailForProcessing,
  projects: { name: string; address: string | null; status: string }[],
  customers: { first_name: string; last_name: string; email: string | null }[],
  subcontractors: { company_name: string; contact_name: string | null; email: string | null; trades: string[] }[]
): string {
  const projectList = projects
    .map((p) => `- ${p.name} (${p.address || "no address"}) [${p.status}]`)
    .join("\n");

  const customerList = customers
    .slice(0, 30)
    .map((c) => `- ${c.first_name} ${c.last_name} (${c.email || "no email"})`)
    .join("\n");

  const subList = subcontractors
    .slice(0, 30)
    .map((s) => `- ${s.company_name} / ${s.contact_name || "?"} (${s.email || "?"}) [${s.trades.join(", ")}]`)
    .join("\n");

  return `Analyze this email and decide what actions to take.

## Email
From: ${email.from} <${email.fromEmail}>
To: ${email.to} <${email.toEmail}>
Date: ${email.date}
Subject: ${email.subject}
Attachments: ${email.attachmentNames.length > 0 ? email.attachmentNames.join(", ") : "none"}

Body:
${email.body.substring(0, 3000)}

## Existing Projects in Database
${projectList || "No projects yet"}

## Existing Customers
${customerList || "No customers yet"}

## Existing Subcontractors
${subList || "No subcontractors yet"}

Analyze and return your JSON decision.`;
}
