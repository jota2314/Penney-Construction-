"use server";

import { createClient } from "@/lib/supabase/server";

/**
 * Manual re-filing from the Finances card: move an invoice, or one worker's
 * clocked hours, onto a different estimate line item.
 *
 * Hours move by stamping the shifts' own estimate_line_item_id with
 * line_item_source='manual' — the stamp beats the phase link in
 * getProjectLaborCost, and 'manual' protects it from any automated
 * re-routing. Nothing is ever written to the ledger; the card recomputes.
 */

export async function moveInvoiceToLine(
  invoiceId: string,
  toLineItemId: string | null,
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { error } = await supabase
    .from("invoices")
    .update({ estimate_line_item_id: toLineItemId })
    .eq("id", invoiceId);
  if (error) return { error: error.message };
  return {};
}

export async function moveWorkerHours(
  projectId: string,
  workerProfileId: string,
  fromLineItemId: string,
  toLineItemId: string,
): Promise<{ moved: number; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { moved: 0, error: "Not authenticated" };
  if (fromLineItemId === toLineItemId) return { moved: 0 };

  // The worker's shifts on this project, with the phase link for fallback.
  const { data: phases } = await supabase
    .from("schedule_phases")
    .select("id, estimate_line_item_id")
    .eq("project_id", projectId);
  if (!phases || phases.length === 0) return { moved: 0 };
  const lineByPhase = new Map<string, string | null>(
    phases.map((p) => [p.id as string, (p.estimate_line_item_id as string | null) ?? null]),
  );

  const { data: logs } = await supabase
    .from("daily_logs")
    .select("id, schedule_phase_id, estimate_line_item_id, started_at, ended_at, status")
    .in("schedule_phase_id", [...lineByPhase.keys()])
    .eq("author_id", workerProfileId);
  if (!logs || logs.length === 0) return { moved: 0 };

  // Move the rows whose hours currently resolve to the source line: the log's
  // own stamp wins, else the phase's link. Zero-length notes carry no money —
  // move them too so the write-up travels with its shift.
  const ids = logs
    .filter((l) => {
      const resolved =
        (l.estimate_line_item_id as string | null) ??
        lineByPhase.get(l.schedule_phase_id as string) ??
        null;
      return resolved === fromLineItemId;
    })
    .map((l) => l.id as string);
  if (ids.length === 0) return { moved: 0 };

  const { error } = await supabase
    .from("daily_logs")
    .update({
      estimate_line_item_id: toLineItemId,
      line_item_source: "manual",
      line_item_needs_review: false,
      line_item_note: "Moved manually from the Finances card",
    })
    .in("id", ids);
  if (error) return { moved: 0, error: error.message };
  return { moved: ids.length };
}
