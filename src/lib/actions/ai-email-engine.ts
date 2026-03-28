"use server";

import OpenAI from "openai";
import { createClient } from "@/lib/supabase/server";
import {
  fetchEmailIdList,
  fetchMessagesByIds,
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
}

const SYSTEM_PROMPT = `You are the AI operations engine for Penney Construction, Inc., a residential general contracting company on the North Shore of Massachusetts.

## Team
- Ryan Penney — Owner (rpenney@penneyconstructioninc.com)
- Jorge Betancur — Preconstruction Manager (jbetancur@penneyconstructioninc.com)
- Nicole Smith — Admin (nsmith@penneyconstructioninc.com)
- Howie Clickstein — Field Supervisor
- Shannon Penney — Admin/Intake

## Key Subs
MTP Electric, Pedersen Electrical, DL Services (HVAC), Jackson Lumber (Chris Parello), Essex County Craftsmen (Brad Noyes), Timberline (Jon Holmes), Building Center of Gloucester (Steve Black), Wanderson Oliveira (Framing), Jonathan Tobar (Framing), Joe Mello (Siding), Marcio Silva (Tile), Peter Nguyen (Hardwood), Cosentino Plumbing, Topcrete (Foundation)

## CRITICAL: NEVER CREATE DUPLICATES
- Check "Existing Projects" before creating. If similar name/address/client exists, DON'T create.
- "Gouthro Addition" and "Paul Gouthro Addition" = SAME project.
- Use EXACT project names from the list when referencing.
- Only create_project for genuinely NEW jobs.

## What to Skip
Automated notifications, newsletters, spam, Google/GitHub/Vercel system emails.

## Actions (return JSON only, no markdown):
{
  "actions": [{ "type": "...", "data": {...}, "reason": "..." }],
  "summary": "..."
}

Types: create_project, create_customer, create_quote, create_follow_up, update_project_stage, log_email, skip
- create_project: { name, client_name, client_email, address, city, state, zip, project_type, description, status (lead|estimating|proposal_sent|contracted|in_progress), phase (preconstruction|pre_start|rough_in|finishing) }
- create_customer: { first_name, last_name, email, phone, address, city, state, zip }
- create_quote: { subcontractor_name, project_name, trade, amount, scope_description, status (received|just_sent|awaiting_reply) }
- create_follow_up: { contact_name, contact_type, description, priority (low|medium|high|urgent), project_name }
- update_project_stage: { project_name, new_status, new_phase, reason }
- log_email: { category (quote|sub_outreach|client_update|follow_up|internal|other), project_name }
- skip: {}`;

// ── Step 1: Clear all data ──────────────────────────

export async function clearAllData(): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

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

// ── Step 2: Get email IDs from Gmail ──────────────────────────

export async function getNewEmailIds(maxEmails: number = 200): Promise<string[]> {
  const allIds = await fetchEmailIdList(maxEmails);

  const supabase = await createClient();
  const { data: existingLogs } = await supabase
    .from("email_logs")
    .select("gmail_message_id");

  const processedIds = new Set(
    (existingLogs ?? []).map((l) => l.gmail_message_id)
  );

  return allIds.filter((id) => !processedIds.has(id));
}

// ── Step 3: Process a batch by IDs (stateless!) ──────────────────────────

