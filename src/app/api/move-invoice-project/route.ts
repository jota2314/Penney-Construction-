/**
 * POST /api/move-invoice-project
 *
 * Move one invoice to a different project (or to overhead with project_id
 * null). Used by the project picker on the transaction detail page at
 * /spent/[id].
 *
 * The budget-line and change-order links belong to the OLD project's
 * estimate, so a move always clears them — the bill lands on the new job
 * unfiled and gets booked to a line there.
 */

import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: { invoice_id?: string; project_id?: string | null };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const invoiceId = body.invoice_id;
  const projectId = body.project_id || null;
  if (!invoiceId) return NextResponse.json({ error: "invoice_id required" }, { status: 400 });

  const { data: invoice } = await supabase
    .from("invoices")
    .select("id, project_id")
    .eq("id", invoiceId)
    .maybeSingle();
  if (!invoice) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });

  if (projectId === invoice.project_id) {
    return NextResponse.json({ success: true, project_id: projectId, unchanged: true });
  }

  if (projectId) {
    const { data: project } = await supabase
      .from("projects")
      .select("id")
      .eq("id", projectId)
      .maybeSingle();
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const { error } = await supabase
    .from("invoices")
    .update({
      project_id: projectId,
      estimate_line_item_id: null,
      change_order_id: null,
    })
    .eq("id", invoiceId);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  revalidatePath(`/spent/${invoiceId}`);
  revalidatePath("/spent");
  if (invoice.project_id) revalidatePath(`/projects/${invoice.project_id}`);
  if (projectId) revalidatePath(`/projects/${projectId}`);

  return NextResponse.json({ success: true, project_id: projectId });
}
