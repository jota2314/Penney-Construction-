import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAnthropicClient, CLAUDE_FALLBACK_MODELS } from "@/lib/ai/claude";
import { keyUuid } from "@/lib/ids/key-uuid";
import { resolveSubNoticeRecipients } from "@/lib/notifications/sub-field-notify";
import { createAdminClient } from "@/lib/supabase/admin";
import type { SubBillAiRead } from "@/lib/sub-portal/payload";

/**
 * Sub invoices from the portal into the Command Center bill workflow
 * (AGENTS.md: vendor bills only through the existing bill flow; plan §4.7).
 *
 * The portal never writes `invoices`. It only hands the file over:
 *  1. prepare: the server picks the path in the bill reviewer's own
 *     field-captures folder ("{reviewer}/{uuid}-{sub}-{name}", the 2-segment
 *     shape ownsBillUpload accepts) and returns a signed upload URL, so the
 *     file goes straight to storage and never hits the 4.5 MB request cap.
 *  2. finish: the server confirms the object is there, reads it with the same
 *     extraction the portal upload route uses, and records a
 *     sub_bill_submissions row. The reviewer gets a notice that opens it in
 *     BillDrop (`/command-center?billUpload=`), and it also shows in their
 *     Saved uploads with "Finish filing".
 * BillDrop does the scan, job, line, split, duplicate review and commit,
 * unchanged. "Filed" is never stored: it means an invoices row has
 * attachment_storage_path = the submission's storage_path.
 *
 * The request and response types are here; the sheet imports them as
 * `import type`, which compiles away, so nothing server-only reaches the phone.
 */

export const SUB_BILL_BUCKET = "field-captures";
/** The field-captures bucket's own cap, and the table's CHECK. */
export const SUB_BILL_MAX_BYTES = 10 * 1024 * 1024;
/** What the field-captures bucket accepts (no HEIF: the sheet relabels it HEIC). */
export const SUB_BILL_MIME = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/gif",
] as const;
/** A guard against a stuck retry loop, not a business rule. */
export const SUB_BILL_DAILY_LIMIT = 25;

// ─────────────────────────────── the route's contract

export type SubBillRequest =
  | { action: "prepare"; projectId: string; name: string; mime: string; size: number }
  | { action: "finish"; projectId: string; path: string; nonce: string; name?: string | null }
  | {
      action: "fix";
      submissionId: string;
      /** What he typed for the invoice number. Blank clears it. */
      number?: string | null;
      /** DecimalInput's number (or a typed "$600.00"). */
      amount?: number | string | null;
    };

export type SubBillPrepareResponse = { ok: true; path: string; token: string; nonce: string };

export type SubBillFinishResponse = {
  ok: true;
  submissionId: string;
  /** The job he picked, for "We read: INV0325 · $600.00 · Pedersen. Right?". */
  jobName: string;
  /** null when the file couldn't be read (a HEIC photo, a timeout). */
  read: SubBillAiRead | null;
  /** Another of his jobs the invoice itself names, when it isn't the one he picked. */
  jobMismatch: string | null;
  /** false when a retry found the submission already recorded. */
  created: boolean;
};

export type SubBillFixResponse = { ok: true };

// ─────────────────────────────── paths

/** "MGL Tile Inc." → "mgl-tile-inc", so Saved uploads says whose bill it is. */
export function subBillSlug(companyName: string): string {
  const slug = companyName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return slug || "sub";
}

/** Same cleaning as the office Saved uploads prepare (receipts/upload). */
export function safeBillFileName(name: string | null | undefined): string {
  const cleaned = String(name || "invoice").replace(/[^a-zA-Z0-9._-]/g, "_").slice(-100);
  return cleaned.replace(/^[._]+/, "") || "invoice";
}

/**
 * The uuid in the path is derived from who asked, for which job, into whose
 * folder, plus a random nonce only the asking phone gets back. finish
 * recomputes it, so a sub can't claim another sub's upload (or an office
 * receipt in the same folder), switch the job afterwards, or point the path
 * at a different folder.
 */
function pathUuid(subId: string, projectId: string, reviewerId: string, nonce: string): string {
  return keyUuid(`sub_bill:${subId}:${projectId}:${reviewerId}:${nonce}`);
}

const EXTENSION: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/gif": "gif",
};