export async function processBatchByIds(
  emailIds: string[]
): Promise<BatchResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const result: BatchResult = {
    emailsProcessed: 0,
    projectsCreated: 0,
    customersCreated: 0,
    quotesCreated: 0,
    followUpsCreated: 0,
    stagesUpdated: 0,
    errors: [],
  };

  // Fetch the actual email content for these IDs
  const emails = await fetchMessagesByIds(emailIds);

  if (emails.length === 0) return result;

  // Get current DB state for context
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
  const createdNames = new Set<string>();

  // Process each email sequentially
  for (const email of emails) {
    try {
      const decisions = await analyzeEmailWithAI(
        email,
        projectsList,
        customers ?? [],
        subs ?? []
      );

      await executeActions(
        supabase, user.id, email, decisions, result, projectsList, createdNames
      );
      result.emailsProcessed++;
    } catch (err) {
      result.errors.push(
        `"${email.subject.substring(0, 35)}": ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  return result;
}

// ── Quick sync (for AI Sync Gmail — new emails only) ──────────────

export async function runAIEmailSync(maxEmails: number = 50): Promise<BatchResult> {
  const ids = await getNewEmailIds(maxEmails);

  const totalResult: BatchResult = {
    emailsProcessed: 0,
    projectsCreated: 0,
    customersCreated: 0,
    quotesCreated: 0,
    followUpsCreated: 0,
    stagesUpdated: 0,
    errors: [],
  };

  // Process in small batches
  for (let i = 0; i < ids.length; i += 3) {
    const batch = ids.slice(i, i + 3);
    const r = await processBatchByIds(batch);
    totalResult.emailsProcessed += r.emailsProcessed;
    totalResult.projectsCreated += r.projectsCreated;
    totalResult.customersCreated += r.customersCreated;
    totalResult.quotesCreated += r.quotesCreated;
    totalResult.followUpsCreated += r.followUpsCreated;
    totalResult.stagesUpdated += r.stagesUpdated;
    totalResult.errors.push(...r.errors);
  }

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
    .map((p) => `- "${p.name}" (${p.address || "?"}) [${p.status}]`)
    .join("\n");

  const userPrompt = `Analyze this email. NEVER create duplicate projects.

From: ${email.from} <${email.fromEmail}>
To: ${email.to} <${email.toEmail}>
Date: ${email.date}
Subject: ${email.subject}

Body:
${email.body.substring(0, 4000)}

## Existing Projects (DO NOT duplicate!)
${projectList || "None yet"}

## Existing Customers
${customers.slice(0, 30).map((c) => `- ${c.first_name} ${c.last_name}`).join("\n") || "None"}

## Existing Subs
${subs.slice(0, 20).map((s) => `- ${s.company_name}`).join("\n") || "None"}

JSON decision:`;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o",
    temperature: 0.1,
    max_tokens: 2000,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
  });

  const content = completion.choices[0]?.message?.content?.trim();
  if (!content) {
    return { actions: [{ type: "skip", data: {}, reason: "No response" }], summary: "" };
  }

  const cleaned = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  return JSON.parse(cleaned) as AIDecision;
}

// ── Dedup ──────────────────────────────────────

function findExistingProject(
  name: string,
  projects: { id: string; name: string; address: string | null }[]
): { id: string; name: string } | null {
  const n = name.toLowerCase().trim();

  for (const p of projects) {
    const pn = p.name.toLowerCase().trim();
    if (pn === n) return p;
    if (pn.includes(n) || n.includes(pn)) return p;

    const words = n.split(/\s+/).filter((w) => w.length > 3);
    const pWords = pn.split(/\s+/).filter((w) => w.length > 3);
    const matches = words.filter((w) => pWords.some((pw) => pw.includes(w) || w.includes(pw)));
    if (matches.length >= 1 && matches.length >= words.length * 0.5) return p;

    if (p.address && n.includes(p.address.toLowerCase().split(",")[0])) return p;
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
  createdNames: Set<string>
) {
  for (const action of decisions.actions) {
    const d = action.data;

    switch (action.type) {
      case "create_project": {
        const name = d.name as string;
        if (findExistingProject(name, projectsList)) break;
        if (createdNames.has(name.toLowerCase())) break;

        const { data: proj, error } = await supabase
          .from("projects")
          .insert({
            name,
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

        if (!error && proj) {
          result.projectsCreated++;
          projectsList.push(proj);
          createdNames.add(name.toLowerCase());

          if (d.client_email) {
            const { data: cust } = await supabase
              .from("customers").select("id")
              .eq("email", d.client_email as string).single();
            if (cust) {
              await supabase.from("projects").update({ customer_id: cust.id }).eq("id", proj.id);
            }
          }
        }
        break;
      }

      case "create_customer": {
        const em = d.email as string;
        if (em) {
          const { data: ex } = await supabase.from("customers").select("id").eq("email", em).single();
          if (ex) break;
        }
        const fn = d.first_name as string;
        const ln = d.last_name as string;
        if (fn && ln) {
          const { data: ex } = await supabase.from("customers").select("id")
            .eq("first_name", fn).eq("last_name", ln).single();
          if (ex) break;
        }

        const { error } = await supabase.from("customers").insert({
          first_name: fn, last_name: ln,
          email: em || null, phone: d.phone as string || null,
          address: d.address as string || null, city: d.city as string || null,
          state: d.state as string || null, zip: d.zip as string || null,
          created_by: userId,
        });
        if (!error) result.customersCreated++;
        break;
      }

      case "create_quote": {
        let projectId: string | null = null;
        const pn = d.project_name as string;
        if (pn) { const m = findExistingProject(pn, projectsList); if (m) projectId = m.id; }

        const sub = d.subcontractor_name as string;
        if (projectId && sub) {
          const { data: ex } = await supabase.from("quote_requests").select("id")
            .eq("project_id", projectId).eq("subcontractor_name", sub).single();
          if (ex) break;
        }

        const { error } = await supabase.from("quote_requests").insert({
          project_id: projectId, subcontractor_name: sub,
          project_name: pn || "Unmatched", trade: d.trade as string || null,
          amount: d.amount as number || null,
          scope_description: d.scope_description as string || null,
          status: (d.status as string) || "received",
          sent_at: email.date,
          received_at: email.direction === "inbound" ? email.date : null,
          gmail_message_id: email.id, created_by: userId,
        });
        if (!error) result.quotesCreated++;
        break;
      }

      case "create_follow_up": {
        let projectId: string | null = null;
        const pn = d.project_name as string;
        if (pn) { const m = findExistingProject(pn, projectsList); if (m) projectId = m.id; }

        const { error } = await supabase.from("follow_ups").insert({
          project_id: projectId, project_name: pn || null,
          contact_name: d.contact_name as string,
          contact_type: (d.contact_type as string) || "subcontractor",
          description: d.description as string,
          priority: (d.priority as string) || "medium",
          status: "open", created_by: userId,
        });
        if (!error) result.followUpsCreated++;
        break;
      }

      case "update_project_stage": {
        const pn = d.project_name as string;
        if (pn) {
          const m = findExistingProject(pn, projectsList);
          if (m) {
            const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
            if (d.new_status) updates.status = d.new_status;
            if (d.new_phase) updates.phase = d.new_phase;
            await supabase.from("projects").update(updates).eq("id", m.id);
            result.stagesUpdated++;
          }
        }
        break;
      }

      case "log_email": {
        const category = (d.category as string) || "other";
        let projectId: string | null = null;
        const pn = d.project_name as string;
        if (pn) { const m = findExistingProject(pn, projectsList); if (m) projectId = m.id; }

        if (!projectId) {
          const txt = `${email.subject}`.toLowerCase();
          for (const p of projectsList) {
            if (p.name && txt.includes(p.name.toLowerCase())) { projectId = p.id; break; }
          }
        }

        await supabase.from("email_logs").insert({
          gmail_message_id: email.id,
          subject: email.subject.substring(0, 500),
          from_email: email.fromEmail, to_email: email.toEmail,
          direction: email.direction, category,
          project_id: projectId, sent_at: email.date,
        });
        break;
      }

      case "skip":
        break;
    }
  }
}
