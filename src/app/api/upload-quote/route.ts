import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAnthropicClient, CLAUDE_FALLBACK_MODELS } from "@/lib/ai/claude";
import { resolveSubcontractorId } from "@/lib/subs/resolve-subcontractor";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Upload a quote file (PDF/image), AI extracts details, creates quote_request.
 * Accepts multipart form data with: file, projectId
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const projectId = formData.get("projectId") as string;
    const estimateLineItemId = (formData.get("estimateLineItemId") as string) || null;
    // Set when the upload comes from a trade section on the Subs board — the
    // quote must land in the trade the user clicked, whatever the PDF reads like.
    const tradeOverride = ((formData.get("trade") as string) || "").trim() || null;

    if (!file) return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });

    // Get project info
    const { data: project } = await supabase
      .from("projects")
      .select("id, name")
      .eq("id", projectId)
      .single();
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    // Upload file to Supabase storage
    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const fileName = `quote-uploads/${projectId}/${Date.now()}-${file.name}`;
    const { error: uploadError } = await supabase.storage
      .from("email-attachments")
      .upload(fileName, fileBuffer, { contentType: file.type });

    if (uploadError) {
      return NextResponse.json({ error: `Upload failed: ${uploadError.message}` }, { status: 500 });
    }

    // Convert file to base64 for Claude
    const base64 = fileBuffer.toString("base64");
    const isPdf = file.type === "application/pdf";
    const isImage = file.type.startsWith("image/");

    if (!isPdf && !isImage) {
      return NextResponse.json({ error: "File must be a PDF or image" }, { status: 400 });
    }

    // Send to Claude for extraction
    const anthropic = await getAnthropicClient();

    const documentContent = isPdf
      ? { type: "document" as const, source: { type: "base64" as const, media_type: "application/pdf" as const, data: base64 } }
      : { type: "image" as const, source: { type: "base64" as const, media_type: file.type as "image/jpeg" | "image/png" | "image/gif" | "image/webp", data: base64 } };

    const extractionPrompt = `You are analyzing a construction quote/invoice document for a residential general contractor (Penney Construction, North Shore MA).

Extract ALL information from this document:

1. **vendor_name** — The company or person who sent the quote
2. **amount** — Total dollar amount (number only, no $ sign)
3. **trade** — Construction trade (e.g., electrical, plumbing, carpentry, roofing, painting, flooring, windows, doors, hvac, insulation, drywall, masonry, landscaping, demolition)
4. **scope_description** — Brief description of the work/materials quoted
5. **extracted_text** — ALL text from the document (every line item, number, name, date, total)
6. **document_type** — One of: quote, invoice, estimate, proposal, change_order, receipt
7. **date** — Date on the document (YYYY-MM-DD format)

Project: ${project.name}

Return ONLY valid JSON:
{
  "vendor_name": "...",
  "amount": 1234.56,
  "trade": "...",
  "scope_description": "...",
  "extracted_text": "...",
  "document_type": "quote",
  "date": "2026-01-15"
}`;

    let rawContent = "";
    for (const model of CLAUDE_FALLBACK_MODELS) {
      try {
        const response = await anthropic.messages.create({
          model,
          max_tokens: 4000,
          messages: [{
            role: "user",
            content: [
              documentContent,
              { type: "text", text: extractionPrompt },
            ],
          }],
        });
        rawContent = response.content[0]?.type === "text" ? response.content[0].text.trim() : "";
        if (rawContent) break;
      } catch { continue; }
    }

    if (!rawContent) {
      return NextResponse.json({ error: "AI extraction failed" }, { status: 500 });
    }

    // Parse AI response
    const cleaned = rawContent
      .replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "").trim();

    let extracted: {
      vendor_name?: string;
      amount?: number;
      trade?: string;
      scope_description?: string;
      extracted_text?: string;
      document_type?: string;
      date?: string;
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

    if (!extracted.vendor_name) {
      return NextResponse.json({ error: "Could not extract quote details from document" }, { status: 400 });
    }

    // Create quote_request
    const subcontractorId = await resolveSubcontractorId(supabase, extracted.vendor_name);
    const { data: quote, error: insertError } = await supabase
      .from("quote_requests")
      .insert({
        project_id: projectId,
        project_name: project.name,
        subcontractor_name: extracted.vendor_name,
        subcontractor_id: subcontractorId,
        trade: tradeOverride || extracted.trade || null,
        amount: extracted.amount || null,
        scope_description: extracted.scope_description || null,
        extracted_text: extracted.extracted_text?.substring(0, 50000) || null,
        document_type: extracted.document_type || "quote",
        status: "received",
        sent_at: extracted.date || new Date().toISOString(),
        received_at: new Date().toISOString(),
        attachment_storage_path: fileName,
        estimate_line_item_id: estimateLineItemId,
        created_by: user.id,
      })
      .select("*")
      .single();

    if (insertError) {
      return NextResponse.json({ error: `Failed to create quote: ${insertError.message}` }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      quote,
      extracted,
      message: `${extracted.vendor_name} — ${extracted.trade || "General"} — $${extracted.amount || "TBD"}`,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
