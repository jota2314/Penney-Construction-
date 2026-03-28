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

export interface BatchResult {
  emailsProcessed: number;
  projectsCreated: number;
  customersCreated: number;
  quotesCreated: number;
  followUpsCreated: number;
  stagesUpdated: number;
  errors: string[];
  done: boolean;
  totalEmails: number;
  processedSoFar: number;
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

## CRITICAL RULES

### NEVER CREATE DUPLICATE PROJECTS
- Check the "Existing Projects" list carefully before creating.
- If a project with a similar name, address, or client exists, DO NOT create a new one.
- "Paul Gouthro Addition" and "Gouthro Addition" are THE SAME project.
- If in doubt, DON'T create. Just log the email and create follow-ups/quotes linked to the existing project.
- Only create_project for genuinely NEW jobs with NO match in existing list.

### Matching to Projects
- Use the EXACT project name from the "Existing Projects" list.
- Match by client last name, address, or project name.

### Email Analysis
1. **NEW project?** ONLY if NO matching project exists → create_project
2. **QUOTE from a sub?** → create_quote (use existing project name)
3. **Needs FOLLOW-UP?** → create_follow_up
4. **Updates a PROJECT STAGE?** → update_project_stage
5. **CLIENT UPDATE?** → log_client_update
6. **Routine/spam/newsletter/automated?** → skip

### What to Skip
- Automated notifications (Google Calendar, Supabase, Vercel, GitHub, etc.)
- Newsletters, marketing, spam
- Internal system emails

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

// ── Step 1: Clear all data ──────────────────────────────────────

export async function clearAllData(): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  // Clear in order respecting foreign keys
  await supabase.from("email_logs").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await supabase.from("quote_requests").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await supabase.from("follow_ups").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await supabase.from("client_updates").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await supabase.from("workflow_actions").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await supabase.from("workflow_instances").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await supabase.from("project_subcontractors").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await supabase.from("schedule_phases").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await supabase.from("estimate_line_items").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await supabase.from("estimates").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await supabase.from("proposals").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await supabase.from("projects").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await supabase.from("customers").delete().neq("id", "00000000-0000-0000-0000-000000000000");
}

// ── Step 2: Fetch email IDs from Gmail ──────────────────────────────────────

export async function fetchEmailIds(maxEmails: number = 200): Promise<string[]> {
  const emails = await fetchRecentEmails(maxEmails);

  const supabase = await createClient();
  const { data: existingLogs } = await supabase
    .from("email_logs")
    .select("gmail_message_id");

  const processedIds = new Set(
    (existingLogs ?? []).map((l) => l.gmail_message_id)
  );

  // Store emails in a temp cache and return IDs
  const newEmails = emails.filter((e) => !processedIds.has(e.id));

  // Store the parsed emails so we can process them in batches
  // We'll use a simple approach: store in the module scope
  emailCache = newEmails;

  return newEmails.map((e) => e.id);
}

// Module-level cache for emails between fetch and process calls
let emailCache: ParsedEmail[] = [];

// ── Step 3: Process a batch of emails ──────────────────────────────────────

