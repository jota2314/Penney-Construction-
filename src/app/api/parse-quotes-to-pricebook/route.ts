import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { callClaude } from "@/lib/ai/claude";

/**
 * POST /api/parse-quotes-to-pricebook
 * Parses extracted_text from quote_requests into structured price_book entries.
 * Can process a single quote or batch all unprocessed quotes.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { quoteId } = await request.json().catch(() => ({}));

  // Get quotes with extracted text that haven't been parsed yet
  let query = supabase
    .from("quote_requests")
    .select("id, subcontractor_name, trade, amount, project_name, project_id, extracted_text, sent_at")
    .not("extracted_text", "is", null);

  if (quoteId) {
    query = query.eq("id", quoteId);
  }

  const { data: quotes } = await query;
  if (!quotes || quotes.length === 0) {
    return NextResponse.json({ message: "No quotes to parse", parsed: 0 });
  }

  // Check which quotes already have price_book entries
  const quoteIds = quotes.map(q => q.id);
  const { data: existing } = await supabase
    .from("price_book")
    .select("quote_request_id")
    .in("quote_request_id", quoteIds);
  const alreadyParsed = new Set((existing ?? []).map(e => e.quote_request_id));

  const toParse = quotes.filter(q => !alreadyParsed.has(q.id));
  if (toParse.length === 0) {
    return NextResponse.json({ message: "All quotes already parsed", parsed: 0 });
  }

  let totalParsed = 0;

  for (const quote of toParse) {
    try {
      const prompt = `Parse this construction quote into individual line items for a price database.

QUOTE FROM: ${quote.subcontractor_name}
TRADE: ${quote.trade || "unknown"}
PROJECT: ${quote.project_name || "unknown"}
TOTAL: $${quote.amount || "unknown"}

EXTRACTED TEXT:
${quote.extracted_text?.substring(0, 6000)}

Return a JSON array of line items. Each item:
{
  "item_name": "specific material/product name with size (e.g., '2x10 PT 14ft', 'Marvin Elevate DH 34.5x68', 'Therma-Tru Smooth Star 3-0x6-8')",
  "category": "lumber | plumbing | electrical | windows | doors | tile | flooring | hvac | insulation | roofing | siding | concrete | hardware | fixtures | glass | painting | other",
  "subcategory": "framing_lumber | trim | sheathing | hardware | fixtures | rough_in | finish | etc.",
  "unit_price": 18.50,
  "unit_type": "each | sqft | linear_ft | lump_sum | sheet | bundle | fixture",
  "quantity": 10,
  "total_price": 185.00
}

RULES:
- Extract EVERY individual line item with its own price
- If only a lump sum total exists (no line items), create ONE entry with unit_type "lump_sum"
- Use specific material names, not generic descriptions
- Include sizes, models, and specifications in item_name
- unit_price should be the price PER UNIT, not the total
- Return ONLY the JSON array, no other text`;

      const response = await callClaude(
        "You parse construction quotes into structured line items. Return ONLY a JSON array.",
        prompt,
        2048
      );

      // Parse the AI response
      let items: Record<string, unknown>[] = [];
      try {
        const cleaned = response
          .replace(/^```json\s*/i, "")
          .replace(/^```\s*/i, "")
          .replace(/\s*```$/i, "")
          .trim();
        const jsonStart = cleaned.indexOf("[");
        const jsonEnd = cleaned.lastIndexOf("]");
        if (jsonStart !== -1 && jsonEnd > jsonStart) {
          items = JSON.parse(cleaned.substring(jsonStart, jsonEnd + 1));
        }
      } catch {
        continue;
      }

      if (items.length === 0) continue;

      // Find supplier in subcontractors table
      const { data: sub } = await supabase
        .from("subcontractors")
        .select("id")
        .ilike("company_name", `%${quote.subcontractor_name}%`)
        .limit(1)
        .single();

      // Insert into price_book
      const entries = items.map((item) => ({
        item_name: String(item.item_name || "Unknown item"),
        category: String(item.category || quote.trade || "other"),
        subcategory: item.subcategory ? String(item.subcategory) : null,
        unit_price: parseFloat(String(item.unit_price || 0)),
        unit_type: String(item.unit_type || "each"),
        quantity: item.quantity ? parseFloat(String(item.quantity)) : null,
        total_price: item.total_price ? parseFloat(String(item.total_price)) : null,
        supplier_name: quote.subcontractor_name,
        supplier_id: sub?.id || null,
        project_id: quote.project_id || null,
        project_name: quote.project_name || null,
        quote_request_id: quote.id,
        quote_date: quote.sent_at ? quote.sent_at.split("T")[0] : null,
        source: "ai_parsed",
        created_by: user.id,
      }));

      const { error } = await supabase.from("price_book").insert(entries);
      if (!error) totalParsed += entries.length;
    } catch {
      continue;
    }
  }

  return NextResponse.json({
    message: `Parsed ${totalParsed} line items from ${toParse.length} quotes`,
    parsed: totalParsed,
    quotes_processed: toParse.length,
  });
}
