"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

// Narrow patch actions used while Ryan is reviewing a proposal. These
// only fire while the estimate is still pending_review — once he decides,
// the review page is read-only and the regular estimate builder takes over.

async function assertEditable(estimateId: string): Promise<string | null> {
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
    .select("total_cost, total_price")
    .eq("estimate_id", estimateId);
  const totalCost = (items ?? []).reduce((s, i) => s + Number(i.total_cost || 0), 0);
  const totalPrice = (items ?? []).reduce((s, i) => s + Number(i.total_price || 0), 0);
  await supabase
    .from("estimates")
    .update({ total_cost: totalCost, total_price: totalPrice })
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
  const { error } = await supabase
    .from("estimate_line_items")
    .update({ total_price: Math.round(newPrice * 100) / 100 })
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
