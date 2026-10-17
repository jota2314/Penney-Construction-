import { NextRequest, NextResponse, after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveSubAccess, getSubBillableProjectIds, type SubAccess } from "@/lib/sub-portal/access";
import { isSubOnJob } from "@/lib/sub-portal/active-jobs";
import { refuseStaffBrowser } from "@/lib/sub-portal/staff-guard";
import { isInternalJob } from "@/lib/crew/crew-visibility";
import { notifySubInvoice } from "@/lib/notifications/sub-field-notify";
import { etMonday } from "@/lib/sub-portal/et-day";
import { subBillsEnabled } from "@/lib/sub-portal/flags";
import { parseMoney } from "@/lib/money";
import type { SubBillAiRead } from "@/lib/sub-portal/payload";
import {
  SUB_BILL_BUCKET,
  SUB_BILL_DAILY_LIMIT,
  SUB_BILL_MAX_BYTES,
  SUB_BILL_MIME,
  isOfficeProfile,
  newSubBillPath,
  readSubDocument,
  resolveSubBillReviewer,
  toSubBillAiRead,
  verifySubBillPath,
  type SubBillFinishResponse,
  type SubBillFixResponse,
  type SubBillPrepareResponse,
  type SubBillRequest,
} from "@/lib/sub-portal/bill-handoff";

export const runtime = "nodejs";
// The read of a 10 MB PDF is the slow part; readSubDocument stops trying
// with time to spare so the row and the notice always get written.
export const maxDuration = 60;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOO_BIG = "That file is over 10 MB. Take a photo of the invoice instead, or send a smaller PDF.";

/**
 * POST /api/sub-portal/bills — a sub sends an invoice from the Money tab.
 *
 *   { action: "prepare", projectId, name, mime, size }
 *       → a signed upload URL for a path the server picks in the bill
 *         reviewer's field-captures folder. The phone uploads straight to it.
 *   { action: "finish", projectId, path, nonce, name? }
 *       → confirms the file is there, reads it, records sub_bill_submissions,
 *         tells the reviewer, and answers with what was read
 *         ("We read: INV0325 · $600.00 · Pedersen. Right?").
 *   { action: "fix", submissionId, number?, amount? }
 *       → his correction, kept as sub_stated_* next to the read.
 *
 * Nothing here writes `invoices`. The reviewer files it through BillDrop in
 * the Command Center (or Weekly Close), which runs the scan, job, line,
 * split and duplicate checks. Retries are safe: finish on a path that was
 * already recorded returns that submission instead of a second one.
 */
export async function POST(request: NextRequest) {
  const staff = await refuseStaffBrowser(request);
  if (staff) return staff;
  // The off switch (NEXT_PUBLIC_SUB_BILLS=0) holds here too, not only in the UI.
  if (!subBillsEnabled()) return NextResponse.json({ error: "Penney can't take invoices here right now. Call the office." }, { status: 403 });
  const access = await resolveSubAccess(request);
  if (!access) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  let body: SubBillRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  try {
    if (body?.action === "prepare") return await prepare(access, body);
    if (body?.action === "finish") return await finish(access, body);
    if (body?.action === "fix") return await fix(access, body);
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    console.error("[sub-portal/bills]", err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: "Something went wrong on our end. Try again." }, { status: 500 });
  }
}

type HisJob = { id: string; name: string; address: string | null; assigned_pm: string | null };

/**
 * The jobs he may bill: a job he is on now (the portal's active-job rule),
 * or one where he has an award, a bill, an active contract, an agreement or
 * an office-assigned phase, minus Penney's internal jobs. A quote or bid
 * alone does not count: a losing bidder must not be able to send an
 * "invoice" and so land on the job screen. Wider than the Today list on
 * purpose: a final invoice often arrives after the job has moved to audit.
 */
