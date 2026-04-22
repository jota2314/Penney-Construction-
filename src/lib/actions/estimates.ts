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
    total_cost?: number;
    markup_percentage?: number;
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
    const totalPrice = item.total_price || 0;
    const totalCost = item.total_cost ?? totalPrice;
    const markupPct = item.markup_percentage ?? (totalCost > 0 ? Math.round(((totalPrice / totalCost) - 1) * 100) : 0);
    const unitCost = item.unit_cost || (totalCost / qty);
    return {
      estimate_id: estimateId,
      description: item.description,
      proposal_description: item.proposal_description || null,
      quantity: qty,
      unit: item.unit || "LS",
      unit_cost: unitCost,
      total_cost: totalCost,
      markup_percentage: markupPct,
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

// ── Estimating Hub Data ──────────────────────────────────

import { OVERHEAD_PCT } from "@/lib/constants/overhead";

export interface EstimatingHubData {
  pipeline: {
    totalValue: number; totalCost: number; totalProfit: number; avgMargin: number; count: number;
    // Split open (still chasing) vs won (signed / approved) so the KPI isn't misleading.
    openValue: number; openCount: number;
    wonValue: number; wonCount: number;
    overhead: number;     // OVERHEAD_PCT * totalValue
    netProfit: number;    // totalProfit - overhead
    netMargin: number;    // netProfit / totalValue
  };
  performance: {
    closeRate: number;        // won / (won + lost) projects, null if no data
    closeRateWon: number;
    closeRateLost: number;
    avgCycleDays: number | null;  // days from estimate.created_at to reviewed_at on approvals
  };
  tradeBreakdown: { trade: string; cost: number; price: number; profit: number }[];
  profitByProject: { name: string; projectNumber: string; profit: number; contract: number; margin: number }[];
  recentEstimates: {
    id: string; name: string; status: string; total_price: number; total_cost: number;
    total_profit: number; markup_pct: number; projectName: string; projectNumber: string;
    projectId: string; updated_at: string;
  }[];
  bidStats: { active: number; awaiting: number; needsAward: number };
}

export async function getEstimatingHubData(): Promise<EstimatingHubData> {
  const supabase = await createClient();

  // Scope the dashboard to this calendar year so old estimates (LaPointe,
  // Merluzzi, Addis Ababa Kitchen, etc.) don't inflate the KPIs. Change
  // this to a user-selectable year later.
  const yearStart = new Date(new Date().getFullYear(), 0, 1).toISOString();

  // Get all active estimates with project info
  const { data: estimates } = await supabase
    .from("estimates")
    .select(`
      id, name, status, total_price, total_cost, total_profit, markup_pct, updated_at, created_at, reviewed_at,
      projects ( id, name, project_number, status )
    `)
    .in("status", ["draft", "review", "approved"])
    .gte("created_at", yearStart)
    .order("updated_at", { ascending: false });

  const activeEstimates = estimates ?? [];

  // Open vs Won is driven by the PROJECT status (source of truth, matches
  // the filter pills on the projects page):
  //   Open   = lead / estimating / waiting_for_approval         → still chasing
  //   Won    = proposal_sent / contracted / in_progress          → signed or about to sign
  //   Ignored = completed / cancelled                            → historical, not current pipeline
  const projStatusOf = (e: { projects: unknown }): string => {
    const proj = (Array.isArray(e.projects) ? e.projects[0] : e.projects) as { status?: string } | null;
    return proj?.status || "";
  };
  const OPEN_PROJECT_STATUSES = new Set(["lead", "estimating", "waiting_for_approval"]);
  const WON_PROJECT_STATUSES = new Set(["proposal_sent", "contracted", "in_progress"]);
  const openEstimates = activeEstimates.filter(e => OPEN_PROJECT_STATUSES.has(projStatusOf(e)));
  const wonEstimates = activeEstimates.filter(e => WON_PROJECT_STATUSES.has(projStatusOf(e)));

  // Current pipeline = open + won. Completed/cancelled are ignored across
  // the dashboard so historical jobs don't skew KPIs, trade breakdown, or
  // profit-by-project charts.
  const currentEstimates = [...openEstimates, ...wonEstimates];

  const totalValue = currentEstimates.reduce((s, e) => s + (e.total_price || 0), 0);
  const totalCost = currentEstimates.reduce((s, e) => s + (e.total_cost || 0), 0);
  const totalProfit = totalValue - totalCost;
  const avgMargin = totalValue > 0 ? (totalProfit / totalValue) * 100 : 0;

  const openValue = openEstimates.reduce((s, e) => s + (e.total_price || 0), 0);
  const wonValue = wonEstimates.reduce((s, e) => s + (e.total_price || 0), 0);
  const overhead = totalValue * OVERHEAD_PCT;
  const netProfit = totalProfit - overhead;
  const netMargin = totalValue > 0 ? (netProfit / totalValue) * 100 : 0;

  // Get all line items for trade breakdown
  const estimateIds = currentEstimates.map((e) => e.id);
  let lineItems: { trade: string | null; total_cost: number | null; total_price: number | null }[] = [];
  if (estimateIds.length > 0) {
    const { data } = await supabase
      .from("estimate_line_items")
      .select("trade, total_cost, total_price")
      .in("estimate_id", estimateIds);
    lineItems = data ?? [];
  }

  // Aggregate by trade
  const tradeMap = new Map<string, { cost: number; price: number }>();
  for (const li of lineItems) {
    const trade = li.trade || "General";
    const existing = tradeMap.get(trade) || { cost: 0, price: 0 };
    existing.cost += li.total_cost || 0;
    existing.price += li.total_price || 0;
    tradeMap.set(trade, existing);
  }
  const tradeBreakdown = Array.from(tradeMap.entries())
    .map(([trade, { cost, price }]) => ({ trade, cost, price, profit: price - cost }))
    .sort((a, b) => b.price - a.price)
    .slice(0, 10);

  // Profit by project
  const projectMap = new Map<string, { name: string; projectNumber: string; profit: number; contract: number }>();
  for (const e of currentEstimates) {
    const proj = (Array.isArray(e.projects) ? e.projects[0] : e.projects) as { id: string; name: string; project_number: string } | null;
    if (!proj) continue;
    const existing = projectMap.get(proj.id) || { name: proj.name, projectNumber: proj.project_number || "", profit: 0, contract: 0 };
    existing.profit += e.total_profit || 0;
    existing.contract += e.total_price || 0;
    projectMap.set(proj.id, existing);
  }
  const profitByProject = Array.from(projectMap.values())
    .map((p) => ({ ...p, margin: p.contract > 0 ? (p.profit / p.contract) * 100 : 0 }))
    .sort((a, b) => b.contract - a.contract)
    .slice(0, 8);

  // Recent estimates
  const recentEstimates = currentEstimates.slice(0, 10).map((e) => {
    const proj = (Array.isArray(e.projects) ? e.projects[0] : e.projects) as { id: string; name: string; project_number: string } | null;
    return {
      id: e.id, name: e.name, status: e.status,
      total_price: e.total_price || 0, total_cost: e.total_cost || 0,
      total_profit: e.total_profit || 0, markup_pct: e.markup_pct || 0,
      projectName: proj?.name || "", projectNumber: proj?.project_number || "",
      projectId: proj?.id || "", updated_at: e.updated_at,
    };
  });

  // Bid stats
  const { data: bidPkgs } = await supabase
    .from("bid_packages").select("id, status").in("status", ["sent", "receiving"]);
  const { data: openBids } = await supabase
    .from("subcontractor_bids").select("id").eq("status", "invited");

  // Close rate + cycle time. Close rate pulls from projects because
  // "cancelled" lives on projects, not estimates. "Won" = we got the job,
  // "lost" = client passed.
  const { data: projectOutcomes } = await supabase
    .from("projects")
    .select("status")
    .in("status", ["contracted", "in_progress", "completed", "cancelled"])
    .gte("created_at", yearStart);
  const wonCount = (projectOutcomes ?? []).filter(p => p.status !== "cancelled").length;
  const lostCount = (projectOutcomes ?? []).filter(p => p.status === "cancelled").length;
  const closeRate = (wonCount + lostCount) > 0 ? (wonCount / (wonCount + lostCount)) * 100 : 0;

  // Average days from estimate created to reviewed (only approved ones).
  const cycleSamples = activeEstimates
    .filter(e => e.status === "approved" && e.reviewed_at && e.created_at)
    .map(e => (new Date(e.reviewed_at!).getTime() - new Date(e.created_at!).getTime()) / 86400000);
  const avgCycleDays = cycleSamples.length > 0
    ? cycleSamples.reduce((a, b) => a + b, 0) / cycleSamples.length
    : null;

  return {
    pipeline: {
      totalValue, totalCost, totalProfit, avgMargin, count: currentEstimates.length,
      openValue, openCount: openEstimates.length,
      wonValue, wonCount: wonEstimates.length,
      overhead, netProfit, netMargin,
    },
    performance: {
      closeRate,
      closeRateWon: wonCount,
      closeRateLost: lostCount,
      avgCycleDays,
    },
    tradeBreakdown, profitByProject, recentEstimates,
    bidStats: { active: bidPkgs?.length ?? 0, awaiting: openBids?.length ?? 0, needsAward: bidPkgs?.filter((p) => p.status === "receiving").length ?? 0 },
  };
}
