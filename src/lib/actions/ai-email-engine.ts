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
You read emails and decide what database actions to take.

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
1. lead — New inquiry
2. estimating — Working on estimate
3. proposal_sent — Estimate sent to client
4. contracted — Client approved
5. in_progress — Construction underway

## CRITICAL RULES — READ CAREFULLY

### NEVER CREATE DUPLICATE PROJECTS
- Before suggesting create_project, check the "Existing Projects" list carefully.
- If a project with a similar name, address, or client exists, DO NOT create a new one.
- "Paul Gouthro Addition" and "Gouthro Addition" are THE SAME project — do NOT create duplicates.
- "Nelligan Residence" at "206 Lowell St" and "Nelligan" at "206 Lowell Street" are THE SAME — do NOT create duplicates.
- If in doubt, DON'T create a project. Just log the email and create follow-ups/quotes linked to the existing project.
- Only create_project for genuinely NEW jobs that have no match in the existing list.

### Matching to Projects
- Use the EXACT project name from the "Existing Projects" list in your project_name fields.
- If the email mentions "14 Cameron Rd" and there's a project at "14 Cameron Rd", use that project's exact name.
- If the email mentions "Gouthro" and there's "Paul Gouthro Addition" in the list, use "Paul Gouthro Addition".

### Email Analysis
1. **NEW project?** ONLY if there is NO matching project in the existing list → create_project
2. **QUOTE from a sub?** → create_quote (use existing project name)
3. **Needs FOLLOW-UP?** → create_follow_up (use existing project name)
4. **Updates a PROJECT STAGE?** → update_project_stage
5. **CLIENT UPDATE?** → log_client_update
6. **Routine/spam/newsletter/automated?** → skip (don't even log)

### What to Skip
- Automated notifications (Google Calendar, Supabase, Vercel, etc.)
- Newsletter/marketing emails
- Spam
- Internal system emails
- Emails that are just replies in a thread where the original was already processed

## Response Format
Return ONLY valid JSON (no markdown fences):
{
  "actions": [
    { "type": "...", "data": { ... }, "reason": "..." }
  ],
  "summary": "One sentence summary"
}

Action types:
- create_project: { name, client_name, client_email, address, city, state, zip, project_type, description, status, phase }
- create_customer: { first_name, last_name, email, phone, address, city, state, zip }
- create_quote: { subcontractor_name, project_name, trade, amount, scope_description, status }
- create_follow_up: { contact_name, contact_type, description, priority, project_name }
- update_project_stage: { project_name, new_status, new_phase, reason }
- log_client_update: { client_name, project_name, summary }
- log_email: { category, project_name } (quote|sub_outreach|client_update|follow_up|internal|other)
- skip: {}`;

/**
 * Call OpenAI to analyze a single email.
 */
async function analyzeEmailWithAI(
  email: ParsedEmail,
  projects: { id: string; name: string; address: string | null; status: string }[],
  customers: { first_name: string; last_name: string; email: string | null }[],
  subs: { company_name: string; contact_name: string | null; email: string | null; trades: string[] }[]
): Promise<AIDecision> {
  const openai = getOpenAI();

  const projectList = projects
    .map((p) => `- "${p.name}" (${p.address || "no address"}) [${p.status}]`)
    .join("\n");

  const customerList = customers
    .slice(0, 50)
    .map((c) => `- ${c.first_name} ${c.last_name} (${c.email || "no email"})`)
    .join("\n");

  const subList = subs
    .slice(0, 30)
    .map((s) => `- ${s.company_name} / ${s.contact_name || "?"} (${s.email || "?"}) [${s.trades.join(", ")}]`)
    .join("\n");

  const userPrompt = `Analyze this email. Remember: NEVER create a project if one with a similar name/address/client already exists in the list below.

## Email
From: ${email.from} <${email.fromEmail}>
To: ${email.to} <${email.toEmail}>
Date: ${email.date}
Subject: ${email.subject}
Attachments: ${email.attachments.map((a) => a.filename).join(", ") || "none"}

Body:
${email.body.substring(0, 2500)}

## Existing Projects (DO NOT create duplicates of these!)
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
    return { actions: [{ type: "skip", data: {}, reason: "No AI response" }], summary: "Could not process" };
  }

  const cleaned = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  return JSON.parse(cleaned) as AIDecision;
}

