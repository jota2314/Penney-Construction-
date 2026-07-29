import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUser } from "@/lib/auth/get-user";
import { getAnthropicClient, CLAUDE_FALLBACK_MODELS } from "@/lib/ai/claude";
import { notifyFieldInvoiceCaptured } from "@/lib/notifications/tagged-mentions";

export const runtime = "nodejs";
export const maxDuration = 60;

const BUCKET = "field-captures";

/**
 * Field capture: a crew member photographs a receipt on the jobsite, Claude
 * reads it, and it files itself as a vendor invoice against the right job and
 * budget line.
 *
 * Three outcomes:
 *   filed      -> invoices row created (review_status ok | needs_review)
 *   document   -> a delivery ticket / packing slip with no dollar amount, filed
 *                 as a project document. NEVER an invoices row, because a $0
 *                 invoice would silently drag down the job's Spent totals.
 *   needs_job  -> the AI could not tell which job it belongs to; the crew
 *                 member picks one and re-posts with { storagePath, projectId }.
 *                 The photo is already in storage by then, so the retry never
 *                 re-uploads over jobsite signal — the route re-reads the image
 *                 from the bucket and re-extracts, so the dollar amount always
 *                 comes from the photo and never from the client.
 *
 * Uploads come through this route rather than browser->Supabase direct: the
 * cross-origin upload stalls on weak jobsite signal and photos vanish (same
 * reasoning as /api/crew/daily-log-photo).
 */

type Extraction = {
  document_type: "receipt" | "invoice" | "delivery_ticket" | "other";
  vendor_name: string | null;
  amount: number | null;
  invoice_number: string | null;
  date: string | null;
  trade: string | null;
  summary: string | null;
  extracted_text: string | null;
  /** Job hint written on the ticket — a site address, lot or client name. */
  job_hint: string | null;
  matched_project_id: string | null;
  /** 0-1. Below CONFIDENCE_FLOOR the capture is posted but flagged. */
  confidence: number | null;
};

const CONFIDENCE_FLOOR = 0.75;

/** What the Anthropic image block accepts. HEIC off an iPhone is not on it. */
const VISION_MIME = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

