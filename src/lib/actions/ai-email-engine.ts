"use server";

import OpenAI from "openai";
import { createClient } from "@/lib/supabase/server";
import {
  fetchRecentEmails,
  type ParsedEmail,
} from "@/lib/google/gmail-sync";

const getOpenAI = () => new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

interface AIAction {
  type: string;
  data: Record<string, unknown>;
  reason: string;
}

interface AIDecision {
  actions: AIAction[];
  summary: string;
}

interface ProcessResult {
  emailsProcessed: number;
  projectsCreated: number;
  customersCreated: number;
  quotesCreated: number;
  followUpsCreated: number;
  stagesUpdated: number;
  errors: string[];
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
1. lead — New inquiry, someone asking about a job
2. estimating — Walkthrough done, working on estimate
3. proposal_sent — Estimate sent to client
4. contracted — Client approved, contract signed
5. in_progress — Construction underway

## Project Phases
- preconstruction, pre_start, rough_in, finishing, punch_list, complete

## How to Analyze Each Email
1. **NEW project?** (client inquiry, Ryan forwarding a new job) → create_project + create_customer
2. **QUOTE from a sub?** (pricing, bid, proposal with $ amount) → create_quote
3. **Needs FOLLOW-UP?** (question, confirmation needed) → create_follow_up
4. **Updates a PROJECT STAGE?** (walkthrough scheduled, estimate sent, client approved) → update_project_stage
5. **CLIENT UPDATE?** (weekly update, progress report) → log_client_update
6. **Routine/spam?** → skip

## Rules
- ALWAYS include a log_email action for every non-spam email
- Extract dollar amounts when found
- Match to existing projects by name, address, or client name
- Project types: remodel, addition, kitchen, bathroom, new_construction, other

## Response Format
Return ONLY valid JSON (no markdown fences):
{
  "actions": [
    { "type": "...", "data": { ... }, "reason": "..." }
  ],
  "summary": "One sentence summary"
}

Action types and their data fields:
- create_project: { name, client_name, client_email, address, city, state, zip, project_type, description, status, phase }
- create_customer: { first_name, last_name, email, phone, address, city, state, zip }
- create_quote: { subcontractor_name, project_name, trade, amount, scope_description, status }
- create_follow_up: { contact_name, contact_type, description, priority, project_name }
- update_project_stage: { project_name, new_status, new_phase, reason }
- log_client_update: { client_name, project_name, summary }
- log_email: { category } (quote|sub_outreach|client_update|follow_up|internal|other)
- skip: {}`;

/**
 * Call OpenAI directly to analyze a single email.
 */
async function analyzeEmailWithAI(
  email: ParsedEmail,
  projects: { name: string; address: string | null; status: string }[],
  customers: { first_name: string; last_name: string; email: string | null }[],
  subs: { company_name: string; contact_name: string | null; email: string | null; trades: string[] }[]
): Promise<AIDecision> {
  const openai = getOpenAI();

  const projectList = projects
    .map((p) => `- ${p.name} (${p.address || "no address"}) [${p.status}]`)
    .join("\n");

  const customerList = customers
    .slice(0, 30)
    .map((c) => `- ${c.first_name} ${c.last_name} (${c.email || "no email"})`)
    .join("\n");

  const subList = subs
    .slice(0, 30)
    .map((s) => `- ${s.company_name} / ${s.contact_name || "?"} (${s.email || "?"}) [${s.trades.join(", ")}]`)
    .join("\n");

  const userPrompt = `Analyze this email:

From: ${email.from} <${email.fromEmail}>
To: ${email.to} <${email.toEmail}>
Date: ${email.date}
Subject: ${email.subject}
Attachments: ${email.attachments.map((a) => a.filename).join(", ") || "none"}

Body:
${email.body.substring(0, 2500)}

## Existing Projects
${projectList || "No projects yet"}

## Existing Customers
${customerList || "No customers yet"}

## Existing Subcontractors
${subList || "No subcontractors yet"}

Return your JSON decision.`;

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
    return { actions: [{ type: "log_email", data: { category: "other" }, reason: "No AI response" }], summary: "Could not process" };
  }

  // Clean up response — remove markdown fences if present
  const cleaned = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  return JSON.parse(cleaned) as AIDecision;
}

/**
 * Full AI-powered email sync:
 * 1. Pull emails from Gmail
 * 2. Send each to OpenAI for analysis
 * 3. Execute actions (create projects, quotes, follow-ups, etc.)
 */
export async function runAIEmailSync(maxEmails: number = 100): Promise<ProcessResult> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const result: ProcessResult = {
    emailsProcessed: 0,
    projectsCreated: 0,
    customersCreated: 0,
    quotesCreated: 0,
    followUpsCreated: 0,
    stagesUpdated: 0,
    errors: [],
  };

  try {
    // 1. Pull emails from Gmail
    const emails = await fetchRecentEmails(maxEmails);

    // 2. Filter out already-processed emails
    const { data: existingLogs } = await supabase
      .from("email_logs")
      .select("gmail_message_id");

    const processedIds = new Set(
      (existingLogs ?? []).map((l) => l.gmail_message_id)
    );

    const newEmails = emails.filter((e) => !processedIds.has(e.id));

    if (newEmails.length === 0) {
      return result;
    }

    // 3. Get existing data for context
    const [{ data: projects }, { data: customers }, { data: subs }] =
      await Promise.all([
        supabase
          .from("projects")
          .select("name, address, status")
          .in("status", ["lead", "estimating", "proposal_sent", "contracted", "in_progress"]),
        supabase
          .from("customers")
          .select("first_name, last_name, email"),
        supabase
          .from("subcontractors")
          .select("company_name, contact_name, email, trades")
          .eq("is_active", true),
      ]);

    // 4. Process each email with AI (in batches of 5 for rate limiting)
    const batchSize = 5;
    for (let i = 0; i < newEmails.length; i += batchSize) {
      const batch = newEmails.slice(i, i + batchSize);

      const batchResults = await Promise.all(
        batch.map(async (email) => {
          try {
            const decisions = await analyzeEmailWithAI(
              email,
              projects ?? [],
              customers ?? [],
              subs ?? []
            );
            return { email, decisions, error: null };
          } catch (err) {
            return {
              email,
              decisions: null,
              error: err instanceof Error ? err.message : String(err),
            };
          }
        })
      );

      // 5. Execute actions for each email
      for (const { email, decisions, error } of batchResults) {
        if (error || !decisions) {
          result.errors.push(
            `AI error for "${email.subject.substring(0, 50)}": ${error}`
          );
          continue;
        }

        try {
          await executeActions(supabase, user.id, email, decisions, result);
          result.emailsProcessed++;
        } catch (err) {
          result.errors.push(
            `Action error for "${email.subject.substring(0, 50)}": ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }
    }
  } catch (err) {
    result.errors.push(
      `Sync error: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  return result;
}

/**
 * Deep scan — clears all existing AI-generated data and re-processes
 * up to 500 emails from scratch. Use this for initial setup.
 */
export async function runDeepScan(): Promise<ProcessResult> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  // Clear all existing AI-generated data
  await Promise.all([
    supabase.from("email_logs").delete().neq("id", "00000000-0000-0000-0000-000000000000"),
    supabase.from("quote_requests").delete().neq("id", "00000000-0000-0000-0000-000000000000"),
    supabase.from("follow_ups").delete().neq("id", "00000000-0000-0000-0000-000000000000"),
    supabase.from("client_updates").delete().neq("id", "00000000-0000-0000-0000-000000000000"),
  ]);

  // Now run the full sync with 500 emails
  return runAIEmailSync(500);
}

// ── Execute Actions ──────────────────────────────────────

async function executeActions(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  email: ParsedEmail,
  decisions: AIDecision,
  result: ProcessResult
) {
  for (const action of decisions.actions) {
    switch (action.type) {
      case "create_project": {
        const d = action.data;
        const { data: newProject, error } = await supabase
          .from("projects")
          .insert({
            name: d.name as string,
            address: d.address as string || null,
            city: d.city as string || null,
            state: (d.state as string) || "MA",
            zip: d.zip as string || null,
            project_type: (d.project_type as string) || "other",
            description: d.description as string || null,
            status: (d.status as string) || "lead",
            phase: (d.phase as string) || "preconstruction",
            project_number: `P-${Date.now().toString(36).toUpperCase()}`,
            created_by: userId,
          })
          .select("id")
          .single();

        if (!error && newProject) {
          result.projectsCreated++;

          if (d.client_email) {
            const { data: existingCustomer } = await supabase
              .from("customers")
              .select("id")
              .eq("email", d.client_email as string)
              .single();

            if (existingCustomer) {
              await supabase
                .from("projects")
                .update({ customer_id: existingCustomer.id })
                .eq("id", newProject.id);
            }
          }
        }
        break;
      }

      case "create_customer": {
        const d = action.data;
        const emailCheck = d.email as string;
        if (emailCheck) {
          const { data: existing } = await supabase
            .from("customers")
            .select("id")
            .eq("email", emailCheck)
            .single();

          if (existing) break;
        }

        const { error } = await supabase.from("customers").insert({
          first_name: d.first_name as string,
          last_name: d.last_name as string,
          email: d.email as string || null,
          phone: d.phone as string || null,
          address: d.address as string || null,
          city: d.city as string || null,
          state: d.state as string || null,
          zip: d.zip as string || null,
          created_by: userId,
        });

        if (!error) result.customersCreated++;
        break;
      }

      case "create_quote": {
        const d = action.data;

        let projectId: string | null = null;
        if (d.project_name) {
          const { data: matched } = await supabase
            .from("projects")
            .select("id")
            .ilike("name", `%${d.project_name}%`)
            .limit(1)
            .single();

          if (matched) projectId = matched.id;
        }

        const { error } = await supabase.from("quote_requests").insert({
          project_id: projectId,
          subcontractor_name: d.subcontractor_name as string,
          project_name: (d.project_name as string) || "Unmatched",
          trade: d.trade as string || null,
          amount: d.amount as number || null,
          scope_description: d.scope_description as string || null,
          status: (d.status as string) || "received",
          sent_at: email.date,
          received_at: email.direction === "inbound" ? email.date : null,
          gmail_message_id: email.id,
          created_by: userId,
        });

        if (!error) result.quotesCreated++;
        break;
      }

      case "create_follow_up": {
        const d = action.data;

        let projectId: string | null = null;
        if (d.project_name) {
          const { data: matched } = await supabase
            .from("projects")
            .select("id")
            .ilike("name", `%${d.project_name}%`)
            .limit(1)
            .single();

          if (matched) projectId = matched.id;
        }

        const { error } = await supabase.from("follow_ups").insert({
          project_id: projectId,
          project_name: d.project_name as string || null,
          contact_name: d.contact_name as string,
          contact_type: (d.contact_type as string) || "subcontractor",
          description: d.description as string,
          priority: (d.priority as string) || "medium",
          status: "open",
          created_by: userId,
        });

        if (!error) result.followUpsCreated++;
        break;
      }

      case "update_project_stage": {
        const d = action.data;

        if (d.project_name) {
          const updates: Record<string, unknown> = {
            updated_at: new Date().toISOString(),
          };

          if (d.new_status) updates.status = d.new_status;
          if (d.new_phase) updates.phase = d.new_phase;

          const { error } = await supabase
            .from("projects")
            .update(updates)
            .ilike("name", `%${d.project_name}%`);

          if (!error) result.stagesUpdated++;
        }
        break;
      }

      case "log_client_update": {
        const d = action.data;

        const weekStart = new Date();
        weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1);
        weekStart.setHours(0, 0, 0, 0);

        let projectId: string | null = null;
        if (d.project_name) {
          const { data: matched } = await supabase
            .from("projects")
            .select("id")
            .ilike("name", `%${d.project_name}%`)
            .limit(1)
            .single();

          if (matched) projectId = matched.id;
        }

        await supabase.from("client_updates").insert({
          project_id: projectId,
          client_name: d.client_name as string,
          week_start: weekStart.toISOString().split("T")[0],
          status: "sent",
          sent_at: email.date,
          summary: d.summary as string || null,
          gmail_message_id: email.id,
          created_by: userId,
        });
        break;
      }

      case "log_email": {
        const d = action.data;
        const category = (d.category as string) || "other";

        let projectId: string | null = null;
        const { data: allProjects } = await supabase
          .from("projects")
          .select("id, name, address")
          .in("status", ["lead", "estimating", "proposal_sent", "contracted", "in_progress"]);

        const searchText = `${email.subject} ${email.body}`.toLowerCase();
        for (const p of allProjects ?? []) {
          if (
            (p.name && searchText.includes(p.name.toLowerCase())) ||
            (p.address && searchText.includes(p.address.toLowerCase()))
          ) {
            projectId = p.id;
            break;
          }
        }

        await supabase.from("email_logs").insert({
          gmail_message_id: email.id,
          subject: email.subject.substring(0, 500),
          from_email: email.fromEmail,
          to_email: email.toEmail,
          direction: email.direction,
          category,
          project_id: projectId,
          sent_at: email.date,
        });
        break;
      }

      case "skip":
        break;
    }
  }
}
