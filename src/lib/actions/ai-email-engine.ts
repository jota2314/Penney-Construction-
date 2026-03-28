"use server";

import { createClient } from "@/lib/supabase/server";
import {
  fetchRecentEmails,
  type ParsedEmail,
} from "@/lib/google/gmail-sync";

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

/**
 * Full AI-powered email sync:
 * 1. Pull emails from Gmail
 * 2. Send to OpenAI for analysis
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

    // 4. Send to AI for processing (in batches)
    const batchSize = 10;
    for (let i = 0; i < newEmails.length; i += batchSize) {
      const batch = newEmails.slice(i, i + batchSize);

      const emailsForAI = batch.map((e) => ({
        id: e.id,
        subject: e.subject,
        from: e.from,
        fromEmail: e.fromEmail,
        to: e.to,
        toEmail: e.toEmail,
        date: e.date,
        body: e.body.substring(0, 3000),
        direction: e.direction,
        attachmentNames: e.attachments.map((a) => a.filename),
      }));

      try {
        const res = await fetch(
          `${process.env.NEXT_PUBLIC_SUPABASE_URL ? "" : ""}${getBaseUrl()}/api/process-emails`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              emails: emailsForAI,
              existingProjects: projects ?? [],
              existingCustomers: customers ?? [],
              existingSubcontractors: subs ?? [],
            }),
          }
        );

        if (!res.ok) {
          result.errors.push(`AI API error: ${res.status}`);
          continue;
        }

        const { results: aiResults } = await res.json();

        // 5. Execute actions for each email
        for (const aiResult of aiResults) {
          const email = batch.find((e) => e.id === aiResult.emailId);
          if (!email) continue;

          try {
            await executeActions(
              supabase,
              user.id,
              email,
              aiResult.decisions,
              result
            );
            result.emailsProcessed++;
          } catch (err) {
            result.errors.push(
              `Action error for "${email.subject}": ${err instanceof Error ? err.message : String(err)}`
            );
          }
        }
      } catch (err) {
        result.errors.push(
          `Batch error: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  } catch (err) {
    result.errors.push(
      `Sync error: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  return result;
}

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

          // If there's a customer to link, try to find or create
          if (d.client_email || d.client_name) {
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
        // Check if customer already exists
        const email_check = d.email as string;
        if (email_check) {
          const { data: existing } = await supabase
            .from("customers")
            .select("id")
            .eq("email", email_check)
            .single();

          if (existing) break; // Already exists
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

        // Try to match project
        let projectId: string | null = null;
        if (d.project_name) {
          const { data: matchedProject } = await supabase
            .from("projects")
            .select("id")
            .ilike("name", `%${d.project_name}%`)
            .limit(1)
            .single();

          if (matchedProject) projectId = matchedProject.id;
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
          const { data: matchedProject } = await supabase
            .from("projects")
            .select("id")
            .ilike("name", `%${d.project_name}%`)
            .limit(1)
            .single();

          if (matchedProject) projectId = matchedProject.id;
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
          const { data: matchedProject } = await supabase
            .from("projects")
            .select("id")
            .ilike("name", `%${d.project_name}%`)
            .limit(1)
            .single();

          if (matchedProject) projectId = matchedProject.id;
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

        // Try to match project
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

function getBaseUrl(): string {
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL;
  return "http://localhost:3000";
}