export async function processBatch(
  startIndex: number,
  batchSize: number = 5
): Promise<BatchResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const result: BatchResult = {
    emailsProcessed: 0,
    projectsCreated: 0,
    customersCreated: 0,
    quotesCreated: 0,
    followUpsCreated: 0,
    stagesUpdated: 0,
    errors: [],
    done: false,
    totalEmails: emailCache.length,
    processedSoFar: startIndex,
  };

  const batch = emailCache.slice(startIndex, startIndex + batchSize);

  if (batch.length === 0) {
    result.done = true;
    return result;
  }

  // Get current projects, customers, subs for context
  const [{ data: allProjects }, { data: customers }, { data: subs }] =
    await Promise.all([
      supabase.from("projects").select("id, name, address, status"),
      supabase.from("customers").select("first_name, last_name, email"),
      supabase
        .from("subcontractors")
        .select("company_name, contact_name, email, trades")
        .eq("is_active", true),
    ]);

  const projectsList = [...(allProjects ?? [])];
  const createdProjectNames = new Set<string>();

  // Process each email in batch sequentially (to maintain project list)
  for (const email of batch) {
    try {
      const decisions = await analyzeEmailWithAI(
        email,
        projectsList,
        customers ?? [],
        subs ?? []
      );

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
        `Error "${email.subject.substring(0, 40)}": ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  result.processedSoFar = startIndex + batch.length;
  result.done = result.processedSoFar >= emailCache.length;

  return result;
}

// ── Simple sync (for AI Sync Gmail button — new emails only) ──────────────

export async function runAIEmailSync(maxEmails: number = 50): Promise<BatchResult> {
  // Fetch and process in one go (small batch for incremental sync)
  await fetchEmailIds(maxEmails);

  const totalResult: BatchResult = {
    emailsProcessed: 0,
    projectsCreated: 0,
    customersCreated: 0,
    quotesCreated: 0,
    followUpsCreated: 0,
    stagesUpdated: 0,
    errors: [],
    done: false,
    totalEmails: emailCache.length,
    processedSoFar: 0,
  };

  // Process in batches of 3 (fits in 60s with gpt-4o)
  let index = 0;
  while (index < emailCache.length) {
    const batchResult = await processBatch(index, 3);
    totalResult.emailsProcessed += batchResult.emailsProcessed;
    totalResult.projectsCreated += batchResult.projectsCreated;
    totalResult.customersCreated += batchResult.customersCreated;
    totalResult.quotesCreated += batchResult.quotesCreated;
    totalResult.followUpsCreated += batchResult.followUpsCreated;
    totalResult.stagesUpdated += batchResult.stagesUpdated;
    totalResult.errors.push(...batchResult.errors);
    index += 3;
  }

  totalResult.done = true;
  totalResult.processedSoFar = emailCache.length;
  return totalResult;
}

// ── AI Analysis ──────────────────────────────────────

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

  const userPrompt = `Analyze this email. NEVER create a project if one with a similar name/address/client already exists.

## Email
From: ${email.from} <${email.fromEmail}>
To: ${email.to} <${email.toEmail}>
Date: ${email.date}
Subject: ${email.subject}
Attachments: ${email.attachments.map((a) => a.filename).join(", ") || "none"}

Body:
${email.body.substring(0, 4000)}

## Existing Projects (DO NOT create duplicates!)
${projectList || "No projects yet"}

## Existing Customers
${customerList || "No customers yet"}

## Existing Subcontractors
${subList || "No subcontractors yet"}

Return your JSON decision.`;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o",
    temperature: 0.1,
    max_tokens: 2500,
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

// ── Dedup Helper ──────────────────────────────────────

function findExistingProject(
  name: string,
  projects: { id: string; name: string; address: string | null }[]
): { id: string; name: string } | null {
  const normalized = name.toLowerCase().trim();

  for (const p of projects) {
    const pName = p.name.toLowerCase().trim();

    if (pName === normalized) return p;
    if (pName.includes(normalized) || normalized.includes(pName)) return p;

    const words = normalized.split(/\s+/).filter((w) => w.length > 3);
    const pWords = pName.split(/\s+/).filter((w) => w.length > 3);

    const matchingWords = words.filter((w) =>
      pWords.some((pw) => pw.includes(w) || w.includes(pw))
    );

    if (matchingWords.length >= 1 && matchingWords.length >= words.length * 0.5) {
      return p;
    }

    if (p.address && name.toLowerCase().includes(p.address.toLowerCase().split(",")[0])) {
      return p;
    }
  }

  return null;
}

// ── Execute Actions ──────────────────────────────────────

async function executeActions(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  email: ParsedEmail,
  decisions: AIDecision,
  result: BatchResult,
  projectsList: { id: string; name: string; address: string | null; status: string }[],
  createdProjectNames: Set<string>
) {
  for (const action of decisions.actions) {
    switch (action.type) {
      case "create_project": {
        const d = action.data;
        const projectName = d.name as string;

        const existing = findExistingProject(projectName, projectsList);
        if (existing) break;

        if (createdProjectNames.has(projectName.toLowerCase())) break;

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
          projectsList.push(newProject);
          createdProjectNames.add(projectName.toLowerCase());

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

        let projectId: string | null = null;
        const projectName = d.project_name as string;
        if (projectName) {
          const matched = findExistingProject(projectName, projectsList);
          if (matched) projectId = matched.id;
        }

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
