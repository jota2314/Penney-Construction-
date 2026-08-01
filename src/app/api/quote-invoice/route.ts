import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAnthropicClient, CLAUDE_FALLBACK_MODELS } from "@/lib/ai/claude";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Upload a sub's invoice against a quote on the Subs board.
 *
 * AI reads the file, then the money lands in `invoices` (vendor bills — the
 * project's Spent) linked to the quote via quote_request_id. Two shapes:
 *   attached -> "Approve as Bill" already committed this money as an invoice
 *               row with no document. If the uploaded total matches one of
 *               those rows, the PDF attaches to it instead of double-counting
 *               the spend with a second row.
 *   created  -> a fresh invoices row. Over-billing the quote or a vendor name
 *               that doesn't read like the sub gets review_status=needs_review
 *               (surfaces in /spent/review) rather than a silent wrong number.
 */

/** Same loose company match the Subs board uses: "Mike's Electric LLC" ↔ "Mikes Electric". */
function simplifyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(llc|inc|corp|co|ltd|company|construction|contracting)\b\.?/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const projectId = formData.get("projectId") as string;
    const quoteId = formData.get("quoteId") as string;

    if (!file) return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    if (!projectId || !quoteId) {
      return NextResponse.json({ error: "projectId and quoteId required" }, { status: 400 });
    }

    const isPdf = file.type === "application/pdf";
    const isImage = file.type.startsWith("image/");
    if (!isPdf && !isImage) {
      return NextResponse.json({ error: "File must be a PDF or image" }, { status: 400 });
    }

    const { data: quote } = await supabase
      .from("quote_requests")
      .select("id, project_id, subcontractor_name, subcontractor_id, trade, amount, estimate_line_item_id")
      .eq("id", quoteId)
      .single();
    if (!quote || quote.project_id !== projectId) {
      return NextResponse.json({ error: "Quote not found on this project" }, { status: 404 });
    }

    const { data: project } = await supabase
      .from("projects")
      .select("id, name")
      .eq("id", projectId)
      .single();
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    // Same bucket the Invoices tab signs its View PDF links against.
    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const storagePath = `invoice-uploads/${projectId}/${Date.now()}-${safeName}`;
    const { error: uploadError } = await supabase.storage
      .from("email-attachments")
      .upload(storagePath, fileBuffer, { contentType: file.type });
    if (uploadError) {
      return NextResponse.json({ error: `Upload failed: ${uploadError.message}` }, { status: 500 });
    }

    const base64 = fileBuffer.toString("base64");
    const documentContent = isPdf
      ? { type: "document" as const, source: { type: "base64" as const, media_type: "application/pdf" as const, data: base64 } }
      : { type: "image" as const, source: { type: "base64" as const, media_type: file.type as "image/jpeg" | "image/png" | "image/gif" | "image/webp", data: base64 } };

    const extractionPrompt = `You are reading an invoice for Penney Construction, a residential GC on the North Shore of Massachusetts.

Context: this should be an invoice from subcontractor "${quote.subcontractor_name}"${quote.trade ? ` (${quote.trade})` : ""} for work on the "${project.name}" project.${quote.amount != null ? ` Their quote for this work was $${quote.amount}.` : ""}

Extract:
1. vendor_name — the company billing us, exactly as printed
2. amount — the GRAND TOTAL due as a number (after tax, no $ sign). null if the document shows no total.
3. invoice_number — invoice/bill number if visible
4. date — invoice date, YYYY-MM-DD
5. summary — one short line naming what is being billed, e.g. "Rough plumbing — addition"
6. extracted_text — ALL text from the document (every line item, number, name, date, total)

Return ONLY valid JSON:
{
  "vendor_name": "...",
  "amount": 1234.56,
  "invoice_number": "...",
  "date": "2026-01-15",
  "summary": "...",
  "extracted_text": "..."
}`;

    const anthropic = await getAnthropicClient();
    let rawContent = "";
    for (const model of CLAUDE_FALLBACK_MODELS) {
      try {
        const response = await anthropic.messages.create({
          model,
          max_tokens: 6000,
          messages: [{
            role: "user",
            content: [documentContent, { type: "text", text: extractionPrompt }],
          }],
        });
        rawContent = response.content[0]?.type === "text" ? response.content[0].text.trim() : "";
        if (rawContent) break;
      } catch { continue; }
    }
    if (!rawContent) {
      return NextResponse.json({ error: "AI extraction failed" }, { status: 500 });
    }

    const cleaned = rawContent
      .replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "").trim();
    let extracted: {
      vendor_name?: string;
      amount?: number;
      invoice_number?: string;
      date?: string;
      summary?: string;
      extracted_text?: string;
    } = {};
    try {
      extracted = JSON.parse(cleaned);
    } catch {
      const s = cleaned.indexOf("{");
      const e = cleaned.lastIndexOf("}");
      if (s !== -1 && e > s) {
        try { extracted = JSON.parse(cleaned.substring(s, e + 1)); } catch { /* */ }
      }
    }

    const amount =
      typeof extracted.amount === "number" && Number.isFinite(extracted.amount) && extracted.amount > 0
        ? round2(extracted.amount)
        : null;
    if (amount === null) {
      return NextResponse.json(
        { error: "Couldn't read a dollar total off that document — try a clearer copy, or add the invoice from the Invoices tab." },
        { status: 422 },
      );
    }

    const invoiceNumber = extracted.invoice_number?.trim() || null;
    const invoiceDate =
      typeof extracted.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(extracted.date)
        ? extracted.date
        : new Date().toISOString().slice(0, 10);
    const extractedText = extracted.extracted_text?.slice(0, 50000) || null;

    // A vendor that doesn't read like the sub on the card is worth a human look —
    // wrong card taps happen. File it anyway; flag it.
    const docVendor = extracted.vendor_name?.trim() || "";
    const a = simplifyName(docVendor);
    const b = simplifyName(quote.subcontractor_name);
    const vendorMismatch = Boolean(a && b && a !== b && !a.includes(b) && !b.includes(a));

    const { data: existing } = await supabase
      .from("invoices")
      .select("id, amount, attachment_storage_path, payment_status")
      .eq("quote_request_id", quoteId);
    const priorInvoices = existing ?? [];

    // "Approve as Bill" already committed this money — attach the document to
    // that row instead of counting the same dollars twice.
    const attachTarget = priorInvoices.find(
      (inv) => !inv.attachment_storage_path && Math.abs(Number(inv.amount) - amount) < 1,
    );

    if (attachTarget) {
      const updates: Record<string, unknown> = {
        attachment_storage_path: storagePath,
        invoice_date: invoiceDate,
        extracted_text: extractedText,
      };
      if (invoiceNumber) updates.invoice_number = invoiceNumber;
      if (vendorMismatch) {
        updates.review_status = "needs_review";
        updates.review_reason = `uploaded document reads "${docVendor}", quote is ${quote.subcontractor_name}`;
      }
      const { data: updated, error: updateError } = await supabase
        .from("invoices")
        .update(updates)
        .eq("id", attachTarget.id)
        .select("*")
        .single();
      if (updateError) {
        return NextResponse.json({ error: updateError.message }, { status: 500 });
      }
      return NextResponse.json({
        success: true,
        mode: "attached",
        invoice: updated,
        message: `Attached to the existing $${amount.toLocaleString()} bill${invoiceNumber ? ` (Inv #${invoiceNumber})` : ""}`,
      });
    }

    const priorBilled = round2(priorInvoices.reduce((s, inv) => s + (Number(inv.amount) || 0), 0));
    const reviewReasons: string[] = [];
    if (vendorMismatch) {
      reviewReasons.push(`uploaded document reads "${docVendor}", quote is ${quote.subcontractor_name}`);
    }
    if (quote.amount != null && priorBilled + amount > Number(quote.amount) + 0.5) {
      reviewReasons.push(
        `billed $${round2(priorBilled + amount).toLocaleString()} against a $${Number(quote.amount).toLocaleString()} quote`,
      );
    }
    const reviewReason = reviewReasons.length > 0 ? reviewReasons.join("; ") : null;

    const { data: created, error: insertError } = await supabase
      .from("invoices")
      .insert({
        project_id: projectId,
        vendor_name: quote.subcontractor_name,
        vendor_type: "subcontractor",
        trade: quote.trade,
        invoice_number: invoiceNumber,
        invoice_date: invoiceDate,
        description: extracted.summary?.trim() || `${quote.subcontractor_name} invoice`,
        amount,
        paid_amount: 0,
        payment_status: "unpaid",
        quote_request_id: quoteId,
        subcontractor_id: quote.subcontractor_id,
        estimate_line_item_id: quote.estimate_line_item_id,
        attachment_storage_path: storagePath,
        extracted_text: extractedText,
        created_by: user.id,
        source: "quote_upload",
        review_status: reviewReason ? "needs_review" : "ok",
        review_reason: reviewReason,
      })
      .select("*")
      .single();
    if (insertError) {
      return NextResponse.json({ error: `Failed to file invoice: ${insertError.message}` }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      mode: "created",
      invoice: created,
      needsReview: Boolean(reviewReason),
      reviewReason,
      message: `Filed $${amount.toLocaleString()}${invoiceNumber ? ` (Inv #${invoiceNumber})` : ""}${reviewReason ? ` — flagged: ${reviewReason}` : ""}`,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
