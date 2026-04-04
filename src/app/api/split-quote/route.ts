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

ESTIMATE LINE ITEMS (budget lines) — use the exact id value as line_item_id:
${lineItems.map((li) => `- id="${li.id}" | "${li.description}" [${li.trade || "General"}] | Budget: $${li.total_cost || li.client_price || li.total_price || 0}
  Scope: ${li.proposal_description || li.scope_text || "N/A"}`).join("\n")}

Split the total of $${quote.amount} across the relevant budget lines. Only include lines the quote's work covers. Amounts must add up to exactly $${quote.amount}.

CRITICAL: The "line_item_id" must be the exact UUID string from the id= field above. Do NOT use numbers.

Return ONLY a JSON array:
[
  { "line_item_id": "exact-uuid-from-above", "description": "line description", "amount": 1234.00, "reason": "brief explanation" }
]`;

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

    // Fix AI returning non-UUID IDs — match by description as fallback
    const fixedSplits = splits.map((s) => {
      const directMatch = lineItems.find((l) => l.id === s.line_item_id);
      if (directMatch) return s;

      // Fallback: match by description
      const descMatch = lineItems.find((l) =>
        l.description.toLowerCase().includes(s.description?.toLowerCase() || "") ||
        s.description?.toLowerCase().includes(l.description.toLowerCase())
      );
      if (descMatch) return { ...s, line_item_id: descMatch.id };

      // Fallback: if AI used a number, try to index into the array
      const num = parseInt(s.line_item_id);
      if (!isNaN(num) && num >= 1 && num <= lineItems.length) {
        return { ...s, line_item_id: lineItems[num - 1].id };
      }

      return s;
    });

    // Enrich splits with budget info
    const enrichedSplits = fixedSplits.map((s) => {
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
