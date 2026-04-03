import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { callClaude, nowStamp } from "@/lib/ai/claude";
import { UNIT_LABELS } from "@/lib/constants/company";

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const { projectId, measurements, checklist, scopeOfWork } = await request.json();

    if (!projectId || !Array.isArray(measurements) || measurements.length === 0) {
      return NextResponse.json({ error: "projectId and measurements required" }, { status: 400 });
    }

    // Fetch project info
    const { data: project } = await supabase
      .from("projects")
      .select("name, address, project_type, scope_of_work, required_trades")
      .eq("id", projectId)
      .single();

    // Fetch trade rates for pricing
    const { data: tradeRates } = await supabase
      .from("trade_rates")
      .select("trade_name, unit_type, avg_price, avg_cost")
      .eq("is_active", true);

    // Build measurement summary for AI
    const measurementSummary = measurements.map((m: {
      label: string;
      type: string;
      value: number;
      unit: string;
      trade?: string;
      guideItemLabel?: string;
    }) => {
      const block = m.guideItemLabel || "Unassigned";
      return `- [${block}] ${m.label}: ${m.value.toFixed(m.type === "area" ? 1 : 2)} ${m.unit} (${m.type})`;
    }).join("\n");

    // Group by block for summary
    const blocks = new Map<string, { measurements: string[]; totalValue: number; unit: string; type: string }>();
    for (const m of measurements) {
      const block = m.guideItemLabel || m.label;
      if (!blocks.has(block)) blocks.set(block, { measurements: [], totalValue: 0, unit: m.unit, type: m.type });
      const b = blocks.get(block)!;
      b.measurements.push(`${m.label}: ${m.value.toFixed(2)} ${m.unit}`);
      b.totalValue += m.value;
    }

    const blockSummary = Array.from(blocks.entries()).map(([name, b]) =>
      `${name}: ${b.totalValue.toFixed(b.type === "area" ? 1 : 2)} ${b.unit} total (${b.measurements.length} measurements)`
    ).join("\n");

    let ratesSection = "";
    if (tradeRates && tradeRates.length > 0) {
      ratesSection = "\n\nCompany Cost Book rates:\n" + tradeRates.map(r =>
        `- ${r.trade_name}: $${r.avg_price.toFixed(2)}${UNIT_LABELS[r.unit_type] || ""} (cost: $${r.avg_cost.toFixed(2)})`
      ).join("\n");
    }

    const systemPrompt = `You are a senior residential construction estimator. Current date: ${nowStamp()}.

Given takeoff measurements from construction drawings, convert them into estimate line items.

For each measurement block/group, determine:
1. The trade/work category (Framing, Siding, Roofing, Plumbing, Electrical, etc.)
2. Whether this is work the GC's crew can do, or if it NEEDS A SUBCONTRACTOR QUOTE
3. If you have a cost book rate, calculate: quantity × rate = price
4. If no rate exists or it's specialized work, flag needs_sub_quote = true
5. Write a brief but specific scope description

Rules for needs_sub_quote:
- Plumbing, Electrical, HVAC = ALWAYS needs_sub_quote (licensed trades)
- Specialized work (roofing, siding installation, windows) = needs_sub_quote
- General carpentry, framing, demolition, drywall, painting = crew can do (needs_sub_quote = false)
- When in doubt, flag as needs_sub_quote

${ratesSection}

Respond with valid JSON:
{
  "lineItems": [
    {
      "description": "Trade/Item Name",
      "trade": "trade_name",
      "quantity": 150.5,
      "unit": "sqft",
      "unit_cost": 12.50,
      "total_price": 1881.25,
      "needs_sub_quote": true,
      "proposal_description": "• Specific scope bullet 1\\n• Specific scope bullet 2",
      "measurement_labels": ["Block Label 1"]
    }
  ]
}`;

    const userMessage = `Convert these takeoff measurements into estimate line items:

Project: ${project?.name || "Unknown"}
Type: ${project?.project_type || "residential"}
Address: ${project?.address || ""}
${project?.scope_of_work ? `Scope: ${project.scope_of_work}` : ""}
${scopeOfWork ? `Drawing scope: ${scopeOfWork}` : ""}

MEASUREMENT BLOCKS:
${blockSummary}

ALL MEASUREMENTS:
${measurementSummary}

${checklist?.length ? `\nAI CHECKLIST ITEMS:\n${checklist.map((c: { label: string; trade: string; type: string }) => `- ${c.label} (${c.trade}, ${c.type})`).join("\n")}` : ""}

Generate line items using actual measured quantities. Flag trades that need subcontractor quotes.`;

    const raw = await callClaude(systemPrompt, userMessage, 4000);

    let parsed: { lineItems?: unknown[] };
    try {
      parsed = JSON.parse(raw);
    } catch {
      return NextResponse.json({ error: "AI returned invalid JSON" }, { status: 500 });
    }

    if (!Array.isArray(parsed.lineItems)) {
      return NextResponse.json({ error: "AI response missing lineItems" }, { status: 500 });
    }

    const lineItems = parsed.lineItems
      .filter((item): item is Record<string, unknown> =>
        typeof item === "object" && item !== null && typeof (item as Record<string, unknown>).description === "string"
      )
      .map(item => ({
        description: String(item.description).trim(),
        trade: typeof item.trade === "string" ? item.trade.trim() : null,
        quantity: typeof item.quantity === "number" ? Math.round(item.quantity * 100) / 100 : 1,
        unit: typeof item.unit === "string" ? item.unit : "ea",
        unit_cost: typeof item.unit_cost === "number" ? Math.round(item.unit_cost * 100) / 100 : 0,
        total_price: typeof item.total_price === "number" ? Math.round(item.total_price * 100) / 100 : 0,
        needs_sub_quote: item.needs_sub_quote === true,
        proposal_description: typeof item.proposal_description === "string" ? item.proposal_description.trim() : "",
        measurement_labels: Array.isArray(item.measurement_labels) ? item.measurement_labels : [],
        source: "takeoff" as const,
      }));

    return NextResponse.json({ lineItems });
  } catch (error) {
    console.error("takeoff-to-estimate error:", error);
    return NextResponse.json({ error: "Failed to convert takeoff" }, { status: 500 });
  }
}
