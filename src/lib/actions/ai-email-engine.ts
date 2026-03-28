"use server";

import OpenAI from "openai";
import { createClient } from "@/lib/supabase/server";
import {
  fetchEmailIdList,
  fetchMessagesByIds,
  type ParsedEmail,
} from "@/lib/google/gmail-sync";

const getOpenAI = () => new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export interface BatchResult {
  emailsProcessed: number;
  projectsCreated: number;
  customersCreated: number;
  quotesCreated: number;
  followUpsCreated: number;
  stagesUpdated: number;
  errors: string[];
}

// ── Clear all data ──────────────────────────────────

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

// ── Get email IDs ──────────────────────────────────

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

// ── Process a batch of emails (5 at a time, bulk analyzed) ──────────

const BULK_SYSTEM_PROMPT = `You are the AI engine for Penney Construction, Inc. (North Shore MA, residential GC).

Team: Ryan Penney (Owner), Jorge Betancur (Precon/Estimator), Nicole Smith (Admin), Howie Clickstein (Field), Shannon Penney (Intake).

Known subs: MTP Electric, Pedersen Electrical, DL Services (HVAC), Jackson Lumber (Chris Parello), Essex County Craftsmen (Brad Noyes), Timberline (Jon Holmes), Building Center of Gloucester (Steve Black), Wanderson Oliveira (Framing), Jonathan Tobar (Framing), Joe Mello (Siding), Marcio Silva (Tile), Peter Nguyen (Hardwood), Cosentino Plumbing, Topcrete (Foundation).

You will receive multiple emails. For each email, analyze and return actions.

## What to extract:
1. **Projects** — If the email is about a construction job (address, client name, scope), create a project. Name projects by client last name or address (e.g. "Gouthro Addition", "14 Cameron Rd"). Include address, city, state, project type.
2. **Customers** — Extract client contact info when mentioned.
3. **Quotes** — If a sub sends pricing/bid/estimate with dollar amounts, create a quote.
4. **Follow-ups** — If something needs action (reply needed, question asked, awaiting response).
5. **Stage updates** — If an email indicates a project moved stages (walkthrough done, estimate sent, approved, construction starting).

## IMPORTANT
- DO create projects when you see references to jobs/addresses/clients. If the existing projects list is empty, that means we need to create them.
- Match to existing projects by name if they exist. Don't create duplicates.
- Skip spam, automated notifications (Google Calendar invites, Vercel deploys, GitHub), newsletters.
- Extract $ amounts from quotes (look for $X,XXX patterns).

## Project types: remodel, addition, kitchen, bathroom, new_construction, other
## Stages: lead, estimating, proposal_sent, contracted, in_progress
## Phases: preconstruction, pre_start, rough_in, finishing, punch_list, complete

Return JSON array — one entry per email:
[
  {
    "email_index": 0,
    "actions": [
      { "type": "create_project", "data": { "name": "...", "address": "...", "city": "...", "state": "MA", "project_type": "...", "status": "estimating", "phase": "preconstruction", "client_name": "...", "client_email": "..." } },
      { "type": "create_quote", "data": { "subcontractor_name": "...", "project_name": "...", "trade": "...", "amount": 1234.00, "status": "received" } },
      { "type": "create_follow_up", "data": { "contact_name": "...", "description": "...", "priority": "medium", "project_name": "..." } },
      { "type": "log_email", "data": { "category": "quote|sub_outreach|client_update|follow_up|internal|other", "project_name": "..." } },
      { "type": "skip" }
    ]
  }
]

Return ONLY valid JSON, no markdown fences.`;

export async function processBatchByIds(emailIds: string[]): Promise<BatchResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const result: BatchResult = {
    emailsProcessed: 0, projectsCreated: 0, customersCreated: 0,
    quotesCreated: 0, followUpsCreated: 0, stagesUpdated: 0, errors: [],
  };

  const emails = await fetchMessagesByIds(emailIds);
  if (emails.length === 0) return result;

  // Get current DB state
  const [{ data: allProjects }, { data: customers }, { data: subs }] = await Promise.all([
    supabase.from("projects").select("id, name, address, status"),
    supabase.from("customers").select("first_name, last_name, email"),
    supabase.from("subcontractors").select("company_name, contact_name, email, trades").eq("is_active", true),
  ]);

  const projectsList = [...(allProjects ?? [])];
  const createdNames = new Set<string>();

  // Build bulk prompt with ALL emails in this batch
  const emailSummaries = emails.map((e, i) =>
    `--- EMAIL ${i} ---
From: ${e.from} <${e.fromEmail}>
To: ${e.to} <${e.toEmail}>
Date: ${e.date}
Subject: ${e.subject}
Body: ${e.body.substring(0, 1500)}`
  ).join("\n\n");

  const existingProjectsList = projectsList
    .map((p) => `- "${p.name}" (${p.address || "?"}) [${p.status}]`)
    .join("\n");

  const userPrompt = `Analyze these ${emails.length} emails:

${emailSummaries}

## Existing Projects
${existingProjectsList || "NONE — create projects for any jobs you find!"}

## Existing Customers
${(customers ?? []).slice(0, 20).map((c) => `- ${c.first_name} ${c.last_name}`).join("\n") || "None"}

Return your JSON array.`;

  try {
    const openai = getOpenAI();
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.1,
      max_tokens: 4000,
      messages: [
        { role: "system", content: BULK_SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
    });

    const content = completion.choices[0]?.message?.content?.trim();
    if (!content) {
      result.errors.push("No AI response");
      return result;
    }

    const cleaned = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const decisions = JSON.parse(cleaned) as { email_index: number; actions: { type: string; data: Record<string, unknown> }[] }[];

    // Execute actions for each email
    for (const decision of decisions) {
      const emailIdx = decision.email_index;
      const email = emails[emailIdx];
      if (!email) continue;

      for (const action of decision.actions) {
        try {
          await executeAction(supabase, user.id, email, action, result, projectsList, createdNames);
        } catch (err) {
          result.errors.push(`${err instanceof Error ? err.message : String(err)}`);
        }
      }
      result.emailsProcessed++;
    }
  } catch (err) {
    result.errors.push(`AI error: ${err instanceof Error ? err.message : String(err)}`);
  }

  return result;
}

