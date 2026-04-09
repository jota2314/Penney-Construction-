"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { ESTIMATE_TEMPLATES } from "@/lib/constants/estimate";
import type { EstimateStatus } from "@/types/database";

// ── Types ──────────────────────────────────────────────

interface EstimateInput {
  name: string;
  status?: EstimateStatus;
  notes?: string;
}

interface SimpleLineItemInput {
  description: string;
  proposal_description?: string;
  value: number;
  cost?: number;
  markup?: number;
}

// ── Helpers ────────────────────────────────────────────

async function getEstimateContext(estimateId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("estimates")
    .select("project_id, lead_id")
    .eq("id", estimateId)
    .single();
  return {
    projectId: data?.project_id as string | null,
    leadId: data?.lead_id as string | null,
  };
}

async function recalculateEstimateTotals(estimateId: string) {
  const supabase = await createClient();

  const { data: items } = await supabase
    .from("estimate_line_items")
    .select("total_cost, total_price, markup_percentage")
    .eq("estimate_id", estimateId);

  const totalCost = (items ?? []).reduce((sum, i) => sum + (i.total_cost ?? 0), 0);
  const totalPrice = (items ?? []).reduce((sum, i) => sum + (i.total_price ?? 0), 0);
  const totalProfit = totalPrice - totalCost;
  const avgMarkup = totalCost > 0 ? ((totalPrice - totalCost) / totalCost) * 100 : 0;

  await supabase
    .from("estimates")
    .update({
      total_cost: totalCost,
      total_price: totalPrice,
      total_profit: totalProfit,
      markup_pct: Math.round(avgMarkup * 100) / 100,
    })
    .eq("id", estimateId);
}

function revalidateEstimatePaths(
  projectId: string | null,
  estimateId?: string,
  leadId?: string | null
) {
  revalidatePath("/estimates");
  if (projectId) {
    revalidatePath(`/projects/${projectId}`);
    if (estimateId) {
      revalidatePath(`/projects/${projectId}/estimates/${estimateId}`);
    }
  }
  if (estimateId) {
    revalidatePath(`/estimates/${estimateId}`);
  }
  if (leadId) {
    revalidatePath(`/crm/leads/${leadId}`);
  }
  revalidatePath("/crm");
}

// ── Estimate CRUD ──────────────────────────────────────

export async function createEstimate(
  input: EstimateInput & {
    projectId?: string;
    leadId?: string;
    siteVisitId?: string;
  }
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Not authenticated" };

  const { projectId, leadId } = input;

  // Auto-increment version scoped to project or lead
  let nextVersion = 1;
  if (projectId) {
    const { data: existing } = await supabase
      .from("estimates")
      .select("version")
      .eq("project_id", projectId)
      .order("version", { ascending: false })
      .limit(1);
    nextVersion = existing && existing.length > 0 ? existing[0].version + 1 : 1;
  } else if (leadId) {
    const { data: existing } = await supabase
      .from("estimates")
      .select("version")
      .eq("lead_id", leadId)
      .is("project_id", null)
      .order("version", { ascending: false })
      .limit(1);
    nextVersion = existing && existing.length > 0 ? existing[0].version + 1 : 1;
  }

  const { data, error } = await supabase
    .from("estimates")
    .insert({
      project_id: projectId || null,
      lead_id: leadId || null,
      version: nextVersion,
      name: input.name,
      status: input.status ?? "draft",
      markup_percentage: 0,
      notes: input.notes || null,
      total_cost: 0,
      total_price: 0,
      created_by: user.id,
    })
    .select("id")
    .single();

  if (error) return { error: error.message };

  // Link site visit if provided
  if (input.siteVisitId) {
    await supabase
      .from("site_visits")
      .update({ estimate_id: data.id })
      .eq("id", input.siteVisitId);
  }

  revalidateEstimatePaths(projectId || null, data.id, leadId);
  return { error: null, id: data.id };
}

