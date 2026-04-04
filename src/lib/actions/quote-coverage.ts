"use server";

import { createClient } from "@/lib/supabase/server";

export interface QuoteCoverageLine {
  line_item_id: string;
  description: string;
  trade: string;
  budgeted_cost: number;
  client_price: number;
  sort_order: number;
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
  coverage: "none" | "single" | "covered";
  approved_quote_id: string | null;
  approved_amount: number | null;
}

export async function getQuoteCoverage(projectId: string, estimateId: string): Promise<QuoteCoverageLine[]> {
  const supabase = await createClient();

  const [{ data: lineItems }, { data: quotes }] = await Promise.all([
    supabase
      .from("estimate_line_items")
      .select("id, description, trade, total_cost, cost, client_price, total_price, sort_order")
      .eq("estimate_id", estimateId)
      .order("sort_order"),
    supabase
      .from("quote_requests")
      .select("id, subcontractor_name, trade, amount, status, scope_description, estimate_line_item_id")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false }),
  ]);

  if (!lineItems?.length) return [];

  const allQuotes = quotes || [];

  return lineItems.map((li) => {
    const trade = li.trade || "General";
    const budgetedCost = Number(li.total_cost || li.cost || 0);
    const clientPrice = Number(li.client_price || li.total_price || 0);

    // Only match quotes that are DIRECTLY linked to this estimate line
    const linkedQuotes = allQuotes.filter((q) => q.estimate_line_item_id === li.id);

    const quotesWithAmounts = linkedQuotes.filter((q) => q.amount && Number(q.amount) > 0);
    const avgQuote = quotesWithAmounts.length > 0
      ? quotesWithAmounts.reduce((sum, q) => sum + Number(q.amount), 0) / quotesWithAmounts.length
      : 0;

    const approved = linkedQuotes.find((q) => q.status === "approved");

    return {
      line_item_id: li.id,
      description: li.description,
      trade,
      budgeted_cost: budgetedCost,
      client_price: clientPrice,
      sort_order: li.sort_order,
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
      coverage: quotesWithAmounts.length === 0 ? "none" : quotesWithAmounts.length === 1 ? "single" : "covered",
      approved_quote_id: approved?.id || null,
      approved_amount: approved?.amount ? Number(approved.amount) : null,
    };
  });
}
