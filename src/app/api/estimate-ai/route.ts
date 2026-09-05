import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { callClaude, nowStamp } from "@/lib/ai/claude";
import { fieldLearningContext } from "@/lib/estimates/load-field-learning";

/**
 * POST /api/estimate-ai
 * AI generates estimate line items based on project info and price book data.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { projectId, projectName, projectType, projectDescription, userMessage, includeWalkthrough, includeTakeoff } = await request.json();

  // Load price data + walkthrough + takeoff
  const [tradeRatesRes, priceBookRes, quotesRes, walkthroughRes, takeoffRes] = await Promise.all([
    supabase.from("trade_rates").select("trade_name, description, unit_type, avg_cost, avg_price").eq("is_active", true),
    supabase.from("price_book").select("item_name, category, unit_price, unit_type, supplier_name, quote_date").order("quote_date", { ascending: false }).limit(100),
    projectId
      ? supabase.from("quote_requests").select("subcontractor_name, trade, amount, scope_description").eq("project_id", projectId).not("amount", "is", null)
      : Promise.resolve({ data: [] }),
    // Walkthrough notes for this project
    (includeWalkthrough && projectId)
      ? supabase
          .from("walkthroughs")
          .select("id, name, summary, walkthrough_notes(content, source, sort_order)")
          .eq("project_id", projectId)
          .order("visited_at", { ascending: false })
          .limit(3)
      : Promise.resolve({ data: [] }),
    // Takeoff measurements for this project
    (includeTakeoff && projectId)
      ? supabase
          .from("takeoff_measurements")
          .select("label, measurement_type, value, unit, trade, notes")
          .eq("project_id", projectId)
          .neq("measurement_type", "checklist")
          .order("created_at")
      : Promise.resolve({ data: [] }),
  ]);

  const tradeRates = (tradeRatesRes.data ?? [])
    .map(r => `${r.trade_name}: $${r.avg_cost} cost / $${r.avg_price} price per ${r.unit_type} — ${r.description}`)
    .join("\n");

  const priceBook = (priceBookRes.data ?? [])
    .map(p => `${p.item_name} | $${p.unit_price}/${p.unit_type} | ${p.supplier_name} | ${p.quote_date || ""}`)
    .join("\n");

  const existingQuotes = (quotesRes.data ?? [])
    .map(q => `${q.subcontractor_name} — ${q.trade}: $${q.amount}${q.scope_description ? ` (${q.scope_description.substring(0, 100)})` : ""}`)
    .join("\n");

  // Build walkthrough context
  const walkthroughs = walkthroughRes.data ?? [];
  const walkthroughContext = walkthroughs.length > 0
    ? walkthroughs.map((w: Record<string, unknown>) => {
        const notes = (w.walkthrough_notes as { content: string; source: string; sort_order: number }[]) || [];
        const noteText = notes
          .sort((a, b) => a.sort_order - b.sort_order)
          .map(n => `  - [${n.source}] ${n.content}`)
          .join("\n");
        return `Walkthrough: ${w.name || "Site Visit"}${w.summary ? `\nSummary: ${w.summary}` : ""}\nNotes:\n${noteText}`;
      }).join("\n\n")
    : "";

  // Build takeoff context
  const takeoffs = takeoffRes.data ?? [];
  const takeoffContext = takeoffs.length > 0
    ? takeoffs.map((t: Record<string, unknown>) =>
        `  ${t.label}: ${t.value} ${t.unit}${t.trade ? ` [${t.trade}]` : ""}${t.notes ? ` — ${t.notes}` : ""}`
      ).join("\n")
    : "";

  const systemPrompt = `You are the estimating AI for Penney Construction, a residential GC on the North Shore of Massachusetts.
${nowStamp()}

## PROJECT
Name: ${projectName || "Unknown"}
Type: ${projectType || "remodel"}
Description: ${projectDescription || "No description"}

## YOUR PRICING DATA (from real quotes and trade rates)
Trade Rates:
${tradeRates || "None loaded"}

Price Book (recent material/sub prices):
${priceBook || "None loaded"}

Existing Sub Quotes for this project:
${existingQuotes || "None yet"}${walkthroughContext ? `

## WALKTHROUGH NOTES (from site visit — use these to understand the scope)
${walkthroughContext}` : ""}${takeoffContext ? `

## TAKEOFF MEASUREMENTS (actual quantities from drawings — use these for accurate pricing)
${takeoffContext}
IMPORTANT: When takeoff measurements are provided, use the EXACT quantities for pricing.
Example: if takeoff says "Tile walls: 370 sqft", price tile at 370 sqft × rate, don't guess.` : ""}

## ESTIMATE FORMAT
Generate estimate line items. Each line:
{
  "category": "Trade/phase name (e.g., Permits, Demolition, Framing, Plumbing)",
  "scope_text": "Detailed scope description — what's included, what's excluded. Use bullet points with dashes.",
  "cost": 5000,
  "markup_pct": 30,
  "client_price": 6500,
  "quote_status": "known" | "allowance" | "waiting",
  "notes": "Internal notes — which sub, where the price came from"
}

## RULES
- Use REAL prices from the price book and trade rates — don't make up numbers
- If you have a sub quote for this project, use that exact amount as cost
- Default markup is 30% — cost × 1.30 = client_price
- For items you're less sure about, use "allowance" as quote_status
- Scope text should match Jorge's style: detailed but concise, use dashes for line items
- Think like a GC: don't miss permits, protection, dumpster, jiffy john, final clean
- Include ALL trades needed for this type of project

Return a JSON object:
{
  "message": "Brief explanation of the estimate",
  "line_items": [...]
}`;

  const fieldContext = await fieldLearningContext(supabase, { projectId, projectType, scope: projectDescription });
  const response = await callClaude(systemPrompt + fieldContext, userMessage || `Generate a complete estimate for ${projectName || "this project"}. Include all trades and phases needed.`, 4096);

  let result: Record<string, unknown> = {};
  try {
    const cleaned = response.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "").trim();
    const jsonStart = cleaned.indexOf("{");
    const jsonEnd = cleaned.lastIndexOf("}");
    if (jsonStart !== -1 && jsonEnd > jsonStart) {
      result = JSON.parse(cleaned.substring(jsonStart, jsonEnd + 1));
    }
  } catch {
    result = { message: response, line_items: [] };
  }

  return NextResponse.json(result);
}
