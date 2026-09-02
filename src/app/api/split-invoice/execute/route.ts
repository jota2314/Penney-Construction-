import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { z } from "zod";

export const runtime = "nodejs";

const requestSchema = z.object({
  invoiceId: z.string().uuid(),
  splits: z.array(z.object({
    line_item_id: z.string().uuid(),
    amount: z.number().finite().positive(),
    note: z.string().max(2_000).default(""),
  })).min(1),
});

/**
 * Execute invoice split — replaces one invoice with multiple, each linked to a budget line.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    const parsed = requestSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid invoice split request" }, { status: 400 });
    }
    const { invoiceId, splits } = parsed.data;

    const { data: original } = await supabase.from("invoices").select("*").eq("id", invoiceId).single();
    if (!original) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });

    // Every piece must land on the estimate IN FORCE for this project
    // (current_estimate_id: the contract estimate, else the highest live
    // version) — never on a superseded version's line, which no contract and
    // no budget counts. Same rule as /api/link-invoice-line.
    const { data: currentEstimateId } = await supabase.rpc("current_estimate_id", {
      p_project_id: original.project_id,
    });
    const lineIds = Array.from(new Set(splits.map((s) => s.line_item_id)));
    const { data: targetLines } = await supabase
      .from("estimate_line_items")
      .select("id, estimate_id, estimates!inner(project_id)")
      .in("id", lineIds)
      .eq("estimates.project_id", original.project_id);
    const byId = new Map((targetLines ?? []).map((li) => [li.id, li]));
    for (const lineId of lineIds) {
      const li = byId.get(lineId);
      if (!li) {
        return NextResponse.json({ error: "Budget line does not belong to this project" }, { status: 400 });
      }
      if (currentEstimateId && li.estimate_id !== currentEstimateId) {
        return NextResponse.json(
          { error: "That line is on a superseded estimate — book it to the contract's budget line" },
          { status: 400 },
        );
      }
    }

    // If 1 split, just update the existing invoice's estimate_line_item_id
    if (splits.length === 1) {
      const { error } = await supabase.from("invoices")
        .update({ estimate_line_item_id: splits[0].line_item_id, description: splits[0].note || original.description })
        .eq("id", invoiceId);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });

      return NextResponse.json({ success: true, message: "Invoice linked to budget line" });
    }

    const { data: created, error: splitError } = await supabase.rpc("split_vendor_invoice", {
      p_invoice_id: invoiceId,
      p_splits: splits,
    });
    if (splitError) {
      return NextResponse.json({ error: splitError.message }, { status: 400 });
    }

    return NextResponse.json({ success: true, message: `Split into ${splits.length} invoices`, invoices: created });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
