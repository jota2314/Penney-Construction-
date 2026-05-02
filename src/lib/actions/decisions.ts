"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type DecisionType =
  | "add_schedule_phase"
  | "link_quote_to_line"
  | "link_invoice_to_line";

export interface PendingDecision {
  id: string;
  role: string;
  decision_type: DecisionType;
  project_id: string | null;
  title: string;
  context: string | null;
  payload: Record<string, unknown>;
  options: Record<string, unknown> | null;
  created_at: string;
}

export async function getPendingDecisions(): Promise<PendingDecision[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("decisions")
    .select("id, role, decision_type, project_id, title, context, payload, options, created_at")
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(20);
  return (data ?? []) as PendingDecision[];
}

export async function queueDecision(input: {
  role: string;
  decision_type: DecisionType;
  project_id: string | null;
  title: string;
  context?: string;
  payload: Record<string, unknown>;
  options?: Record<string, unknown>;
  proposed_by?: string | null;
}): Promise<{ id?: string; error?: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("decisions")
    .insert({
      role: input.role,
      decision_type: input.decision_type,
      project_id: input.project_id,
      title: input.title,
      context: input.context ?? null,
      payload: input.payload,
      options: input.options ?? null,
      proposed_by: input.proposed_by ?? null,
    })
    .select("id")
    .single();
  if (error) return { error: error.message };
  return { id: data.id };
}

export async function approveDecision(id: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };

  const { data: decision, error: fetchErr } = await supabase
    .from("decisions")
    .select("id, decision_type, project_id, payload, status")
    .eq("id", id)
    .single();
  if (fetchErr || !decision) return { ok: false, error: fetchErr?.message ?? "Decision not found" };
  if (decision.status !== "pending") return { ok: false, error: "Already decided" };

  const payload = (decision.payload ?? {}) as Record<string, unknown>;

  let execErr: string | undefined;
  switch (decision.decision_type as DecisionType) {
    case "add_schedule_phase":
      execErr = await applyAddSchedulePhase(supabase, payload, user.id);
      break;
    case "link_quote_to_line":
      execErr = await applyLinkQuoteToLine(supabase, payload);
      break;
    case "link_invoice_to_line":
      execErr = await applyLinkInvoiceToLine(supabase, payload);
      break;
    default:
      execErr = `Unknown decision_type: ${decision.decision_type}`;
  }

  if (execErr) return { ok: false, error: execErr };

  await supabase
    .from("decisions")
    .update({ status: "approved", decided_by: user.id, decided_at: new Date().toISOString() })
    .eq("id", id);

  revalidatePath("/command-center");
  if (decision.project_id) revalidatePath(`/projects/${decision.project_id}`);
  return { ok: true };
}

export async function rejectDecision(id: string, note?: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };

  const { error } = await supabase
    .from("decisions")
    .update({
      status: "rejected",
      decided_by: user.id,
      decided_at: new Date().toISOString(),
      decision_note: note ?? null,
    })
    .eq("id", id)
    .eq("status", "pending");
  if (error) return { ok: false, error: error.message };

  revalidatePath("/command-center");
  return { ok: true };
}

// ── Per-type approve handlers ───────────────────────────────────────

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

async function applyAddSchedulePhase(
  supabase: SupabaseClient,
  payload: Record<string, unknown>,
  userId: string,
): Promise<string | undefined> {
  if (!payload.project_id || !payload.name || !payload.start_date) {
    return "Missing project_id, name, or start_date in payload";
  }
  const startDate = String(payload.start_date);
  const endDate = payload.end_date ? String(payload.end_date) : startDate;
  if (endDate < startDate) return "end_date must be on or after start_date";

  const eventType = String(payload.event_type ?? "phase");
  const colors: Record<string, string> = {
    phase: "#8b5cf6", inspection: "#ef4444", walkthrough: "#f59e0b", meeting: "#3b82f6",
  };

  const { error } = await supabase.from("schedule_phases").insert({
    project_id: String(payload.project_id),
    name: String(payload.name),
    start_date: startDate,
    end_date: endDate,
    status: String(payload.status ?? "not_started"),
    event_type: eventType,
    color: colors[eventType] ?? "#8b5cf6",
    notes: payload.notes ? String(payload.notes) : null,
    created_by: userId,
  });
  return error?.message;
}

async function applyLinkQuoteToLine(
  supabase: SupabaseClient,
  payload: Record<string, unknown>,
): Promise<string | undefined> {
  if (!payload.quote_id || !payload.estimate_line_item_id) {
    return "Missing quote_id or estimate_line_item_id in payload";
  }
  const { error } = await supabase
    .from("quote_requests")
    .update({ estimate_line_item_id: String(payload.estimate_line_item_id) })
    .eq("id", String(payload.quote_id));
  return error?.message;
}

async function applyLinkInvoiceToLine(
  supabase: SupabaseClient,
  payload: Record<string, unknown>,
): Promise<string | undefined> {
  if (!payload.invoice_id || !payload.estimate_line_item_id) {
    return "Missing invoice_id or estimate_line_item_id in payload";
  }
  const { error } = await supabase
    .from("invoices")
    .update({ estimate_line_item_id: String(payload.estimate_line_item_id) })
    .eq("id", String(payload.invoice_id));
  return error?.message;
}
