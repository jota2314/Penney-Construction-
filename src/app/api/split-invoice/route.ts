import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAnthropicClient, CLAUDE_FALLBACK_MODELS } from "@/lib/ai/claude";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * AI suggests how to split an invoice across estimate line items.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    const { invoiceId, projectId } = await request.json();

    // Load invoice
    const { data: invoice } = await supabase
      .from("invoices")
      .select("*")
      .eq("id", invoiceId)
      .single();

    if (!invoice) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });

    // Load estimate lines via the canonical pointer — a status filter here
    // returned nothing for signed jobs (accepted ∉ approved/draft).
    const { data: currentEstimateId } = await supabase.rpc("current_estimate_id", {
      p_project_id: projectId,
    });

    const estimateId = currentEstimateId as string | null;
    if (!estimateId) return NextResponse.json({ error: "No estimate found" }, { status: 404 });

    const { data: rawLineItems } = await supabase
      .from("estimate_line_items")
      .select("id, description, trade, total_cost, client_price, total_price, proposal_description, scope_text, is_section_header")
      .eq("estimate_id", estimateId)
      .order("sort_order");

    // Section headers (GENERAL CONDITIONS, KITCHEN, …) organize the estimate;
    // money never books to them.
    const lineItems = (rawLineItems ?? []).filter((li) => !li.is_section_header);

    if (!lineItems.length) return NextResponse.json({ error: "No estimate lines" }, { status: 404 });

    const invoiceContent = [
      invoice.description || "",
      invoice.extracted_text ? invoice.extracted_text.substring(0, 4000) : "",
    ].filter(Boolean).join("\n\n");

    // Penney Construction in-house trades vs subcontractor trades
    const isPenneyLabor = (invoice.vendor_name || "").toLowerCase().includes("penney construction");
    const IN_HOUSE_TRADES = ["carpentry", "finish carpentry", "framing", "flooring", "demo", "general"];
    const SUB_TRADES = ["electrical", "plumbing", "plaster", "paint", "insulation", "hvac", "tile", "roofing"];

    // Filter line items based on vendor type
    const relevantLines = isPenneyLabor
      ? lineItems.filter((li) => {
          const t = (li.trade || "general").toLowerCase();
          return IN_HOUSE_TRADES.some((iht) => t.includes(iht));
        })
      : lineItems;

    const anthropic = await getAnthropicClient();

    let contextNote = "";
    if (isPenneyLabor) {
      contextNote = `
IMPORTANT CONTEXT:
This is Penney Construction's own crew labor. Their guys do: cleaning, carpentry, finish carpentry, framing, flooring, and demo.
They do NOT do: electrical, plumbing, plastering, painting, insulation, HVAC, or tile — those are subcontractor trades.
Split this labor ONLY across the in-house trade budget lines shown below. Never allocate to sub trades.`;
    } else if (SUB_TRADES.includes((invoice.trade || "").toLowerCase())) {
      contextNote = `
IMPORTANT CONTEXT:
This is a subcontractor invoice. Link the FULL amount to the single matching trade budget line. Do not split across multiple lines unless the invoice description clearly covers multiple trades.`;
    }

    const prompt = `You are splitting a construction vendor invoice across budget line items.

INVOICE:
- Vendor: ${invoice.vendor_name}
- Trade: ${invoice.trade || "Unknown"}
- Total: $${invoice.amount}
- Description: ${invoiceContent || "No details"}
${contextNote}

ESTIMATE LINE ITEMS — use exact "id" values:
${(relevantLines.length > 0 ? relevantLines : lineItems).map((li) => `- id="${li.id}" | "${li.description}" [${li.trade || "General"}] | Budget: $${li.total_cost || li.client_price || li.total_price || 0}`).join("\n")}

Split $${invoice.amount} across the relevant lines. Use exact UUIDs from id="".

Return ONLY a JSON array:
[{ "line_item_id": "uuid", "line_description": "name", "amount": 1234.00, "note": "what this covers" }]`;

    let rawContent = "";
    for (const model of CLAUDE_FALLBACK_MODELS) {
      try {
        const res = await anthropic.messages.create({ model, max_tokens: 2000, messages: [{ role: "user", content: prompt }] });
        rawContent = res.content[0]?.type === "text" ? res.content[0].text.trim() : "";
        if (rawContent) break;
      } catch { continue; }
    }

    if (!rawContent) return NextResponse.json({ error: "AI failed" }, { status: 500 });

    const cleaned = rawContent.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "").trim();
    let splits: { line_item_id: string; line_description: string; amount: number; note: string }[] = [];
    try {
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed)) splits = parsed;
    } catch {
      const s = cleaned.indexOf("["), e = cleaned.lastIndexOf("]");
      if (s !== -1 && e > s) try { splits = JSON.parse(cleaned.substring(s, e + 1)); } catch { /**/ }
    }

    // Fix non-UUID IDs
    splits = splits.map((s) => {
      if (lineItems.find((l) => l.id === s.line_item_id)) return s;
      const match = lineItems.find((l) => l.description.toLowerCase().includes((s.line_description || "").toLowerCase()) || (s.line_description || "").toLowerCase().includes(l.description.toLowerCase()));
      if (match) return { ...s, line_item_id: match.id, line_description: match.description };
      const num = parseInt(s.line_item_id);
      if (!isNaN(num) && num >= 1 && num <= lineItems.length) return { ...s, line_item_id: lineItems[num - 1].id, line_description: lineItems[num - 1].description };
      return s;
    });

    const enriched = splits.map((s) => {
      const li = lineItems.find((l) => l.id === s.line_item_id);
      return { ...s, trade: li?.trade || null, budgeted_cost: Number(li?.total_cost || li?.client_price || li?.total_price || 0) };
    });

    return NextResponse.json({
      invoice: { id: invoice.id, vendor_name: invoice.vendor_name, amount: Number(invoice.amount), trade: invoice.trade, description: invoice.description },
      line_items: lineItems.map((li) => ({ id: li.id, description: li.description, trade: li.trade, budgeted_cost: Number(li.total_cost || li.client_price || li.total_price || 0) })),
      suggested_splits: enriched,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
