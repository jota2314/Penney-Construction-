"use server";

/**
 * Server actions for the Agent Crew dashboard. Reads the run log +
 * review queue the scheduled Claude Code Routines write to, and lets a
 * human approve/dismiss what the agents surface.
 */

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { resolveSubcontractorId } from "@/lib/subs/resolve-subcontractor";
import { detectQuoteDocument } from "@/lib/finance/quote-detection";
import { resolveVendorType } from "@/lib/finance/spend-category";

export interface AgentStatus {
  agent_key: string;
  total_runs: number;
  last_run_at: string | null;
  last_status: "running" | "success" | "error" | null;
  lifetime_items: number;
}

export interface AgentRun {
  id: string;
  agent_key: string;
  status: "running" | "success" | "error";
  trigger: string;
  started_at: string;
  finished_at: string | null;
  items_found: number;
  summary: string | null;
}

export interface AgentSuggestion {
  id: string;
  agent_key: string;
  project_id: string | null;
  kind: string;
  title: string;
  detail: string | null;
  status: "pending" | "approved" | "dismissed";
  created_at: string;
}

/** Per-agent status cards + recent activity feed + pending review queue. */
export async function getAgentCrew(): Promise<{
  statuses: AgentStatus[];
  recentRuns: AgentRun[];
  pending: AgentSuggestion[];
}> {
  const supabase = await createClient();

  const [{ data: statuses }, { data: recentRuns }, { data: pending }] =
    await Promise.all([
      supabase.from("agent_crew_status").select("*"),
      supabase
        .from("agent_runs")
        .select(
          "id, agent_key, status, trigger, started_at, finished_at, items_found, summary"
        )
        .order("started_at", { ascending: false })
        .limit(25),
      supabase
        .from("agent_suggestions")
        .select("id, agent_key, project_id, kind, title, detail, status, created_at")
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(50),
    ]);

  return {
    statuses: (statuses as AgentStatus[]) || [],
    recentRuns: (recentRuns as AgentRun[]) || [],
    pending: (pending as AgentSuggestion[]) || [],
  };
}

/** Approve or dismiss a suggestion the crew surfaced. */
export async function reviewSuggestion(
  id: string,
  decision: "approved" | "dismissed"
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  // Approving certain kinds actually DOES the work (not just marks it read).
  // For an invoice, the green check logs the bill to the project and posts it
  // to the live P&L using the payload the agent attached.
  if (decision === "approved") {
    const { data: suggestion } = await supabase
      .from("agent_suggestions")
      .select("kind, payload, status")
      .eq("id", id)
      .single();

    if (suggestion && suggestion.status === "pending" && suggestion.kind === "invoice") {
      const acted = await logInvoiceFromPayload(
        supabase,
        user.id,
        (suggestion.payload ?? {}) as InvoicePayload
      );
      if (acted.error) return { error: acted.error };
    }
  }

  const { error } = await supabase
    .from("agent_suggestions")
    .update({
      status: decision,
      reviewed_at: new Date().toISOString(),
      reviewed_by: user.id,
    })
    .eq("id", id);

  if (error) return { error: error.message };
  revalidatePath("/command-center/agents");
  return {};
}

interface InvoicePayload {
  project_id?: string;
  amount?: number;
  vendor_name?: string;
  trade?: string;
  invoice_number?: string;
  invoice_date?: string;
  due_date?: string;
  description?: string;
  gmail_message_id?: string;
  attachment_storage_path?: string;
  drive_url?: string;
  extracted_text?: string;
}

/**
 * Logs an invoice from an approved suggestion's payload. Mirrors the MCP
 * record_invoice tool: dedups on gmail_message_id / project+vendor+invoice#,
 * links the matching estimate line by trade when exactly one matches, and
 * posts to the live P&L (get_project_financials sums invoices by project).
 */
async function logInvoiceFromPayload(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  payload: InvoicePayload
): Promise<{ error?: string }> {
  const { project_id, amount, vendor_name } = payload;
  if (!project_id || !vendor_name || amount == null) {
    return { error: "This bill is missing a project, vendor, or amount — can't log it automatically." };
  }

  // A quote booked as an invoice is phantom cost on the job (the Sobol BC of
  // Essex quotation). The attachment filename rides on the storage path.
  const quoteCheck = detectQuoteDocument({
    filename: payload.attachment_storage_path?.split("/").pop() ?? null,
    extractedText: [payload.description, payload.extracted_text].filter(Boolean).join("\n"),
  });
  if (quoteCheck.isQuote) {
    return {
      error: `This looks like a QUOTE, not a bill — ${quoteCheck.reason}. A quote is a price offered, not money owed, so it won't be booked as an invoice. If it belongs on the job, add it from the project's Quotes tab.`,
    };
  }

  // Dedup so approving twice never double-posts.
  if (payload.gmail_message_id) {
    const { data: dupe } = await supabase
      .from("invoices")
      .select("id")
      .eq("gmail_message_id", payload.gmail_message_id)
      .maybeSingle();
    if (dupe) return {}; // already logged — treat approve as a no-op success
  }
  if (payload.invoice_number) {
    const { data: dupe } = await supabase
      .from("invoices")
      .select("id")
      .eq("project_id", project_id)
      .eq("vendor_name", vendor_name)
      .eq("invoice_number", payload.invoice_number)
      .maybeSingle();
    if (dupe) return {};
  }

  // Refine-match an estimate line by trade (never blocks the write). Uses the
  // canonical pointer — a status filter here returned nothing for signed jobs,
  // so the bookkeeper agent filed every invoice on a contracted job unlinked.
  let estimateLineItemId: string | null = null;
  if (payload.trade) {
    const { data: currentEstimateId } = await supabase.rpc("current_estimate_id", {
      p_project_id: project_id,
    });
    if (currentEstimateId) {
      const { data: lines } = await supabase
        .from("estimate_line_items")
        .select("id")
        .eq("estimate_id", currentEstimateId as string)
        .ilike("trade", payload.trade);
      if (lines && lines.length === 1) estimateLineItemId = lines[0].id;
    }
  }

  const { error } = await supabase.from("invoices").insert({
    project_id,
    vendor_name,
    subcontractor_id: await resolveSubcontractorId(supabase, vendor_name),
    vendor_type: resolveVendorType(vendor_name),
    amount,
    payment_status: "unpaid",
    source: "inbox_router",
    trade: payload.trade ?? null,
    invoice_number: payload.invoice_number ?? null,
    invoice_date: payload.invoice_date ?? null,
    due_date: payload.due_date ?? null,
    description: payload.description ?? null,
    gmail_message_id: payload.gmail_message_id ?? null,
    attachment_storage_path: payload.attachment_storage_path ?? null,
    drive_url: payload.drive_url ?? null,
    extracted_text: payload.extracted_text ?? null,
    estimate_line_item_id: estimateLineItemId,
    created_by: userId,
  });

  if (error) return { error: error.message };
  revalidatePath("/projects");
  return {};
}
