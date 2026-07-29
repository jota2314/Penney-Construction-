import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUser } from "@/lib/auth/get-user";
import { getAnthropicClient, CLAUDE_FALLBACK_MODELS } from "@/lib/ai/claude";

export const runtime = "nodejs";
export const maxDuration = 60;

const BUCKET = "field-captures";
const CONFIDENCE_FLOOR = 0.75;

/**
 * SCAN a receipt. Reads the photo and proposes where every dollar goes — and
 * writes NOTHING to the books. Filing happens in ./commit, once a human has
 * seen the read.
 *
 * Two calls land here:
 *   1. first scan, with `file` — uploads the photo, then reads it
 *   2. re-scan, with `storagePath` + `projectId` — the user corrected the job,
 *      so the items get re-allocated against THAT job's budget lines. The photo
 *      is re-read from the bucket, never re-uploaded; jobsite signal is the
 *      thing that breaks here.
 *
 * Uploads come through our own origin rather than browser->Supabase direct:
 * the cross-origin upload stalls on weak signal and photos vanish (same
 * reasoning as /api/crew/daily-log-photo).
 */

type ScannedItem = { description: string; amount: number | null; trade: string | null };

type Extraction = {
  document_type: "receipt" | "invoice" | "delivery_ticket" | "other";
  vendor_name: string | null;
  amount: number | null;
  invoice_number: string | null;
  date: string | null;
  trade: string | null;
  summary: string | null;
  items: ScannedItem[] | null;
  extracted_text: string | null;
  job_hint: string | null;
  matched_project_id: string | null;
  confidence: number | null;
};

const VISION_MIME = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

const round2 = (n: number): number => Math.round(n * 100) / 100;

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
        response.content[0]?.type === "text" ? response.content[0].text.trim() : "";
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
6. trade — the single trade that best covers the whole receipt
7. summary — one short line naming what was bought, e.g. "2x10 PT joists, joist hangers, structural screws"
8. items — the individual line items you can read, as [{description, amount, trade}]. amount is that line's extended price (qty x unit) as a number, or null if unreadable. trade is the trade THAT item serves: lumber and framing material -> carpentry; wire, devices, boxes -> electrical; pipe, fittings, valves -> plumbing; drywall and compound -> drywall; paint and primer -> painting; tile, thinset, grout -> tile. One store run often mixes trades — that is exactly what this field is for, so be precise per item. Return [] if the receipt shows no itemization.
9. extracted_text — every line of text you can read
10. job_hint — any site address, lot number, client surname or PO written on the ticket. null if none.
11. matched_project_id — if job_hint clearly identifies one job below, its exact id. null if unsure. DO NOT guess.
12. confidence — 0 to 1, how sure you are of vendor_name AND amount together. Be honest; a crumpled or blurry receipt should score low.

Active jobs (id | number | name | address):
${jobList || "(none)"}

Return ONLY valid JSON with exactly those 12 keys.`;

    const extracted = (await askClaude(
      [
        {
          type: "image",
          source: { type: "base64", media_type: mediaType, data: buffer.toString("base64") },
        },
        { type: "text", text: extractPrompt },
      ],
      6000,
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
        ? round2(extracted.amount)
        : null;
    const confidence =
      typeof extracted.confidence === "number" ? extracted.confidence : 0;

    const items = (Array.isArray(extracted.items) ? extracted.items : [])
      .filter((i) => i && typeof i.description === "string")
      .map((i) => ({
        description: i.description,
        amount:
          typeof i.amount === "number" && Number.isFinite(i.amount) ? round2(i.amount) : null,
        trade: i.trade ?? null,
      }));

    // The model will occasionally invent a plausible uuid — only accept one
    // that is actually in the list we handed it.
    const aiProjectId =
      extracted.matched_project_id &&
      jobs.some((j) => j.id === extracted.matched_project_id)
        ? extracted.matched_project_id
        : null;

    const projectId = pickedProjectId || aiProjectId;

    const scan = {
      storagePath,
      documentType: extracted.document_type,
      vendor: vendorName,
      amount,
      invoiceNumber: extracted.invoice_number || null,
      date: extracted.date || null,
      trade: extracted.trade || null,
      summary: extracted.summary || null,
      items,
      jobHint: extracted.job_hint || null,
      extractedText: extracted.extracted_text?.slice(0, 50000) || null,
      confidence,
      lowConfidence: confidence < CONFIDENCE_FLOOR,
      jobGuessed: !pickedProjectId && Boolean(aiProjectId),
    };

    if (!projectId) {
      return NextResponse.json({ status: "needs_job", scan, job: null, allocations: [] });
    }

    const { data: project } = await supabase
      .from("projects")
      .select("id, name, project_number")
      .eq("id", projectId)
      .single();
    if (!project) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }
    const job = {
      id: project.id,
      label: project.project_number
        ? `${project.project_number} ${project.name}`
        : project.name,
    };

    // A delivery ticket carries no money, so there is nothing to allocate.
    if (extracted.document_type === "delivery_ticket" || amount === null) {
      return NextResponse.json({ status: "scanned", scan, job, allocations: [] });
    }

    // --- Allocate the money across this job's budget lines -----------------
    const { data: estimate } = await supabase
      .from("estimates")
      .select("id")
      .eq("project_id", projectId)
      .in("status", ["approved", "draft"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    let allocations: Array<{
      lineItemId: string;
      lineLabel: string;
      trade: string | null;
      amount: number;
      note: string | null;
    }> = [];

    if (estimate) {
      const { data: lines } = await supabase
        .from("estimate_line_items")
        .select("id, description, trade, total_cost")
        .eq("estimate_id", estimate.id)
        .eq("is_section_header", false)
        .limit(200);

      if (lines && lines.length > 0) {
        const itemText = items.length
          ? items
              .map((i) => `- ${i.description} | ${i.amount ?? "?"} | ${i.trade ?? "?"}`)
              .join("\n")
          : "(no itemization readable)";

        const allocPrompt = `A ${vendorName} receipt for $${amount} on job "${job.label}".
