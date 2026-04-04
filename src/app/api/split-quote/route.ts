import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAnthropicClient, CLAUDE_FALLBACK_MODELS } from "@/lib/ai/claude";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * AI suggests how to split a quote across estimate line items.
 * Takes the quote scope + estimate lines and proposes a split.
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

    // Load quote and estimate lines in parallel
    const [{ data: quote }, { data: estimates }] = await Promise.all([
      supabase.from("quote_requests").select("*").eq("id", quoteId).single(),
      supabase
        .from("estimates")
        .select("id")
        .eq("project_id", projectId)
        .in("status", ["approved", "draft"])
        .order("version", { ascending: false })
        .limit(1),
    ]);

    if (!quote) return NextResponse.json({ error: "Quote not found" }, { status: 404 });

    const estimateId = estimates?.[0]?.id;
    if (!estimateId) {
      return NextResponse.json({ error: "No estimate found for this project" }, { status: 404 });
    }

    const { data: lineItems } = await supabase
      .from("estimate_line_items")
      .select("id, description, trade, total_cost, client_price, total_price, proposal_description, scope_text")
      .eq("estimate_id", estimateId)
      .order("sort_order");

    if (!lineItems?.length) {
      return NextResponse.json({ error: "No estimate line items found" }, { status: 404 });
    }

    // Ask AI to suggest the split
    const anthropic = await getAnthropicClient();

    const prompt = `You are helping split a subcontractor quote across budget line items for a construction project.

QUOTE:
- Subcontractor: ${quote.subcontractor_name}
- Trade: ${quote.trade}
- Total Amount: $${quote.amount}
- Scope: ${quote.scope_description || "No description"}
${quote.extracted_text ? `- Extracted PDF text: ${quote.extracted_text.substring(0, 3000)}` : ""}

ESTIMATE LINE ITEMS (budget lines):
${lineItems.map((li, i) => `${i + 1}. "${li.description}" [${li.trade || "General"}] — Budget: $${li.total_cost || li.client_price || li.total_price || 0}
   Scope: ${li.proposal_description || li.scope_text || "N/A"}`).join("\n")}

Based on the quote's scope description, split the total amount of $${quote.amount} across the relevant budget lines. Only include lines that the quote's work actually covers. The amounts must add up to exactly $${quote.amount}.

Return ONLY a JSON array:
[
  { "line_item_id": "uuid", "description": "line description", "amount": 1234.00, "reason": "brief explanation" }
]

Be practical — if the work clearly maps to one line, put it all there. If it spans multiple, split proportionally based on the scope.`;

    let rawContent = "";
    for (const model of CLAUDE_FALLBACK_MODELS) {
      try {
        const response = await anthropic.messages.create({
          model,
          max_tokens: 2000,
          messages: [{ role: "user", content: prompt }],
        });
        rawContent = response.content[0]?.type === "text" ? response.content[0].text.trim() : "";
        if (rawContent) break;
      } catch { continue; }
    }

    if (!rawContent) {
      return NextResponse.json({ error: "AI failed to suggest split" }, { status: 500 });
    }

    // Parse AI response
    const cleaned = rawContent
      .replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "").trim();

    let splits: { line_item_id: string; description: string; amount: number; reason: string }[] = [];
    try {
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed)) splits = parsed;
    } catch {
      const jsonStart = cleaned.indexOf("[");
      const jsonEnd = cleaned.lastIndexOf("]");
      if (jsonStart !== -1 && jsonEnd > jsonStart) {
        try {
          splits = JSON.parse(cleaned.substring(jsonStart, jsonEnd + 1));
        } catch { /* fallback */ }
      }
    }

    // Enrich splits with budget info
    const enrichedSplits = splits.map((s) => {
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
        amount: quote.amount,
        scope_description: quote.scope_description,
      },
      line_items: lineItems.map((li) => ({
        id: li.id,
        description: li.description,
        trade: li.trade,
        budgeted_cost: Number(li.total_cost || li.client_price || li.total_price || 0),
      })),
      suggested_splits: enrichedSplits,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
