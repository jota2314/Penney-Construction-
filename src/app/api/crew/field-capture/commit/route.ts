import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUser } from "@/lib/auth/get-user";
import { notifyFieldInvoiceCaptured } from "@/lib/notifications/tagged-mentions";
import { resolveSubcontractorId } from "@/lib/subs/resolve-subcontractor";
import { pushVendorExpenseToQuickBooks } from "@/lib/quickbooks/expenses";

export const runtime = "nodejs";
export const maxDuration = 30;

const BUCKET = "field-captures";

/**
 * FILE a scanned receipt, after a human confirmed the read. The scan route
 * proposes; this route is the only one that writes money.
 *
 * Three shapes come out of it:
 *   document -> a delivery ticket with no dollar total, filed as a project
 *               document. NEVER an invoices row: a $0 invoice would silently
 *               drag down the job's Spent.
 *   single   -> one invoices row, optionally pinned to one budget line
 *   split    -> one invoices row fanned out across several budget lines via
 *               split_vendor_invoice(), which enforces that the parts equal
 *               the whole and that every line belongs to this project
 *
 * The client posts back the scan it was shown. That is deliberate — the app's
 * RLS posture is already "any signed-in user sees everything", so re-running a
 * 20-second vision call to defend against a Penney employee editing a number
 * would buy nothing. What IS enforced here: the photo must belong to the
 * caller, the budget lines must belong to the job, and the split must add up.
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
    const storagePath = String(body?.storagePath ?? "").trim();
    const projectId = String(body?.projectId ?? "").trim();
    const documentType = String(body?.documentType ?? "receipt");
    const vendorName = String(body?.vendor ?? "").trim() || "Unknown vendor";
    const rawAmount = body?.amount;
    const amount =
      typeof rawAmount === "number" && Number.isFinite(rawAmount) ? round2(rawAmount) : null;

    if (!storagePath || !projectId) {
      return NextResponse.json({ error: "Missing photo or job" }, { status: 400 });
    }
    // The path is namespaced by profile at upload time, so this is also the
    // check that one person can't file another person's photo.
    if (!storagePath.startsWith(`${profileId}/`)) {
      return NextResponse.json({ error: "Not your capture" }, { status: 403 });
    }

    const { data: project } = await supabase
      .from("projects")
      .select("id, name, project_number")
      .eq("id", projectId)
      .single();
    if (!project) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }
    const projectLabel = project.project_number
      ? `${project.project_number} ${project.name}`
      : project.name;

    const invoiceDate =
      typeof body?.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date)
        ? body.date
        : new Date().toISOString().slice(0, 10);
    // Crew pay at the counter with their company Capital One card unless they
    // say otherwise — the method decides which QBO account the expense draws on.
    // 'on_account' is the house-account pickup: signed for, NOT paid — the
    // supplier bills later, so it files unpaid and stays out of QuickBooks.
    const paymentMethod = ["credit_card", "check", "cash", "on_account"].includes(
      String(body?.paymentMethod),
    )
      ? String(body?.paymentMethod)
      : "credit_card";
    const isOnAccount = paymentMethod === "on_account";
    const summary = typeof body?.summary === "string" ? body.summary : null;

    // --- Delivery ticket ---------------------------------------------------
    if (documentType === "delivery_ticket" || amount === null) {
      const { error: fileError } = await supabase.from("project_files").insert({
        project_id: projectId,
        filename: `${vendorName} delivery ${invoiceDate}.jpg`,
        storage_path: storagePath,
        storage_bucket: BUCKET,
        mime_type: "image/jpeg",
        category: "invoices",
        description: `Delivery ticket — ${vendorName}${summary ? `: ${summary}` : ""}`,
        uploaded_by: profileId,
      });
      if (fileError) {
        return NextResponse.json({ error: fileError.message }, { status: 500 });
      }
      return NextResponse.json({
        status: "document",
        vendor: vendorName,
        project: projectLabel,
      });
    }

    if (amount <= 0) {
      return NextResponse.json({ error: "Amount must be more than zero" }, { status: 400 });
    }

    // --- Validate the allocations against THIS job's estimate --------------
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
        .select("id, description, estimates!inner(project_id)")
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

    // A split that doesn't equal the receipt is a split we refuse to make —
    // it would either lose or invent cost on the job.
    const allocSum = round2(allocations.reduce((s, a) => s + a.amount, 0));
    const splitIsWhole = allocations.length > 0 && Math.abs(allocSum - amount) < 0.011;
    const useSplit = allocations.length > 1 && splitIsWhole;
    const singleLineId =
      allocations.length === 1 && splitIsWhole ? allocations[0].lineItemId : null;

    const reviewReasons: string[] = [];
    if (body?.lowConfidence) reviewReasons.push("AI was not confident reading the receipt");
    if (allocations.length === 0) reviewReasons.push("no budget line matched");
    else if (!splitIsWhole) reviewReasons.push("the split did not add up, so it was left unassigned");
    const reviewReason = reviewReasons.length > 0 ? reviewReasons.join("; ") : null;

    const { data: invoice, error: invoiceError } = await supabase
      .from("invoices")
      .insert({
        project_id: projectId,
        vendor_name: vendorName,
        subcontractor_id: await resolveSubcontractorId(supabase, vendorName),
        vendor_type: "supplier",
        trade: typeof body?.trade === "string" ? body.trade : null,
        invoice_number: typeof body?.invoiceNumber === "string" ? body.invoiceNumber : null,
        invoice_date: invoiceDate,
        description: summary || `${vendorName} — field capture`,
        amount,
        // Paid at the counter = settled; on the house account = cost lands on
        // the job today, but the money is still owed to the supplier.
        paid_amount: isOnAccount ? 0 : amount,
        payment_status: isOnAccount ? "unpaid" : "paid",
        paid_date: isOnAccount ? null : invoiceDate,
        payment_method: paymentMethod,
        attachment_storage_path: storagePath,
        extracted_text:
          typeof body?.extractedText === "string" ? body.extractedText.slice(0, 50000) : null,
        estimate_line_item_id: singleLineId,
        created_by: profileId,
        source: "field_capture",
        review_status: reviewReason ? "needs_review" : "ok",
        review_reason: reviewReason,
      })
      .select("id")
      .single();

    if (invoiceError) {
      return NextResponse.json({ error: invoiceError.message }, { status: 500 });
    }

    let invoiceId = invoice.id;
    let splitCount = 0;
    let allInvoiceIds: string[] = [invoice.id];

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
        // The parent row is still intact and still correct — the whole receipt
        // just sits on one row instead of several. Flag it rather than fail.
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

    // Mirror the paid receipt into QuickBooks as an expense (one Purchase,
    // one line per budget-line allocation, drawn on the filer's card).
    // Flagged reads wait — they push when the office confirms them in
    // /spent/review, so a half-read receipt never lands in QBO wrong.
    // A QBO hiccup must never un-file the receipt — the lib records the
    // failure on quickbooks_push_error instead of throwing.
    if (!reviewReason && !isOnAccount) {
      try {
        await pushVendorExpenseToQuickBooks(allInvoiceIds);
      } catch (err) {
        console.error("[field-capture] QuickBooks push failed", {
          invoiceId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Notification must never break the capture — the receipt is already filed.
    try {
      const admin = createAdminClient();
      const { data: actor } = await admin
        .from("profiles")
        .select("full_name")
        .eq("id", profileId)
        .maybeSingle();

      // Re-read the stored photo so the email can show it. Server-to-server
      // inside the same region, and only on the confirm step.
      let photo: { base64: string; mimeType: string } | null = null;
      const { data: blob } = await supabase.storage.from(BUCKET).download(storagePath);
      if (blob) {
        photo = {
          base64: Buffer.from(await blob.arrayBuffer()).toString("base64"),
          mimeType: blob.type || "image/jpeg",
        };
      }

      await notifyFieldInvoiceCaptured({
        actorId: profileId,
        actorName: actor?.full_name || "A crew member",
        invoiceId,
        vendorName,
        amount,
        projectLabel,
        reviewReason,
        url: reviewReason ? "/spent/review" : `/projects/${projectId}?tab=finances`,
        photo,
      });
    } catch (err) {
      console.error("[field-capture] notification failed", {
        invoiceId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    return NextResponse.json({
      status: "filed",
      invoiceId,
      vendor: vendorName,
      amount,
      project: projectLabel,
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