export function newSubBillPath(input: {
  reviewerId: string;
  subId: string;
  projectId: string;
  companyName: string;
  fileName: string;
  /** One of SUB_BILL_MIME. The name gets the matching extension: the bill flow tells a PDF by ".pdf". */
  mime: string;
}): { path: string; nonce: string } {
  const nonce = crypto.randomUUID();
  const uuid = pathUuid(input.subId, input.projectId, input.reviewerId, nonce);
  const ext = EXTENSION[input.mime] ?? "pdf";
  const stem = safeBillFileName(input.fileName).replace(/\.[a-z0-9]{1,5}$/i, "").slice(0, 90) || "invoice";
  const path = `${input.reviewerId}/${uuid}-${subBillSlug(input.companyName)}-${stem}.${ext}`;
  return { path, nonce };
}

/** The reviewer folder the path was issued for, or null when it wasn't issued to this sub for this job. */
export function verifySubBillPath(input: {
  path: string;
  subId: string;
  projectId: string;
  nonce: string;
}): { reviewerId: string } | null {
  const { path } = input;
  if (path.includes("..") || path.includes("\\")) return null;
  const parts = path.split("/");
  if (parts.length !== 2) return null;
  const [reviewerId, file] = parts;
  const expected = pathUuid(input.subId, input.projectId, reviewerId, input.nonce);
  return file.startsWith(`${expected}-`) ? { reviewerId } : null;
}

// ─────────────────────────────── the reviewer

/**
 * Who files sub bills: app_settings sub_bill_reviewer_profile_id (Nicole)
 * when it names an office-role profile, else the job PM, else Jorge. This is
 * the same rule the sub_invoice notice uses, so the Saved-uploads folder and
 * the notice always agree.
 */
export async function resolveSubBillReviewer(projectId: string | null): Promise<string | null> {
  const { recipients } = await resolveSubNoticeRecipients(createAdminClient(), {
    projectId,
    audience: ["bill_reviewer"],
  });
  return recipients[0]?.id ?? null;
}

/** True when the profile exists and has an office role (a path's folder is re-checked at finish). */
export async function isOfficeProfile(admin: SupabaseClient, profileId: string): Promise<boolean> {
  const { data } = await admin.from("profiles").select("role").eq("id", profileId).maybeSingle();
  return ["owner", "precon_manager", "project_manager", "office_admin"].includes(String(data?.role ?? ""));
}

// ─────────────────────────────── reading the document

const VISION_MIME = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

/** Can the model read this file as sent? (HEIC can't be read; it is still filed.) */
export function isReadableDocument(mime: string | null | undefined): boolean {
  return mime === "application/pdf" || VISION_MIME.has(String(mime));
}

