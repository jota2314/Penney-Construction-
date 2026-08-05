import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { resolveSubcontractorId } from "@/lib/subs/resolve-subcontractor";

export const runtime = "nodejs";

/**
 * Execute a confirmed quote split — creates invoices for each split line.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    const { quoteId, projectId, splits } = await request.json();

    if (!quoteId || !projectId || !splits?.length) {
      return NextResponse.json({ error: "quoteId, projectId, and splits required" }, { status: 400 });
    }

    // Get quote info
    const { data: quote } = await supabase
      .from("quote_requests")
      .select("id, subcontractor_name, subcontractor_id, trade, amount")
      .eq("id", quoteId)
      .single();

    if (!quote) return NextResponse.json({ error: "Quote not found" }, { status: 404 });

    // Create one invoice per split
    const subId =
      quote.subcontractor_id ??
      (await resolveSubcontractorId(supabase, quote.subcontractor_name));
    const invoices = splits.map((s: { line_item_id: string; amount: number; description: string }) => ({
      project_id: projectId,
      vendor_name: quote.subcontractor_name,
      vendor_type: "subcontractor" as const,
      trade: quote.trade,
      amount: s.amount,
      paid_amount: 0,
      payment_status: "unpaid" as const,
      description: s.description,
      estimate_line_item_id: s.line_item_id,
      subcontractor_id: subId,
      quote_request_id: quoteId,
      created_by: user.id,
    }));

    const { data: created, error: insertError } = await supabase
      .from("invoices")
      .insert(invoices)
      .select("id, description, amount, estimate_line_item_id");

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    // Mark quote as approved
    await supabase
      .from("quote_requests")
      .update({ status: "approved", received_at: new Date().toISOString() })
      .eq("id", quoteId);

    return NextResponse.json({
      success: true,
      message: `Created ${created?.length || 0} invoices from quote split`,
      invoices: created,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
