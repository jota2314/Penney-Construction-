import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * Execute invoice split — replaces one invoice with multiple, each linked to a budget line.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    const { invoiceId, splits } = await request.json();

    if (!invoiceId || !splits?.length) {
      return NextResponse.json({ error: "invoiceId and splits required" }, { status: 400 });
    }

    const { data: original } = await supabase.from("invoices").select("*").eq("id", invoiceId).single();
    if (!original) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });

    // If 1 split, just update the existing invoice's estimate_line_item_id
    if (splits.length === 1) {
      await supabase.from("invoices")
        .update({ estimate_line_item_id: splits[0].line_item_id, description: splits[0].note || original.description })
        .eq("id", invoiceId);

      return NextResponse.json({ success: true, message: "Invoice linked to budget line" });
    }

    // Multiple splits: create new invoices, delete original
    const newInvoices = splits.map((s: { line_item_id: string; amount: number; note: string }) => ({
      project_id: original.project_id,
      vendor_name: original.vendor_name,
      vendor_type: original.vendor_type,
      trade: original.trade,
      invoice_number: original.invoice_number,
      invoice_date: original.invoice_date,
      due_date: original.due_date,
      terms: original.terms,
      amount: s.amount,
      paid_amount: original.payment_status === "paid" ? s.amount : 0,
      payment_status: original.payment_status,
      paid_date: original.paid_date,
      description: s.note || original.description,
      estimate_line_item_id: s.line_item_id,
      subcontractor_id: original.subcontractor_id,
      quote_request_id: original.quote_request_id,
      gmail_message_id: original.gmail_message_id,
      attachment_storage_path: original.attachment_storage_path,
      created_by: user.id,
    }));

    const { data: created, error: insertError } = await supabase.from("invoices").insert(newInvoices).select("id, description, amount");
    if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });

    // Delete original
    await supabase.from("invoices").delete().eq("id", invoiceId);

    return NextResponse.json({ success: true, message: `Split into ${created?.length} invoices`, invoices: created });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
