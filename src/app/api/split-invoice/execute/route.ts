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

    // If 1 split, just update the existing invoice's estimate_line_item_id
    if (splits.length === 1) {
      const { data: lineItem } = await supabase
        .from("estimate_line_items")
        .select("estimates!inner(project_id)")
        .eq("id", splits[0].line_item_id)
        .eq("estimates.project_id", original.project_id)
        .maybeSingle();
      if (!lineItem) {
        return NextResponse.json({ error: "Budget line does not belong to this project" }, { status: 400 });
      }

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
