"use server";

/**
 * Server actions for the Agent Crew dashboard. Reads the run log +
 * review queue the scheduled Claude Code Routines write to, and lets a
 * human approve/dismiss what the agents surface.
 *
 * The human is the manager here: every card carries enough evidence
 * (the bill PDF, the source email, the project) to verify the bot's
 * work before approving, and approving performs the action the card
 * asks for — not just a mark-as-read.
 */

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

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

/** What an agent attached to a suggestion — everything we need to show proof. */
export interface SuggestionPayload {
  project_id?: string;
  amount?: number;
  vendor_name?: string;
  trade?: string;
  invoice_number?: string;
  invoice_date?: string;
  due_date?: string;
  description?: string;
  note?: string;
  gmail_message_id?: string;
  attachment_storage_path?: string;
  drive_url?: string;
  extracted_text?: string;
  /** Present when the bill is already logged and only needs a decision (e.g. line assignment). */
  invoice_id?: string;
}

export interface AgentSuggestion {
  id: string;
  agent_key: string;
  run_id: string | null;
  project_id: string | null;
  kind: string;
  title: string;
  detail: string | null;
  payload: SuggestionPayload | null;
  status: "pending" | "approved" | "dismissed";
  created_at: string;
}

/** A run that never called finish within this window is a dead shift, not a live one. */
const STALE_RUNNING_MS = 30 * 60 * 1000;

function isStaleRunning(status: string | null, startedAt: string | null): boolean {
  if (status !== "running" || !startedAt) return false;
  return Date.now() - new Date(startedAt).getTime() > STALE_RUNNING_MS;
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
        .select(
          "id, agent_key, run_id, project_id, kind, title, detail, payload, status, created_at"
        )
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(50),
    ]);

  // A crashed agent leaves its run stuck on "running" forever, which made the
  // office show a permanent "working…" bubble. Treat stale running as error.
  const normalizedRuns = ((recentRuns as AgentRun[]) || []).map((r) =>
    isStaleRunning(r.status, r.started_at)
      ? { ...r, status: "error" as const, summary: r.summary ?? "Shift never reported back" }
      : r
  );
  const normalizedStatuses = ((statuses as AgentStatus[]) || []).map((s) =>
    isStaleRunning(s.last_status, s.last_run_at)
      ? { ...s, last_status: "error" as const }
      : s
  );

  return {
    statuses: normalizedStatuses,
    recentRuns: normalizedRuns,
    pending: (pending as AgentSuggestion[]) || [],
  };
}

export interface SuggestionEvidence {
  project: { id: string; name: string } | null;
  /** Source email, when it's synced — deep-links to the email detail page. */
  email: { id: string; subject: string | null } | null;
  /** Short-lived signed URL for the attached document (usually the bill PDF). */
  attachment: { url: string; filename: string } | null;
  /** The already-logged invoice this suggestion is about, when there is one. */
  invoice: { id: string; assignedLineId: string | null } | null;
  /** Estimate lines on the project's latest estimate, for line assignment. */
  estimateLines: { id: string; trade: string | null; description: string | null; total_cost: number | null }[];
}

/**
 * Everything the human needs to verify a suggestion before approving:
 * the source email, the document itself, the project, and (for bills)
 * the estimate lines it could be assigned to.
 */