async function hisJobs(supabase: SupabaseClient, subId: string, picked: string): Promise<HisJob[]> {
  const ids = await getSubBillableProjectIds(supabase, subId);
  if (!ids.includes(picked) && (await isSubOnJob(supabase, subId, picked))) ids.push(picked);
  if (!ids.length) return [];
  const { data, error } = await supabase
    .from("projects")
    .select("id, name, project_number, address, city, is_overhead, assigned_pm")
    .in("id", ids);
  if (error) throw new Error(`jobs: ${error.message}`);
  return (data ?? [])
    .filter((p) => !isInternalJob(p))
    .map((p) => ({
      id: p.id as string,
      name: (p.name as string) || (p.project_number as string) || "Job",
      address: [p.address, p.city].filter(Boolean).join(", ") || null,
      assigned_pm: (p.assigned_pm as string | null) ?? null,
    }));
}

/** HEIF photos are stored as HEIC (the bucket allows HEIC, not HEIF). */
function normalizeMime(mime: unknown): string {
  const m = String(mime ?? "").trim().toLowerCase();
  if (m === "image/heif") return "image/heic";
  if (m === "image/jpg") return "image/jpeg";
  return m;
}

// ─────────────────────────────── prepare

async function prepare(access: SubAccess, body: Extract<SubBillRequest, { action: "prepare" }>) {
  const { supabase, subId, companyName } = access;
  const projectId = String(body.projectId ?? "").trim();
  if (!UUID_RE.test(projectId)) return NextResponse.json({ error: "Pick a job first" }, { status: 400 });

  const mime = normalizeMime(body.mime);
  if (!(SUB_BILL_MIME as readonly string[]).includes(mime)) {
    return NextResponse.json({ error: "Send a PDF or a photo of the invoice" }, { status: 400 });
  }
  const size = Number(body.size);
  if (!Number.isFinite(size) || size <= 0) {
    return NextResponse.json({ error: "That file is empty. Pick it again." }, { status: 400 });
  }
  if (size > SUB_BILL_MAX_BYTES) return NextResponse.json({ error: TOO_BIG }, { status: 413 });

  const jobs = await hisJobs(supabase, subId, projectId);
  if (!jobs.some((j) => j.id === projectId)) {
    return NextResponse.json({ error: "That job isn't on your list" }, { status: 403 });
  }

  const since = new Date(Date.now() - 24 * 3_600_000).toISOString();
  const { count } = await supabase
    .from("sub_bill_submissions")
    .select("id", { count: "exact", head: true })
    .eq("subcontractor_id", subId)
    .gte("created_at", since);
  if ((count ?? 0) >= SUB_BILL_DAILY_LIMIT) {
    return NextResponse.json({ error: "That's a lot of invoices today. Call the office." }, { status: 429 });
  }

  const reviewerId = await resolveSubBillReviewer(projectId);
  if (!reviewerId) {
    return NextResponse.json({ error: "Penney can't take invoices here right now. Call the office." }, { status: 503 });
  }

  const { path, nonce } = newSubBillPath({
    reviewerId,
    subId,
    projectId,
    companyName,
    fileName: String(body.name ?? ""),
    mime,
  });
  const { data, error } = await supabase.storage.from(SUB_BILL_BUCKET).createSignedUploadUrl(path);
  if (error || !data) {
    console.error("[sub-portal/bills] signed upload", error?.message);
    return NextResponse.json({ error: "Couldn't start the upload. Try again." }, { status: 502 });
  }
  const res: SubBillPrepareResponse = { ok: true, path, token: data.token, nonce };
  return NextResponse.json(res);
}

// ─────────────────────────────── finish

type SubmissionRow = {
  id: string;
  subcontractor_id: string;
  project_id: string | null;
  reviewer_profile_id: string;
  storage_path: string;
  status: string;
  ai_read: SubBillAiRead | null;
  sub_stated_number: string | null;
  sub_stated_amount: number | string | null;
};
const SUBMISSION_COLS =
  "id, subcontractor_id, project_id, reviewer_profile_id, storage_path, status, ai_read, sub_stated_number, sub_stated_amount";

