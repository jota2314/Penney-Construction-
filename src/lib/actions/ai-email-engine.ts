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

// ── Clear ALL data for full re-scan ──────────

export async function clearAllData(): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  // Delete in order to respect foreign key constraints
  await supabase.from("email_logs").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await supabase.from("quote_requests").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await supabase.from("follow_ups").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await supabase.from("client_updates").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await supabase.from("projects").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await supabase.from("customers").delete().neq("id", "00000000-0000-0000-0000-000000000000");
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

  // Get current projects and customers for matching
  const [{ data: allProjects }, { data: allCustomers }] = await Promise.all([
    supabase.from("projects").select("id, name, address, status"),
    supabase.from("customers").select("id, first_name, last_name, email"),
  ]);

  const projectsList = [...(allProjects ?? [])];
  const customersList = [...(allCustomers ?? [])];

  for (const decision of decisions) {
    const email = emailsData[decision.email_index];
    if (!email) continue;

    // Process create_project and create_customer actions FIRST so they exist
    // for subsequent quote/follow-up actions in the same batch
    const sortedActions = [...decision.actions].sort((a, b) => {
      const priority: Record<string, number> = {
        create_customer: 0,
        create_project: 1,
        create_quote: 2,
        create_follow_up: 2,
        update_project_stage: 2,
        log_email: 3,
        skip: 4,
      };
      return (priority[a.type] ?? 3) - (priority[b.type] ?? 3);
    });

    for (const action of sortedActions) {
      try {
        await executeAction(supabase, user.id, email, action, result, projectsList, customersList);
      } catch (err) {
        result.errors.push(`${err instanceof Error ? err.message : String(err)}`);
      }
    }
    result.emailsProcessed++;
  }

  return result;
}

// ── Project matching ──────────

function findExistingProject(
  name: string,
  projects: { id: string; name: string; address: string | null }[]
): { id: string; name: string } | null {
  const n = name.toLowerCase().trim();
  if (!n) return null;

  for (const p of projects) {
    const pn = p.name.toLowerCase().trim();

    // Exact match
    if (pn === n) return p;

    // One contains the other
    if (pn.includes(n) || n.includes(pn)) return p;

    // Word overlap: at least 2 significant words match (or 50%+ for short names)
    const words = n.split(/\s+/).filter((w) => w.length > 2);
    const pWords = pn.split(/\s+/).filter((w) => w.length > 2);
    if (words.length > 0 && pWords.length > 0) {
      const matches = words.filter((w) =>
        pWords.some((pw) => pw === w || pw.includes(w) || w.includes(pw))
      );
      const threshold = Math.max(1, Math.ceil(Math.min(words.length, pWords.length) * 0.5));
      if (matches.length >= threshold) return p;
    }

    // Address match
    if (p.address) {
      const addr = p.address.toLowerCase().split(",")[0].trim();
      if (addr.length > 5 && (n.includes(addr) || addr.includes(n))) return p;
    }
  }

  return null;
}

// ── Customer matching ──────────

