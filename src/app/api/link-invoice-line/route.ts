/**
 * POST /api/link-invoice-line
 *
 * Link (or unlink) one invoice to a budget line. Used by the picker on the
 * transaction detail page at /spent/[id].
 *
 * Guards that the line item belongs to an estimate on the SAME project as the
 * invoice, so a bill can never land on another job's budget.
 */

import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: { invoice_id?: string; line_item_id?: string | null };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const invoiceId = body.invoice_id;
  const lineItemId = body.line_item_id || null;
  if (!invoiceId) return NextResponse.json({ error: "invoice_id required" }, { status: 400 });

  const { data: invoice } = await supabase
    .from("invoices")
    .select("id, project_id")
    .eq("id", invoiceId)
    .maybeSingle();
  if (!invoice) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });

  if (lineItemId) {
    const { data: line } = await supabase
      .from("estimate_line_items")
      .select("id, is_section_header, estimates(project_id)")
      .eq("id", lineItemId)
      .maybeSingle();
    if (!line) return NextResponse.json({ error: "Line item not found" }, { status: 404 });
    if (line.is_section_header) {
      return NextResponse.json(
        { error: "That's a section header — pick a real budget line" },
        { status: 400 },
      );
    }

    const estimate = Array.isArray(line.estimates) ? line.estimates[0] : line.estimates;
    if (!estimate?.project_id || estimate.project_id !== invoice.project_id) {
      return NextResponse.json(
        { error: "That budget line belongs to a different project" },
        { status: 400 },
      );
    }
  }

  const { error } = await supabase
    .from("invoices")
    .update({ estimate_line_item_id: lineItemId })
    .eq("id", invoiceId);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  revalidatePath(`/spent/${invoiceId}`);
  revalidatePath("/spent");
  if (invoice.project_id) revalidatePath(`/projects/${invoice.project_id}`);

  return NextResponse.json({ success: true, line_item_id: lineItemId });
}
