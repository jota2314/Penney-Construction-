"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { lineItemFinancials } from "@/lib/estimates/line-item-financials";

export async function createChangeOrder(data: {
  project_id: string;
  estimate_id?: string | null;
  title: string;
  description?: string;
  trade?: string;
  cost_impact: number;
  price_impact: number;
  status?: string;
  notes?: string;
}) {
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return { error: "Not authenticated" };

  // Get next change_order_number
  const { data: existing } = await supabase
    .from("change_orders")
    .select("change_order_number")
    .eq("project_id", data.project_id)
    .order("change_order_number", { ascending: false })
    .limit(1);

  const nextNumber = (existing?.[0]?.change_order_number ?? 0) + 1;

  // Get estimate_id if not provided
  let estimateId = data.estimate_id;
  if (!estimateId) {
    const { data: est } = await supabase
      .from("estimates")
      .select("id")
      .eq("project_id", data.project_id)
      .in("status", ["approved", "draft"])
      .order("version", { ascending: false })
      .limit(1);
    estimateId = est?.[0]?.id;
  }

  // Insert change order
  const { data: co, error: coError } = await supabase
    .from("change_orders")
    .insert({
      project_id: data.project_id,
      estimate_id: estimateId,
      change_order_number: nextNumber,
      title: data.title,
      description: data.description || null,
      status: data.status || "draft",
      cost_impact: data.cost_impact,
      price_impact: data.price_impact,
      notes: data.notes || null,
      approved_at: data.status === "approved" ? new Date().toISOString() : null,
      created_by: user.user.id,
    })
    .select("id")
    .single();

  if (coError) return { error: coError.message };

  // Auto-create matching estimate line item
  if (estimateId && co) {
    await supabase.from("estimate_line_items").insert({
      estimate_id: estimateId,
      description: data.title,
      trade: data.trade || null,
      ...lineItemFinancials(
        data.cost_impact,
        data.cost_impact > 0
          ? Math.round(((data.price_impact / data.cost_impact) - 1) * 100)
          : 0,
        data.price_impact,
      ),
      quantity: 1,
      unit: "LS",
      unit_cost: data.cost_impact,
      sort_order: 100 + nextNumber,
      change_order_id: co.id,
      is_visible_on_proposal: false,
      source: "manual",
    });
  }

  revalidatePath(`/projects/${data.project_id}`);
  return { id: co.id, number: nextNumber };
}

export async function updateChangeOrder(
  changeOrderId: string,
  projectId: string,
  data: {
    title?: string;
    description?: string;
    trade?: string;
    cost_impact?: number;
    price_impact?: number;
    status?: string;
    notes?: string;
  }
) {
  const supabase = await createClient();

  const updateData: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (data.title !== undefined) updateData.title = data.title;
  if (data.description !== undefined)
    updateData.description = data.description || null;
  if (data.cost_impact !== undefined) updateData.cost_impact = data.cost_impact;
  if (data.price_impact !== undefined)
    updateData.price_impact = data.price_impact;
  if (data.status !== undefined) {
    updateData.status = data.status;
    if (data.status === "approved")
      updateData.approved_at = new Date().toISOString();
  }
  if (data.notes !== undefined) updateData.notes = data.notes || null;

  const { error } = await supabase
    .from("change_orders")
    .update(updateData)
    .eq("id", changeOrderId);

  if (error) return { error: error.message };

  // Update linked estimate line item if cost/price changed
  if (
    data.cost_impact !== undefined ||
    data.price_impact !== undefined ||
    data.title !== undefined ||
    data.trade !== undefined
  ) {
    const lineUpdate: Record<string, unknown> = {};
    if (data.title !== undefined) lineUpdate.description = data.title;
    if (data.trade !== undefined) lineUpdate.trade = data.trade || null;
    // Write both column sets — active (cost/client_price) is authoritative,
    // legacy (total_cost/total_price) is kept as a mirror.
    if (data.cost_impact !== undefined) {
      lineUpdate.cost = data.cost_impact;
      lineUpdate.total_cost = data.cost_impact;
      lineUpdate.unit_cost = data.cost_impact;
    }
    if (data.price_impact !== undefined) {
      lineUpdate.client_price = data.price_impact;
      lineUpdate.total_price = data.price_impact;
    }
    if (data.cost_impact !== undefined && data.price_impact !== undefined) {
      lineUpdate.profit = data.price_impact - data.cost_impact;
      const markup = data.cost_impact > 0
        ? Math.round(((data.price_impact / data.cost_impact) - 1) * 100)
        : 0;
      lineUpdate.markup_pct = markup;
      lineUpdate.markup_percentage = markup;
    }

    await supabase
      .from("estimate_line_items")
      .update(lineUpdate)
      .eq("change_order_id", changeOrderId);
  }

  revalidatePath(`/projects/${projectId}`);
  return { success: true };
}

export async function deleteChangeOrder(
  changeOrderId: string,
  projectId: string
) {
  const supabase = await createClient();

  // Delete linked estimate line items first
  await supabase
    .from("estimate_line_items")
    .delete()
    .eq("change_order_id", changeOrderId);

  const { error } = await supabase
    .from("change_orders")
    .delete()
    .eq("id", changeOrderId);

  if (error) return { error: error.message };

  revalidatePath(`/projects/${projectId}`);
  return { success: true };
}

export async function linkInvoiceToChangeOrder(
  invoiceId: string,
  changeOrderId: string | null,
  projectId: string
) {
  const supabase = await createClient();

  if (changeOrderId) {
    // Find the estimate line item linked to this CO
    const { data: lineItem } = await supabase
      .from("estimate_line_items")
      .select("id")
      .eq("change_order_id", changeOrderId)
      .limit(1)
      .single();

    const { error } = await supabase
      .from("invoices")
      .update({
        change_order_id: changeOrderId,
        estimate_line_item_id: lineItem?.id || null,
      })
      .eq("id", invoiceId);

    if (error) return { error: error.message };
  } else {
    const { error } = await supabase
      .from("invoices")
      .update({ change_order_id: null })
      .eq("id", invoiceId);

    if (error) return { error: error.message };
  }

  revalidatePath(`/projects/${projectId}`);
  return { success: true };
}
