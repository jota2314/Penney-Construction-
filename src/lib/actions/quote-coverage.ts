"use server";

import { createClient } from "@/lib/supabase/server";

export interface QuoteCoverageLine {
  line_item_id: string;
  description: string;
  trade: string;
  budgeted_cost: number;
  client_price: number;
  sort_order: number;
  needs_sub_quote: boolean;
  quotes: {
    id: string;
    subcontractor_name: string;
    amount: number | null;
    status: string;
    scope_description: string | null;
  }[];
  quote_count: number;
  average_quote: number;
  budget_vs_average: number;
  coverage: "none" | "single" | "covered" | "internal";
  approved_quote_id: string | null;
  approved_amount: number | null;
  scope_text: string | null;
}

export async function getQuoteCoverage(projectId: string): Promise<{ lines: QuoteCoverageLine[]; estimateId: string | null }> {
  const supabase = await createClient();

  // Find latest estimate
  const { data: estimates } = await supabase
    .from("estimates")
    .select("id")
    .eq("project_id", projectId)
    .in("status", ["approved", "draft"])
    .order("version", { ascending: false })
    .limit(1);

  const estimateId = estimates?.[0]?.id || null;
  if (!estimateId) return { lines: [], estimateId: null };

  const [{ data: lineItems }, { data: quotes }] = await Promise.all([
    supabase
      .from("estimate_line_items")
      .select("id, description, trade, total_cost, cost, client_price, total_price, sort_order, needs_sub_quote, scope_text, proposal_description")
      .eq("estimate_id", estimateId)
      .order("sort_order"),
    supabase
      .from("quote_requests")
      .select("id, subcontractor_name, trade, amount, status, scope_description, estimate_line_item_id")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false }),
  ]);

  if (!lineItems?.length) return { lines: [], estimateId };

  const allQuotes = quotes || [];

  const lines: QuoteCoverageLine[] = lineItems.map((li) => {
    const trade = li.trade || "General";
    // Active columns (cost/client_price) win over the legacy total_* mirrors
    const budgetedCost = Number(li.cost ?? li.total_cost ?? 0);
    const clientPrice = Number(li.client_price ?? li.total_price ?? 0);
    const needsSub = li.needs_sub_quote !== false; // default true if null

    // Only match directly linked quotes
    const linkedQuotes = allQuotes.filter((q) => q.estimate_line_item_id === li.id);
    const quotesWithAmounts = linkedQuotes.filter((q) => q.amount && Number(q.amount) > 0);
    const avgQuote = quotesWithAmounts.length > 0
      ? quotesWithAmounts.reduce((sum, q) => sum + Number(q.amount), 0) / quotesWithAmounts.length
      : 0;
    const approved = linkedQuotes.find((q) => q.status === "approved");

    let coverage: "none" | "single" | "covered" | "internal";
    if (!needsSub) {
      coverage = "internal";
    } else if (quotesWithAmounts.length >= 2) {
      coverage = "covered";
    } else if (quotesWithAmounts.length === 1) {
      coverage = "single";
    } else {
      coverage = "none";
    }

    return {
      line_item_id: li.id,
      description: li.description,
      trade,
      budgeted_cost: budgetedCost,
      client_price: clientPrice,
      sort_order: li.sort_order,
      needs_sub_quote: needsSub,
      quotes: linkedQuotes.map((q) => ({
        id: q.id,
        subcontractor_name: q.subcontractor_name,
        amount: q.amount ? Number(q.amount) : null,
        status: q.status,
        scope_description: q.scope_description,
      })),
      quote_count: quotesWithAmounts.length,
      average_quote: Math.round(avgQuote),
      budget_vs_average: avgQuote > 0 ? Math.round(budgetedCost - avgQuote) : 0,
      coverage,
      approved_quote_id: approved?.id || null,
      approved_amount: approved?.amount ? Number(approved.amount) : null,
      scope_text: li.scope_text || li.proposal_description || null,
    };
  });

  return { lines, estimateId };
}
