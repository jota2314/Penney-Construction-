import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUser } from "@/lib/auth/get-user";
import { getAnthropicClient, CLAUDE_FALLBACK_MODELS } from "@/lib/ai/claude";
import { detectQuoteDocument } from "@/lib/finance/quote-detection";
import { detectCreditDocument, signedAmount } from "@/lib/finance/credit-detection";
import { looksLikeFuelPurchase } from "@/lib/finance/spend-category";

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
  document_type: "receipt" | "invoice" | "credit_memo" | "delivery_ticket" | "quote" | "other";
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
  charged_to_account: boolean | null;
  purchase_kind: "fuel" | "meals" | "materials" | null;
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
    let originalFilename: string | null = null;

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
      originalFilename = file.name || null;
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
- a supplier's QUOTE — a price OFFERED for material or work, not money owed

Extract:
1. document_type — "quote" if it is a quote / quotation / estimate / proposal: look for a "Quotation" or "Quote" header, a Quote No, an expiration or valid-until date, or a customer acceptance signature line — a quote is a price OFFERED, never money spent, and must NOT be read as a receipt or invoice. "credit_memo" if it is a credit / credit memo / return slip — a "Credit Memo" header, a "Total Credit" line, returned or restocked material, or totals in parentheses like ($42.50) — money coming BACK to us, the mirror of a receipt. Otherwise "receipt" if it shows a total charged, "delivery_ticket" if it lists materials but no dollar total, "invoice" for a sub's bill, else "other"
2. vendor_name — the store or company
3. amount — the GRAND TOTAL of the charges, as a number, AFTER tax. CAREFUL: the invoice TOTAL, never the "Balance Due" — a paid invoice shows Balance Due $0.00 but its charges are still real money. On a CREDIT MEMO or return, return the total as a NEGATIVE number. null only if the document shows no charges at all.
4. invoice_number — receipt / invoice / ticket number if visible
5. date — YYYY-MM-DD if visible
6. trade — the single trade that best covers the whole receipt
7. summary — one short line naming what was bought, e.g. "2x10 PT joists, joist hangers, structural screws"
8. items — the individual line items you can read, as [{description, amount, trade}]. amount is that line's extended price (qty x unit) as a number, or null if unreadable. trade is the trade THAT item serves: lumber and framing material -> carpentry; wire, devices, boxes -> electrical; pipe, fittings, valves -> plumbing; drywall and compound -> drywall; paint and primer -> painting; tile, thinset, grout -> tile. One store run often mixes trades — that is exactly what this field is for, so be precise per item. Return [] if the receipt shows no itemization.
9. extracted_text — every line of text you can read
10. job_hint — any site address, lot number, client surname or PO written on the ticket. null if none.
11. matched_project_id — if job_hint clearly identifies one job below, its exact id. null if unsure. DO NOT guess.
12. confidence — 0 to 1, how sure you are of vendor_name AND amount together. Be honest; a crumpled or blurry receipt should score low.
13. charged_to_account — true if this purchase went on the customer's HOUSE ACCOUNT at the supplier instead of being paid at the counter: look for "CHARGE", "ON ACCOUNT", "ACCT", a customer account number, "billed to account", or the ABSENCE of any tender line (no card, no cash, no change due) on a lumberyard/supply-house ticket. false if a card/cash tender is shown. null if you can't tell.
14. purchase_kind — "fuel" if this is a gas-station FILL-UP (gallons, price per gallon, pump number, unleaded/diesel — company truck gas, not job material); "meals" if it is restaurant/coffee/food; otherwise "materials". A gas-station ticket that is only snacks or coffee is "meals", not "fuel".

Active jobs (id | number | name | address):
${jobList || "(none)"}