export async function getSuggestionEvidence(
  suggestionId: string
): Promise<SuggestionEvidence | { error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { data: suggestion } = await supabase
    .from("agent_suggestions")
    .select("id, project_id, kind, payload")
    .eq("id", suggestionId)
    .maybeSingle();
  if (!suggestion) return { error: "Suggestion not found" };

  const payload = (suggestion.payload ?? {}) as SuggestionPayload;
  const projectId = suggestion.project_id || payload.project_id || null;

  const evidence: SuggestionEvidence = {
    project: null,
    email: null,
    attachment: null,
    invoice: null,
    estimateLines: [],
  };

  // Fan the independent lookups out together.
  const [projectRes, emailRes, invoiceByIdRes, invoiceByMsgRes] = await Promise.all([
    projectId
      ? supabase.from("projects").select("id, name").eq("id", projectId).maybeSingle()
      : Promise.resolve({ data: null }),
    payload.gmail_message_id
      ? supabase
          .from("inbox_emails")
          .select("id, subject")
          .eq("gmail_message_id", payload.gmail_message_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    payload.invoice_id
      ? supabase
          .from("invoices")
          .select("id, estimate_line_item_id")
          .eq("id", payload.invoice_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    !payload.invoice_id && payload.gmail_message_id
      ? supabase
          .from("invoices")
          .select("id, estimate_line_item_id")
          .eq("gmail_message_id", payload.gmail_message_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  if (projectRes.data) evidence.project = projectRes.data as { id: string; name: string };
  if (emailRes.data) evidence.email = emailRes.data as { id: string; subject: string | null };

  const invoiceRow = (invoiceByIdRes.data ?? invoiceByMsgRes.data) as
    | { id: string; estimate_line_item_id: string | null }
    | null;
  if (invoiceRow) {
    evidence.invoice = { id: invoiceRow.id, assignedLineId: invoiceRow.estimate_line_item_id };
  }

  if (payload.attachment_storage_path) {
    const { data: signed } = await supabase.storage
      .from("email-attachments")
      .createSignedUrl(payload.attachment_storage_path, 60 * 60);
    if (signed?.signedUrl) {
      const segments = payload.attachment_storage_path.split("/");
      evidence.attachment = {
        url: signed.signedUrl,
        filename: segments[segments.length - 1] || "document.pdf",
      };
    }
  }

  // Estimate lines for bill assignment — latest estimate, real lines only.
  if (projectId && (suggestion.kind === "invoice" || suggestion.kind === "invoice_line")) {
    const { data: estimate } = await supabase
      .from("estimates")
      .select("id")
      .eq("project_id", projectId)
      .in("status", ["approved", "draft"])
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (estimate) {
      const { data: lines } = await supabase
        .from("estimate_line_items")
        .select("id, trade, description, total_cost, is_section_header")
        .eq("estimate_id", estimate.id)
        .order("sort_order", { ascending: true });
      evidence.estimateLines = ((lines ?? []) as {
        id: string;
        trade: string | null;
        description: string | null;
        total_cost: number | null;
        is_section_header: boolean | null;
      }[])
        .filter((l) => !l.is_section_header)
        .map(({ id, trade, description, total_cost }) => ({ id, trade, description, total_cost }));
    }
  }

  return evidence;
}

/** Suggestions a specific run produced — the drill-down for the activity feed. */
export async function getRunSuggestions(runId: string): Promise<
  { id: string; kind: string; title: string; status: string }[]
> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("agent_suggestions")
    .select("id, kind, title, status")
    .eq("run_id", runId)
    .order("created_at", { ascending: true });
  return (data as { id: string; kind: string; title: string; status: string }[]) || [];
}

/**
 * Approve or dismiss a suggestion the crew surfaced.
 *
 * Approving DOES the work the card asks for:
 *  - bill not logged yet    -> logs it to the project + live P&L
 *  - bill already logged    -> assigns the estimate line the human picked
 * A picked estimateLineItemId always wins over the agent's auto-match.
 */
export async function reviewSuggestion(
  id: string,
  decision: "approved" | "dismissed",
  options?: { estimateLineItemId?: string }
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  if (decision === "approved") {
    const { data: suggestion } = await supabase
      .from("agent_suggestions")
      .select("kind, payload, status")
      .eq("id", id)
      .single();

    if (
      suggestion &&
      suggestion.status === "pending" &&
      (suggestion.kind === "invoice" || suggestion.kind === "invoice_line")
    ) {
      const payload = (suggestion.payload ?? {}) as SuggestionPayload;

      // Already-logged bill: approve = assign the line the human picked.
      let existingInvoiceId = payload.invoice_id ?? null;
      if (!existingInvoiceId && payload.gmail_message_id) {
        const { data: dupe } = await supabase
          .from("invoices")
          .select("id")
          .eq("gmail_message_id", payload.gmail_message_id)
          .maybeSingle();
        if (dupe) existingInvoiceId = dupe.id;
      }

      if (existingInvoiceId) {
        if (options?.estimateLineItemId) {
          const { error } = await supabase
            .from("invoices")
            .update({ estimate_line_item_id: options.estimateLineItemId })
            .eq("id", existingInvoiceId);
          if (error) return { error: error.message };
        }
      } else if (
        payload.project_id &&
        payload.vendor_name &&
        payload.amount != null
      ) {
        const acted = await logInvoiceFromPayload(
          supabase,
          user.id,
          payload,
          options?.estimateLineItemId
        );
        if (acted.error) return { error: acted.error };
      }
      // Payload too incomplete to log automatically (no project/vendor/amount):
      // approving just marks it handled — the human deals with it from the email.
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

/**
 * Logs an invoice from an approved suggestion's payload. Mirrors the MCP
 * record_invoice tool: dedups on gmail_message_id / project+vendor+invoice#,
 * links the estimate line (human pick first, else unique trade match), and
 * posts to the live P&L (get_project_financials sums invoices by project).
 */
async function logInvoiceFromPayload(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  payload: SuggestionPayload,
  pickedLineId?: string
): Promise<{ error?: string }> {
  const { project_id, amount, vendor_name } = payload;
  if (!project_id || !vendor_name || amount == null) {
    return { error: "This bill is missing a project, vendor, or amount — can't log it automatically." };
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

  // The human's pick wins; otherwise refine-match by trade (never blocks the write).
  let estimateLineItemId: string | null = pickedLineId ?? null;
  if (!estimateLineItemId && payload.trade) {
    const { data: estimate } = await supabase
      .from("estimates")
      .select("id")
      .eq("project_id", project_id)
      .in("status", ["approved", "draft"])
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (estimate) {
      const { data: lines } = await supabase
        .from("estimate_line_items")
        .select("id")
        .eq("estimate_id", estimate.id)
        .ilike("trade", payload.trade);
      if (lines && lines.length === 1) estimateLineItemId = lines[0].id;
    }
  }

  const { error } = await supabase.from("invoices").insert({
    project_id,
    vendor_name,
    vendor_type: "subcontractor",
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
