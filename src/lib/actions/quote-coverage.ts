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
    document_type: string;
    created_at: string;
  }[];
  quote_count: number;
  average_quote: number;
  budget_vs_average: number; // positive = budget has buffer, negative = budget is under
  coverage: "none" | "single" | "covered"; // 0, 1, 2+
  approved_quote_id: string | null;
  approved_amount: number | null;
}

export async function getQuoteCoverage(projectId: string, estimateId: string): Promise<QuoteCoverageLine[]> {
  const supabase = await createClient();

  // Load estimate lines and project quotes in parallel
  const [{ data: lineItems }, { data: quotes }] = await Promise.all([
    supabase
      .from("estimate_line_items")
      .select("id, description, trade, total_cost, cost, client_price, total_price, sort_order")
      .eq("estimate_id", estimateId)
      .order("sort_order"),
    supabase
      .from("quote_requests")
      .select("id, subcontractor_name, trade, amount, status, scope_description, document_type, created_at")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false }),
  ]);

  if (!lineItems?.length) return [];

  const allQuotes = quotes || [];

  // Build trade normalization map
  const normalize = (t: string) => t.toLowerCase().replace(/[^a-z]/g, "");

  // Trade alias map for fuzzy matching
  const aliases: Record<string, string[]> = {
    "electrical": ["electric", "electrical", "mtp"],
    "plumbing": ["plumbing", "plumber", "heating"],
    "hvac": ["hvac", "heating", "cooling", "ac", "airconditioning"],
    "framing": ["framing", "lumber", "carpentry", "structural"],
    "demo": ["demo", "demolition", "excavation"],
    "concrete": ["concrete", "foundation", "sitework", "site"],
    "tile": ["tile", "tiling"],
    "paint": ["paint", "painting"],
    "plaster": ["plaster", "blueboard", "drywall"],
    "insulation": ["insulation", "firestopping", "sprayfoam"],
    "roofing": ["roofing", "roof", "shingles"],
    "siding": ["siding", "exterior"],
    "flooring": ["flooring", "hardwood", "lvp", "floor"],
    "materials": ["materials", "lumber", "windows", "doors", "garagedoors", "garage"],
    "carpentry": ["carpentry", "finish", "trim", "cabinets"],
  };

  function tradesMatch(lineTrade: string, quoteTrade: string): boolean {
    const lt = normalize(lineTrade);
    const qt = normalize(quoteTrade);

    // Direct match
    if (lt === qt) return true;
    if (lt.includes(qt) || qt.includes(lt)) return true;

    // Alias match
    for (const [, group] of Object.entries(aliases)) {
      const ltIn = group.some((a) => lt.includes(a));
      const qtIn = group.some((a) => qt.includes(a));
      if (ltIn && qtIn) return true;
    }

    return false;
  }

  // Match quotes to line items by trade
  const result: QuoteCoverageLine[] = lineItems.map((li) => {
    const trade = li.trade || "General";
    const budgetedCost = Number(li.total_cost || li.cost || 0);
    const clientPrice = Number(li.client_price || li.total_price || 0);

    // Find matching quotes by trade
    const matchedQuotes = allQuotes.filter((q) => {
      if (!q.trade) return false;
      return tradesMatch(trade, q.trade);
    });

    // Calculate average of quotes that have amounts
    const quotesWithAmounts = matchedQuotes.filter((q) => q.amount && Number(q.amount) > 0);
    const avgQuote = quotesWithAmounts.length > 0
      ? quotesWithAmounts.reduce((sum, q) => sum + Number(q.amount), 0) / quotesWithAmounts.length
      : 0;

    // Find approved quote
    const approved = matchedQuotes.find((q) => q.status === "approved");

    return {
      line_item_id: li.id,
      description: li.description,
      trade,
      budgeted_cost: budgetedCost,
      client_price: clientPrice,
      sort_order: li.sort_order,
      quotes: matchedQuotes.map((q) => ({
        id: q.id,
        subcontractor_name: q.subcontractor_name,
        amount: q.amount ? Number(q.amount) : null,
        status: q.status,
        scope_description: q.scope_description,
        document_type: q.document_type,
        created_at: q.created_at,
      })),
      quote_count: quotesWithAmounts.length,
      average_quote: Math.round(avgQuote),
      budget_vs_average: avgQuote > 0 ? Math.round(budgetedCost - avgQuote) : 0,
      coverage: quotesWithAmounts.length === 0 ? "none" : quotesWithAmounts.length === 1 ? "single" : "covered",
      approved_quote_id: approved?.id || null,
      approved_amount: approved?.amount ? Number(approved.amount) : null,
    };
  });

  return result;
}
