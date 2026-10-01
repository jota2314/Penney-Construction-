import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUser } from "@/lib/auth/get-user";
import { askClaude } from "@/lib/bills/model";
import { ownsBillUpload, loadBillRead, saveBillRead } from "@/lib/bills/read-store";
import type { BillRead } from "@/lib/bills/types";
import { detectQuoteDocument } from "@/lib/finance/quote-detection";
import { detectCreditDocument, signedAmount } from "@/lib/finance/credit-detection";
import { looksLikeFuelPurchase } from "@/lib/finance/spend-category";
import { crewJobHints } from "@/lib/crew/receipt-job-hints";
import type {
  CrewScan,
  CrewRead,
  CrewJobSource,
  CrewJobHint,
  CrewReadResponse,
} from "@/lib/crew/receipt-scan-types";

export const runtime = "nodejs";
export const maxDuration = 120;
// The read gets the whole request budget; splitting across budget lines is
// ./allocate, a separate request, so a slow model can no longer cost the read.
const READ_BUDGET_MS = 100_000;

const BUCKET = "field-captures";
const CONFIDENCE_FLOOR = 0.75;

/**
 * READ a receipt. Writes NOTHING to the books — filing happens in ./commit,
 * once a human has seen the read.
 *
 * The photo is already saved (lib/receipts/save-upload) before this runs, so
 * the client posts its `storagePath`. The read is saved once per photo in
 * bill_scan_reads, so everything after the first read is instant:
 *   - picking or changing the job never re-reads the photo (that was a second
 *     20-second wait, and the moment crew gave up and re-shot the receipt)
 *   - a crew member who closed the app mid-scan finishes from the saved read
 *
 * The job comes from, in order: the crew member's pick, a job name / address
 * on the receipt, a gas fill-up (company overhead), then their own time card
 * at the time printed on the receipt.
 */

type ScannedItem = { description: string; amount: number | null; trade: string | null };