export async function createEstimateFromTemplate(
  input: EstimateInput & {
    projectId?: string;
    leadId?: string;
    siteVisitId?: string;
  },
  templateKey: string
) {
  const result = await createEstimate(input);
  if (result.error || !result.id) return result;

  const templateItems = ESTIMATE_TEMPLATES[templateKey];
  if (!templateItems || templateItems.length === 0) return result;

  const supabase = await createClient();

  const rows = templateItems.map((name, index) => ({
    estimate_id: result.id!,
    description: name,
    proposal_description: null,
    quantity: 1,
    unit: "LS",
    unit_cost: 0,
    total_cost: 0,
    markup_percentage: 0,
    total_price: 0,
    is_visible_on_proposal: true,
    notes: null,
    sort_order: index,
  }));

  await supabase.from("estimate_line_items").insert(rows);

  revalidateEstimatePaths(
    input.projectId || null,
    result.id!,
    input.leadId
  );
  return result;
}

export async function updateEstimate(estimateId: string, input: EstimateInput) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Not authenticated" };

  const { error } = await supabase
    .from("estimates")
    .update({
      name: input.name,
      status: input.status ?? "draft",
      notes: input.notes || null,
    })
    .eq("id", estimateId);

  if (error) return { error: error.message };

  const ctx = await getEstimateContext(estimateId);
  revalidateEstimatePaths(ctx.projectId, estimateId, ctx.leadId);
  return { error: null };
}

export async function deleteEstimate(estimateId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Not authenticated" };

  const ctx = await getEstimateContext(estimateId);

  // Delete line items first
  await supabase
    .from("estimate_line_items")
    .delete()
    .eq("estimate_id", estimateId);

  // Clear lead.estimate_id if applicable
  if (ctx.leadId) {
    await supabase
      .from("leads")
      .update({ estimate_id: null, status: "meeting_complete" })
      .eq("estimate_id", estimateId);
  }

  const { error } = await supabase
    .from("estimates")
    .delete()
    .eq("id", estimateId);

  if (error) return { error: error.message };

  revalidateEstimatePaths(ctx.projectId, undefined, ctx.leadId);
  return { error: null };
}

export async function updateEstimateDescription(
  estimateId: string,
  description: string
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Not authenticated" };

  const { error } = await supabase
    .from("estimates")
    .update({ description })
    .eq("id", estimateId);

  if (error) return { error: error.message };

  return { error: null };
}

// ── Approve Estimate as Contract ──────────────────────

export async function approveEstimateAsContract(estimateId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Not authenticated" };

  // Fetch estimate with totals
  const { data: estimate, error: fetchError } = await supabase
    .from("estimates")
    .select("id, project_id, lead_id, total_price, total_cost, status")
    .eq("id", estimateId)
    .single();

  if (fetchError || !estimate) return { error: fetchError?.message || "Estimate not found" };
  if (!estimate.project_id) return { error: "Estimate must be linked to a project first" };

  // Mark estimate as approved
  const { error: estError } = await supabase
    .from("estimates")
    .update({ status: "approved" })
    .eq("id", estimateId);

  if (estError) return { error: estError.message };

  // Mark any other estimates for this project as superseded
  await supabase
    .from("estimates")
    .update({ status: "superseded" })
    .eq("project_id", estimate.project_id)
    .neq("id", estimateId)
    .in("status", ["draft", "review"]);

  // Set project contract_value and update status to contracted
  const { error: projError } = await supabase
    .from("projects")
    .update({
      contract_value: estimate.total_price,
      status: "contracted",
    })
    .eq("id", estimate.project_id);

  if (projError) return { error: projError.message };

  revalidateEstimatePaths(estimate.project_id, estimateId, estimate.lead_id);
  revalidatePath(`/projects/${estimate.project_id}`);
  return { error: null };
}

// ── Line Item CRUD ─────────────────────────────────────

export async function addLineItem(
  estimateId: string,
  input: SimpleLineItemInput
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Not authenticated" };

  // Get next sort_order
  const { data: existing } = await supabase
    .from("estimate_line_items")
    .select("sort_order")
    .eq("estimate_id", estimateId)
    .order("sort_order", { ascending: false })
    .limit(1);

  const nextSort = existing && existing.length > 0 ? existing[0].sort_order + 1 : 0;

  const value = input.value || 0;

  const { error } = await supabase.from("estimate_line_items").insert({
    estimate_id: estimateId,
    description: input.description,
    proposal_description: input.proposal_description || null,
    quantity: 1,
    unit: "LS",
    unit_cost: value,
    total_cost: value,
    markup_percentage: 0,
    total_price: value,
    is_visible_on_proposal: true,
    notes: null,
    sort_order: nextSort,
  });

  if (error) return { error: error.message };

  await recalculateEstimateTotals(estimateId);
  const ctx = await getEstimateContext(estimateId);
  revalidateEstimatePaths(ctx.projectId, estimateId, ctx.leadId);
  return { error: null };
}

