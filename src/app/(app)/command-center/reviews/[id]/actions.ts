"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { lineCost, linePrice } from "@/lib/estimates/line-item-financials";
import { getUser } from "@/lib/auth/get-user";
import { canReviewEstimates } from "@/lib/auth/role-access";

// Narrow patch actions used while Ryan is reviewing a proposal. These
// only fire while the estimate is still pending_review — once he decides,
// the review page is read-only and the regular estimate builder takes over.

async function assertEditable(estimateId: string): Promise<string | null> {
  const viewer = await getUser();
  if (!viewer || !canReviewEstimates(viewer.profile?.role)) {
    return "Proposal reviews are limited to owners and precon.";
  }
  const supabase = await createClient();
  const { data } = await supabase
    .from("estimates")
    .select("approval_status")
    .eq("id", estimateId)
    .maybeSingle();
  if (!data) return "Estimate not found";
  if (data.approval_status !== "pending_review") {
    return "Estimate is not in review — reopen it to edit.";
  }
  return null;
}

async function recalcEstimateTotal(estimateId: string) {
  const supabase = await createClient();
  const { data: items } = await supabase
    .from("estimate_line_items")
    .select("cost, client_price, total_cost, total_price, is_section_header")
    .eq("estimate_id", estimateId);
  // Active columns first, section headers excluded — same math as the
  // sync_estimate_totals_from_lines trigger so we never fight it.
  const lines = (items ?? []).filter((i) => !i.is_section_header);
  const totalCost = lines.reduce((s, i) => s + lineCost(i), 0);
  const totalPrice = lines.reduce((s, i) => s + linePrice(i), 0);
  await supabase
    .from("estimates")
    .update({ total_cost: totalCost, total_price: totalPrice, total_profit: totalPrice - totalCost })
    .eq("id", estimateId);
}

export async function patchLineItemPrice(
  estimateId: string,
  lineItemId: string,
  newPrice: number,
): Promise<{ success: boolean; error?: string }> {
  const blocked = await assertEditable(estimateId);
  if (blocked) return { success: false, error: blocked };
  if (!isFinite(newPrice) || newPrice < 0) {
    return { success: false, error: "Price must be a positive number" };
  }

  const supabase = await createClient();
  const rounded = Math.round(newPrice * 100) / 100;

  // Price-only patch: keep cost, recompute markup + profit, and write BOTH
  // column sets (client_price is authoritative, total_price is the legacy
  // mirror) so the row can't drift from the header rollup.
  const { data: row } = await supabase
    .from("estimate_line_items")
    .select("cost, total_cost")
    .eq("id", lineItemId)
    .maybeSingle();
  const cost = row ? lineCost(row) : 0;
  const markup = cost > 0 ? Math.round(((rounded / cost) - 1) * 10000) / 100 : 0;

  const { error } = await supabase
    .from("estimate_line_items")
    .update({
      client_price: rounded,
      total_price: rounded,
      markup_pct: markup,
      markup_percentage: markup,
      profit: rounded - cost,
    })
    .eq("id", lineItemId);
  if (error) return { success: false, error: error.message };

  await recalcEstimateTotal(estimateId);
  revalidatePath(`/command-center/reviews/${estimateId}`);
  return { success: true };
}

export async function patchLineItemScope(
  estimateId: string,
  lineItemId: string,
  newScope: string,
): Promise<{ success: boolean; error?: string }> {
  const blocked = await assertEditable(estimateId);
  if (blocked) return { success: false, error: blocked };

  const supabase = await createClient();
  const { error } = await supabase
    .from("estimate_line_items")
    .update({ proposal_description: newScope || null })
    .eq("id", lineItemId);
  if (error) return { success: false, error: error.message };

  revalidatePath(`/command-center/reviews/${estimateId}`);
  return { success: true };
}

export async function patchProjectScope(
  estimateId: string,
  projectId: string,
  newScope: string,
): Promise<{ success: boolean; error?: string }> {
  const blocked = await assertEditable(estimateId);
  if (blocked) return { success: false, error: blocked };

  const supabase = await createClient();
  const { error } = await supabase
    .from("projects")
    .update({ scope_of_work: newScope || null })
    .eq("id", projectId);
  if (error) return { success: false, error: error.message };

  revalidatePath(`/command-center/reviews/${estimateId}`);
  return { success: true };
}
