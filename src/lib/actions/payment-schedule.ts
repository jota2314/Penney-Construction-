"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createClientInvoice } from "@/lib/actions/invoices";
import { PAYMENT_PRESETS } from "@/lib/constants/payment-schedule";

export interface PaymentMilestoneInput {
  label: string;
  stage_key?: string;
  percent?: number | null;
  amount?: number | null;
}

export async function addPaymentMilestone(projectId: string, input: PaymentMilestoneInput) {
  const supabase = await createClient();

  const { data: last } = await supabase
    .from("project_payment_milestones")
    .select("sort_order")
    .eq("project_id", projectId)
    .order("sort_order", { ascending: false })
    .limit(1);

  const { error } = await supabase.from("project_payment_milestones").insert({
    project_id: projectId,
    sort_order: (last?.[0]?.sort_order ?? 0) + 10,
    label: input.label,
    stage_key: input.stage_key ?? "custom",
    percent: input.percent ?? null,
    amount: input.amount ?? null,
  });

  if (error) return { error: error.message };
  revalidatePath(`/projects/${projectId}`);
  return { error: null };
}

export async function updatePaymentMilestone(
  milestoneId: string,
  projectId: string,
  patch: Partial<PaymentMilestoneInput> & { status?: string }
) {
  const supabase = await createClient();

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.label !== undefined) update.label = patch.label;
  if (patch.stage_key !== undefined) update.stage_key = patch.stage_key;
  if (patch.percent !== undefined) update.percent = patch.percent;
  if (patch.amount !== undefined) update.amount = patch.amount;
  if (patch.status !== undefined) update.status = patch.status;

  const { error } = await supabase
    .from("project_payment_milestones")
    .update(update)
    .eq("id", milestoneId)
    .eq("project_id", projectId);

  if (error) return { error: error.message };
  revalidatePath(`/projects/${projectId}`);
  return { error: null };
}

export async function deletePaymentMilestone(milestoneId: string, projectId: string) {
  const supabase = await createClient();

  const { error } = await supabase
    .from("project_payment_milestones")
    .delete()
    .eq("id", milestoneId)
    .eq("project_id", projectId);

  if (error) return { error: error.message };
  revalidatePath(`/projects/${projectId}`);
  return { error: null };
}

// Shared replace: wipes the current (un-invoiced) schedule and writes new
// percent-driven rows. Refuses to touch a schedule that already has invoiced
// milestones — those are linked to real client invoices.
async function replaceMilestoneRows(
  projectId: string,
  rows: { label: string; stage_key: string; percent: number }[]
) {
  const supabase = await createClient();

  const { count } = await supabase
    .from("project_payment_milestones")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId)
    .not("client_invoice_id", "is", null);
  if ((count ?? 0) > 0) {
    return { error: "Some milestones are already invoiced — adjust rows individually instead of replacing the schedule." };
  }

  const { error: delError } = await supabase
    .from("project_payment_milestones")
    .delete()
    .eq("project_id", projectId);
  if (delError) return { error: delError.message };

  const { error } = await supabase.from("project_payment_milestones").insert(
    rows.map((r, i) => ({
      project_id: projectId,
      sort_order: (i + 1) * 10,
      label: r.label,
      stage_key: r.stage_key,
      percent: r.percent,
      amount: null,
    }))
  );
  if (error) return { error: error.message };

  revalidatePath(`/projects/${projectId}`);
  return { error: null };
}

// Replaces the project's current schedule with a preset. Percent-driven —
// dollar amounts resolve against the contract value at render time, so the
// schedule stays correct if the contract value changes before signing.
export async function applyPaymentPreset(projectId: string, presetKey: string) {
  const preset = PAYMENT_PRESETS.find((p) => p.key === presetKey);
  if (!preset) return { error: `Unknown preset: ${presetKey}` };
  return replaceMilestoneRows(projectId, preset.rows);
}

// Replaces the schedule with AI-suggested (or otherwise custom) rows —
// already validated by /api/suggest-payment-schedule, re-checked here.
export async function replaceSchedule(
  projectId: string,
  rowsIn: { label: string; stage_key: string; percent: number }[]
) {
  const rows = (Array.isArray(rowsIn) ? rowsIn : [])
    .filter((r) => r && typeof r.label === "string" && r.label.trim() && Number(r.percent) > 0)
    .slice(0, 8)
    .map((r) => ({
      label: r.label.trim().slice(0, 200),
      stage_key: String(r.stage_key || "custom"),
      percent: Math.round(Number(r.percent) * 10) / 10,
    }));
  if (rows.length < 2) return { error: "Need at least two milestones" };
  return replaceMilestoneRows(projectId, rows);
}

// One-click invoice: turns a milestone into a client invoice (reusing the
// standard client-invoice pipeline incl. numbering + QuickBooks mirror),
// links it back, and marks the milestone invoiced.
export async function invoiceMilestone(projectId: string, milestoneId: string) {
  const supabase = await createClient();

  const { data: milestone, error: mErr } = await supabase
    .from("project_payment_milestones")
    .select("id, label, percent, amount, client_invoice_id")
    .eq("id", milestoneId)
    .eq("project_id", projectId)
    .single();
  if (mErr || !milestone) return { error: mErr?.message ?? "Milestone not found" };
  if (milestone.client_invoice_id) return { error: "This milestone already has an invoice" };

  // Resolve the dollar amount: fixed amount wins; percent resolves against
  // contract value → latest estimate → estimated value (same basis the
  // Finances tab displays).
  let amount = milestone.amount != null ? Number(milestone.amount) : null;
  if (amount == null) {
    const { data: project } = await supabase
      .from("projects")
      .select("contract_value, estimated_value")
      .eq("id", projectId)
      .single();
    let basis = Number(project?.contract_value ?? 0);
    if (!basis) {
      const { data: est } = await supabase
        .from("estimates")
        .select("total_price")
        .eq("project_id", projectId)
        .order("version", { ascending: false })
        .limit(1);
      basis = Number(est?.[0]?.total_price ?? 0) || Number(project?.estimated_value ?? 0);
    }
    if (!basis) return { error: "No contract value or estimate to compute the milestone amount from" };
    amount = Math.round(((basis * Number(milestone.percent ?? 0)) / 100) * 100) / 100;
  }
  if (!amount || amount <= 0) return { error: "Milestone amount is zero — set a % or $ first" };

  const result = await createClientInvoice({
    project_id: projectId,
    title: milestone.label,
    description: "Progress payment per the contract payment schedule.",
    line_items: [{ description: milestone.label, amount }],
    terms: "Due within 5 days of invoice",
  });
  if ("error" in result && result.error) return { error: result.error };
  const invoiceId = "data" in result ? result.data?.id : null;
  if (!invoiceId) return { error: "Invoice was not created" };

  const { error: linkErr } = await supabase
    .from("project_payment_milestones")
    .update({ status: "invoiced", client_invoice_id: invoiceId, updated_at: new Date().toISOString() })
    .eq("id", milestoneId)
    .eq("project_id", projectId);
  if (linkErr) return { error: linkErr.message };

  revalidatePath(`/projects/${projectId}`);
  return { error: null, invoiceId };
}