function findExistingCustomer(
  firstName: string,
  lastName: string,
  email: string | null,
  customers: { id: string; first_name: string; last_name: string; email: string | null }[]
): { id: string } | null {
  const fn = firstName.toLowerCase().trim();
  const ln = lastName.toLowerCase().trim();

  for (const c of customers) {
    // Email match (strongest signal)
    if (email && c.email && email.toLowerCase() === c.email.toLowerCase()) return c;

    // Name match
    if (c.first_name.toLowerCase().trim() === fn && c.last_name.toLowerCase().trim() === ln) return c;
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
  projectsList: { id: string; name: string; address: string | null; status: string }[],
  customersList: { id: string; first_name: string; last_name: string; email: string | null }[]
) {
  const d = action.data;

  switch (action.type) {
    case "create_project": {
      const name = (d.name as string)?.trim();
      if (!name) break;

      // Dedup: check if project already exists
      const existing = findExistingProject(name, projectsList);
      if (existing) {
        // Update existing project with new info if we have it
        const updates: Record<string, unknown> = {};
        if (d.estimated_value && !existing.status) updates.estimated_value = d.estimated_value;
        if (d.contract_value) updates.contract_value = d.contract_value;
        if (d.scope_of_work) updates.scope_of_work = d.scope_of_work;
        if (d.required_trades) updates.required_trades = d.required_trades;
        if (d.phase) updates.phase = d.phase;
        if (d.description) updates.description = d.description;
        if (d.address && !existing.address) updates.address = d.address;
        if (Object.keys(updates).length > 0) {
          updates.updated_at = new Date().toISOString();
          await supabase.from("projects").update(updates).eq("id", existing.id);
        }
        break;
      }

      // Try to link to customer
      let customerId: string | null = null;
      const customerName = d.customer_name as string;
      if (customerName) {
        const parts = customerName.trim().split(/\s+/);
        const lastName = parts.pop() || "";
        const firstName = parts.join(" ") || lastName;
        const match = findExistingCustomer(firstName, lastName, null, customersList);
        if (match) customerId = match.id;
      }

      // Determine phase from status
      const status = (d.status as string) || "lead";
      let phase = (d.phase as string) || null;
      if (!phase) {
        if (["lead", "estimating", "proposal_sent"].includes(status)) phase = "preconstruction";
        else if (status === "contracted") phase = "pre_start";
        else if (status === "in_progress") phase = "rough_in";
        else if (status === "completed") phase = "complete";
      }

      const { data: newProject, error } = await supabase.from("projects").insert({
        name,
        address: (d.address as string) || null,
        city: (d.city as string) || null,
        state: (d.state as string) || "MA",
        zip: (d.zip as string) || null,
        project_type: (d.project_type as string) || "other",
        status,
        phase,
        description: (d.description as string) || null,
        scope_of_work: (d.scope_of_work as string) || null,
        estimated_value: (d.estimated_value as number) || null,
        contract_value: (d.contract_value as number) || null,
        required_trades: d.required_trades ? d.required_trades : null,
        customer_id: customerId,
        created_by: userId,
      }).select("id, name, address, status").single();

      if (!error && newProject) {
        result.projectsCreated++;
        projectsList.push(newProject);
      }
      break;
    }

    case "create_customer": {
      const firstName = (d.first_name as string)?.trim();
      const lastName = (d.last_name as string)?.trim();
      if (!firstName || !lastName) break;

      const customerEmail = (d.email as string) || null;

      // Dedup — but update existing if we have new info (email, phone)
      const existing = findExistingCustomer(firstName, lastName, customerEmail, customersList);
      if (existing) {
        // Update existing customer with newly extracted info
        const updates: Record<string, unknown> = {};
        if (customerEmail && !existing.email) updates.email = customerEmail;
        if (d.phone) updates.phone = d.phone;
        if (d.address) updates.address = d.address;
        if (d.city) updates.city = d.city;
        if (d.state) updates.state = d.state;
        if (d.zip) updates.zip = d.zip;
        if (Object.keys(updates).length > 0) {
          await supabase.from("customers").update(updates).eq("id", existing.id);
          // Update in-memory record too
          if (customerEmail) existing.email = customerEmail;
        }

        // Link to matching project if not already linked
        const match = findExistingProject(`${lastName}`, projectsList);
        if (match) {
          await supabase.from("projects").update({ customer_id: existing.id }).eq("id", match.id).is("customer_id", null);
        }
        break;
      }

      const { data: newCustomer, error } = await supabase.from("customers").insert({
        first_name: firstName,
        last_name: lastName,
        email: customerEmail,
        phone: (d.phone as string) || null,
        address: (d.address as string) || null,
        city: (d.city as string) || null,
        state: (d.state as string) || "MA",
        zip: (d.zip as string) || null,
        created_by: userId,
      }).select("id, first_name, last_name, email").single();

      if (!error && newCustomer) {
        result.customersCreated++;
        customersList.push(newCustomer);

        // Auto-link to project with matching last name
        const match = findExistingProject(`${lastName}`, projectsList);
        if (match) {
          await supabase.from("projects").update({ customer_id: newCustomer.id }).eq("id", match.id).is("customer_id", null);
        }
      }
      break;
    }

    case "create_quote": {
      let projectId: string | null = null;
      const pn = d.project_name as string;
      if (pn) { const m = findExistingProject(pn, projectsList); if (m) projectId = m.id; }

      const sub = d.subcontractor_name as string;
      if (!sub) break;

      // Dedup: same project + same sub
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

      const contactName = d.contact_name as string || "Unknown";

      // Dedup
      if (projectId) {
        const { data: ex } = await supabase.from("follow_ups").select("id")
          .eq("project_id", projectId).ilike("contact_name", contactName).eq("status", "open").single();
        if (ex) break;
      } else {
        const { data: ex } = await supabase.from("follow_ups").select("id")
          .ilike("contact_name", contactName).is("project_id", null).eq("status", "open").single();
        if (ex) break;
      }

      const { error } = await supabase.from("follow_ups").insert({
        project_id: projectId, project_name: pn || null,
        contact_name: contactName,
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
          if (d.new_status) {
            updates.status = d.new_status;
            // Auto-set phase from status if not explicitly provided
            if (!d.new_phase) {
              const statusToPhase: Record<string, string> = {
                lead: "preconstruction", estimating: "preconstruction",
                proposal_sent: "preconstruction", contracted: "pre_start",
                in_progress: "rough_in", completed: "complete",
              };
              if (statusToPhase[d.new_status as string]) updates.phase = statusToPhase[d.new_status as string];
            }
          }
          if (d.new_phase) updates.phase = d.new_phase;
          if (d.contract_value) updates.contract_value = d.contract_value;
          if (d.estimated_value) updates.estimated_value = d.estimated_value;
          await supabase.from("projects").update(updates).eq("id", m.id);
          // Update in-memory status
          m.status = (d.new_status as string) || m.status;
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