/** Claude wraps JSON in prose or fences often enough to need both fallbacks. */
function jsonFromModel(raw: string): Record<string, unknown> | null {
  const cleaned = raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(cleaned.substring(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

async function askClaude(
  content: Array<Record<string, unknown>>,
  maxTokens: number,
): Promise<Record<string, unknown> | null> {
  const anthropic = await getAnthropicClient();
  for (const model of CLAUDE_FALLBACK_MODELS) {
    try {
      const response = await anthropic.messages.create({
        model,
        max_tokens: maxTokens,
        messages: [{ role: "user", content: content as never }],
      });
      const text =
        response.content[0]?.type === "text"
          ? response.content[0].text.trim()
          : "";
      if (text) {
        const parsed = jsonFromModel(text);
        if (parsed) return parsed;
      }
    } catch {
      continue;
    }
  }
  return null;
}

export async function POST(request: NextRequest) {
  // Impersonation-aware, same as every other crew route — the capture must be
  // credited to the profile the app is acting as, not the raw auth user.
  const user = await getUser();
  const profileId = user?.profile?.id ?? user?.id;
  if (!profileId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const supabase = await createClient();

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const priorPath = ((formData.get("storagePath") as string) || "").trim();
    const pickedProjectId = ((formData.get("projectId") as string) || "").trim() || null;

    let buffer: Buffer;
    let mediaType: string;
    let storagePath: string;

    if (priorPath) {
      // Retry after "which job?" — the photo is already stored. Re-read it here
      // rather than trusting anything the client echoes back.
      if (!priorPath.startsWith(`${profileId}/`)) {
        return NextResponse.json({ error: "Not your capture" }, { status: 403 });
      }
      const { data: blob, error: downloadError } = await supabase.storage
        .from(BUCKET)
        .download(priorPath);
      if (downloadError || !blob) {
        return NextResponse.json(
          { error: "That photo is no longer available — take it again." },
          { status: 404 },
        );
      }
      buffer = Buffer.from(await blob.arrayBuffer());
      mediaType = blob.type && VISION_MIME.has(blob.type) ? blob.type : "image/jpeg";
      storagePath = priorPath;
    } else {
      if (!file) {
        return NextResponse.json({ error: "No photo uploaded" }, { status: 400 });
      }
      if (!VISION_MIME.has(file.type)) {
        return NextResponse.json(
          {
            error: file.type.startsWith("image/")
              ? "That image format can't be read. Retake the photo."
              : "Field capture takes a photo — use the project Files tab for PDFs",
          },
          { status: 400 },
        );
      }
      buffer = Buffer.from(await file.arrayBuffer());
      mediaType = file.type;
      storagePath = `${profileId}/${crypto.randomUUID()}.jpg`;

      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(storagePath, buffer, { contentType: mediaType });
      if (uploadError) {
        return NextResponse.json(
          { error: `Upload failed: ${uploadError.message}` },
          { status: 500 },
        );
      }
    }

    // Candidate jobs for the AI to match against. Kept small and current —
    // matching against every project the company ever had invites false hits.
    const { data: activeJobs } = await supabase
      .from("projects")
      .select("id, project_number, name, address, city")
      .in("status", ["contracted", "in_progress"])
      .limit(80);

    const jobs = activeJobs ?? [];
    const jobList = jobs
      .map(
        (j) =>
          `${j.id} | ${j.project_number ?? "-"} | ${j.name} | ${j.address ?? ""} ${j.city ?? ""}`.trim(),
      )
      .join("\n");

    const extractPrompt = `You are reading a photo of paperwork a construction crew picked up on a jobsite for Penney Construction, a residential GC on the North Shore of Massachusetts.

It is most likely one of:
- a material receipt (Home Depot, Lowes, a lumberyard, ABC Supply, a tile or plumbing supply house)
- a delivery ticket or packing slip (proves material landed on site, often has NO prices at all)
- a subcontractor's invoice

Extract:
1. document_type — "receipt" if it shows a total charged, "delivery_ticket" if it lists materials but no dollar total, "invoice" for a sub's bill, else "other"
2. vendor_name — the store or company
3. amount — the GRAND TOTAL actually charged, as a number. Use the total AFTER tax. null if the document shows no total.
4. invoice_number — receipt / invoice / ticket number if visible
5. date — YYYY-MM-DD if visible
6. trade — the construction trade the materials serve (lumber and framing materials -> carpentry; wire/devices -> electrical; pipe/fittings -> plumbing; etc.)
7. summary — one short line naming what was actually bought, e.g. "2x10 PT joists, joist hangers, structural screws"
8. extracted_text — every line of text you can read
9. job_hint — any site address, lot number, client surname or PO written on the ticket. null if none.
10. matched_project_id — if job_hint clearly identifies one job below, its exact id. null if unsure. DO NOT guess.
11. confidence — 0 to 1, how sure you are of vendor_name AND amount together. Be honest; a crumpled or blurry receipt should score low.

Active jobs (id | number | name | address):
${jobList || "(none)"}

Return ONLY valid JSON with exactly those 11 keys.`;

    const extracted = (await askClaude(
      [
        {
          type: "image",
          source: { type: "base64", media_type: mediaType, data: buffer.toString("base64") },
        },
        { type: "text", text: extractPrompt },
      ],
      4000,
    )) as Extraction | null;

    if (!extracted) {
      return NextResponse.json(
        { error: "Could not read that photo. Try again with better light." },
        { status: 422 },
      );
    }

    const vendorName = extracted.vendor_name?.trim() || "Unknown vendor";
    const amount =
      typeof extracted.amount === "number" && Number.isFinite(extracted.amount)
        ? extracted.amount
        : null;
    const confidence =
      typeof extracted.confidence === "number" ? extracted.confidence : 0;

    // The model will occasionally invent a plausible-looking uuid. Only accept
    // one that is actually in the candidate list we gave it.
    const aiProjectId =
      extracted.matched_project_id &&
      jobs.some((j) => j.id === extracted.matched_project_id)
        ? extracted.matched_project_id
        : null;

    // The crew member's pick always beats the AI's guess.
    const projectId = pickedProjectId || aiProjectId;

    if (!projectId) {
      // Nothing is written to the books yet — the photo is parked in storage
      // and the crew member is asked which job it belongs to.
      return NextResponse.json({
        status: "needs_job",
        storagePath,
        extracted: {
          vendor_name: vendorName,
          amount,
          summary: extracted.summary,
          document_type: extracted.document_type,
          job_hint: extracted.job_hint,
        },
      });
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

    // --- Delivery ticket branch -------------------------------------------
    // No dollar amount means it is proof of delivery, not a bill. Filing it as
    // an invoice would put a $0 row into the job's cost.
    const isDeliveryTicket =
      extracted.document_type === "delivery_ticket" || amount === null;

    if (isDeliveryTicket) {
      const { error: fileError } = await supabase.from("project_files").insert({
        project_id: projectId,
        filename: `${vendorName} delivery ${extracted.date ?? new Date().toISOString().slice(0, 10)}.jpg`,
        storage_path: storagePath,
        storage_bucket: BUCKET,
        mime_type: mediaType,
        size: buffer.length,
        // 'delivery_ticket' is not an allowed category value, so these file
        // under vendor paperwork with the real type spelled out in description.
        category: "invoices",
        description: `Delivery ticket — ${vendorName}${extracted.summary ? `: ${extracted.summary}` : ""}`,
        uploaded_by: profileId,
      });
      if (fileError) {
        return NextResponse.json({ error: fileError.message }, { status: 500 });
      }

      return NextResponse.json({
        status: "document",
        message: `Delivery ticket filed to ${projectLabel}`,
        vendor: vendorName,
        project: projectLabel,
      });
    }

    // --- Invoice branch ----------------------------------------------------
    // Match to a budget line on the job's current estimate.
    const { data: estimate } = await supabase
      .from("estimates")
      .select("id")
      .eq("project_id", projectId)
      .in("status", ["approved", "draft"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    let lineItemId: string | null = null;
    let lineNote: string | null = null;

    if (estimate) {
      const { data: lines } = await supabase
        .from("estimate_line_items")
        .select("id, description, trade, total_cost")
        .eq("estimate_id", estimate.id)
        .eq("is_section_header", false)
        .limit(200);

      if (lines && lines.length > 0) {
        const linePrompt = `A ${vendorName} receipt for $${amount} on job "${projectLabel}".
What was bought: ${extracted.summary ?? "unknown"}
Trade: ${extracted.trade ?? "unknown"}
Receipt text:
${(extracted.extracted_text ?? "").slice(0, 4000)}

Budget lines on this job (id | description | trade | budget):
${lines.map((l) => `${l.id} | ${l.description} | ${l.trade ?? "-"} | ${l.total_cost}`).join("\n")}

Which SINGLE budget line should this receipt be costed against? Materials bought for a trade belong on that trade's line. If nothing fits, return null — a wrong line is worse than none.

Return ONLY JSON: {"line_item_id": "<uuid or null>", "note": "<short reason>"}`;

        const match = await askClaude([{ type: "text", text: linePrompt }], 500);
        const candidate = match?.line_item_id;
        if (typeof candidate === "string") {
          // Only trust an id that actually exists on this job's estimate.
          if (lines.some((l) => l.id === candidate)) {
            lineItemId = candidate;
            lineNote = typeof match?.note === "string" ? match.note : null;
          }
        }
      }
    }

    // Flag anything the AI was shaky on, or where we could not place the cost.
    const reviewReasons: string[] = [];
    if (confidence < CONFIDENCE_FLOOR) {
      reviewReasons.push("AI was not confident reading the receipt");
    }
    if (!extracted.vendor_name) reviewReasons.push("vendor name unreadable");
    if (!lineItemId) reviewReasons.push("no budget line matched");
    if (!pickedProjectId && aiProjectId) {
      reviewReasons.push("job was guessed from the receipt, not chosen");
    }
    const reviewReason = reviewReasons.length > 0 ? reviewReasons.join("; ") : null;

    const { data: invoice, error: invoiceError } = await supabase
      .from("invoices")
      .insert({
        project_id: projectId,
        vendor_name: vendorName,
        vendor_type: "supplier",
        trade: extracted.trade || null,
        invoice_number: extracted.invoice_number || null,
        invoice_date: extracted.date || new Date().toISOString().slice(0, 10),
        description:
          lineNote || extracted.summary || `${vendorName} — field capture`,
        amount,
        // A crew member paying at the counter means it is already settled.
        paid_amount: amount,
        payment_status: "paid",
        paid_date: extracted.date || new Date().toISOString().slice(0, 10),
        attachment_storage_path: storagePath,
        extracted_text: extracted.extracted_text?.slice(0, 50000) || null,
        estimate_line_item_id: lineItemId,
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

    // Notification must never break the capture — the receipt is already filed.
    try {
      const admin = createAdminClient();
      const { data: actor } = await admin
        .from("profiles")
        .select("full_name")
        .eq("id", profileId)
        .maybeSingle();

      await notifyFieldInvoiceCaptured({
        actorId: profileId,
        actorName: actor?.full_name || "A crew member",
        invoiceId: invoice.id,
        vendorName,
        amount,
        projectLabel,
        reviewReason,
        url: reviewReason ? "/spent/review" : `/projects/${projectId}?tab=finances`,
        // The photo is already in memory and already compressed — show it in
        // the email so the number can be checked without opening the app.
        photo: { base64: buffer.toString("base64"), mimeType: mediaType },
      });
    } catch (err) {
      console.error("[field-capture] notification failed", {
        invoiceId: invoice.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    return NextResponse.json({
      status: "filed",
      invoiceId: invoice.id,
      vendor: vendorName,
      amount,
      project: projectLabel,
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