What was bought: ${extracted.summary ?? "unknown"}

Items read off the receipt (description | amount | trade):
${itemText}

Receipt text:
${(extracted.extracted_text ?? "").slice(0, 4000)}

Budget lines on this job (id | description | trade | budget):
${lines.map((l) => `${l.id} | ${l.description} | ${l.trade ?? "-"} | ${l.total_cost}`).join("\n")}

Split this receipt across the budget lines it actually paid for. Material bought for a trade belongs on that trade's line. One store run often covers several trades — split it when it did, and return a single allocation when it didn't.

Rules:
- the amounts MUST sum to exactly ${amount}
- put tax and any unattributable remainder on the largest allocation
- only use line ids from the list above
- if nothing in the list genuinely fits, return {"allocations": []} — a wrong line is worse than none

Return ONLY JSON: {"allocations": [{"line_item_id": "<uuid>", "amount": <number>, "note": "<what this covers, 6 words max>"}]}`;

        const proposal = await askClaude([{ type: "text", text: allocPrompt }], 1500);
        const raw = Array.isArray(proposal?.allocations)
          ? (proposal.allocations as Array<Record<string, unknown>>)
          : [];

        const byId = new Map(lines.map((l) => [l.id, l]));
        const cleaned = raw
          .map((a) => ({
            lineItemId: String(a?.line_item_id ?? ""),
            amount:
              typeof a?.amount === "number" && Number.isFinite(a.amount) ? round2(a.amount) : 0,
            note: typeof a?.note === "string" ? a.note : null,
          }))
          .filter((a) => byId.has(a.lineItemId) && a.amount > 0);

        // Same line twice would show up as two rows charging the same budget.
        const merged = new Map<string, { amount: number; note: string | null }>();
        for (const a of cleaned) {
          const prior = merged.get(a.lineItemId);
          merged.set(a.lineItemId, {
            amount: round2((prior?.amount ?? 0) + a.amount),
            note: prior?.note ?? a.note,
          });
        }

        allocations = [...merged.entries()].map(([lineItemId, v]) => ({
          lineItemId,
          lineLabel: byId.get(lineItemId)?.description ?? "Budget line",
          trade: byId.get(lineItemId)?.trade ?? null,
          amount: v.amount,
          note: v.note,
        }));

        // The split has to add up to the receipt. Force any drift onto the
        // biggest line rather than shipping a split that loses or invents money.
        const sum = round2(allocations.reduce((s, a) => s + a.amount, 0));
        if (allocations.length > 0 && Math.abs(sum - amount) > 0.005) {
          let biggest = 0;
          allocations.forEach((a, i) => {
            if (a.amount > allocations[biggest].amount) biggest = i;
          });
          allocations[biggest] = {
            ...allocations[biggest],
            amount: round2(allocations[biggest].amount + round2(amount - sum)),
          };
          allocations = allocations.filter((a) => a.amount > 0);
        }
      }
    }

    return NextResponse.json({ status: "scanned", scan, job, allocations });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