// ── Quick sync ──────────────────────────────────

export async function runAIEmailSync(maxEmails: number = 50): Promise<BatchResult> {
  const ids = await getNewEmailIds(maxEmails);
  const total: BatchResult = {
    emailsProcessed: 0, projectsCreated: 0, customersCreated: 0,
    quotesCreated: 0, followUpsCreated: 0, stagesUpdated: 0, errors: [],
  };

  for (let i = 0; i < ids.length; i += 5) {
    const r = await processBatchByIds(ids.slice(i, i + 5));
    total.emailsProcessed += r.emailsProcessed;
    total.projectsCreated += r.projectsCreated;
    total.customersCreated += r.customersCreated;
    total.quotesCreated += r.quotesCreated;
    total.followUpsCreated += r.followUpsCreated;
    total.stagesUpdated += r.stagesUpdated;
    total.errors.push(...r.errors);
  }
  return total;
}

// ── Dedup ──────────────────────────────────

function findExistingProject(
  name: string,
  projects: { id: string; name: string; address: string | null }[]
): { id: string; name: string } | null {
  const n = name.toLowerCase().trim();
  for (const p of projects) {
    const pn = p.name.toLowerCase().trim();
    if (pn === n || pn.includes(n) || n.includes(pn)) return p;
    const words = n.split(/\s+/).filter((w) => w.length > 3);
    const pWords = pn.split(/\s+/).filter((w) => w.length > 3);
    const matches = words.filter((w) => pWords.some((pw) => pw.includes(w) || w.includes(pw)));
    if (matches.length >= 1 && matches.length >= words.length * 0.5) return p;
    if (p.address && n.includes(p.address.toLowerCase().split(",")[0])) return p;
  }
  return null;
}

// ── Execute single action ──────────────────────────────────

async function executeAction(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  email: ParsedEmail,
  action: { type: string; data: Record<string, unknown> },
  result: BatchResult,
  projectsList: { id: string; name: string; address: string | null; status: string }[],
  createdNames: Set<string>
) {
  const d = action.data;

  switch (action.type) {
    case "create_project": {
      const name = d.name as string;
      if (!name) break;
      if (findExistingProject(name, projectsList)) break;
      if (createdNames.has(name.toLowerCase())) break;

      const { data: proj, error } = await supabase.from("projects").insert({
        name, address: d.address as string || null,
        city: d.city as string || null, state: (d.state as string) || "MA",
        zip: d.zip as string || null,
        project_type: (d.project_type as string) || "other",
        description: d.description as string || null,
        status: (d.status as string) || "lead",
        phase: (d.phase as string) || "preconstruction",
        project_number: `P-${Date.now().toString(36).toUpperCase()}`,
        created_by: userId,
      }).select("id, name, address, status").single();

      if (!error && proj) {
        result.projectsCreated++;
        projectsList.push(proj);
        createdNames.add(name.toLowerCase());

        // Auto-create customer if we have client info
        const clientName = d.client_name as string;
        const clientEmail = d.client_email as string;
        if (clientName) {
          const parts = clientName.split(" ");
          const firstName = parts[0] || "";
          const lastName = parts.slice(1).join(" ") || parts[0] || "";

          if (clientEmail) {
            const { data: ex } = await supabase.from("customers").select("id").eq("email", clientEmail).single();
            if (!ex) {
              const { data: newCust } = await supabase.from("customers").insert({
                first_name: firstName, last_name: lastName,
                email: clientEmail, created_by: userId,
              }).select("id").single();
              if (newCust) {
                result.customersCreated++;
                await supabase.from("projects").update({ customer_id: newCust.id }).eq("id", proj.id);
              }
            } else {
              await supabase.from("projects").update({ customer_id: ex.id }).eq("id", proj.id);
            }
          }
        }
      }
      break;
    }

    case "create_customer": {
      const em = d.email as string;
      const fn = d.first_name as string;
      const ln = d.last_name as string;
      if (em) { const { data: ex } = await supabase.from("customers").select("id").eq("email", em).single(); if (ex) break; }
      if (fn && ln) { const { data: ex } = await supabase.from("customers").select("id").eq("first_name", fn).eq("last_name", ln).single(); if (ex) break; }
      const { error } = await supabase.from("customers").insert({
        first_name: fn, last_name: ln, email: em || null,
        phone: d.phone as string || null, created_by: userId,
      });
      if (!error) result.customersCreated++;
      break;
    }

    case "create_quote": {
      let projectId: string | null = null;
      const pn = d.project_name as string;
      if (pn) { const m = findExistingProject(pn, projectsList); if (m) projectId = m.id; }

      const sub = d.subcontractor_name as string;
      if (!sub) break;
      if (projectId) {
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
        sent_at: email.date, gmail_message_id: email.id, created_by: userId,
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
        contact_name: d.contact_name as string || "Unknown",
        contact_type: (d.contact_type as string) || "subcontractor",
        description: d.description as string || email.subject,
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