type Extraction = {
  document_type: "receipt" | "invoice" | "credit_memo" | "delivery_ticket" | "quote" | "other";
  vendor_name: string | null;
  amount: number | null;
  invoice_number: string | null;
  date: string | null;
  time: string | null;
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

async function readReceipt(
  supabase: Awaited<ReturnType<typeof createClient>>,
  storagePath: string,
  deadline: number,
): Promise<CrewRead | { error: string; status: number }> {
  const { data: blob, error: downloadError } = await supabase.storage.from(BUCKET).download(storagePath);
  if (downloadError || !blob) {
    return { error: "That photo is no longer available — take it again.", status: 404 };
  }
  if (!VISION_MIME.has(blob.type)) {
    return {
      error: "The photo is saved, but that format can't be read. Retake it with the camera.",
      status: 415,
    };
  }
  const buffer = Buffer.from(await blob.arrayBuffer());
  const originalFilename = storagePath.split("/").pop()?.replace(/^[0-9a-f-]{36}-?/i, "") || null;

  const { data: activeJobs } = await supabase
    .from("projects")
    .select("id, project_number, name, address, city")
    .in("status", ["contracted", "in_progress"])
    .order("name", { ascending: true })
    .limit(150);

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
6. time — the purchase time printed on it, as 24-hour HH:MM (12:53 PM -> "12:53", 3:05 PM -> "15:05"). null if none is printed.
7. trade — the single trade that best covers the whole receipt
8. summary — one short line naming what was bought, e.g. "2x10 PT joists, joist hangers, structural screws"
9. items — the individual line items you can read, as [{description, amount, trade}]. amount is that line's extended price (qty x unit) as a number, or null if unreadable. trade is the trade THAT item serves: lumber and framing material -> carpentry; wire, devices, boxes -> electrical; pipe, fittings, valves -> plumbing; drywall and compound -> drywall; paint and primer -> painting; tile, thinset, grout -> tile. One store run often mixes trades — that is exactly what this field is for, so be precise per item. Return [] if the receipt shows no itemization.
10. extracted_text — every line of text you can read
11. job_hint — any site address, lot number, client surname, PO or "Job Name" written or printed on the ticket. null if none.
12. matched_project_id — if job_hint clearly identifies one job below, its exact id. null if unsure. DO NOT guess.
13. confidence — 0 to 1, how sure you are of vendor_name AND amount together. Be honest; a crumpled or blurry receipt should score low.
14. charged_to_account — true if this purchase went on the customer's HOUSE ACCOUNT at the supplier instead of being paid at the counter: look for "CHARGE", "ON ACCOUNT", "ACCT", a customer account number, "billed to account", or the ABSENCE of any tender line (no card, no cash, no change due) on a lumberyard/supply-house ticket. false if a card/cash tender is shown. null if you can't tell.
15. purchase_kind — "fuel" if this is a gas-station FILL-UP (gallons, price per gallon, pump number, unleaded/diesel — company truck gas, not job material); "meals" if it is restaurant/coffee/food; otherwise "materials". A gas-station ticket that is only snacks or coffee is "meals", not "fuel".

Active jobs (id | number | name | address):
${jobList || "(none)"}

Return ONLY valid JSON with exactly those 15 keys.`;

  const extracted = (await askClaude(
    [
      {
        type: "image",
        source: { type: "base64", media_type: blob.type, data: buffer.toString("base64") },
      },
      { type: "text", text: extractPrompt },
    ],
    6000,
    deadline,
  )) as Extraction | null;

  if (!extracted) {
    return {
      error: "The reader didn't answer in time. Your photo is saved — tap Try again.",
      status: 503,
    };
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
  const confidence = typeof extracted.confidence === "number" ? extracted.confidence : 0;

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
    extracted.matched_project_id && jobs.some((j) => j.id === extracted.matched_project_id)
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
  let suggestedProjectId = aiProjectId;
  let fuelAutoRouted = false;
  if (isFuel) {
    const { data: overhead } = await supabase
      .from("projects")
      .select("id")
      .eq("is_overhead", true)
      .limit(1)
      .maybeSingle();
    if (overhead) {
      suggestedProjectId = overhead.id;
      fuelAutoRouted = true;
    }
  }

  // Quotes are prices OFFERED, not money spent — the commit route refuses
  // to book them. Deterministic on purpose: the model is the thing that
  // misread the Sobol quotation in the first place.
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

  const time =
    typeof extracted.time === "string" && /^\d{1,2}:\d{2}$/.test(extracted.time.trim())
      ? extracted.time.trim()
      : null;

  const scan: CrewScan = {
    storagePath,
    documentType,
    filename: originalFilename,
    quoteReason: quoteCheck.reason,
    isCredit: creditCheck.isCredit,
    creditReason: creditCheck.reason,
    vendor: vendorName,
    amount,
    invoiceNumber: extracted.invoice_number || null,
    date: extracted.date && /^\d{4}-\d{2}-\d{2}$/.test(extracted.date) ? extracted.date : null,
    dueDate: null,
    time,
    trade: extracted.trade || null,
    summary: extracted.summary || null,
    items,
    jobHint: extracted.job_hint || null,
    extractedText: extracted.extracted_text?.slice(0, 50000) || null,
    confidence,
    lowConfidence: confidence < CONFIDENCE_FLOOR,
    chargedToAccount: extracted.charged_to_account === true,
    fuelAutoRouted,
  };
  return { scan, suggestedProjectId };
}

export async function POST(request: NextRequest) {
  const deadline = Date.now() + READ_BUDGET_MS;
  const user = await getUser();
  const profileId = user?.profile?.id ?? user?.id;
  if (!profileId) {
    return NextResponse.json({ error: "Not signed in — open the app again." }, { status: 401 });
  }

  const supabase = await createClient();

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    let storagePath = ((formData.get("storagePath") as string) || "").trim();
    const pickedProjectId = ((formData.get("projectId") as string) || "").trim() || null;

    // A phone still running the old page posts the photo itself.
    if (!storagePath) {
      if (!file) {
        return NextResponse.json({ error: "No photo came through — try again." }, { status: 400 });
      }
      if (!VISION_MIME.has(file.type)) {
        return NextResponse.json(
          { error: "That photo format can't be read. Retake it with the camera." },
          { status: 400 },
        );
      }
      storagePath = `${profileId}/${crypto.randomUUID()}-receipt.jpg`;
      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(storagePath, Buffer.from(await file.arrayBuffer()), { contentType: file.type });
      if (uploadError) {
        return NextResponse.json(
          { error: `The photo didn't save: ${uploadError.message}` },
          { status: 500 },
        );
      }
    }

    if (!ownsBillUpload(profileId, storagePath)) {
      return NextResponse.json({ error: "That receipt belongs to someone else." }, { status: 403 });
    }

    let read = (await loadBillRead(profileId, storagePath)) as CrewRead | null;
    if (!read) {
      const fresh = await readReceipt(supabase, storagePath, deadline);
      if ("error" in fresh) {
        return NextResponse.json({ error: fresh.error, storagePath }, { status: fresh.status });
      }
      // First completed read wins (a retry racing the original can't fork it).
      read = (await saveBillRead(profileId, fresh as BillRead)) as CrewRead;
    }

    const scan = read.scan;
    let projectId: string | null = pickedProjectId || read.suggestedProjectId;
    let jobSource: CrewJobSource | null = pickedProjectId
      ? "picked"
      : read.suggestedProjectId
        ? scan.fuelAutoRouted ? "fuel" : "receipt"
        : null;
    let jobReason: string | null =
      jobSource === "fuel"
        ? "Gas fill-up — company overhead, not a job"
        : jobSource === "receipt"
          ? scan.jobHint ? `Read "${scan.jobHint}" on the receipt` : "Matched from the receipt"
          : null;

    // Never let a time-card lookup hiccup cost the read.
    let suggestedJobs: CrewJobHint[] = [];
    try {
      const hints = await crewJobHints(supabase, profileId, scan.date, scan.time ?? null);
      suggestedJobs = hints.jobs;
      if (!projectId && hints.match) {
        projectId = hints.match.id;
        jobSource = "timecard";
        jobReason = hints.match.reason;
      }
    } catch (err) {
      console.warn("[field-capture] job hints failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    let job: { id: string; label: string } | null = null;
    if (projectId) {
      const { data: project } = await supabase
        .from("projects")
        .select("id, name, project_number")
        .eq("id", projectId)
        .maybeSingle();
      if (project) {
        job = {
          id: project.id,
          label: project.project_number ? `${project.project_number} ${project.name}` : project.name,
        };
      } else if (pickedProjectId) {
        return NextResponse.json({ error: "That job wasn't found — pick it again." }, { status: 404 });
      }
    }
    if (!job) {
      jobSource = null;
      jobReason = null;
    }

    const needsAllocation =
      job !== null && scan.amount !== null && !["quote", "delivery_ticket"].includes(scan.documentType);

    const body: CrewReadResponse = {
      status: job ? "scanned" : "needs_job",
      scan: {
        ...scan,
        jobGuessed: jobSource === "receipt" || jobSource === "timecard",
        fuelAutoRouted: jobSource === "fuel",
      },
      job,
      jobSource,
      jobReason,
      suggestedJobs,
      allocationStatus: needsAllocation ? "pending" : "not_required",
    };
    return NextResponse.json(body);
  } catch (err) {
    console.error("[field-capture] read failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { error: "Something went wrong reading it. Your photo is saved — tap Try again." },
      { status: 500 },
    );
  }
}
