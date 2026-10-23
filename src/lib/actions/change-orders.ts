"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { lineItemFinancials } from "@/lib/estimates/line-item-financials";
import { pushChangeOrderToQuickBooks } from "@/lib/quickbooks/change-orders";

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
  billing_type?: "fixed_price" | "time_materials";
  tm_terms?: string | null;
}) {
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return { error: "Not authenticated" };
  const billingType = data.billing_type ?? "fixed_price";
  if (!["fixed_price", "time_materials"].includes(billingType)) return { error: "Invalid billing basis" };
  if (billingType === "time_materials") {
    data = { ...data, cost_impact: 0, price_impact: 0 };
    if (["submitted", "approved"].includes(data.status ?? "draft") && !data.tm_terms?.trim()) {
      return { error: "Enter the agreed T&M billing rates and terms before approval." };
    }
  }

  // Get next change_order_number
  const { data: existing } = await supabase
    .from("change_orders")
    .select("change_order_number")
    .eq("project_id", data.project_id)
    .order("change_order_number", { ascending: false })
    .limit(1);

  const nextNumber = (existing?.[0]?.change_order_number ?? 0) + 1;

  // Get estimate_id if not provided — canonical pointer, because COs are cut
  // against jobs under contract, whose estimate is 'accepted' and invisible to
  // any approved/draft status filter.
  let estimateId = data.estimate_id;
  if (!estimateId) {
    const { data: currentId } = await supabase.rpc("current_estimate_id", {
      p_project_id: data.project_id,
    });
    estimateId = (currentId as string | null) ?? undefined;
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
      billing_type: billingType,
      tm_terms: billingType === "time_materials" ? data.tm_terms?.trim() || null : null,
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
    billing_type?: "fixed_price" | "time_materials";
    tm_terms?: string | null;
  }
) {
  const supabase = await createClient();

  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { error: "Not authenticated" };
  const { data: current, error: readError } = await supabase.from("change_orders")
    .select("id, title, description, billing_type, tm_terms, tm_issued_at, approved_at, status, client_signed_at, sent_to_client_at")
    .eq("id", changeOrderId).eq("project_id", projectId).single();
  if (readError || !current) return { error: "Change order not found or access denied." };
  const billingType = data.billing_type ?? current.billing_type ?? "fixed_price";
  if (!["fixed_price", "time_materials"].includes(billingType)) return { error: "Invalid billing basis" };
  const terms = data.tm_terms === undefined ? current.tm_terms : data.tm_terms?.trim() || null;
  const issued = !!current.tm_issued_at || !!current.approved_at || !!current.sent_to_client_at || !!current.client_signed_at || ["submitted", "approved"].includes(current.status);
  if (issued &&
    (billingType !== current.billing_type || terms !== current.tm_terms)) {
    return { error: "The billing basis already shared with the client cannot be changed. Create a new change order." };
  }
  if (issued && current.billing_type === "time_materials" &&
    ((data.title !== undefined && data.title !== current.title) ||
      (data.description !== undefined && (data.description || null) !== current.description))) {
    return { error: "The T&M scope already shared with the client cannot be changed. Create a new change order." };
  }
  if (billingType === "time_materials") {
    data = { ...data, cost_impact: 0, price_impact: 0 };
    if (["submitted", "approved"].includes(data.status ?? current.status) && !terms) {
      return { error: "Enter the agreed T&M billing rates and terms before approval." };
    }
  }

  const updateData: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
    billing_type: billingType,
    tm_terms: billingType === "time_materials" ? terms : null,
  };
  if (data.title !== undefined) updateData.title = data.title;
  if (data.description !== undefined)
    updateData.description = data.description || null;
  if (data.cost_impact !== undefined) updateData.cost_impact = data.cost_impact;
  if (data.price_impact !== undefined)
    updateData.price_impact = data.price_impact;
  if (data.status !== undefined) {
    updateData.status = data.status;
    if (data.status === "approved") {
      updateData.approved_at = current.approved_at || new Date().toISOString();
      updateData.approved_by = "Manual approval";
    }
  }
  if (data.notes !== undefined) updateData.notes = data.notes || null;

  const { error } = await supabase
    .from("change_orders")
    .update(updateData)
    .eq("id", changeOrderId).eq("project_id", projectId);

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

  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { error: "Not authenticated" };
  const { data: linkedLines, error: linesError } = await supabase
    .from("estimate_line_items")
    .select("id")
    .eq("change_order_id", changeOrderId);
  if (linesError) return { error: linesError.message };

  // Delete the parent first: the T&M history FK must reject the deletion before
  // any budget/source lines can be removed. Its line-item FK uses SET NULL.
  const { data: deleted, error } = await supabase
    .from("change_orders")
    .delete()
    .eq("id", changeOrderId).eq("project_id", projectId).select("id");

  if (error) return { error: error.code === "23503"
    ? "This change order has linked history and cannot be deleted. Keep it for the audit trail."
    : error.message };
  if (!deleted?.length) return { error: "Change order not found or deletion is not allowed." };

  if (linkedLines?.length) {
    const { error: cleanupError } = await supabase.from("estimate_line_items").delete()
      .in("id", linkedLines.map(line => line.id)).is("change_order_id", null);
    if (cleanupError) {
      revalidatePath(`/projects/${projectId}`);
      return { error: "The change order was deleted, but its former estimate lines could not be removed. Review the estimate before continuing." };
    }
  }

  revalidatePath(`/projects/${projectId}`);
  return { success: true };
}

export async function pushChangeOrderToQB(
  changeOrderId: string,
  projectId: string
) {
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return { error: "Not authenticated" };

  const result = await pushChangeOrderToQuickBooks(changeOrderId);
  if (result.error) return { error: result.error };

  revalidatePath(`/projects/${projectId}`);
  return { success: true, qbEstimateId: result.qbEstimateId };
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
