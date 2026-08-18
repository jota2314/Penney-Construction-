import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUser } from "@/lib/auth/get-user";
import { resolveSubcontractorId } from "@/lib/subs/resolve-subcontractor";
import { pushVendorExpenseToQuickBooks } from "@/lib/quickbooks/expenses";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * FILE a bill from the office, after a human confirmed the read (or typed it
 * in by hand — storagePath is optional here, unlike the crew commit).
 *
 * The office flow's extra dimension over the crew one: the bill may be
 * UNPAID. Paid bills book the payment (who paid, how) and mirror straight to
 * QuickBooks as an expense on the payer's card; unpaid bills sit as A/P with
 * a due date and go to QuickBooks later, when someone marks them paid.
 */

type Allocation = { lineItemId: string; amount: number; note?: string | null };

const round2 = (n: number): number => Math.round(n * 100) / 100;

export async function POST(request: NextRequest) {
  const user = await getUser();
  const profileId = user?.profile?.id ?? user?.id;
  if (!profileId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const supabase = await createClient();

  try {
    const body = await request.json();
    const storagePath = String(body?.storagePath ?? "").trim() || null;
    const projectId = String(body?.projectId ?? "").trim();
    const vendorName = String(body?.vendor ?? "").trim();
    const rawAmount = body?.amount;
    const amount =
      typeof rawAmount === "number" && Number.isFinite(rawAmount) ? round2(rawAmount) : null;

    if (!projectId) return NextResponse.json({ error: "Pick a job" }, { status: 400 });
    if (!vendorName) return NextResponse.json({ error: "Vendor is required" }, { status: 400 });
    if (amount === null || amount <= 0) {
      return NextResponse.json({ error: "Amount must be more than zero" }, { status: 400 });
    }
    if (storagePath && !storagePath.startsWith(`${profileId}/`)) {
      return NextResponse.json({ error: "Not your upload" }, { status: 403 });
    }

    const { data: project } = await supabase
      .from("projects")
      .select("id, name, project_number")
      .eq("id", projectId)
      .single();
    if (!project) return NextResponse.json({ error: "Job not found" }, { status: 404 });

    const isPaid = body?.paid === true;
    const paymentMethod = ["credit_card", "check", "cash", "ach"].includes(
      String(body?.paymentMethod),
    )
      ? String(body?.paymentMethod)
      : "credit_card";

    // Who paid decides which Capital One subaccount the QBO expense draws on.
    // Only accept a real profile id; anything else falls back to the filer.
    let paidBy: string | null = null;
    if (isPaid) {
      const requested = String(body?.paidBy ?? "").trim();
      if (requested) {
        const { data: payer } = await supabase
          .from("profiles")
          .select("id")
          .eq("id", requested)
          .maybeSingle();
        paidBy = payer?.id ?? null;
      }
      paidBy = paidBy ?? profileId;
    }

    const dateRe = /^\d{4}-\d{2}-\d{2}$/;
    const invoiceDate =
      typeof body?.date === "string" && dateRe.test(body.date)
        ? body.date
        : new Date().toISOString().slice(0, 10);
    const dueDate =
      !isPaid && typeof body?.dueDate === "string" && dateRe.test(body.dueDate)
        ? body.dueDate
        : null;
    const summary = typeof body?.summary === "string" ? body.summary : null;
    const vendorType = body?.vendorType === "subcontractor" ? "subcontractor" : "supplier";

    // --- Validate allocations against THIS job (same rules as the crew flow)
    const requested: Allocation[] = Array.isArray(body?.allocations)
      ? body.allocations
          .map((a: Record<string, unknown>) => ({
            lineItemId: String(a?.lineItemId ?? ""),
            amount:
              typeof a?.amount === "number" && Number.isFinite(a.amount) ? round2(a.amount) : 0,
            note: typeof a?.note === "string" ? a.note : null,
          }))
          .filter((a: Allocation) => a.lineItemId && a.amount > 0)
      : [];

    let allocations: Allocation[] = [];
    if (requested.length > 0) {
      const { data: validLines } = await supabase
        .from("estimate_line_items")
        .select("id, estimates!inner(project_id)")
        .in(
          "id",
          requested.map((a) => a.lineItemId),
        );
      const ownedByJob = new Set(
        (validLines ?? [])
          .filter((l) => {
            const est = Array.isArray(l.estimates) ? l.estimates[0] : l.estimates;
            return (est as { project_id: string } | null)?.project_id === projectId;
          })
          .map((l) => l.id),
      );
      allocations = requested.filter((a) => ownedByJob.has(a.lineItemId));
    }

    const allocSum = round2(allocations.reduce((s, a) => s + a.amount, 0));
    const splitIsWhole = allocations.length > 0 && Math.abs(allocSum - amount) < 0.011;
    const useSplit = allocations.length > 1 && splitIsWhole;
    const singleLineId =
      allocations.length === 1 && splitIsWhole ? allocations[0].lineItemId : null;

    // The office user just LOOKED at the bill, so their read is the review —
    // only an unassigned bill gets flagged, so it surfaces in the queue until
    // someone puts it on a budget line.
    const reviewReason =
      allocations.length === 0
        ? "no budget line chosen"
        : !splitIsWhole
          ? "the split did not add up, so it was left unassigned"
          : null;

    const { data: invoice, error: invoiceError } = await supabase
      .from("invoices")
      .insert({
        project_id: projectId,
        vendor_name: vendorName,
        subcontractor_id: await resolveSubcontractorId(supabase, vendorName),
        vendor_type: vendorType,
        trade: typeof body?.trade === "string" ? body.trade : null,
        invoice_number: typeof body?.invoiceNumber === "string" ? body.invoiceNumber : null,
        invoice_date: invoiceDate,
        due_date: dueDate,
        description: summary || `${vendorName} — bill`,
        amount,
        paid_amount: isPaid ? amount : 0,
        payment_status: isPaid ? "paid" : "unpaid",
        paid_date: isPaid ? invoiceDate : null,
        payment_method: isPaid ? paymentMethod : null,
        paid_by_profile_id: paidBy,
        attachment_storage_path: storagePath,
        extracted_text:
          typeof body?.extractedText === "string" ? body.extractedText.slice(0, 50000) : null,
        estimate_line_item_id: singleLineId,
        created_by: profileId,
        source: "office_entry",
        review_status: reviewReason ? "needs_review" : "ok",
        review_reason: reviewReason,
      })
      .select("id")
      .single();

    if (invoiceError) {
      return NextResponse.json({ error: invoiceError.message }, { status: 500 });
    }

    let invoiceId = invoice.id;
    let allInvoiceIds: string[] = [invoice.id];
    let splitCount = 0;

    if (useSplit) {
      const { data: children, error: splitError } = await supabase.rpc("split_vendor_invoice", {
        p_invoice_id: invoice.id,
        p_splits: allocations.map((a) => ({
          line_item_id: a.lineItemId,
          amount: a.amount,
          note: a.note ?? null,
        })),
      });

      if (splitError) {
        await supabase
          .from("invoices")
          .update({
            review_status: "needs_review",
            review_reason: `could not split across budget lines: ${splitError.message}`,
          })
          .eq("id", invoice.id);
      } else {
        const rows = (children ?? []) as Array<{ id: string }>;
        splitCount = rows.length;
        if (rows[0]?.id) invoiceId = rows[0].id;
        if (rows.length > 0) allInvoiceIds = rows.map((r) => r.id);
      }
    }

    // Paid + allocated → mirror into QuickBooks now, on the payer's card.
    // Unpaid bills go when they're marked paid; unassigned ones when the
    // review queue blesses them. The lib records failures on
    // quickbooks_push_error instead of throwing.
    if (isPaid && !reviewReason) {
      try {
        await pushVendorExpenseToQuickBooks(allInvoiceIds);
      } catch (err) {
        console.error("[bills/commit] QuickBooks push failed", {
          invoiceId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return NextResponse.json({
      status: "filed",
      invoiceId,
      vendor: vendorName,
      amount,
      paid: isPaid,
      project: project.project_number
        ? `${project.project_number} ${project.name}`
        : project.name,
      splitCount,
      needsReview: Boolean(reviewReason),
      reviewReason,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