/**
 * Check if a project with a similar name already exists.
 * Returns the existing project ID if found, null otherwise.
 */
function findExistingProject(
  name: string,
  projects: { id: string; name: string; address: string | null }[]
): { id: string; name: string } | null {
  const normalized = name.toLowerCase().trim();

  for (const p of projects) {
    const pName = p.name.toLowerCase().trim();

    // Exact match
    if (pName === normalized) return p;

    // One contains the other
    if (pName.includes(normalized) || normalized.includes(pName)) return p;

    // Check for partial word matches (e.g. "Gouthro" matches "Paul Gouthro Addition")
    const words = normalized.split(/\s+/).filter((w) => w.length > 3);
    const pWords = pName.split(/\s+/).filter((w) => w.length > 3);

    const matchingWords = words.filter((w) =>
      pWords.some((pw) => pw.includes(w) || w.includes(pw))
    );

    if (matchingWords.length >= 1 && matchingWords.length >= words.length * 0.5) {
      return p;
    }

    // Address match
    if (p.address && name.toLowerCase().includes(p.address.toLowerCase().split(",")[0])) {
      return p;
    }
  }

  return null;
}

/**
 * Full AI-powered email sync.
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
    const emails = await fetchRecentEmails(maxEmails);

    const { data: existingLogs } = await supabase
      .from("email_logs")
      .select("gmail_message_id");

    const processedIds = new Set(
      (existingLogs ?? []).map((l) => l.gmail_message_id)
    );

    const newEmails = emails.filter((e) => !processedIds.has(e.id));

    if (newEmails.length === 0) return result;

    // Get ALL projects (not just active) for dedup checking
    const [{ data: allProjects }, { data: customers }, { data: subs }] =
      await Promise.all([
        supabase.from("projects").select("id, name, address, status"),
        supabase.from("customers").select("first_name, last_name, email"),
        supabase
          .from("subcontractors")
          .select("company_name, contact_name, email, trades")
          .eq("is_active", true),
      ]);

    // Mutable list — new projects get added during processing
    const projectsList = [...(allProjects ?? [])];

    // Track created project names in this run to prevent intra-batch dupes
    const createdProjectNames = new Set<string>();

    const batchSize = 5;
    for (let i = 0; i < newEmails.length; i += batchSize) {
      const batch = newEmails.slice(i, i + batchSize);

      const batchResults = await Promise.all(
        batch.map(async (email) => {
          try {
            const decisions = await analyzeEmailWithAI(
              email,
              projectsList,
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

      for (const { email, decisions, error } of batchResults) {
        if (error || !decisions) {
          result.errors.push(
            `AI error for "${email.subject.substring(0, 40)}": ${error}`
          );
          continue;
        }

        try {
          await executeActions(
            supabase,
            user.id,
            email,
            decisions,
            result,
            projectsList,
            createdProjectNames
          );
          result.emailsProcessed++;
        } catch (err) {
          result.errors.push(
            `Action error for "${email.subject.substring(0, 40)}": ${err instanceof Error ? err.message : String(err)}`
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
 * Deep scan — clears all AI-generated data and re-processes from scratch.
 */
export async function runDeepScan(): Promise<ProcessResult> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  // Clear AI-generated data
  await Promise.all([
    supabase.from("email_logs").delete().neq("id", "00000000-0000-0000-0000-000000000000"),
    supabase.from("quote_requests").delete().neq("id", "00000000-0000-0000-0000-000000000000"),
    supabase.from("follow_ups").delete().neq("id", "00000000-0000-0000-0000-000000000000"),
    supabase.from("client_updates").delete().neq("id", "00000000-0000-0000-0000-000000000000"),
  ]);

  return runAIEmailSync(500);
}

// ── Execute Actions with Dedup ──────────────────────────────────────

