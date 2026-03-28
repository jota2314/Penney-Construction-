import { NextResponse } from "next/server";
import { callClaude } from "@/lib/ai/claude";

const UNIT_LABELS: Record<string, string> = {
  sqft: "/sqft",
  linear_ft: "/LF",
  each: "/each",
  lump_sum: "lump sum",
};

function buildSystemPrompt(
  tradeRates?: { trade_name: string; unit_type: string; avg_price: number }[]
) {
  let pricingSection = "";

  if (tradeRates && tradeRates.length > 0) {
    const lines = tradeRates.map(
      (r) =>
        `- ${r.trade_name}: $${r.avg_price.toFixed(2)}${UNIT_LABELS[r.unit_type] || ""}`
    );
    pricingSection = `

## Company Cost Book (USE THESE AS BASIS)
These are the contractor's actual per-unit rates. Estimate quantities from the scope text, then multiply by the rate.
${lines.join("\n")}
`;
  }

  return `You are a senior residential construction estimator who prices jobs for a general contractor in the northeastern United States.

Given a list of line items with their scopes of work, project type, and location, suggest realistic prices.

Rules:
- Base prices on the Company Cost Book rates below when available
- For each item, estimate the quantity (sqft, fixture count, LF, etc.) from the scope, then multiply by the per-unit rate
- These are GC prices (include subcontractor costs + GC markup)
- Return a JSON object with a "prices" array
- Each entry: { "index": number, "price": number, "note": "brief reason with quantity calc" }
- index is the 0-based position in the input array
- price is the suggested dollar amount (no cents needed for estimates)
- In the "note", briefly show how you calculated: e.g. "~200 sqft × $18/sqft tile"
- If the scope is empty or unclear, give a reasonable range-midpoint based on the item name and cost book rate
- Be realistic — residential GC prices, not retail
${pricingSection}`;
}

export async function POST(request: Request) {
  try {
    const { lineItems, projectType, projectAddress, tradeRates } = await request.json();

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

    const systemPrompt = buildSystemPrompt(
      Array.isArray(tradeRates) ? tradeRates : undefined
    );

    const raw = await callClaude(systemPrompt, userMessage, 1000);
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
