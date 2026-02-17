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
}

// ── Helpers ────────────────────────────────────────────

async function recalculateEstimateTotals(estimateId: string) {
  const supabase = await createClient();

  const { data: items } = await supabase
    .from("estimate_line_items")
    .select("total_price")
    .eq("estimate_id", estimateId);

  const total = (items ?? []).reduce((sum, i) => sum + (i.total_price ?? 0), 0);

  await supabase
    .from("estimates")
    .update({ total_cost: total, total_price: total })
    .eq("id", estimateId);
}

function revalidateEstimatePaths(projectId: string, estimateId?: string) {
  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/estimates");
  if (estimateId) {
    revalidatePath(`/projects/${projectId}/estimates/${estimateId}`);
  }
}

// ── Estimate CRUD ──────────────────────────────────────

export async function createEstimate(projectId: string, input: EstimateInput) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Not authenticated" };

  // Auto-increment version per project
  const { data: existing } = await supabase
    .from("estimates")
    .select("version")
    .eq("project_id", projectId)
    .order("version", { ascending: false })
    .limit(1);

  const nextVersion = existing && existing.length > 0 ? existing[0].version + 1 : 1;

  const { data, error } = await supabase
    .from("estimates")
    .insert({
      project_id: projectId,
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

  revalidateEstimatePaths(projectId);
  return { error: null, id: data.id };
}

export async function createEstimateFromTemplate(
  projectId: string,
  input: EstimateInput,
  templateKey: string
) {
  const result = await createEstimate(projectId, input);
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

  revalidateEstimatePaths(projectId, result.id!);
  return result;
}

export async function updateEstimate(
  estimateId: string,
  projectId: string,
  input: EstimateInput
) {
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

  revalidateEstimatePaths(projectId, estimateId);
  return { error: null };
}

export async function deleteEstimate(estimateId: string, projectId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Not authenticated" };

  // Delete line items first
  await supabase
    .from("estimate_line_items")
    .delete()
    .eq("estimate_id", estimateId);

  const { error } = await supabase
    .from("estimates")
    .delete()
    .eq("id", estimateId);

  if (error) return { error: error.message };

  revalidateEstimatePaths(projectId);
  return { error: null };
}

// ── Line Item CRUD ─────────────────────────────────────

export async function addLineItem(
  estimateId: string,
  projectId: string,
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
  revalidateEstimatePaths(projectId, estimateId);
  return { error: null };
}

export async function updateLineItem(
  lineItemId: string,
  estimateId: string,
  projectId: string,
  input: SimpleLineItemInput
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Not authenticated" };

  const value = input.value || 0;

  const { error } = await supabase
    .from("estimate_line_items")
    .update({
      description: input.description,
      proposal_description: input.proposal_description || null,
      quantity: 1,
      unit: "LS",
      unit_cost: value,
      total_cost: value,
      markup_percentage: 0,
      total_price: value,
      is_visible_on_proposal: true,
    })
    .eq("id", lineItemId);

  if (error) return { error: error.message };

  await recalculateEstimateTotals(estimateId);
  revalidateEstimatePaths(projectId, estimateId);
  return { error: null };
}

export async function deleteLineItem(
  lineItemId: string,
  estimateId: string,
  projectId: string
) {
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
  revalidateEstimatePaths(projectId, estimateId);
  return { error: null };
}

export async function bulkCreateLineItems(
  estimateId: string,
  projectId: string,
  items: { description: string; proposal_description?: string; total_price: number }[],
  mode: "replace" | "append"
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Not authenticated" };

  let startOrder = 0;

  if (mode === "replace") {
    // Delete all existing line items
    await supabase
      .from("estimate_line_items")
      .delete()
      .eq("estimate_id", estimateId);
  } else {
    // Append: find max sort_order
    const { data: existing } = await supabase
      .from("estimate_line_items")
      .select("sort_order")
      .eq("estimate_id", estimateId)
      .order("sort_order", { ascending: false })
      .limit(1);

    startOrder = existing && existing.length > 0 ? existing[0].sort_order + 1 : 0;
  }

  const rows = items.map((item, index) => ({
    estimate_id: estimateId,
    description: item.description,
    proposal_description: item.proposal_description || null,
    quantity: 1,
    unit: "LS",
    unit_cost: item.total_price || 0,
    total_cost: item.total_price || 0,
    markup_percentage: 0,
    total_price: item.total_price || 0,
    is_visible_on_proposal: true,
    notes: null,
    sort_order: startOrder + index,
  }));

  if (rows.length > 0) {
    const { error } = await supabase.from("estimate_line_items").insert(rows);
    if (error) return { error: error.message };
  }

  await recalculateEstimateTotals(estimateId);
  revalidateEstimatePaths(projectId, estimateId);
  return { error: null };
}

export async function reorderLineItems(
  estimateId: string,
  projectId: string,
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

  revalidateEstimatePaths(projectId, estimateId);
  return { error: null };
}
