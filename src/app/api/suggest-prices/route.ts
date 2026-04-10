import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { callClaude, nowStamp } from "@/lib/ai/claude";
import { UNIT_LABELS } from "@/lib/constants/company";
import { getTradeRatesForAI, formatCostBookForAI } from "@/lib/actions/trade-rates";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

/** Load historical cost data from past projects for AI pricing intelligence */
async function loadHistoricalCosts(supabase: SupabaseClient): Promise<string> {
  // Get line items from completed/contracted projects that have actual invoice data
  const { data: history } = await supabase
    .from("budget_vs_actual")
    .select("description, trade, budgeted_cost, budgeted_price, actual_invoiced, percent_spent")
    .gt("budgeted_cost", 0)
    .gt("actual_invoiced", 0)
    .order("actual_invoiced", { ascending: false })
    .limit(100);

  if (!history || history.length === 0) return "";

  // Group by trade, show avg estimated vs actual
  const tradeMap = new Map<string, { items: string[]; totalEstimated: number; totalActual: number; count: number }>();

  for (const row of history) {
    const trade = row.trade || "General";
    if (!tradeMap.has(trade)) tradeMap.set(trade, { items: [], totalEstimated: 0, totalActual: 0, count: 0 });
    const group = tradeMap.get(trade)!;
    group.totalEstimated += Number(row.budgeted_cost) || 0;
    group.totalActual += Number(row.actual_invoiced) || 0;
    group.count++;
    if (group.items.length < 5) {
      const pct = Number(row.percent_spent) || 0;
      const flag = pct > 110 ? " (OVER BUDGET)" : pct < 80 ? " (under budget)" : "";
      group.items.push(`  - "${row.description}": estimated $${Math.round(Number(row.budgeted_cost))}, actual $${Math.round(Number(row.actual_invoiced))}${flag}`);
    }
  }

  const lines: string[] = [];
  for (const [trade, data] of tradeMap) {
    const accuracy = data.totalEstimated > 0
      ? Math.round((data.totalActual / data.totalEstimated) * 100)
      : 0;
    lines.push(`**${trade}** (${data.count} items, actual was ${accuracy}% of estimated):`);
    lines.push(...data.items);
  }

  return `

## HISTORICAL COST DATA — Learn From Past Projects
These are REAL costs from completed projects. Use this to calibrate your estimates.
If actual costs consistently exceeded estimates for a trade, adjust your suggestions upward.

${lines.join("\n")}
`;
}

function buildSystemPrompt(
  costBookText?: string,
  historicalCosts?: string,
) {
  return `You are a senior residential construction estimator who prices jobs for a general contractor in the northeastern United States (North Shore MA).

Given a list of line items with their scopes of work, project type, and location, suggest realistic prices.

Rules:
- Base prices on the Company Cost Book below — these are REAL prices from completed projects
- Each cost book entry shows LOW–MID–HIGH ranges. Use MID for standard scope, LOW for simple, HIGH for complex
- For per-unit items (sqft, LF), estimate the quantity from the scope text, then multiply by the rate
- For per-room items (bathroom, kitchen), match the scope to the closest cost book entry
- Cross-reference with Historical Cost Data to see if estimates were accurate in the past
- These are CLIENT SELL prices (include sub cost + 30% GC markup)
- Return a JSON object with a "prices" array
- Each entry: { "index": number, "price": number, "note": "brief reason with quantity calc" }
- index is the 0-based position in the input array
- price is the suggested dollar amount (no cents needed for estimates)
- In the "note", briefly show how you calculated: e.g. "~200 sqft × $8.50/sf LVP" or "Full bath plumbing, mid range"
- If the scope is empty or unclear, give a reasonable range-midpoint based on the item name and cost book rate
- Be realistic — residential GC prices, not retail

${costBookText || ""}
${historicalCosts || ""}`;
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const { lineItems, projectType, projectAddress } = await request.json();

    if (!Array.isArray(lineItems) || lineItems.length === 0) {
      return NextResponse.json(
        { error: "lineItems array is required" },
        { status: 400 }
      );
    }

    const itemDescriptions = lineItems
      .map(
        (item: { name: string; scope: string }, i: number) =>
          `${i}. "${item.name}" — Scope: ${item.scope || "(no scope written)"}`
      )
      .join("\n");

    const userMessage = `Project type: ${projectType || "Residential"}
Location: ${projectAddress || "Northeast US"}

Line items to price:
${itemDescriptions}

Return JSON with suggested prices for each item. Use the cost book rates and estimate quantities from the scope text.`;

    const historicalCosts = await loadHistoricalCosts(supabase);
    const rates = await getTradeRatesForAI(projectType || null);
    const costBookText = await formatCostBookForAI(rates);

    const systemPrompt = buildSystemPrompt(
      costBookText,
      historicalCosts,
    );

    const raw = await callClaude(`Current date & time: ${nowStamp()}\n\n${systemPrompt}`, userMessage, 1000);
    const result = JSON.parse(raw);

    return NextResponse.json({
      prices: Array.isArray(result.prices) ? result.prices : [],
    });
  } catch (error) {
    console.error("suggest-prices error:", error);
    return NextResponse.json(
      { error: "Failed to suggest prices" },
      { status: 500 }
    );
  }
}
