import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAnthropicClient, CLAUDE_FALLBACK_MODELS } from "@/lib/ai/claude";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Upload an invoice on the Subs board.
 *
 * Two entry points:
 *   with quoteId    -> the per-card button; the sub is known.
 *   without quoteId -> the toolbar button; AI reads the vendor off the
 *                      document and matches it to one of this project's
 *                      quotes (or files it unmatched for /spent/review).
 *
 * Either way the money lands in `invoices` (vendor bills — the project's
 * Spent) and never on the quotes board. Shapes:
 *   attached -> "Approve as Bill" already committed this money as an invoice
 *               row with no document. If the uploaded total matches one of
 *               those rows, the PDF attaches to it instead of double-counting
 *               the spend with a second row.
 *   created  -> a fresh invoices row. Over-billing the quote, a vendor that
 *               doesn't read like the sub, or no match at all gets
 *               review_status=needs_review rather than a silent wrong number.
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

type QuoteRow = {
  id: string;
  project_id: string | null;
  subcontractor_name: string;
  subcontractor_id: string | null;
  trade: string | null;
  amount: number | null;
  estimate_line_item_id: string | null;
  status: string;
};

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const projectId = formData.get("projectId") as string;
    const quoteId = ((formData.get("quoteId") as string) || "").trim() || null;

    if (!file) return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });

    const isPdf = file.type === "application/pdf";
    const isImage = file.type.startsWith("image/");
    if (!isPdf && !isImage) {
      return NextResponse.json({ error: "File must be a PDF or image" }, { status: 400 });
    }

    const { data: project } = await supabase
      .from("projects")
      .select("id, name")
      .eq("id", projectId)
      .single();
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    const { data: projectQuotes } = await supabase
      .from("quote_requests")
      .select("id, project_id, subcontractor_name, subcontractor_id, trade, amount, estimate_line_item_id, status")
      .eq("project_id", projectId);
    const quotes: QuoteRow[] = projectQuotes ?? [];

    const targetQuote = quoteId ? quotes.find((q) => q.id === quoteId) ?? null : null;
    if (quoteId && !targetQuote) {
      return NextResponse.json({ error: "Quote not found on this project" }, { status: 404 });
    }

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

    const matchableQuotes = quotes.filter((q) => q.status !== "declined");
    const quoteList = matchableQuotes
      .map((q) => `${q.id} | ${q.subcontractor_name} | ${q.trade ?? "-"} | ${q.amount != null ? `$${q.amount}` : "no amount"}`)
      .join("\n");

    const contextBlock = targetQuote
      ? `Context: this should be an invoice from subcontractor "${targetQuote.subcontractor_name}"${targetQuote.trade ? ` (${targetQuote.trade})` : ""} for work on the "${project.name}" project.${targetQuote.amount != null ? ` Their quote for this work was $${targetQuote.amount}.` : ""}`
      : `Context: this is an invoice someone uploaded onto the "${project.name}" project. It is probably from one of the subs quoting this job (list below), but it could also be from a supplier or a sub with no quote on file.

Sub quotes on this job (id | company | trade | quote amount):
${quoteList || "(none)"}`;

    const matchFields = targetQuote
      ? ""
      : `
7. matched_quote_id — if the vendor clearly IS one of the subs in the list above, that exact id. null if unsure. DO NOT guess.
8. vendor_type — "subcontractor" if this bills labor/installed work, "supplier" if it is a material/merchant invoice
9. trade — the single construction trade this invoice covers (e.g. electrical, plumbing, carpentry, roofing, windows), or null`;

    const extractionPrompt = `You are reading an invoice for Penney Construction, a residential GC on the North Shore of Massachusetts.

${contextBlock}

Extract:
1. vendor_name — the company billing us, exactly as printed
2. amount — the GRAND TOTAL due as a number (after tax, no $ sign). null if the document shows no total.
3. invoice_number — invoice/bill number if visible
4. date — invoice date, YYYY-MM-DD
5. summary — one short line naming what is being billed, e.g. "Rough plumbing — addition"
6. extracted_text — ALL text from the document (every line item, number, name, date, total)${matchFields}

Return ONLY valid JSON with exactly those ${targetQuote ? "6" : "9"} keys.`;

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
      matched_quote_id?: string | null;
      vendor_type?: string;
      trade?: string | null;
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
        { error: "Couldn't read a dollar total off that document — try a clearer copy." },
        { status: 422 },
      );
    }

    const invoiceNumber = extracted.invoice_number?.trim() || null;
    const invoiceDate =
      typeof extracted.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(extracted.date)
        ? extracted.date
        : new Date().toISOString().slice(0, 10);
    const extractedText = extracted.extracted_text?.slice(0, 50000) || null;
    const docVendor = extracted.vendor_name?.trim() || "";

    // The model will occasionally invent a plausible uuid — only accept one
    // that is actually in the list we handed it.
    const aiMatchedQuote =
      !targetQuote && extracted.matched_quote_id
        ? matchableQuotes.find((q) => q.id === extracted.matched_quote_id) ?? null
        : null;
    const quote = targetQuote ?? aiMatchedQuote;

    // ── Filed against a known quote ──────────────────────────
    if (quote) {
      // A vendor that doesn't read like the sub on the card is worth a human
      // look — wrong card taps happen. Only meaningful when the user picked
      // the card; an AI match came FROM the vendor name.
      const a = simplifyName(docVendor);
      const b = simplifyName(quote.subcontractor_name);
      const vendorMismatch =
        Boolean(targetQuote) && Boolean(a && b && a !== b && !a.includes(b) && !b.includes(a));

      const { data: existing } = await supabase
        .from("invoices")
        .select("id, amount, attachment_storage_path")
        .eq("quote_request_id", quote.id);
      const priorInvoices = existing ?? [];

      // "Approve as Bill" already committed this money — attach the document
      // to that row instead of counting the same dollars twice.
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
          message: `Attached to ${quote.subcontractor_name}'s existing $${amount.toLocaleString()} bill${invoiceNumber ? ` (Inv #${invoiceNumber})` : ""}`,
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
          quote_request_id: quote.id,
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
        message: `Filed $${amount.toLocaleString()} → ${quote.subcontractor_name}${quote.trade ? ` (${quote.trade})` : ""}${reviewReason ? ` — flagged: ${reviewReason}` : ""}`,
      });
    }

    // ── No quote matched — file it on the project for review ─
    const vendorType = extracted.vendor_type === "supplier" ? "supplier" : "subcontractor";
    const reviewReason = "no sub quote matched — assign a budget line in review";
    const { data: created, error: insertError } = await supabase
      .from("invoices")
      .insert({
        project_id: projectId,
        vendor_name: docVendor || "Unknown vendor",
        vendor_type: vendorType,
        trade: extracted.trade?.trim() || null,
        invoice_number: invoiceNumber,
        invoice_date: invoiceDate,
        description: extracted.summary?.trim() || `${docVendor || "Vendor"} invoice`,
        amount,
        paid_amount: 0,
        payment_status: "unpaid",
        attachment_storage_path: storagePath,
        extracted_text: extractedText,
        created_by: user.id,
        source: "quote_upload",
        review_status: "needs_review",
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
      needsReview: true,
      reviewReason,
      message: `Filed $${amount.toLocaleString()} from ${docVendor || "unknown vendor"} — no sub matched, sent to review`,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
