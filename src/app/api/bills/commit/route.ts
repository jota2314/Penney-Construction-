import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUser } from "@/lib/auth/get-user";
import { resolveSubcontractorId } from "@/lib/subs/resolve-subcontractor";
import { isMaterialSupplier, resolveVendorType } from "@/lib/finance/spend-category";
import { detectQuoteDocument } from "@/lib/finance/quote-detection";
import { detectCreditDocument } from "@/lib/finance/credit-detection";
import { canApproveBillPay } from "@/lib/auth/role-access";
import {
  notifyFieldInvoiceCaptured,
  notifyBillApprovedForPay,
} from "@/lib/notifications/tagged-mentions";
import {
  pushVendorExpenseToQuickBooks,
  pushVendorBillToQuickBooks,
} from "@/lib/quickbooks/expenses";

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
  if (!user || !profileId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const supabase = await createClient();

  try {
    const body = await request.json();
    const storagePath = String(body?.storagePath ?? "").trim() || null;
    const projectId = String(body?.projectId ?? "").trim();
    const invoiceNumber =
      typeof body?.invoiceNumber === "string" ? body.invoiceNumber.trim() || null : null;
    const vendorName = String(body?.vendor ?? "").trim();
    const rawAmount = body?.amount;
    const amount =
      typeof rawAmount === "number" && Number.isFinite(rawAmount) ? round2(rawAmount) : null;

    if (!vendorName) return NextResponse.json({ error: "Vendor is required" }, { status: 400 });
    // Negative is legal here: a credit memo is money coming back and books as
    // a negative row against the same line the charge went on. Zero is not —
    // a zero row is a read that failed, not a document.
    if (amount === null || amount === 0) {
      return NextResponse.json({ error: "Amount can't be zero" }, { status: 400 });
    }
    // Own folder only. Files the browser sent straight to storage (over
    // Vercel's body cap — see bill-upload.ts) are keyed on the auth user id,
    // which differs from the profile id while impersonating.
    if (
      storagePath &&
      !storagePath.startsWith(`${profileId}/`) &&
      !storagePath.startsWith(`${user.id}/`)
    ) {
      return NextResponse.json({ error: "Not your upload" }, { status: 403 });
    }

    // Retry guard — a HARD stop, unlike the 45-day duplicate flag below.
    // When an upload looks stuck people tap again, and a second tap files
    // the same bill twice. Same person, same vendor, same amount, within 15
    // minutes, and the SAME document: identical invoice number, or neither
    // has one and it's the same job. Refuse it and point at the row that
    // already exists.
    //
    // Vendor + amount alone is NOT enough: porta-potty companies bill the
    // same monthly rate per site, and Nicole legitimately filed Rest Stop
    // #32257 and #32254 ($205.65 each, two jobs) two minutes apart on 9/3.
    {
      const vendorToken = vendorName.split(/\s+/)[0].replace(/[%_,]/g, "");
      if (vendorToken.length >= 3) {
        const { data: recent } = await supabase
          .from("invoices")
          .select("id, vendor_name, created_at, invoice_number, project_id")
          .eq("amount", amount)
          .eq("created_by", profileId)
          .ilike("vendor_name", `${vendorToken}%`)
          .gte("created_at", new Date(Date.now() - 15 * 60_000).toISOString())
          .order("created_at", { ascending: false })
          .limit(5);
        const prior = (recent ?? []).find((r) =>
          r.invoice_number && invoiceNumber
            ? r.invoice_number.trim().toLowerCase() === invoiceNumber.toLowerCase()
            : !r.invoice_number && !invoiceNumber && (r.project_id ?? null) === (projectId || null),
        );
        if (prior) {
          const minutesAgo = Math.max(
            1,
            Math.round((Date.now() - new Date(prior.created_at).getTime()) / 60_000),
          );
          return NextResponse.json(
            {
              error: `Already filed: ${prior.vendor_name} for $${Math.abs(amount).toFixed(2)} went in ${minutesAgo} min ago. It's in the books — no need to send it again.`,
              duplicateInvoiceId: prior.id,
            },
            { status: 409 },
          );
        }
      }
    }

    // Zero-touch filing: a bill the AI couldn't place still gets FILED — it
    // lands flagged in the review queue instead of blocking the person at a
    // form. A wrong hold-up costs more than a flagged row.
    let project: { id: string; name: string; project_number: string | null } | null = null;
    if (projectId) {
      const { data } = await supabase
        .from("projects")
        .select("id, name, project_number")
        .eq("id", projectId)
        .single();
      if (!data) return NextResponse.json({ error: "Job not found" }, { status: 404 });
      project = data;
    }

    const isPaid = body?.paid === true;

    // Approving at the moment of filing — the person putting the bill in picks
    // the line and clears it for pay in one pass, instead of filing here and
    // then hunting the bill down on /spent/[id] to tap a second button.
    //
    // The client only ASKS; this gate decides. Same allowlist as
    // approveBillForPay, checked against the REAL account so View-as can't
    // approve. A paid bill has nothing to approve — the money already left.
    const approverEmail = user?.realProfile?.email ?? user?.email;
    const wantsApproval = body?.approveForPay === true && !isPaid;
    const canApprove = wantsApproval && canApproveBillPay(approverEmail);
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
    // The dialog guesses the type from what the scanner thought the document
    // was (invoice → subcontractor, anything else → supplier). A sub's bill
    // the scanner read as a QUOTE arrived typed "supplier", so the Weekly
    // Close filed it under materials instead of "Payments to subs" (WRD Pro
    // Painting $7,500, Parziale, 9/2). WHO the vendor is outranks that guess:
    // a name that resolves to a subcontractor record is a sub, unless the
    // name is a known material dealer (Building Center, Jackson Lumber).
    const subcontractorId = await resolveSubcontractorId(supabase, vendorName);
    const vendorType =
      subcontractorId && !isMaterialSupplier(vendorName)
        ? "subcontractor"
        : resolveVendorType(vendorName, body?.vendorType === "subcontractor" ? "subcontractor" : "supplier");

    // --- Validate allocations against THIS job (same rules as the crew flow)
    const requested: Allocation[] = Array.isArray(body?.allocations)
      ? body.allocations
          .map((a: Record<string, unknown>) => ({
            lineItemId: String(a?.lineItemId ?? ""),
            amount:
              typeof a?.amount === "number" && Number.isFinite(a.amount) ? round2(a.amount) : 0,
            note: typeof a?.note === "string" ? a.note : null,
          }))
          .filter((a: Allocation) => a.lineItemId && a.amount !== 0)
      : [];

    let allocations: Allocation[] = [];
    if (requested.length > 0 && projectId) {
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

    // Duplicate guard: the same bill often arrives twice — WRD emails their
    // invoice (email triage files it) and then someone drops the same PDF at
    // the tile. Same money, same job, same vendor family, recent = suspicious.
    // Zero-touch still files it, but FLAGGED, so it dies in Needs check
    // instead of silently doubling the job's Spent.
    let duplicateOf: { id: string; vendor_name: string; invoice_date: string | null } | null = null;
    {
      const vendorToken = vendorName.split(/\s+/)[0].replace(/[%_,]/g, "");
      if (vendorToken.length >= 3) {
        let dupeQuery = supabase
          .from("invoices")
          .select("id, vendor_name, invoice_date, invoice_number")
          .eq("amount", amount)
          .ilike("vendor_name", `${vendorToken}%`)
          .gte("created_at", new Date(Date.now() - 45 * 86400_000).toISOString())
          .limit(10);
        dupeQuery = projectId
          ? dupeQuery.eq("project_id", projectId)
          : dupeQuery.is("project_id", null);
        const { data: dupes } = await dupeQuery;
        // A recurring bill (porta-potty, dumpster) repeats the same amount on
        // the same job every month — two DIFFERENT invoice numbers are two
        // bills, not a duplicate. Only flag when the numbers match or one
        // side has none to compare.
        duplicateOf =
          (dupes ?? []).find(
            (d) =>
              !d.invoice_number ||
              !invoiceNumber ||
              d.invoice_number.trim().toLowerCase() === invoiceNumber.toLowerCase(),
          ) ?? null;
      }
    }

    // A quote is a price OFFERED, not money owed — booking one inflates the
    // job's Spent (the Sobol BC of Essex quotation, $6,834.48 of phantom
    // cost). The office flow flags rather than blocks (a wrong hold-up costs
    // more than a flagged row), so it dies in Needs check instead of QBO.
    const quoteCheck = detectQuoteDocument({
      documentType: typeof body?.documentType === "string" ? body.documentType : null,
      filename: typeof body?.filename === "string" ? body.filename : null,
      extractedText: typeof body?.extractedText === "string" ? body.extractedText : null,
    });

    // A credit books negative and files as PAID when the refund already went
    // back on the card. It still lands in Needs check: the question a credit
    // always raises is whether the charge it reverses is even in the books —
    // the BC of Essex pallet refund landed on a job whose $40 pallet deposit
    // was never filed, so an unreviewed credit would push that line negative.
    const isCredit =
      amount < 0 ||
      detectCreditDocument({
        documentType: typeof body?.documentType === "string" ? body.documentType : null,
        filename: typeof body?.filename === "string" ? body.filename : null,
        extractedText: typeof body?.extractedText === "string" ? body.extractedText : null,
        amount,
      }).isCredit;

    // The office user just LOOKED at the bill, so their read is the review —
    // only an unassigned or suspicious bill gets flagged, so it surfaces in
    // the queue until someone resolves it.
    const reviewReason = quoteCheck.isQuote
      ? `this looks like a QUOTE, not a bill (${quoteCheck.reason}) — a price offered is not money owed; discard it, or confirm it really is an invoice`
      : duplicateOf
      ? `looks like the SAME bill as ${duplicateOf.vendor_name} for the same amount${duplicateOf.invoice_date ? ` (${duplicateOf.invoice_date})` : ""} already in the books — confirm it's really a second one, or discard`
      : !projectId
        ? "AI couldn't tell the job — pick one"
        : allocations.length === 0
          ? "no budget line chosen"
          : !splitIsWhole
            ? "the split did not add up, so it was left unassigned"
            : isCredit
              ? "this is a CREDIT — it books negative against this line; confirm the charge it reverses is already in the books"
              : null;

    // Approval only sticks on a CLEAN bill: coded to a budget line, not a
    // suspected duplicate or quote. Anything with a review reason files
    // pending no matter what the client asked for — approving a bill that
    // isn't on a line is a signature on an unknown, which is the whole thing
    // this flow exists to stop.
    const approvedNow = canApprove && !reviewReason;
    const approvedAt = approvedNow ? new Date().toISOString() : null;

    const { data: invoice, error: invoiceError } = await supabase
      .from("invoices")
      .insert({
        project_id: projectId || null,
        vendor_name: vendorName,
        subcontractor_id: subcontractorId,
        vendor_type: vendorType,
        trade: typeof body?.trade === "string" ? body.trade : null,
        invoice_number: invoiceNumber,
        invoice_date: invoiceDate,
        // Lets /spent/review show the suspected original side by side.
        duplicate_of_id: duplicateOf?.id ?? null,
        due_date: dueDate,
        description: summary || `${vendorName} — ${isCredit ? "credit" : "bill"}`,
        amount,
        paid_amount: isPaid ? amount : 0,
        payment_status: isPaid ? "paid" : "unpaid",
        pay_approval_status: isPaid ? null : approvedNow ? "approved" : "pending",
        pay_approved_by: approvedNow ? profileId : null,
        pay_approved_at: approvedAt,
        approved_for_pay_by: approvedNow ? profileId : null,
        approved_for_pay_at: approvedAt,
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

        // The split replaces the parent with per-line pieces, so carry the
        // approval onto every piece — it is still one check to one vendor,
        // and a half-approved split would strand the rest at the pay gate.
        if (approvedNow && rows.length > 0) {
          await supabase
            .from("invoices")
            .update({
              pay_approval_status: "approved",
              pay_approved_by: profileId,
              pay_approved_at: approvedAt,
              approved_for_pay_by: profileId,
              approved_for_pay_at: approvedAt,
            })
            .in("id", allInvoiceIds);
        }
      }
    }

    // Paid + allocated → mirror into QuickBooks now, on the payer's card.
    // Unpaid bills go when they're marked paid; unassigned ones when the
    // review queue blesses them. The lib records failures on
    // quickbooks_push_error instead of throwing.
    // Paid → QBO Expense now. Unpaid → QBO Bill now (A/P shows on the QB
    // Bills page; Mark-paid later posts a BillPayment against it). Flagged
    // rows wait for the review queue either way.
    if (!reviewReason) {
      try {
        if (isPaid) await pushVendorExpenseToQuickBooks(allInvoiceIds);
        else await pushVendorBillToQuickBooks(allInvoiceIds);
      } catch (err) {
        console.error("[bills/commit] QuickBooks push failed", {
          invoiceId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Jorge, Nicole and Ryan hear about EVERY bill that enters the books
    // (Jorge 8/19) — same watchers as the crew scanner, filer excluded.
    // Best-effort: a notify failure never breaks the filing.
    try {
      const admin = createAdminClient();
      const { data: actor } = await admin
        .from("profiles")
        .select("full_name")
        .eq("id", profileId)
        .maybeSingle();

      // Photos embed in the email; PDFs just get the link.
      let photo: { base64: string; mimeType: string } | null = null;
      if (storagePath && !storagePath.toLowerCase().endsWith(".pdf")) {
        const { data: blob } = await supabase.storage
          .from("field-captures")
          .download(storagePath);
        if (blob) {
          photo = {
            base64: Buffer.from(await blob.arrayBuffer()).toString("base64"),
            mimeType: blob.type || "image/jpeg",
          };
        }
      }

      const projectLabel = project
        ? project.project_number
          ? `${project.project_number} ${project.name}`
          : project.name
        : "no job yet";

      // A bill approved as it was filed is already cleared — telling the
      // office "an invoice is ready for your approval" would be asking for a
      // signature that exists. Send the pay notice instead, so Nicole gets the
      // one message that matters: this is good to pay.
      if (approvedNow) {
        await notifyBillApprovedForPay({
          actorId: profileId,
          actorName: actor?.full_name || "Someone at the office",
          invoiceId,
          vendorName,
          amount,
          projectLabel,
          invoiceNumber: typeof body?.invoiceNumber === "string" ? body.invoiceNumber : null,
          dueDate,
          url: `/spent/${invoiceId}`,
        });
      } else {
        await notifyFieldInvoiceCaptured({
          actorId: profileId,
          actorName: actor?.full_name || "Someone at the office",
          invoiceId,
          vendorName,
          amount,
          projectLabel,
          reviewReason,
          docKind: isPaid ? "receipt" : "invoice",
          url: reviewReason ? "/spent/review" : `/spent/${invoiceId}`,
          photo,
        });
      }
    } catch (err) {
      console.error("[bills/commit] notification failed", {
        invoiceId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    return NextResponse.json({
      status: "filed",
      invoiceId,
      vendor: vendorName,
      amount,
      paid: isPaid,
      project: project
        ? project.project_number
          ? `${project.project_number} ${project.name}`
          : project.name
        : null,
      splitCount,
      needsReview: Boolean(reviewReason),
      reviewReason,
      approvedForPay: approvedNow,
      // Asked to approve but the gate said no — the UI says so rather than
      // silently filing it pending and letting someone think it was cleared.
      approvalDenied: wantsApproval && !approvedNow,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
