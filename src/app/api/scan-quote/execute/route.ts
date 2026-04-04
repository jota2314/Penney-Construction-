import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * Execute a confirmed quote scan — splits one quote into multiple quotes,
 * each linked to a specific estimate line item.
 * The original quote is marked as "split" (status stays but gets a note).
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

    // Get original quote
    const { data: original } = await supabase
      .from("quote_requests")
      .select("*")
      .eq("id", quoteId)
      .single();

    if (!original) return NextResponse.json({ error: "Quote not found" }, { status: 404 });

    // If only 1 split, just link the original quote to the estimate line
    if (splits.length === 1) {
      await supabase
        .from("quote_requests")
        .update({
          estimate_line_item_id: splits[0].line_item_id,
          amount: splits[0].amount,
        })
        .eq("id", quoteId);

      return NextResponse.json({
        success: true,
        message: "Quote linked to estimate line",
        quotes: [{ id: quoteId, description: splits[0].line_description, amount: splits[0].amount }],
      });
    }

    // Multiple splits — create new quotes for each, mark original as parent
    const newQuotes = splits.map((s: { line_item_id: string; amount: number; line_description: string; scope_note: string }) => ({
      project_id: projectId,
      project_name: original.project_name,
      subcontractor_name: original.subcontractor_name,
      subcontractor_id: original.subcontractor_id,
      trade: original.trade,
      amount: s.amount,
      status: original.status || "received",
      scope_description: s.scope_note || s.line_description,
      document_type: original.document_type || "quote",
      gmail_message_id: original.gmail_message_id,
      attachment_storage_path: original.attachment_storage_path,
      estimate_line_item_id: s.line_item_id,
      created_by: user.id,
    }));

    const { data: created, error: insertError } = await supabase
      .from("quote_requests")
      .insert(newQuotes)
      .select("id, scope_description, amount, estimate_line_item_id");

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    // Mark original quote as split (add note, keep for reference)
    await supabase
      .from("quote_requests")
      .update({
        notes: `Split into ${splits.length} line items on ${new Date().toISOString().split("T")[0]}`,
        status: "accepted",
      })
      .eq("id", quoteId);

    return NextResponse.json({
      success: true,
      message: `Split into ${created?.length || 0} quotes linked to estimate lines`,
      quotes: created,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