export async function updateLineItem(
  lineItemId: string,
  estimateId: string,
  input: SimpleLineItemInput
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Not authenticated" };

  // Cost/markup/price calculation:
  // If cost + markup provided → calculate price from them
  // If only value (price) provided → use as price, cost = price (backwards compat)
  const hasCostMarkup = input.cost != null && input.cost > 0;
  const cost = hasCostMarkup ? input.cost! : (input.value || 0);
  const markup = hasCostMarkup ? (input.markup ?? 0) : 0;
  const price = hasCostMarkup ? cost * (1 + markup / 100) : (input.value || 0);

  const { error } = await supabase
    .from("estimate_line_items")
    .update({
      description: input.description,
      proposal_description: input.proposal_description || null,
      quantity: 1,
      unit: "LS",
      unit_cost: cost,
      total_cost: cost,
      markup_percentage: markup,
      total_price: Math.round(price * 100) / 100,
      is_visible_on_proposal: true,
    })
    .eq("id", lineItemId);

  if (error) return { error: error.message };

  await recalculateEstimateTotals(estimateId);
  const ctx = await getEstimateContext(estimateId);
  revalidateEstimatePaths(ctx.projectId, estimateId, ctx.leadId);
  return { error: null };
}

export async function deleteLineItem(lineItemId: string, estimateId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Not authenticated" };

  const { error } = await supabase
    .from("estimate_line_items")
    .delete()
    .eq("id", lineItemId);

  if (error) return { error: error.message };

  await recalculateEstimateTotals(estimateId);
  const ctx = await getEstimateContext(estimateId);
  revalidateEstimatePaths(ctx.projectId, estimateId, ctx.leadId);
  return { error: null };
}

export async function bulkCreateLineItems(
  estimateId: string,
  items: {
    description: string;
    proposal_description?: string;
    total_price: number;
    quantity?: number;
    unit?: string;
    unit_cost?: number;
    trade?: string | null;
    needs_sub_quote?: boolean;
    source?: "manual" | "ai" | "takeoff";
  }[],
  mode: "replace" | "append"
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Not authenticated" };

  let startOrder = 0;

  if (mode === "replace") {
    await supabase
      .from("estimate_line_items")
      .delete()
      .eq("estimate_id", estimateId);
  } else {
    const { data: existing } = await supabase
      .from("estimate_line_items")
      .select("sort_order")
      .eq("estimate_id", estimateId)
      .order("sort_order", { ascending: false })
      .limit(1);

    startOrder = existing && existing.length > 0 ? existing[0].sort_order + 1 : 0;
  }

  const rows = items.map((item, index) => {
    const qty = item.quantity || 1;
    const unitCost = item.unit_cost || item.total_price || 0;
    const totalPrice = item.total_price || (qty * unitCost);
    return {
      estimate_id: estimateId,
      description: item.description,
      proposal_description: item.proposal_description || null,
      quantity: qty,
      unit: item.unit || "LS",
      unit_cost: unitCost,
      total_cost: totalPrice,
      markup_percentage: 0,
      total_price: totalPrice,
      is_visible_on_proposal: true,
      notes: null,
      sort_order: startOrder + index,
      trade: item.trade || null,
      needs_sub_quote: item.needs_sub_quote || false,
      source: item.source || "manual",
    };
  });

  if (rows.length > 0) {
    const { error } = await supabase.from("estimate_line_items").insert(rows);
    if (error) return { error: error.message };
  }

  await recalculateEstimateTotals(estimateId);
  const ctx = await getEstimateContext(estimateId);
  revalidateEstimatePaths(ctx.projectId, estimateId, ctx.leadId);
  return { error: null };
}

export async function reorderLineItems(
  estimateId: string,
  items: { id: string; sort_order: number }[]
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Not authenticated" };

  for (const item of items) {
    const { error } = await supabase
      .from("estimate_line_items")
      .update({ sort_order: item.sort_order })
      .eq("id", item.id);

    if (error) return { error: error.message };
  }

  const ctx = await getEstimateContext(estimateId);
  revalidateEstimatePaths(ctx.projectId, estimateId, ctx.leadId);
  return { error: null };
}
