import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUser } from "@/lib/auth/get-user";
import { getAnthropicClient, CLAUDE_FALLBACK_MODELS } from "@/lib/ai/claude";

export const runtime = "nodejs";
export const maxDuration = 60;

const BUCKET = "field-captures";
const CONFIDENCE_FLOOR = 0.75;

/**
 * SCAN a client payment. Reads a photo of the check (or deposit slip / payment
 * confirmation) and proposes which job it belongs to -- and writes NOTHING.
 * Filing happens in ./commit once a human has seen the read.
 *
 * The money-IN twin of /api/crew/field-capture. Two calls land here:
 *   1. first scan, with `file` -- uploads the photo, then reads it
 *   2. re-scan, with `storagePath` + `projectId` -- the user corrected the job,
 *      so the payment type is re-proposed against THAT job's history. The photo
 *      is re-read from the bucket, never re-uploaded.
 *
 * Matching a check to a job is harder than matching a receipt: a check is
 * signed by a person ("Karen L. Whitfield Revocable Trust"), not by a job, and
 * the memo line is often blank. So the model gets the CUSTOMER name on every
 * job, not just the job name, and is told to leave it null rather than guess.
 */

type Extraction = {
  document_type: "check" | "deposit_slip" | "payment_confirmation" | "other";
  payer_name: string | null;
  amount: number | null;
  check_number: string | null;
  date: string | null;
  method: string | null;
  memo: string | null;
  bank: string | null;
  extracted_text: string | null;
  job_hint: string | null;
  matched_project_id: string | null;
  confidence: number | null;
};

const VISION_MIME = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

const METHODS = new Set(["check", "wire", "ach", "credit_card", "cash", "zelle", "other"]);
const PAYMENT_TYPES = new Set([
  "deposit",
  "draw",
  "progress",
  "final",
  "change_order",
  "retainage",
  "other",
]);

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

