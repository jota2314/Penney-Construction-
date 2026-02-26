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
    .select("total_price")
    .eq("estimate_id", estimateId);

  const total = (items ?? []).reduce((sum, i) => sum + (i.total_price ?? 0), 0);

  await supabase
    .from("estimates")
    .update({ total_cost: total, total_price: total })
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
  input: EstimateInput & { projectId?: string; leadId?: string }
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

  revalidateEstimatePaths(projectId || null, data.id, leadId);
  return { error: null, id: data.id };
}

export async function createEstimateFromTemplate(
  input: EstimateInput & { projectId?: string; leadId?: string },
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
