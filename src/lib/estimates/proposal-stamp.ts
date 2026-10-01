import crypto from "node:crypto";
import type { createClient } from "@/lib/supabase/server";

type ServerSupabase = Awaited<ReturnType<typeof createClient>>;

export interface ProposalStamp {
  /** Opaque change token. Differs whenever anything the proposal PDF prints changes. */
  stamp: string;
  total_price: number;
  total_cost: number;
  margin_pct: number;
  line_count: number;
  /** Most recent change across the estimate, its lines, project and customer. */
  updated_at: string | null;
}

function latest(values: (string | null | undefined)[]): string | null {
  let best: string | null = null;
  let bestMs = -Infinity;
  for (const v of values) {
    if (!v) continue;
    const ms = Date.parse(v);
    if (Number.isFinite(ms) && ms > bestMs) {
      best = v;
      bestMs = ms;
    }
  }
  return best;
}

/**
 * Change stamp for the Live Proposal view.
 *
 * Folds in everything generate-proposal-pdf prints:
 *   - the estimate row (totals, notes; the line trigger also bumps it)
 *   - its lines: max(updated_at) catches edits/inserts, the count catches deletes
 *   - the project and its customer (name, address, client block)
 * Every one of those tables has a set_updated_at trigger (verified live 9/29).
 *
 * Returns null when the estimate isn't visible to this client.
 */
export async function getProposalStamp(
  supabase: ServerSupabase,
  estimateId: string,
): Promise<ProposalStamp | null> {
  const [estRes, linesRes] = await Promise.all([
    supabase
      .from("estimates")
      .select("id, project_id, total_price, total_cost, updated_at")
      .eq("id", estimateId)
      .maybeSingle(),
    // Newest line + exact count in one round trip.
    supabase
      .from("estimate_line_items")
      .select("updated_at", { count: "exact" })
      .eq("estimate_id", estimateId)
      .order("updated_at", { ascending: false })
      .limit(1),
  ]);
  if (estRes.error) throw estRes.error;
  if (linesRes.error) throw linesRes.error;

  const est = estRes.data;
  if (!est) return null;

  const lineCount = linesRes.count ?? linesRes.data?.length ?? 0;
  const lineUpdatedAt: string | null = linesRes.data?.[0]?.updated_at ?? null;

  let projectUpdatedAt: string | null = null;
  let customerUpdatedAt: string | null = null;
  if (est.project_id) {
    const { data: project, error } = await supabase
      .from("projects")
      .select("updated_at, customers(updated_at)")
      .eq("id", est.project_id)
      .maybeSingle();
    if (error) throw error;
    projectUpdatedAt = project?.updated_at ?? null;
    const cust = Array.isArray(project?.customers) ? project.customers[0] : project?.customers;
    customerUpdatedAt = cust?.updated_at ?? null;
  }

  const raw = [
    est.updated_at,
    lineUpdatedAt ?? "-",
    lineCount,
    projectUpdatedAt ?? "-",
    customerUpdatedAt ?? "-",
  ].join("|");
  const stamp = crypto.createHash("sha1").update(raw).digest("hex").slice(0, 16);

  const totalPrice = Number(est.total_price ?? 0);
  const totalCost = Number(est.total_cost ?? 0);
  const marginPct =
    totalPrice > 0 ? Math.round(((totalPrice - totalCost) / totalPrice) * 10000) / 100 : 0;

  return {
    stamp,
    total_price: totalPrice,
    total_cost: totalCost,
    margin_pct: marginPct,
    line_count: lineCount,
    updated_at: latest([est.updated_at, lineUpdatedAt, projectUpdatedAt, customerUpdatedAt]),
  };
}
