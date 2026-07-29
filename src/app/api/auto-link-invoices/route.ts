import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAnthropicClient, CLAUDE_FALLBACK_MODELS } from "@/lib/ai/claude";
import { z } from "zod";
import { getCurrentEstimateId } from "@/lib/estimates/current-estimate";

export const runtime = "nodejs";
export const maxDuration = 60;

const mappingSchema = z.array(z.object({
  invoice_id: z.string().uuid(),
  splits: z.array(z.object({
    line_item_id: z.string().uuid(),
    amount: z.number().finite().positive(),
    note: z.string().max(2_000).default(""),
  })).min(1),
}));

/**
 * Auto-link all unlinked invoices for a project to their best-fit budget lines.
 * Penney labor gets split across in-house trades; subs/materials get direct links.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    const requestData = z.object({ projectId: z.string().uuid() })
      .safeParse(await request.json());
    if (!requestData.success) {
      return NextResponse.json({ error: "Valid projectId required" }, { status: 400 });
    }
    const { projectId } = requestData.data;

    // Load unlinked invoices
    const { data: unlinked } = await supabase
      .from("invoices")
      .select("*")
      .eq("project_id", projectId)
      .is("estimate_line_item_id", null)
      .order("invoice_date", { ascending: false });

    if (!unlinked?.length) return NextResponse.json({ linked: 0, split: 0, message: "No unlinked invoices" });

    // Load line items with current spend from the project's current estimate
    const estimateId = await getCurrentEstimateId(supabase, projectId);
    if (!estimateId) return NextResponse.json({ error: "No estimate found for this project" }, { status: 404 });

    const { data: lineItems } = await supabase
      .from("estimate_line_items")
      .select("id, description, trade, total_cost, client_price, total_price")
      .eq("estimate_id", estimateId)
      .order("sort_order");

    if (!lineItems?.length) return NextResponse.json({ error: "No estimate lines" }, { status: 404 });

    // Get current spend per line
    const { data: spendData } = await supabase
      .from("invoices")
      .select("estimate_line_item_id, amount")
      .eq("project_id", projectId)
      .not("estimate_line_item_id", "is", null);

    const spendByLine = new Map<string, number>();
    for (const inv of spendData || []) {
      const current = spendByLine.get(inv.estimate_line_item_id!) || 0;
      spendByLine.set(inv.estimate_line_item_id!, current + Number(inv.amount));
    }

    // Build line items summary with remaining budget
    const linesWithBudget = lineItems.map((li) => {
      const budget = Number(li.total_cost || li.client_price || li.total_price || 0);
      const spent = spendByLine.get(li.id) || 0;
      return { ...li, budget, spent, remaining: budget - spent };
    });

    // Build invoice summary for AI
    const invoiceSummary = unlinked.map((inv) => ({
      id: inv.id,
      vendor: inv.vendor_name,
      trade: inv.trade,
      amount: Number(inv.amount),
      description: inv.description || "",
      date: inv.invoice_date,
    }));

    const anthropic = await getAnthropicClient();
    const prompt = `You are a construction cost accountant mapping unlinked expenses to budget line items for a residential remodel.

CONTEXT:
- Penney Construction's crew does IN-HOUSE: carpentry, finish carpentry, framing, flooring, demo, cleaning/general.
- Subcontractor trades (done by outside subs): electrical, plumbing, plaster, paint, insulation, HVAC, tile, roofing.
- "Penney Construction (Labor)" invoices are weekly crew payroll — split these ONLY across in-house trade budget lines.
- Material invoices from lumber yards (Moynihan, Jackson, Building Center) are typically framing/carpentry lumber.
- Home Depot/Lowes/Aubuchon are general supplies — match to the most relevant trade or General line.
- Subcontractor invoices should go 100% to their matching trade budget line.

BUDGET LINES (use exact "id" values):
${linesWithBudget.map((li) => `- id="${li.id}" | "${li.description}" [${li.trade || "General"}] | Budget: $${li.budget} | Spent: $${li.spent} | Remaining: $${li.remaining}`).join("\n")}

UNLINKED INVOICES TO MAP:
${invoiceSummary.map((inv) => `- id="${inv.id}" | "${inv.vendor}" [${inv.trade}] | $${inv.amount} | "${inv.description}" | ${inv.date}`).join("\n")}

MAP each invoice to one or more budget lines. For Penney Construction (Labor), split proportionally across the in-house trade lines that still have remaining budget. For everything else, pick the single best-matching line.

Return ONLY a JSON array. Each entry maps one invoice:
[
  {
    "invoice_id": "exact-uuid",
    "splits": [
      { "line_item_id": "exact-uuid", "amount": 1234.00, "note": "brief reason" }
    ]
  }
]

Rules:
- Use EXACT UUIDs from the ids above
- Each invoice's splits must sum to the invoice amount exactly
- For non-labor invoices, use exactly 1 split (direct link)
- For Penney labor, split across 2-4 in-house trade lines proportionally based on remaining budget
- NEVER map Penney labor to electrical, plumbing, plaster, paint, or insulation lines`;

    let rawContent = "";
    for (const model of CLAUDE_FALLBACK_MODELS) {
      try {
        const res = await anthropic.messages.create({
          model,
          max_tokens: 8000,
          messages: [{ role: "user", content: prompt }],
        });
        rawContent = res.content[0]?.type === "text" ? res.content[0].text.trim() : "";
        if (rawContent) break;
      } catch { continue; }
    }

    if (!rawContent) return NextResponse.json({ error: "AI mapping failed" }, { status: 500 });

    // Parse response
    const cleaned = rawContent.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "").trim();
    let parsedMappings: unknown = [];
    try {
      parsedMappings = JSON.parse(cleaned);
    } catch {
      const s = cleaned.indexOf("["), e = cleaned.lastIndexOf("]");
      if (s !== -1 && e > s) {
        try { parsedMappings = JSON.parse(cleaned.substring(s, e + 1)); } catch { /**/ }
      }
    }
    const mappingResult = mappingSchema.safeParse(parsedMappings);
    if (!mappingResult.success) {
      return NextResponse.json({ error: "AI returned an invalid invoice mapping" }, { status: 422 });
    }
    const mappings = mappingResult.data;

    // Validate and fix UUIDs
    const validLineIds = new Set(lineItems.map((l) => l.id));
    const validInvoiceIds = new Set(unlinked.map((i) => i.id));

    let linked = 0;
    let split = 0;
    const errors: string[] = [];

    for (const mapping of mappings) {
      if (!validInvoiceIds.has(mapping.invoice_id)) {
        errors.push(`Unknown invoice ${mapping.invoice_id}`);
        continue;
      }

      const validSplits = mapping.splits.filter((s) => validLineIds.has(s.line_item_id));
      if (!validSplits.length) {
        errors.push(`No valid line items for invoice ${mapping.invoice_id}`);
        continue;
      }

      const original = unlinked.find((i) => i.id === mapping.invoice_id)!;

      if (validSplits.length === 1) {
        // Direct link — just update the invoice
        const { error } = await supabase
          .from("invoices")
          .update({
            estimate_line_item_id: validSplits[0].line_item_id,
            description: validSplits[0].note || original.description,
          })
          .eq("id", mapping.invoice_id);

        if (error) errors.push(`Link error: ${error.message}`);
        else linked++;
      } else {
        const { error: splitError } = await supabase.rpc("split_vendor_invoice", {
          p_invoice_id: mapping.invoice_id,
          p_splits: validSplits,
        });
        if (splitError) {
          errors.push(`Split error: ${splitError.message}`);
          continue;
        }
        split++;
      }
    }

    return NextResponse.json({
      linked,
      split,
      total: linked + split,
      errors: errors.length > 0 ? errors : undefined,
      message: `Linked ${linked} invoices, split ${split} labor entries across budget lines`,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
