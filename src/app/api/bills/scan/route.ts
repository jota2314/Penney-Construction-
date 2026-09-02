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
 * The OFFICE side of bill intake — the desk cousin of the crew receipt
 * scanner (/api/crew/field-capture). Ryan gets handed a sub's bill, drops the
 * photo OR PDF here, and gets back a proposed read: vendor, total, dates, the
 * job it belongs to, and how it splits across that job's budget lines.
 *
 * Differences from the crew scan, on purpose:
 *   - PDFs are accepted (sub bills arrive as PDFs; jobsite receipts don't)
 *   - the job list offered to the model includes the Overhead project, so an
 *     insurance or fuel bill can be filed without leaving the flow
 *   - it reads "invoice" documents as first-class, not an edge case
 *
 * Writes NOTHING to the books — ./commit does that after a human confirms.
 */

type ScannedItem = { description: string; amount: number | null; trade: string | null };

type Extraction = {
  document_type: "receipt" | "invoice" | "credit_memo" | "delivery_ticket" | "quote" | "other";
  vendor_name: string | null;
  amount: number | null;
  invoice_number: string | null;
  date: string | null;
  due_date: string | null;
  trade: string | null;
  summary: string | null;
  items: ScannedItem[] | null;
  extracted_text: string | null;
  job_hint: string | null;
  matched_project_id: string | null;
  confidence: number | null;
  balance_due: number | null;
  paid_stamp: boolean | null;
  purchase_kind: "fuel" | "meals" | "materials" | null;
};

const VISION_MIME = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
const PDF_MIME = "application/pdf";

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** "CO #6 · " for a change-order line, "" for base scope. */
function coPrefix(l: { change_order_id?: string | null; change_orders?: unknown }): string {
  if (!l.change_order_id) return "";
  const co = (Array.isArray(l.change_orders) ? l.change_orders[0] : l.change_orders) as
    | { change_order_number: number | null }
    | null
    | undefined;
  return co?.change_order_number ? `CO #${co.change_order_number} · ` : "CO · ";
}

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
        return NextResponse.json({ error: "Not your upload" }, { status: 403 });
      }
      const { data: blob, error: downloadError } = await supabase.storage
        .from(BUCKET)
        .download(priorPath);
      if (downloadError || !blob) {
        return NextResponse.json(
          { error: "That file is no longer available — upload it again." },
          { status: 404 },
        );
      }
      buffer = Buffer.from(await blob.arrayBuffer());
      mediaType =
        blob.type === PDF_MIME || VISION_MIME.has(blob.type) ? blob.type : "image/jpeg";
      storagePath = priorPath;
    } else {
      if (!file) {
        return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
      }
      if (!VISION_MIME.has(file.type) && file.type !== PDF_MIME) {
        return NextResponse.json(
          { error: "Upload a photo or a PDF of the bill." },
          { status: 400 },
        );
      }
      buffer = Buffer.from(await file.arrayBuffer());
      mediaType = file.type;
      originalFilename = file.name || null;
      storagePath = `${profileId}/${crypto.randomUUID()}.${file.type === PDF_MIME ? "pdf" : "jpg"}`;

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

    // EVERY job, not just the active ones. This used to filter
    // `status.in.(contracted,in_progress)` plus overhead, which meant a sub's
    // final invoice — the ones that arrive precisely when a job has moved on
    // to `audit` — had no candidate to match against, so the AI could only
    // ever return "no job" (Picardi #3358 → Weidlein Bathroom PC-2026-067).
    // Status rides along in the list instead, so the model can prefer a live
    // job on an ambiguous address without a closed one being invisible.
    const { data: allJobs } = await supabase
      .from("projects")
      .select("id, project_number, name, address, city, is_overhead, status")
      .limit(300);

    const ACTIVE = new Set(["contracted", "in_progress"]);
    const jobs = (allJobs ?? []).sort((a, b) => {
      const rank = (j: typeof a) =>
        j.is_overhead ? 0 : ACTIVE.has(j.status ?? "") ? 1 : j.status === "audit" ? 2 : 3;
      return rank(a) - rank(b) || (a.name ?? "").localeCompare(b.name ?? "");
    });
    const jobList = jobs
      .map(
        (j) =>
          `${j.id} | ${j.project_number ?? "-"} | ${j.name}${j.is_overhead ? " (COMPANY OVERHEAD — insurance, fuel, office, anything not for a jobsite)" : ` [${j.status ?? "?"}]`} | ${j.address ?? ""} ${j.city ?? ""}`.trim(),
      )
      .join("\n");

    const extractPrompt = `You are reading a bill handed to the office of Penney Construction, a residential GC on the North Shore of Massachusetts.

It is most likely one of:
- a subcontractor's invoice (a plumber, electrician, painter, mason billing for work on a job)
- a supplier invoice or receipt (lumberyard, Home Depot, tile or plumbing supply house)
- a company bill that belongs to overhead (insurance, fuel, software, office)
- a QUOTE — a price OFFERED for material or work, not money owed
- a CREDIT MEMO — money coming BACK to us (a returned pallet, restocked material, a billing correction)

Extract:
1. document_type — "quote" if it is a quote / quotation / estimate / proposal: look for a "Quotation" or "Quote" header, a Quote No, an expiration or valid-until date, or a customer acceptance signature line — a quote is a price OFFERED, never money owed, and must NOT be read as an invoice. "credit_memo" if it is a credit / credit memo / credit note / return: look for a "Credit Memo" header, a Credit Memo No, a "Total Credit" line, returned or restocked material, or totals printed in parentheses like ($42.50) — a credit is money coming BACK, the mirror of a bill. Otherwise "invoice" for a bill someone sent us, "receipt" if it shows a payment already made at a register, "delivery_ticket" if it lists materials but no dollar total, else "other"
2. vendor_name — the company or person billing us
3. amount — the GRAND TOTAL of the charges (sum of the line items, after tax), as a number. CAREFUL: this is the invoice TOTAL, NOT the "Balance Due" — a paid invoice shows Balance Due $0.00 but its charges are still real money. If the document shows both a total and a balance due, use the TOTAL of charges. On a CREDIT MEMO, return the total as a NEGATIVE number — ($42.50) or a "Total Credit" of 42.50 is -42.50. null only if no charges are shown at all.
4. invoice_number — invoice / receipt number if visible
5. date — the invoice date, YYYY-MM-DD if visible
6. due_date — the payment due date if stated (e.g. "Net 30" from the invoice date, or an explicit date), YYYY-MM-DD, else null
7. trade — the single trade that best covers the bill (plumbing, electrical, painting, carpentry, ...)
8. summary — one short line naming what the bill is for, e.g. "rough plumbing, second floor bath"
9. items — readable line items as [{description, amount, trade}], amount = that line's extended price or null (negative on a credit memo). [] if none.
10. extracted_text — every line of text you can read
11. job_hint — any site address, client surname, lot number or PO on the bill. null if none.
12. matched_project_id — if job_hint clearly identifies one job below, its exact id. A company bill with no jobsite (insurance, fuel, software) matches the COMPANY OVERHEAD project. null if unsure. DO NOT guess between jobs.
13. confidence — 0 to 1, how sure you are of vendor_name AND amount together.
14. balance_due — the "Balance Due" / "Amount Due" figure if the document shows one, as a number (0 is meaningful — it means paid). null if not shown.
15. paid_stamp — true if the document carries a PAID stamp, "payment received", or Payments/Credits equal to the total. false otherwise.
16. purchase_kind — "fuel" if this is a gas-station FILL-UP (gallons, price per gallon, pump number, unleaded/diesel — company truck gas, not job material); "meals" if it is restaurant/coffee/food; otherwise "materials". A gas-station ticket that is only snacks or coffee is "meals", not "fuel".

Jobs (id | number | name [status] | address). A sub's FINAL bill usually lands
after its job has left construction, so an audit or completed job is a
perfectly normal match — match on the ADDRESS and client name, not the status.
Only when an address genuinely fits two jobs equally does the more active one
win; if it still fits two, return null rather than guessing:
${jobList || "(none)"}

Return ONLY valid JSON with exactly those 16 keys.`;

    const fileBlock =
      mediaType === PDF_MIME
        ? {
            type: "document",
            source: { type: "base64", media_type: PDF_MIME, data: buffer.toString("base64") },
          }
        : {
            type: "image",
            source: { type: "base64", media_type: mediaType, data: buffer.toString("base64") },
          };

    const extracted = (await askClaude(
      [fileBlock, { type: "text", text: extractPrompt }],
      6000,
    )) as Extraction | null;

    if (!extracted) {
      return NextResponse.json(
        { error: "Could not read that file. Try a clearer photo or the PDF itself." },
        { status: 422 },
      );
    }

    const vendorName = extracted.vendor_name?.trim() || "Unknown vendor";
    const amountRead =
      typeof extracted.amount === "number" && Number.isFinite(extracted.amount)
        ? round2(extracted.amount)
        : null;

    // A credit memo is money coming BACK — it books negative, so the budget
    // line it came off nets down. The guard is deterministic because the
    // model reads "($42.50)" as 42.50 as often as it reads it as -42.50.
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

    // Gas is company overhead, never job cost — a fill-up routes to the
    // Overhead project deterministically, same as the crew scan. The AI's
    // read is the primary signal; vendor-name + gallons-text is the backstop.
    // An explicit job pick from the user still wins.
    const isFuel =
      extracted.purchase_kind === "fuel" ||
      looksLikeFuelPurchase(extracted.vendor_name, extracted.extracted_text);
    const overheadJob = jobs.find((j) => j.is_overhead) ?? null;
    let fuelAutoRouted = false;
    let projectId = pickedProjectId || aiProjectId;
    if (isFuel && !pickedProjectId && overheadJob) {
      projectId = overheadJob.id;
      fuelAutoRouted = true;
    }

    // Quotes are prices OFFERED, not money owed — see the field-capture scan.
    // The Sobol "Quote 12286.pdf" quotation was booked as three paid rows
    // before this check existed. Deterministic on purpose.
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
      dueDate: extracted.due_date || null,
      trade: extracted.trade || null,
      summary: extracted.summary || null,
      items,
      jobHint: extracted.job_hint || null,
      extractedText: extracted.extracted_text?.slice(0, 50000) || null,
      confidence,
      lowConfidence: confidence < CONFIDENCE_FLOOR,
      jobGuessed: !pickedProjectId && Boolean(aiProjectId),
      // A PAID stamp or a zero balance under real charges = the money already
      // moved. This files as a paid cost, not A/P — the Jorge dumpster case.
      // A credit is settled the moment it is issued — the money went back on
      // the card or came off the account, so it files as paid, never as A/P.
      alreadyPaid:
        amount !== null &&
        (creditCheck.isCredit ||
          (amount > 0 && (extracted.paid_stamp === true || extracted.balance_due === 0))),
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

    if (documentType === "delivery_ticket" || documentType === "quote" || amount === null) {
      return NextResponse.json({ status: "scanned", scan, job, allocations: [], budgetLines: [] });
    }

    // --- Allocate across the job's budget lines (current_estimate_id is the
    // canonical pointer — see the field-capture scan for the history) --------
    //
    // The splitter reasons in DOLLARS SPENT, so a credit is allocated on its
    // magnitude and the signs are flipped once at the end — asking the model
    // to sum to a negative is how you get a split that doesn't add up.
    const allocTotal = Math.abs(amount);
    const { data: estimateId } = await supabase.rpc("current_estimate_id", {
      p_project_id: projectId,
    });

    let allocations: Array<{
      lineItemId: string;
      lineLabel: string;
      trade: string | null;
      amount: number;
      note: string | null;
    }> = [];
    // The job's budget lines ride back so the confirm card can re-point or
    // split an allocation the AI got wrong before anything books.
    let budgetLines: Array<{ id: string; description: string; trade: string | null }> = [];

    if (estimateId) {
      const { data: lines } = await supabase
        .from("estimate_line_items")
        .select("id, description, trade, total_cost, change_order_id, change_orders:change_order_id(change_order_number)")
        .eq("estimate_id", estimateId as string)
        .eq("is_section_header", false)
        .limit(200);

      // A change-order line is named by its CO so it can be told apart from
      // the base scope in the confirm card's dropdown.
      budgetLines = (lines ?? []).map((l) => ({
        id: l.id,
        description: coPrefix(l) + l.description,
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

        const allocPrompt = `A ${vendorName} ${creditCheck.isCredit ? "credit memo" : "bill"} for $${allocTotal} on job "${job.label}".
What it covers: ${extracted.summary ?? "unknown"}

Line items (description | amount | trade):
${itemText}

Bill text:
${(extracted.extracted_text ?? "").slice(0, 4000)}

Budget lines on this job (id | description | trade | budget):
${lines.map((l) => `${l.id} | ${l.description} | ${l.trade ?? "-"} | ${l.total_cost}`).join("\n")}

Split this ${creditCheck.isCredit ? "credit across the budget lines the original charges came off" : "bill across the budget lines it actually covers"}. A sub's bill usually lands whole on that trade's line; a supplier run can split across trades.

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

      // Back to the document's own sign, so the confirm card and the commit
      // route both see a credit as a credit.
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