async function finish(access: SubAccess, body: Extract<SubBillRequest, { action: "finish" }>) {
  const { supabase, subId, companyName } = access;
  const projectId = String(body.projectId ?? "").trim();
  const path = String(body.path ?? "").trim();
  const nonce = String(body.nonce ?? "").trim();
  if (!UUID_RE.test(projectId) || !path || !UUID_RE.test(nonce)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const issued = verifySubBillPath({ path, subId, projectId, nonce });
  if (!issued) {
    return NextResponse.json({ error: "That upload didn't start from this phone. Send it again." }, { status: 400 });
  }

  const jobs = await hisJobs(supabase, subId, projectId);
  const job = jobs.find((j) => j.id === projectId);
  if (!job) return NextResponse.json({ error: "That job isn't on your list" }, { status: 403 });

  const { data: existing, error: existingError } = await supabase
    .from("sub_bill_submissions")
    .select(SUBMISSION_COLS)
    .eq("storage_path", path)
    .maybeSingle<SubmissionRow>();
  if (existingError) throw new Error(`lookup: ${existingError.message}`);
  if (existing && existing.subcontractor_id !== subId) {
    return NextResponse.json({ error: "Invalid request" }, { status: 409 });
  }

  // The object must really be there before anything is recorded.
  const { data: blob, error: downloadError } = await supabase.storage.from(SUB_BILL_BUCKET).download(path);
  if (downloadError || !blob) {
    return NextResponse.json({ error: "Your file didn't finish sending. Send it again." }, { status: 404 });
  }
  if (blob.size > SUB_BILL_MAX_BYTES) return NextResponse.json({ error: TOO_BIG }, { status: 413 });
  const mime = normalizeMime(blob.type) || (path.toLowerCase().endsWith(".pdf") ? "application/pdf" : "image/jpeg");

  let row: SubmissionRow | null = existing ?? null;
  let created = false;
  if (!row) {
    // prepare picked an office-role reviewer; a setting changed in between
    // must not leave a bill in a folder nobody can file from.
    if (!(await isOfficeProfile(supabase, issued.reviewerId))) {
      return NextResponse.json({ error: "Penney can't take invoices here right now. Call the office." }, { status: 503 });
    }
    const originalName = String(body.name ?? "").trim().slice(0, 200) || path.split("/")[1].replace(/^[0-9a-f-]{36}-/i, "");
    // Recorded before the read, so a slow or failed read never loses the bill.
    const { data: inserted, error: insertError } = await supabase
      .from("sub_bill_submissions")
      .upsert(
        {
          subcontractor_id: subId,
          project_id: projectId,
          reviewer_profile_id: issued.reviewerId,
          storage_path: path,
          original_name: originalName,
          mime,
          size_bytes: blob.size,
          received_week: etMonday(),
          status: "sent",
        },
        { onConflict: "storage_path", ignoreDuplicates: true },
      )
      .select(SUBMISSION_COLS);
    if (insertError) throw new Error(`insert: ${insertError.message}`);
    row = (inserted as SubmissionRow[] | null)?.[0] ?? null;
    created = !!row;
    if (!row) {
      // A retry raced the first request and lost: use the row it wrote.
      const { data: again } = await supabase
        .from("sub_bill_submissions")
        .select(SUBMISSION_COLS)
        .eq("storage_path", path)
        .eq("subcontractor_id", subId)
        .maybeSingle<SubmissionRow>();
      row = again ?? null;
    }
    if (!row) throw new Error("submission not recorded");
  }

  let read: SubBillAiRead | null = row.ai_read ?? null;
  let jobMatch: string | null = null;
  if (!read) {
    const doc = await readSubDocument({
      buffer: Buffer.from(await blob.arrayBuffer()),
      mime,
      docType: "invoice",
      companyName,
      projectName: job.name,
      candidateJobs: jobs.map((j) => ({ name: j.name, address: j.address })),
      budgetMs: 40_000,
    });
    if (doc) {
      read = toSubBillAiRead(doc);
      jobMatch = doc.jobMatch;
      const { error: readError } = await supabase.from("sub_bill_submissions").update({ ai_read: read }).eq("id", row.id);
      if (readError) console.error("[sub-portal/bills] save read", readError.message);
    }
  } else if (read.project_hint && jobs.some((j) => j.name === read?.project_hint)) {
    jobMatch = read.project_hint;
  }

  const submission = row;
  const statedAmount = submission.sub_stated_amount == null ? null : Number(submission.sub_stated_amount);
  // Keyed by the submission id: the first call pushes, a retry only rewrites the text.
  after(() =>
    notifySubInvoice({
      submissionId: submission.id,
      subId,
      projectId,
      storagePath: submission.storage_path,
      reviewerProfileId: submission.reviewer_profile_id,
      invoiceNumber: submission.sub_stated_number ?? read?.invoice_number ?? null,
      amount: statedAmount ?? read?.amount ?? null,
    }),
  );

  const res: SubBillFinishResponse = {
    ok: true,
    submissionId: submission.id,
    jobName: job.name,
    read,
    jobMismatch: jobMatch && jobMatch !== job.name ? jobMatch : null,
    created,
  };
  return NextResponse.json(res);
}

// ─────────────────────────────── fix

async function fix(access: SubAccess, body: Extract<SubBillRequest, { action: "fix" }>) {
  const { supabase, subId } = access;
  const submissionId = String(body.submissionId ?? "").trim();
  if (!UUID_RE.test(submissionId)) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const number = typeof body.number === "string" ? body.number.trim().slice(0, 60) || null : null;
  const typedAmount = body.amount == null || body.amount === "" ? null : parseMoney(body.amount);
  if (body.amount != null && body.amount !== "" && (typedAmount == null || typedAmount <= 0)) {
    return NextResponse.json({ error: "Type the total, like 600.00" }, { status: 400 });
  }
  if (!number && typedAmount == null) {
    return NextResponse.json({ error: "Type the invoice number or the total." }, { status: 400 });
  }

  const { data: row, error } = await supabase
    .from("sub_bill_submissions")
    .select(SUBMISSION_COLS)
    .eq("id", submissionId)
    .eq("subcontractor_id", subId)
    .maybeSingle<SubmissionRow>();
  if (error) throw new Error(`lookup: ${error.message}`);
  if (!row) return NextResponse.json({ error: "We can't find that invoice." }, { status: 404 });
  if (row.status !== "sent") {
    return NextResponse.json({ error: "Penney sent this one back. Send a new invoice instead." }, { status: 409 });
  }
  const { data: filed } = await supabase
    .from("invoices")
    .select("id")
    .eq("attachment_storage_path", row.storage_path)
    .limit(1);
  if (filed?.length) {
    return NextResponse.json({ error: "Penney already filed this invoice. Call the office to change it." }, { status: 409 });
  }

  const { error: updateError } = await supabase
    .from("sub_bill_submissions")
    .update({ sub_stated_number: number, sub_stated_amount: typedAmount })
    .eq("id", row.id)
    .eq("subcontractor_id", subId);
  if (updateError) throw new Error(`update: ${updateError.message}`);

  // Same key as the first notice: the reviewer's row is rewritten, no second push.
  after(() =>
    notifySubInvoice({
      submissionId: row.id,
      subId,
      projectId: row.project_id,
      storagePath: row.storage_path,
      reviewerProfileId: row.reviewer_profile_id,
      invoiceNumber: number ?? row.ai_read?.invoice_number ?? null,
      amount: typedAmount ?? row.ai_read?.amount ?? null,
    }),
  );

  const res: SubBillFixResponse = { ok: true };
  return NextResponse.json(res);
}
