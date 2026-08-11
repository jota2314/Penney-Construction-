import { NextRequest, NextResponse } from "next/server";
import { resolveSubAccess, getSubProjectIds } from "@/lib/sub-portal/access";
import { getAnthropicClient, CLAUDE_FALLBACK_MODELS } from "@/lib/ai/claude";

export const runtime = "nodejs";
export const maxDuration = 60;

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * POST /api/sub-portal/upload  (multipart: file, projectId, docType)
 *
 * A sub sends us their own paperwork from the portal. The vendor is never
 * guessed — it IS the signed-in sub, so the row is linked to their
 * subcontractor_id at write time (the name-only rows from email ingest are
 * exactly what broke the portal on 8/5).
 *
 *   docType "quote"   → quote_requests (status received) — shows on the
 *                       project's Subs board like any uploaded quote.
 *   docType "invoice" → invoices, ALWAYS review_status=needs_review — money
 *                       written by an outside party gets a human look at
 *                       /spent/review before it counts anywhere.
 */
export async function POST(request: NextRequest) {
  const access = await resolveSubAccess(request);
  if (!access) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { supabase, subId, companyName, trades } = access;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid upload" }, { status: 400 });
  }

  const file = form.get("file");
  const projectId = ((form.get("projectId") as string) || "").trim();
  const docType = ((form.get("docType") as string) || "").trim();
  if (!(file instanceof File)) return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
  if (!projectId) return NextResponse.json({ error: "Pick a job first" }, { status: 400 });
  if (docType !== "quote" && docType !== "invoice") {
    return NextResponse.json({ error: "Pick quote or invoice" }, { status: 400 });
  }

  const isPdf = file.type === "application/pdf";
  const isImage = file.type.startsWith("image/");
  if (!isPdf && !isImage) {
    return NextResponse.json({ error: "Send a PDF or a photo of the document" }, { status: 400 });
  }

  const projectIds = await getSubProjectIds(supabase, subId);
  if (!projectIds.includes(projectId)) {
    return NextResponse.json({ error: "That job isn't on your list" }, { status: 403 });
  }
  const { data: project } = await supabase
    .from("projects")
    .select("id, name")
    .eq("id", projectId)
    .single();
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  // Same bucket + prefixes the office upload surfaces use, so View PDF links
  // sign against the right place everywhere.
  const fileBuffer = Buffer.from(await file.arrayBuffer());
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const prefix = docType === "invoice" ? "invoice-uploads" : "quote-uploads";
  const storagePath = `${prefix}/${projectId}/${Date.now()}-${safeName}`;
  const { error: uploadError } = await supabase.storage
    .from("email-attachments")
    .upload(storagePath, fileBuffer, { contentType: file.type });
  if (uploadError) {
    return NextResponse.json({ error: `Upload failed: ${uploadError.message}` }, { status: 500 });
  }

  // Read the document — the vendor is known, we only need the numbers.
  const base64 = fileBuffer.toString("base64");
  const documentContent = isPdf
    ? { type: "document" as const, source: { type: "base64" as const, media_type: "application/pdf" as const, data: base64 } }
    : { type: "image" as const, source: { type: "base64" as const, media_type: file.type as "image/jpeg" | "image/png" | "image/gif" | "image/webp", data: base64 } };

  const extractionPrompt = `You are reading a ${docType} that subcontractor "${companyName}" uploaded for the "${project.name}" project (Penney Construction, residential GC, North Shore MA).

Extract:
1. amount — the grand total as a number (after tax, no $ sign). null if no total is shown.
2. document_number — invoice/quote/estimate number if visible
3. date — document date, YYYY-MM-DD
4. trade — the single construction trade this covers (e.g. electrical, plumbing, carpentry, roofing), or null
5. summary — one short line naming the work, e.g. "Rough plumbing — addition"
6. extracted_text — ALL text from the document (every line item, number, name, date, total)

Return ONLY valid JSON with exactly those 6 keys.`;

  const anthropic = await getAnthropicClient();
  let rawContent = "";
  for (const model of CLAUDE_FALLBACK_MODELS) {
    try {
      const response = await anthropic.messages.create({
        model,
        max_tokens: 6000,
        messages: [{ role: "user", content: [documentContent, { type: "text", text: extractionPrompt }] }],
      });
      rawContent = response.content[0]?.type === "text" ? response.content[0].text.trim() : "";
      if (rawContent) break;
    } catch {
      continue;
    }
  }

  let extracted: {
    amount?: number;
    document_number?: string;
    date?: string;
    trade?: string | null;
    summary?: string;
    extracted_text?: string;
  } = {};
  if (rawContent) {
    const cleaned = rawContent
      .replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "").trim();
    try {
      extracted = JSON.parse(cleaned);
    } catch {
      const s = cleaned.indexOf("{");
      const e = cleaned.lastIndexOf("}");
      if (s !== -1 && e > s) {
        try { extracted = JSON.parse(cleaned.substring(s, e + 1)); } catch { /* leave empty */ }
      }
    }
  }

  const amount =
    typeof extracted.amount === "number" && Number.isFinite(extracted.amount) && extracted.amount > 0
      ? round2(extracted.amount)
      : null;
  const docNumber = extracted.document_number?.trim() || null;
  const docDate =
    typeof extracted.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(extracted.date)
      ? extracted.date
      : new Date().toISOString().slice(0, 10);
  const extractedText = extracted.extracted_text?.slice(0, 50000) || null;
  const trade = extracted.trade?.trim() || trades[0] || null;
  const summary = extracted.summary?.trim() || null;

  if (docType === "quote") {
    const { error: insertError } = await supabase
      .from("quote_requests")
      .insert({
        project_id: projectId,
        project_name: project.name,
        subcontractor_name: companyName,
        subcontractor_id: subId,
        trade,
        amount,
        scope_description: summary,
        extracted_text: extractedText,
        document_type: "quote",
        status: "received",
        sent_at: docDate,
        received_at: new Date().toISOString(),
        attachment_storage_path: storagePath,
        created_by: null,
      });
    if (insertError) {
      return NextResponse.json({ error: `Couldn't file the quote: ${insertError.message}` }, { status: 500 });
    }
    return NextResponse.json({
      ok: true,
      message: amount != null
        ? `Quote received — $${amount.toLocaleString()}. We'll take a look.`
        : "Quote received. We'll take a look.",
    });
  }

  // Invoice — needs a readable total to count as money.
  if (amount === null) {
    return NextResponse.json(
      { error: "We couldn't read a dollar total off that document — try a clearer copy or call the office." },
      { status: 422 },
    );
  }

  // If "Approve as Bill" already committed this money as a row with no
  // document, attach the PDF to it instead of double-counting the spend.
  const { data: existing } = await supabase
    .from("invoices")
    .select("id, amount, attachment_storage_path")
    .eq("subcontractor_id", subId)
    .eq("project_id", projectId);
  const attachTarget = (existing ?? []).find(
    (inv) => !inv.attachment_storage_path && Math.abs(Number(inv.amount) - amount) < 1,
  );
  if (attachTarget) {
    const { error: updateError } = await supabase
      .from("invoices")
      .update({
        attachment_storage_path: storagePath,
        invoice_date: docDate,
        extracted_text: extractedText,
        ...(docNumber ? { invoice_number: docNumber } : {}),
        review_status: "needs_review",
        review_reason: `document uploaded by ${companyName} through the sub portal`,
      })
      .eq("id", attachTarget.id);
    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }
    return NextResponse.json({
      ok: true,
      message: `Invoice received — $${amount.toLocaleString()}. Matched to your bill on file.`,
    });
  }

  // Their most recent quote on this job carries the trade + budget-line pin.
  const { data: subQuotes } = await supabase
    .from("quote_requests")
    .select("id, trade, estimate_line_item_id")
    .eq("subcontractor_id", subId)
    .eq("project_id", projectId)
    .order("received_at", { ascending: false, nullsFirst: false })
    .limit(1);
  const quote = subQuotes?.[0] ?? null;

  const { error: insertError } = await supabase
    .from("invoices")
    .insert({
      project_id: projectId,
      vendor_name: companyName,
      vendor_type: "subcontractor",
      trade: quote?.trade ?? trade,
      invoice_number: docNumber,
      invoice_date: docDate,
      description: summary || `${companyName} invoice`,
      amount,
      paid_amount: 0,
      payment_status: "unpaid",
      quote_request_id: quote?.id ?? null,
      subcontractor_id: subId,
      estimate_line_item_id: quote?.estimate_line_item_id ?? null,
      attachment_storage_path: storagePath,
      extracted_text: extractedText,
      created_by: null,
      source: "sub_portal",
      review_status: "needs_review",
      review_reason: `uploaded by ${companyName} through the sub portal`,
    });
  if (insertError) {
    return NextResponse.json({ error: `Couldn't file the invoice: ${insertError.message}` }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    message: `Invoice received — $${amount.toLocaleString()}. The office will review it.`,
  });
}
