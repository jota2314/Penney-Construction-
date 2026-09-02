"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { lineItemFinancials } from "@/lib/estimates/line-item-financials";
import {
  checklistFor,
  checklistLineMarker,
  type ChecklistAnswer,
  type ChecklistAnswers,
} from "@/lib/constants/walkthrough-checklist";

/** Markup on allowance lines. Sub-$50K policy: hard lines 40%, allowances 20%. */
const ALLOWANCE_MARKUP_PCT = 20;

export async function saveWalkthroughChecklist(
  walkthroughId: string,
  answers: ChecklistAnswers
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { error } = await supabase
    .from("walkthroughs")
    .update({ checklist: answers, updated_at: new Date().toISOString() })
    .eq("id", walkthroughId);
  if (error) return { error: error.message };

  revalidatePath(`/walkthroughs/${walkthroughId}`);
  return { error: null };
}

/**
 * Turn every trigger answered "no" (condition does NOT hold) or left unknown
 * into an allowance line on the linked estimate. Idempotent: a line already
 * carrying the checklist marker is skipped.
 */
export async function applyChecklistAllowances(walkthroughId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated", added: 0 };

  const { data: wt, error: wtErr } = await supabase
    .from("walkthroughs")
    .select("id, estimate_id, project_id, checklist")
    .eq("id", walkthroughId)
    .single();
  if (wtErr || !wt) return { error: wtErr?.message ?? "Walkthrough not found", added: 0 };

  // Resolve the estimate: linked one, else the project's latest live version.
  let estimateId: string | null = wt.estimate_id;
  let projectId: string | null = wt.project_id;
  if (!estimateId && projectId) {
    const { data: est } = await supabase
      .from("estimates")
      .select("id")
      .eq("project_id", projectId)
      .not("status", "in", '("superseded","rejected")')
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    estimateId = est?.id ?? null;
  }
  if (!estimateId) return { error: "No estimate linked to this walkthrough or its project", added: 0 };
  if (!projectId) {
    const { data: est } = await supabase.from("estimates").select("project_id").eq("id", estimateId).single();
    projectId = est?.project_id ?? null;
  }

  let projectType: string | null = null;
  if (projectId) {
    const { data: p } = await supabase.from("projects").select("project_type").eq("id", projectId).single();
    projectType = p?.project_type ?? null;
  }

  const answers = (wt.checklist ?? {}) as ChecklistAnswers;
  const questions = checklistFor(projectType).filter((q) => q.kind === "trigger" && q.allowance);

  const { data: existing } = await supabase
    .from("estimate_line_items")
    .select("id, notes, sort_order")
    .eq("estimate_id", estimateId);
  const existingNotes = (existing ?? []).map((l) => l.notes ?? "").join("\n");
  let nextSort = (existing ?? []).reduce((m, l) => Math.max(m, l.sort_order ?? 0), 0) + 1;

  const codes = questions.map((q) => q.allowance?.rateCode).filter((c): c is string => !!c);
  const rateByCode = new Map<string, number>();
  if (codes.length > 0) {
    const { data: rates } = await supabase
      .from("sub_unit_rates")
      .select("code, rate")
      .in("code", codes)
      .neq("status", "expired");
    for (const r of rates ?? []) rateByCode.set(r.code, Number(r.rate));
  }

  const rows = [];
  for (const q of questions) {
    const a: ChecklistAnswer | undefined = answers[q.key]?.answer;
    // "yes" means the safe condition holds → nothing to carry.
    if (a === "yes") continue;
    const marker = checklistLineMarker(q.key);
    if (existingNotes.includes(marker)) continue;
    const al = q.allowance!;
    const cost = al.rateCode && rateByCode.has(al.rateCode) ? rateByCode.get(al.rateCode)! : al.defaultCost;
    const price = Math.round(cost * (1 + ALLOWANCE_MARKUP_PCT / 100));
    const why = a === "no" ? "walkthrough found this condition" : "not confirmed on the walkthrough";
    const note = answers[q.key]?.note ? ` Note: ${answers[q.key]?.note}` : "";
    rows.push({
      estimate_id: estimateId,
      description: `Allowance — ${al.item}`,
      proposal_description: al.proposal,
      quantity: 1,
      unit: "LS",
      unit_cost: cost,
      ...lineItemFinancials(cost, ALLOWANCE_MARKUP_PCT, price),
      is_visible_on_proposal: true,
      is_allowance: true,
      needs_sub_quote: true,
      trade: q.trade === "general" || q.trade === "structural" ? null : q.trade,
      section: "Allowances",
      sort_order: nextSort++,
      notes: `${marker} "${q.label}" — ${why}.${note} Cost from ${al.rateCode && rateByCode.has(al.rateCode) ? `sub unit rate ${al.rateCode}` : "checklist default"}.`,
      source: "manual",
    });
  }

  if (rows.length === 0) return { error: null, added: 0, estimateId, projectId };

  const { error: insErr } = await supabase.from("estimate_line_items").insert(rows);
  if (insErr) return { error: insErr.message, added: 0 };

  // Keep estimate totals in step (mirrors recalculateEstimateTotals in estimates.ts).
  const { data: items } = await supabase
    .from("estimate_line_items")
    .select("cost, client_price, total_cost, total_price, is_section_header")
    .eq("estimate_id", estimateId);
  const lines = (items ?? []).filter((i) => !i.is_section_header);
  const totalCost = lines.reduce((s, i) => s + Number(i.cost ?? i.total_cost ?? 0), 0);
  const totalPrice = lines.reduce((s, i) => s + Number(i.client_price ?? i.total_price ?? 0), 0);
  const avgMarkup = totalCost > 0 ? ((totalPrice - totalCost) / totalCost) * 100 : 0;
  await supabase
    .from("estimates")
    .update({
      total_cost: totalCost,
      total_price: totalPrice,
      total_profit: totalPrice - totalCost,
      markup_pct: Math.min(Math.max(Math.round(avgMarkup * 100) / 100, -999.99), 999.99),
    })
    .eq("id", estimateId);

  revalidatePath(`/walkthroughs/${walkthroughId}`);
  revalidatePath(`/estimates/${estimateId}`);
  if (projectId) {
    revalidatePath(`/projects/${projectId}`);
    revalidatePath(`/projects/${projectId}/estimates/${estimateId}`);
  }
  return { error: null, added: rows.length, estimateId, projectId };
}

/** Merged checklist answers across every walkthrough on a project (latest wins). */
export async function getProjectChecklistAnswers(projectId: string, estimateId?: string) {
  const supabase = await createClient();
  const q = supabase
    .from("walkthroughs")
    .select("checklist, updated_at, estimate_id, project_id")
    .order("updated_at", { ascending: true });
  const { data } = estimateId
    ? await q.or(`project_id.eq.${projectId},estimate_id.eq.${estimateId}`)
    : await q.eq("project_id", projectId);
  const merged: ChecklistAnswers = {};
  for (const w of data ?? []) Object.assign(merged, (w.checklist ?? {}) as ChecklistAnswers);
  return merged;
}