export interface SubDocumentRead {
  /** Grand total, rounded to the cent; null when no total is shown (or not > 0). */
  amount: number | null;
  documentNumber: string | null;
  /** YYYY-MM-DD, or null when the date isn't readable. */
  date: string | null;
  trade: string | null;
  summary: string | null;
  vendorName: string | null;
  /** The job address or customer printed on it, as printed. */
  jobHint: string | null;
  /** Exactly one of the candidate job names, when candidates were given and one fits. */
  jobMatch: string | null;
  /** Every line of text, only when includeText. */
  extractedText: string | null;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;
const text = (v: unknown, max = 200): string | null =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;

/**
 * Read a document a sub sent from the portal. The vendor is never guessed:
 * it IS the signed-in sub, so only the numbers are needed. This is the
 * extraction the portal upload route has always used (quotes still go
 * through it), with the vendor and job lines added for invoices.
 *
 * Returns null when nothing usable came back: no model answered, the reply
 * wasn't JSON, or the file type can't be read. It stops trying within
 * `budgetMs`, so a slow model can't use up the route's time before the row
 * and the notice are written.
 */
export async function readSubDocument(input: {
  buffer: Buffer;
  mime: string;
  docType: "quote" | "invoice";
  companyName: string;
  projectName: string;
  /** His jobs, so the read can say which one the paper names. */
  candidateJobs?: { name: string; address: string | null }[];
  /** Ask for every line of text (the quote record keeps it). */
  includeText?: boolean;
  budgetMs?: number;
}): Promise<SubDocumentRead | null> {
  if (!isReadableDocument(input.mime)) return null;
  const deadline = Date.now() + (input.budgetMs ?? 45_000);

  const base64 = input.buffer.toString("base64");
  const documentContent =
    input.mime === "application/pdf"
      ? { type: "document" as const, source: { type: "base64" as const, media_type: "application/pdf" as const, data: base64 } }
      : {
          type: "image" as const,
          source: {
            type: "base64" as const,
            media_type: input.mime as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
            data: base64,
          },
        };

  const candidates = (input.candidateJobs ?? []).filter((j) => j.name).slice(0, 40);
  const fields = [
    "amount — the grand total as a number (after tax, no $ sign). null if no total is shown.",
    "document_number — invoice/quote/estimate number if visible",
    "date — document date, YYYY-MM-DD",
    "trade — the single construction trade this covers (e.g. electrical, plumbing, carpentry, roofing), or null",
    'summary — one short line naming the work, e.g. "Rough plumbing — addition"',
    "vendor_name — the company the document is from, as printed, or null",
    "job_hint — the job address or customer name printed on the document, or null",
  ];
  const keys = ["amount", "document_number", "date", "trade", "summary", "vendor_name", "job_hint"];
  if (candidates.length) {
    fields.push(
      `job_match — which of these jobs the document is for, copied exactly from this list, or null if it doesn't say:\n${candidates
        .map((j) => `   - ${j.name}${j.address ? ` (${j.address})` : ""}`)
        .join("\n")}`,
    );
    keys.push("job_match");
  }
  if (input.includeText) {
    fields.push("extracted_text — ALL text from the document (every line item, number, name, date, total)");
    keys.push("extracted_text");
  }

  const extractionPrompt = `You are reading a ${input.docType} that subcontractor "${input.companyName}" uploaded for the "${input.projectName}" project (Penney Construction, residential GC, North Shore MA).

Extract:
${fields.map((f, i) => `${i + 1}. ${f}`).join("\n")}

Return ONLY valid JSON with exactly those ${keys.length} keys.`;

  let rawContent = "";
  try {
    const anthropic = await getAnthropicClient();
    for (const model of CLAUDE_FALLBACK_MODELS) {
      const remaining = deadline - Date.now();
      if (remaining < 5_000) break;
      try {
        const response = await anthropic.messages.create(
          {
            model,
            max_tokens: input.includeText ? 6000 : 1200,
            messages: [{ role: "user", content: [documentContent, { type: "text", text: extractionPrompt }] }],
          },
          { timeout: remaining, maxRetries: 0 },
        );
        // Read the text block by type: a thinking model can lead with another block.
        const block = response.content.find((b) => b.type === "text");
        rawContent = block && block.type === "text" ? block.text.trim() : "";
        if (rawContent) break;
      } catch {
        continue;
      }
    }
  } catch (err) {
    console.error("[bill-handoff] no model client", err instanceof Error ? err.message : String(err));
    return null;
  }
  if (!rawContent) return null;

  let extracted: Record<string, unknown> | null = null;
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
  if (!extracted || typeof extracted !== "object") return null;

  const amount =
    typeof extracted.amount === "number" && Number.isFinite(extracted.amount) && extracted.amount > 0
      ? round2(extracted.amount)
      : null;
  const date =
    typeof extracted.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(extracted.date) ? extracted.date : null;
  const match = text(extracted.job_match);
  return {
    amount,
    documentNumber: text(extracted.document_number, 60),
    date,
    trade: text(extracted.trade, 60),
    summary: text(extracted.summary),
    vendorName: text(extracted.vendor_name),
    jobHint: text(extracted.job_hint),
    // Only a name that is really on his list counts as a match.
    jobMatch: match && candidates.some((j) => j.name === match) ? match : null,
    extractedText: typeof extracted.extracted_text === "string" ? extracted.extracted_text.slice(0, 50000) || null : null,
  };
}

/** The part of a read the sub confirms, stored as sub_bill_submissions.ai_read. */
export function toSubBillAiRead(read: SubDocumentRead): SubBillAiRead {
  return {
    invoice_number: read.documentNumber,
    amount: read.amount,
    invoice_date: read.date,
    vendor_name: read.vendorName,
    project_hint: read.jobMatch ?? read.jobHint,
  };
}
