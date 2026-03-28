"use server";

import { createClient } from "@/lib/supabase/server";
import { fetchEmailIdList } from "@/lib/google/gmail-sync";

export interface BatchResult {
  emailsProcessed: number;
  projectsCreated: number;
  customersCreated: number;
  quotesCreated: number;
  followUpsCreated: number;
  stagesUpdated: number;
  errors: string[];
}

interface EmailData {
  id: string;
  subject: string;
  fromEmail: string;
  toEmail: string;
  direction: "inbound" | "outbound";
  date: string;
  from: string;
}

interface AIDecisionEntry {
  email_index: number;
  actions: { type: string; data: Record<string, unknown> }[];
}

// ── Clear all AI-generated data (NOT projects/customers) ──────────

export async function clearAllData(): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  await supabase.from("email_logs").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await supabase.from("quote_requests").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await supabase.from("follow_ups").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await supabase.from("client_updates").delete().neq("id", "00000000-0000-0000-0000-000000000000");
}

// ── Get email IDs from Gmail ──────────

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

// ── Save batch results from AI analysis ──────────

export async function saveBatchResults(
  decisions: AIDecisionEntry[],
  emailsData: EmailData[]
): Promise<BatchResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const result: BatchResult = {
    emailsProcessed: 0, projectsCreated: 0, customersCreated: 0,
    quotesCreated: 0, followUpsCreated: 0, stagesUpdated: 0, errors: [],
  };

  // Get current projects for matching
  const { data: allProjects } = await supabase
    .from("projects")
    .select("id, name, address, status");

  const projectsList = [...(allProjects ?? [])];

  for (const decision of decisions) {
    const email = emailsData[decision.email_index];
    if (!email) continue;

    for (const action of decision.actions) {
      try {
        await executeAction(supabase, user.id, email, action, result, projectsList);
      } catch (err) {
        result.errors.push(`${err instanceof Error ? err.message : String(err)}`);
      }
    }
    result.emailsProcessed++;
  }

  return result;
}

// ── Dedup ──────────

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

// ── Execute single action ──────────

async function executeAction(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  email: EmailData,
  action: { type: string; data: Record<string, unknown> },
  result: BatchResult,
  projectsList: { id: string; name: string; address: string | null; status: string }[]
) {
  const d = action.data;

  switch (action.type) {
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

      if (!projectId) {
        const txt = email.subject.toLowerCase();
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
