import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAnthropicClient, CLAUDE_FALLBACK_MODELS } from "@/lib/ai/claude";
import { getCurrentEstimateId } from "@/lib/estimates/current-estimate";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * AI scans a quote (from extracted text or scope) and suggests how to split
 * it across estimate line items. Returns suggested splits with amounts.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    const { quoteId, projectId } = await request.json();
    if (!quoteId || !projectId) {
      return NextResponse.json({ error: "quoteId and projectId required" }, { status: 400 });
    }

    // Load quote
    const { data: quote } = await supabase
      .from("quote_requests")
      .select("*")
      .eq("id", quoteId)
      .single();

    if (!quote) return NextResponse.json({ error: "Quote not found" }, { status: 404 });

    // Load lines from the project's current estimate
    const estimateId = await getCurrentEstimateId(supabase, projectId);
    if (!estimateId) {
      return NextResponse.json({ error: "No estimate found" }, { status: 404 });
    }

    const { data: lineItems } = await supabase
      .from("estimate_line_items")
      .select("id, description, trade, total_cost, client_price, total_price, proposal_description, scope_text")
      .eq("estimate_id", estimateId)
      .order("sort_order");

    if (!lineItems?.length) {
      return NextResponse.json({ error: "No estimate lines found" }, { status: 404 });
    }

    // Build the quote content for AI
    const quoteContent = [
      quote.scope_description || "",
      quote.extracted_text ? quote.extracted_text.substring(0, 6000) : "",
    ].filter(Boolean).join("\n\n");

    if (!quoteContent && !quote.amount) {
      return NextResponse.json({ error: "Quote has no scope or extracted text to analyze" }, { status: 400 });
    }

    // Ask AI to analyze and split
    const anthropic = await getAnthropicClient();

    const prompt = `You are analyzing a construction subcontractor quote to split it across budget line items.

QUOTE:
- Subcontractor: ${quote.subcontractor_name}
- Trade: ${quote.trade || "Unknown"}
- Total Amount: $${quote.amount || "Unknown"}
- Scope/Content:
${quoteContent || "No detailed scope available — use the trade and amount to determine best match."}

ESTIMATE LINE ITEMS (budget lines) — use the exact "id" values:
${lineItems.map((li) => `- id="${li.id}" | "${li.description}" [${li.trade || "General"}] | Budget: $${li.total_cost || li.client_price || li.total_price || 0}
  Scope: ${li.proposal_description || li.scope_text || "N/A"}`).join("\n")}

INSTRUCTIONS:
1. Read the quote content carefully
2. Identify which estimate line items this quote covers
3. If the quote covers ONE line item, put the full amount on that line
4. If the quote covers MULTIPLE line items, split the amount based on the scope breakdown in the quote
5. If the quote has individual line items with prices, use those exact prices
6. Amounts MUST add up to exactly $${quote.amount || 0}

CRITICAL: Use the exact UUID from id="" for each line_item_id. Do NOT use numbers or descriptions.

Return ONLY a JSON array:
[
  {
    "line_item_id": "exact-uuid",
    "line_description": "which estimate line this maps to",
    "amount": 1234.00,
    "scope_note": "what part of the quote covers this"
  }
]

If the quote clearly maps to a single line, return just one entry with the full amount.`;

    let rawContent = "";
    for (const model of CLAUDE_FALLBACK_MODELS) {
      try {
        const response = await anthropic.messages.create({
          model,
          max_tokens: 3000,
          messages: [{ role: "user", content: prompt }],
        });
        rawContent = response.content[0]?.type === "text" ? response.content[0].text.trim() : "";
        if (rawContent) break;
      } catch { continue; }
    }

    if (!rawContent) {
      return NextResponse.json({ error: "AI failed" }, { status: 500 });
    }

    // Parse
    const cleaned = rawContent
      .replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "").trim();

    let splits: { line_item_id: string; line_description: string; amount: number; scope_note: string }[] = [];
    try {
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed)) splits = parsed;
    } catch {
      const s = cleaned.indexOf("[");
      const e = cleaned.lastIndexOf("]");
      if (s !== -1 && e > s) {
        try { splits = JSON.parse(cleaned.substring(s, e + 1)); } catch { /* */ }
      }
    }

    // Fix non-UUID IDs (fallback matching)
    const fixedSplits = splits.map((s) => {
      const direct = lineItems.find((l) => l.id === s.line_item_id);
      if (direct) return s;

      // Match by description
      const descMatch = lineItems.find((l) =>
        l.description.toLowerCase().includes((s.line_description || "").toLowerCase()) ||
        (s.line_description || "").toLowerCase().includes(l.description.toLowerCase())
      );
      if (descMatch) return { ...s, line_item_id: descMatch.id, line_description: descMatch.description };

      // Match by index
      const num = parseInt(s.line_item_id);
      if (!isNaN(num) && num >= 1 && num <= lineItems.length) {
        const li = lineItems[num - 1];
        return { ...s, line_item_id: li.id, line_description: li.description };
      }

      return s;
    });

    // Enrich with budget info
    const enriched = fixedSplits.map((s) => {
      const li = lineItems.find((l) => l.id === s.line_item_id);
      return {
        ...s,
        trade: li?.trade || null,
        budgeted_cost: Number(li?.total_cost || li?.client_price || li?.total_price || 0),
      };
    });

    return NextResponse.json({
      quote: {
        id: quote.id,
        subcontractor_name: quote.subcontractor_name,
        trade: quote.trade,
        amount: Number(quote.amount) || 0,
        scope_description: quote.scope_description,
      },
      estimate_id: estimateId,
      line_items: lineItems.map((li) => ({
        id: li.id,
        description: li.description,
        trade: li.trade,
        budgeted_cost: Number(li.total_cost || li.client_price || li.total_price || 0),
      })),
      suggested_splits: enriched,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
