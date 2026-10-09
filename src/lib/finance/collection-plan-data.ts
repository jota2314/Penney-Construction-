import "server-only";
import { createClient } from "@/lib/supabase/server";
import { buildCollectionPlan, type CollectionProject, type CollectionPlan, type CollectionInvoice,
  type CollectionMilestone, type CollectionPhase, type CollectionReceipt } from "./collection-plan";

// A failed or capped read is unavailable, never a zero-dollar forecast.
async function readComplete<T>(page: (from: number, to: number) => PromiseLike<{
  data: T[] | null; error: { message: string } | null;
}>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; from < 50_000; from += 1000) {
    const result = await page(from, from + 999);
    if (result.error || !result.data) throw new Error(result.error?.message ?? "Collection records unavailable");
    rows.push(...result.data);
    if (result.data.length < 1000) return rows;
  }
  throw new Error("Collection record limit reached");
}

export async function getCollectionPlan(projects: CollectionProject[], today: string): Promise<CollectionPlan | null> {
  const ids = projects.map(p => p.id);
  if (!ids.length) return buildCollectionPlan({ today, projects, invoices: [], milestones: [], phases: [], receipts: [] });
  try {
    const supabase = await createClient();
    const [invoices, milestones, phases, receipts] = await Promise.all([
      readComplete<CollectionInvoice>((from, to) => supabase.from("client_invoices")
        .select("id, project_id, title, amount, paid_amount, status, due_date, sent_to_client_at, source")
        .in("project_id", ids).order("id").range(from, to)),
      readComplete<CollectionMilestone>((from, to) => supabase.from("project_payment_milestones")
        .select("id, project_id, label, stage_key, amount, percent, status, client_invoice_id")
        .in("project_id", ids).order("id").range(from, to)),
      readComplete<CollectionPhase>((from, to) => supabase.from("schedule_phases")
        .select("project_id, name, end_date, start_date, planned_end_date, planned_start_date, phase_scope, event_type, status")
        .in("project_id", ids).eq("phase_scope", "master").order("id").range(from, to)),
      readComplete<CollectionReceipt>((from, to) => supabase.from("payments_received")
        .select("project_id, client_invoice_id, amount").in("project_id", ids).order("id").range(from, to)),
    ]);
    return buildCollectionPlan({ today, projects, invoices, milestones, phases, receipts });
  } catch (error) {
    console.error("CEO collection plan unavailable", error instanceof Error ? error.message : "Unknown error");
    return null;
  }
}
