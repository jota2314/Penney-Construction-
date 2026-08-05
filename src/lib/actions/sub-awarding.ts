"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { normalizeTradeKey } from "@/lib/trade-key";
import { resolveSubcontractorId } from "@/lib/subs/resolve-subcontractor";
import type { QuoteRequest } from "@/types/database";

// Server actions behind the project Subs tab: quick manual quote entry,
// one-tap awarding per trade, and per-trade budget overrides.

interface QuickAddQuoteInput {
  projectId: string;
  projectName: string;
  subcontractorName: string;
  subcontractorId?: string | null;
  trade?: string | null;
  amount?: number | null;
  scopeDescription?: string | null;
  notes?: string | null;
}

export async function quickAddQuote(input: QuickAddQuoteInput) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated", quote: null };

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("quote_requests")
    .insert({
      project_id: input.projectId,
      project_name: input.projectName,
      subcontractor_name: input.subcontractorName.trim(),
      subcontractor_id:
        input.subcontractorId ||
        (await resolveSubcontractorId(supabase, input.subcontractorName)),
      trade: input.trade?.trim() || null,
      amount: input.amount ?? null,
      scope_description: input.scopeDescription?.trim() || null,
      notes: input.notes?.trim() || null,
      status: "received",
      sent_at: now,
      received_at: now,
      created_by: user.id,
    })
    .select("*")
    .single();

  if (error) return { error: error.message, quote: null };

  revalidatePath(`/projects/${input.projectId}`);
  return { error: null, quote: data as QuoteRequest };
}

/**
 * Award a quote: the sub wins this trade. Marks the quote `accepted`,
 * optionally declines the competing quotes for the same trade, and records
 * the sub's contract amount on project_subcontractors when the quote is
 * linked to a directory sub. "Approve as Bill" (status `approved`) stays a
 * separate, later step — that's when the invoice actually lands.
 */
export async function awardQuote(quoteId: string, declineOthers: boolean) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated", declinedIds: [] };

  const { data: quote } = await supabase
    .from("quote_requests")
    .select("id, project_id, trade, subcontractor_id, amount, received_at")
    .eq("id", quoteId)
    .single();
  if (!quote) return { error: "Quote not found", declinedIds: [] };

  const updates: Record<string, unknown> = { status: "accepted" };
  if (!quote.received_at) updates.received_at = new Date().toISOString();
  const { error } = await supabase
    .from("quote_requests")
    .update(updates)
    .eq("id", quoteId);
  if (error) return { error: error.message, declinedIds: [] };

  // Decline the losing quotes for the same trade (trades are free text, so
  // match on the normalized key in JS rather than raw equality in SQL).
  let declinedIds: string[] = [];
  if (declineOthers && quote.project_id && quote.trade) {
    const tradeKey = normalizeTradeKey(quote.trade);
    const { data: rivals } = await supabase
      .from("quote_requests")
      .select("id, trade, status")
      .eq("project_id", quote.project_id)
      .neq("id", quoteId)
      .in("status", ["just_sent", "awaiting_reply", "received", "in_progress"]);
    declinedIds = (rivals ?? [])
      .filter((r) => normalizeTradeKey(r.trade) === tradeKey)
      .map((r) => r.id);
    if (declinedIds.length > 0) {
      await supabase
        .from("quote_requests")
        .update({ status: "declined" })
        .in("id", declinedIds);
    }
  }

  if (quote.project_id && quote.subcontractor_id && quote.amount) {
    await supabase.from("project_subcontractors").upsert(
      {
        project_id: quote.project_id,
        subcontractor_id: quote.subcontractor_id,
        contract_amount: quote.amount,
      },
      { onConflict: "project_id,subcontractor_id" }
    );
  }

  if (quote.project_id) revalidatePath(`/projects/${quote.project_id}`);
  return { error: null, declinedIds };
}

export async function unawardQuote(quoteId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { data: quote } = await supabase
    .from("quote_requests")
    .select("id, project_id")
    .eq("id", quoteId)
    .single();
  if (!quote) return { error: "Quote not found" };

  const { error } = await supabase
    .from("quote_requests")
    .update({ status: "received" })
    .eq("id", quoteId);
  if (error) return { error: error.message };

  if (quote.project_id) revalidatePath(`/projects/${quote.project_id}`);
  return { error: null };
}

/** Reopen a declined quote so it can compete again. */
export async function reopenQuote(quoteId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { data: quote } = await supabase
    .from("quote_requests")
    .select("id, project_id")
    .eq("id", quoteId)
    .single();
  if (!quote) return { error: "Quote not found" };

  const { error } = await supabase
    .from("quote_requests")
    .update({ status: "received" })
    .eq("id", quoteId);
  if (error) return { error: error.message };

  if (quote.project_id) revalidatePath(`/projects/${quote.project_id}`);
  return { error: null };
}

/**
 * Set the PM's budget for a trade on this project. Pass null to clear the
 * override (the tab falls back to the estimate-derived number). `trade`
 * must already be a normalized key (see normalizeTradeKey).
 */
export async function setTradeBudget(
  projectId: string,
  trade: string,
  amount: number | null
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const tradeKey = normalizeTradeKey(trade);
  if (!tradeKey) return { error: "Trade is required" };

  if (amount == null) {
    const { error } = await supabase
      .from("project_trade_budgets")
      .delete()
      .eq("project_id", projectId)
      .eq("trade", tradeKey);
    if (error) return { error: error.message };
  } else {
    const { error } = await supabase.from("project_trade_budgets").upsert(
      {
        project_id: projectId,
        trade: tradeKey,
        budget_amount: amount,
        created_by: user.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "project_id,trade" }
    );
    if (error) return { error: error.message };
  }

  revalidatePath(`/projects/${projectId}`);
  return { error: null };
}

/** Delete a quote (manual mis-entries). Approved quotes are committed bills — blocked. */
export async function deleteQuoteRequest(quoteId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { data: quote } = await supabase
    .from("quote_requests")
    .select("id, project_id, status")
    .eq("id", quoteId)
    .single();
  if (!quote) return { error: "Quote not found" };
  if (quote.status === "approved") {
    return { error: "This quote is an approved bill — uncommit it on the Finances tab first." };
  }

  const { error } = await supabase.from("quote_requests").delete().eq("id", quoteId);
  if (error) return { error: error.message };

  if (quote.project_id) revalidatePath(`/projects/${quote.project_id}`);
  return { error: null };
}