type CustomerRef = { first_name: string | null; last_name: string | null };

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
              : "Deposit capture takes a photo of the check — use the project Finances tab for PDFs",
          },
          { status: 400 },
        );
      }
      buffer = Buffer.from(await file.arrayBuffer());
      mediaType = file.type;
      storagePath = `${profileId}/deposits/${crypto.randomUUID()}.jpg`;

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

    // Jobs a client could plausibly be paying on. Money arrives before a job
    // starts (deposit) and after it finishes (retainage, final bill), so this
    // list is wider than the receipt side's contracted/in_progress.
    const { data: payableJobs } = await supabase
      .from("projects")
      .select(
        "id, project_number, name, address, city, status, contract_value, customers(first_name, last_name)",
      )
      .in("status", ["contracted", "in_progress", "audit", "completed"])
      .limit(120);

    const jobs = payableJobs ?? [];
    const customerName = (job: (typeof jobs)[number]): string => {
      const c = (Array.isArray(job.customers) ? job.customers[0] : job.customers) as
        | CustomerRef
        | null;
      return [c?.first_name, c?.last_name].filter(Boolean).join(" ");
    };

    const jobList = jobs
      .map((j) =>
        `${j.id} | ${j.project_number ?? "-"} | ${j.name} | client: ${customerName(j) || "unknown"} | ${j.address ?? ""} ${j.city ?? ""}`.trim(),
      )
      .join("\n");

    const extractPrompt = `You are reading a photo of a client payment received by Penney Construction, a residential general contractor on the North Shore of Massachusetts.

It is most likely one of:
- a personal or business CHECK from a homeowner (the usual case)
- a bank deposit slip
- a screenshot of a wire / ACH / Zelle confirmation

Extract:
1. document_type — "check", "deposit_slip", "payment_confirmation", or "other"
2. payer_name — who the money is FROM. On a check this is the name printed top-left or the signature line, NOT "Penney Construction" (that is the payee). Trusts and married couples are common, e.g. "John & Jill Conrad" or "Whitfield Family Trust".
3. amount — the amount of the payment as a number. On a check, prefer the WRITTEN-OUT words line over the numeric box if the two disagree, because the words are legally controlling. null if unreadable.
4. check_number — the check number, usually top-right. null for a wire or Zelle.
5. date — YYYY-MM-DD, the date written on the check or the transfer date. null if blank.
6. method — one of: check, wire, ach, credit_card, cash, zelle, other
7. memo — the memo / "for" line exactly as written. This is where clients write things like "Kitchen deposit" or "final payment 12 Stewart Ln", so it is the single most useful field for matching. null if blank.
8. bank — the bank name printed on the check
9. extracted_text — every line of text you can read
10. job_hint — any address, job name, invoice number or client surname visible anywhere on it (check the memo line first). null if none.
11. matched_project_id — if the payer_name or job_hint clearly identifies ONE job below, its exact id. Match on the CLIENT name as well as the job name — a check signed "Karen Whitfield" pays the job whose client is Karen Whitfield. null if two or more jobs fit or you are unsure. DO NOT guess: a payment posted to the wrong job is worse than an unmatched one.
12. confidence — 0 to 1, how sure you are of payer_name AND amount together. Be honest; handwriting on a check is often hard.

Jobs that could be paying (id | number | name | client | address):
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
      4000,
    )) as Extraction | null;

    if (!extracted) {
      return NextResponse.json(
        { error: "Could not read that photo. Try again with better light." },
        { status: 422 },
      );
    }

    const payerName = extracted.payer_name?.trim() || null;
    const amount =
      typeof extracted.amount === "number" && Number.isFinite(extracted.amount)
        ? round2(extracted.amount)
        : null;
    const confidence = typeof extracted.confidence === "number" ? extracted.confidence : 0;
    const method =
      extracted.method && METHODS.has(extracted.method)
        ? extracted.method
        : extracted.check_number
          ? "check"
          : null;

    // The model will occasionally invent a plausible uuid — only accept one
    // that is actually in the list we handed it.
    const aiProjectId =
      extracted.matched_project_id && jobs.some((j) => j.id === extracted.matched_project_id)
        ? extracted.matched_project_id
        : null;

    const projectId = pickedProjectId || aiProjectId;

    const scan = {
      storagePath,
      documentType: extracted.document_type,
      payer: payerName,
      amount,
      checkNumber: extracted.check_number || null,
      date: extracted.date || null,
      method,
      memo: extracted.memo || null,
      bank: extracted.bank || null,
      jobHint: extracted.job_hint || null,
      extractedText: extracted.extracted_text?.slice(0, 50000) || null,
      confidence,
      lowConfidence: confidence < CONFIDENCE_FLOOR,
      jobGuessed: !pickedProjectId && Boolean(aiProjectId),
    };

    if (!projectId) {
      return NextResponse.json({ status: "needs_job", scan, job: null, suggestion: null });
    }

    const { data: project } = await supabase
      .from("projects")
      .select("id, name, project_number, contract_value")
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

    // --- What kind of payment is this? -------------------------------------
    // Decided from the job's own history rather than asked of the model: the
    // first money in is the deposit, money in on a finished job is the final,
    // everything between is a progress draw. Cheap, and it cannot hallucinate.
    const { data: priorPayments } = await supabase
      .from("payments_received")
      .select("amount")
      .eq("project_id", projectId);

    const priorRows = priorPayments ?? [];
    const priorTotal = round2(priorRows.reduce((s, p) => s + Number(p.amount ?? 0), 0));
    const contractValue = Number(project.contract_value ?? 0);
    const wouldCloseOut =
      contractValue > 0 && amount !== null && priorTotal + amount >= contractValue - 0.01;

    let paymentType = "progress";
    if (priorRows.length === 0) paymentType = "deposit";
    else if (wouldCloseOut) paymentType = "final";
    if (!PAYMENT_TYPES.has(paymentType)) paymentType = "other";

    // A memo saying "retainage" or "change order" beats the positional guess.
    const memoText = `${extracted.memo ?? ""} ${extracted.job_hint ?? ""}`.toLowerCase();
    if (/retain/.test(memoText)) paymentType = "retainage";
    else if (/change\s*order|\bco\s*#/.test(memoText)) paymentType = "change_order";
    else if (/deposit/.test(memoText)) paymentType = "deposit";
    else if (/final/.test(memoText)) paymentType = "final";

    const suggestion = {
      paymentType,
      priorTotal,
      priorCount: priorRows.length,
      contractValue: contractValue > 0 ? contractValue : null,
      remainingAfter:
        contractValue > 0 && amount !== null
          ? round2(contractValue - priorTotal - amount)
          : null,
    };

    return NextResponse.json({ status: "scanned", scan, job, suggestion });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