Return ONLY valid JSON with exactly those 14 keys.`;

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
    const amountRead =
      typeof extracted.amount === "number" && Number.isFinite(extracted.amount)
        ? round2(extracted.amount)
        : null;

    // Material goes back to the yard as often as it comes off it. A return
    // slip books NEGATIVE against the same budget line the buy went on, so
    // the line nets down instead of the credit being refused at the tile.
    const creditCheck = detectCreditDocument({
      documentType: extracted.document_type,
      filename: originalFilename,
      extractedText: extracted.extracted_text,
      amount: amountRead,
    });
    const amount = signedAmount(amountRead, creditCheck.isCredit);
    const confidence =
      typeof extracted.confidence === "number" ? extracted.confidence : 0;

    const items = (Array.isArray(extracted.items) ? extracted.items : [])
      .filter((i) => i && typeof i.description === "string")
      .map((i) => ({
        description: i.description,
        amount:
          typeof i.amount === "number" && Number.isFinite(i.amount)
            ? signedAmount(round2(i.amount), creditCheck.isCredit)
            : null,
        trade: i.trade ?? null,
      }));

    // The model will occasionally invent a plausible uuid — only accept one
    // that is actually in the list we handed it.
    const aiProjectId =
      extracted.matched_project_id &&
      jobs.some((j) => j.id === extracted.matched_project_id)
        ? extracted.matched_project_id
        : null;

    // Gas is company overhead, never job cost — route a fill-up straight to
    // the Office — Overhead job, the same place the card recon books it. The
    // AI's read of the ticket is the primary signal; the vendor-name +
    // gallons-text check is the deterministic backstop for a misread. An
    // explicit job pick from the crew member always wins over the auto-route.
    const isFuel =
      extracted.purchase_kind === "fuel" ||
      looksLikeFuelPurchase(extracted.vendor_name, extracted.extracted_text);
    let fuelAutoRouted = false;
    let projectId = pickedProjectId || aiProjectId;
    if (isFuel && !pickedProjectId) {
      const { data: overhead } = await supabase
        .from("projects")
        .select("id")
        .eq("is_overhead", true)
        .limit(1)
        .maybeSingle();
      if (overhead) {
        projectId = overhead.id;
        fuelAutoRouted = true;
      }
    }

    // Quotes are prices OFFERED, not money spent — the commit route refuses
    // to book them, but catching it here keeps the Claude allocation call
    // from even running. Deterministic on purpose: the model is the thing
    // that misread the Sobol quotation in the first place.
    const quoteCheck = detectQuoteDocument({
      documentType: extracted.document_type,
      filename: originalFilename,
      extractedText: extracted.extracted_text,
    });
    const documentType = quoteCheck.isQuote
      ? "quote"
      : creditCheck.isCredit
        ? "credit_memo"
        : extracted.document_type;

    const scan = {
      storagePath,
      documentType,
      filename: originalFilename,
      quoteReason: quoteCheck.reason,
      isCredit: creditCheck.isCredit,
      creditReason: creditCheck.reason,
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
      chargedToAccount: extracted.charged_to_account === true,
      fuelAutoRouted,
    };

    if (!projectId) {
      return NextResponse.json({
        status: "needs_job",
        scan,
        job: null,
        allocations: [],
        budgetLines: [],
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
    const job = {
      id: project.id,
      label: project.project_number
        ? `${project.project_number} ${project.name}`
        : project.name,
    };

    // A delivery ticket carries no money, and a quote's money was never
    // spent — neither has anything to allocate.
    if (documentType === "delivery_ticket" || documentType === "quote" || amount === null) {
      return NextResponse.json({ status: "scanned", scan, job, allocations: [], budgetLines: [] });
    }

    // --- Allocate the money across this job's budget lines -----------------
    // A credit is split on its magnitude and flipped once at the end — asking
    // the model to sum to a negative is how a split stops adding up.
    const allocTotal = Math.abs(amount);
    // Ask the canonical pointer which estimate IS this job's budget. The old
    // query here filtered on status in ('approved','draft'), which silently
    // excluded every SIGNED job: acceptance flips the estimate to 'accepted',
    // so from that moment the route saw zero budget lines and every receipt
    // filed "no budget line matched" — on exactly the jobs where crew buy
    // material. 12 of 30 active jobs were in that state.
    const { data: estimateId } = await supabase.rpc("current_estimate_id", {
      p_project_id: projectId,
    });
    const estimate = estimateId ? { id: estimateId as string } : null;

    let allocations: Array<{
      lineItemId: string;
      lineLabel: string;
      trade: string | null;
      amount: number;
      note: string | null;
    }> = [];
    // The job's budget lines ride back to the phone so the crew member can
    // re-point or split an allocation the AI got wrong before confirming.
    let budgetLines: Array<{ id: string; description: string; trade: string | null }> = [];

    if (estimate) {
      const { data: lines } = await supabase
        .from("estimate_line_items")
        .select("id, description, trade, total_cost")
        .eq("estimate_id", estimate.id)
        .eq("is_section_header", false)
        .limit(200);

      budgetLines = (lines ?? []).map((l) => ({
        id: l.id,
        description: l.description,
        trade: l.trade ?? null,
      }));

      // A fill-up goes on the overhead Fuel line whole — no model call needed.
      if (fuelAutoRouted && lines && lines.length > 0) {
        const fuelLine = lines.find((l) => /fuel|gas/i.test(l.description ?? ""));
        if (fuelLine) {
          allocations = [
            {
              lineItemId: fuelLine.id,
              lineLabel: fuelLine.description,
              trade: fuelLine.trade ?? null,
              amount,
              note: "Gas",
            },
          ];
        }
      }

      if (allocations.length === 0 && lines && lines.length > 0) {
        const itemText = items.length
          ? items
              .map((i) => `- ${i.description} | ${i.amount ?? "?"} | ${i.trade ?? "?"}`)
              .join("\n")
          : "(no itemization readable)";

        const allocPrompt = `A ${vendorName} ${creditCheck.isCredit ? "return credit" : "receipt"} for $${allocTotal} on job "${job.label}".
What was bought: ${extracted.summary ?? "unknown"}

Items read off the receipt (description | amount | trade):
${itemText}

Receipt text:
${(extracted.extracted_text ?? "").slice(0, 4000)}

Budget lines on this job (id | description | trade | budget):
${lines.map((l) => `${l.id} | ${l.description} | ${l.trade ?? "-"} | ${l.total_cost}`).join("\n")}

Split this ${creditCheck.isCredit ? "credit across the budget lines the returned material was bought on" : "receipt across the budget lines it actually paid for"}. Material bought for a trade belongs on that trade's line. One store run often covers several trades — split it when it did, and return a single allocation when it didn't.

Rules:
- the amounts MUST sum to exactly ${allocTotal}
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
        if (allocations.length > 0 && Math.abs(sum - allocTotal) > 0.005) {
          let biggest = 0;
          allocations.forEach((a, i) => {
            if (a.amount > allocations[biggest].amount) biggest = i;
          });
          allocations[biggest] = {
            ...allocations[biggest],
            amount: round2(allocations[biggest].amount + round2(allocTotal - sum)),
          };
          allocations = allocations.filter((a) => a.amount > 0);
        }
      }

      // Back to the slip's own sign before it leaves the route.
      if (creditCheck.isCredit) {
        allocations = allocations.map((a) => ({ ...a, amount: round2(-Math.abs(a.amount)) }));
      }
    }

    return NextResponse.json({ status: "scanned", scan, job, allocations, budgetLines });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