async function executeActions(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  email: ParsedEmail,
  decisions: AIDecision,
  result: ProcessResult,
  projectsList: { id: string; name: string; address: string | null; status: string }[],
  createdProjectNames: Set<string>
) {
  for (const action of decisions.actions) {
    switch (action.type) {
      case "create_project": {
        const d = action.data;
        const projectName = d.name as string;

        // DEDUP CHECK 1: Does a project with this name already exist in DB?
        const existing = findExistingProject(projectName, projectsList);
        if (existing) {
          // Don't create — it already exists
          break;
        }

        // DEDUP CHECK 2: Did we already create this project in this run?
        if (createdProjectNames.has(projectName.toLowerCase())) {
          break;
        }

        const { data: newProject, error } = await supabase
          .from("projects")
          .insert({
            name: projectName,
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
          .select("id, name, address, status")
          .single();

        if (!error && newProject) {
          result.projectsCreated++;
          // Add to the list so future emails in this batch see it
          projectsList.push(newProject);
          createdProjectNames.add(projectName.toLowerCase());

          // Link customer if exists
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

        // Dedup: check if customer exists by email
        if (emailCheck) {
          const { data: existing } = await supabase
            .from("customers")
            .select("id")
            .eq("email", emailCheck)
            .single();

          if (existing) break;
        }

        // Dedup: check if customer exists by name
        const firstName = d.first_name as string;
        const lastName = d.last_name as string;
        if (firstName && lastName) {
          const { data: existing } = await supabase
            .from("customers")
            .select("id")
            .eq("first_name", firstName)
            .eq("last_name", lastName)
            .single();

          if (existing) break;
        }

        const { error } = await supabase.from("customers").insert({
          first_name: firstName,
          last_name: lastName,
          email: emailCheck || null,
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

        // Find project by name
        let projectId: string | null = null;
        const projectName = d.project_name as string;
        if (projectName) {
          const matched = findExistingProject(projectName, projectsList);
          if (matched) projectId = matched.id;
        }

        // Dedup: check if this exact quote already exists
        const subName = d.subcontractor_name as string;
        if (projectId && subName) {
          const { data: existingQuote } = await supabase
            .from("quote_requests")
            .select("id")
            .eq("project_id", projectId)
            .eq("subcontractor_name", subName)
            .single();

          if (existingQuote) break;
        }

        const { error } = await supabase.from("quote_requests").insert({
          project_id: projectId,
          subcontractor_name: subName,
          project_name: projectName || "Unmatched",
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
        const projectName = d.project_name as string;
        if (projectName) {
          const matched = findExistingProject(projectName, projectsList);
          if (matched) projectId = matched.id;
        }

        const { error } = await supabase.from("follow_ups").insert({
          project_id: projectId,
          project_name: projectName || null,
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
        const projectName = d.project_name as string;

        if (projectName) {
          const matched = findExistingProject(projectName, projectsList);
          if (matched) {
            const updates: Record<string, unknown> = {
              updated_at: new Date().toISOString(),
            };

            if (d.new_status) updates.status = d.new_status;
            if (d.new_phase) updates.phase = d.new_phase;

            const { error } = await supabase
              .from("projects")
              .update(updates)
              .eq("id", matched.id);

            if (!error) result.stagesUpdated++;
          }
        }
        break;
      }

      case "log_client_update": {
        const d = action.data;

        const weekStart = new Date();
        weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1);
        weekStart.setHours(0, 0, 0, 0);

        let projectId: string | null = null;
        const projectName = d.project_name as string;
        if (projectName) {
          const matched = findExistingProject(projectName, projectsList);
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
        const projectName = d.project_name as string;
        if (projectName) {
          const matched = findExistingProject(projectName, projectsList);
          if (matched) projectId = matched.id;
        }

        // If AI didn't provide a project name, try text matching
        if (!projectId) {
          const searchText = `${email.subject} ${email.snippet || ""}`.toLowerCase();
          for (const p of projectsList) {
            if (
              (p.name && searchText.includes(p.name.toLowerCase())) ||
              (p.address && p.address.length > 5 && searchText.includes(p.address.toLowerCase().split(",")[0]))
            ) {
              projectId = p.id;
              break;
            }
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
