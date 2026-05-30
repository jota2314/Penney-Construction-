/**
 * Second-pass project matcher for auto-triage.
 *
 * The Haiku classifier only sees the email's subject/snippet/body, so an
 * invoice whose only job reference is buried inside the attached PDF comes
 * back as matched_project_id = null. This helper opens that attachment, pulls
 * the job-site address / client name out of it, and resolves it to a project
 * via the deterministic find_projects() fuzzy matcher.
 *
 * It is deliberately conservative: it only returns a project when the fuzzy
 * score is strong AND clearly beats the runner-up. Anything weaker returns
 * null so the email stays in the manual Review queue — we never silently
 * file an invoice under the wrong job.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { extractAttachmentText, type AttachmentMeta } from "@/lib/actions/extract-attachment";
import { getAnthropicClientServer } from "@/lib/ai/claude-server";

const MODEL = "claude-haiku-4-5-20251001";

// Calibrated against find_projects() on real data:
//   full name+address  -> ~0.76
//   address only        -> ~0.80 (runner-up 0.29)
//   client name only    -> ~0.90
//   vendor name         -> no rows
// 0.5 with a clear gap from #2 keeps false-positives out.
const MIN_SCORE = 0.5;
const MIN_GAP = 0.15;

/** project_files.category values the PDF pass can assign. */
export type FileCategory = "invoices" | "pricing" | "estimates" | "contracts";

/** Map the document type read off the PDF to a project_files category. */
function categoryFromDocType(docType: string | null): FileCategory | null {
  switch (docType) {
    case "invoice":
    case "receipt":
      return "invoices";
    case "quote":
      return "pricing";
    case "estimate":
      return "estimates";
    case "contract":
      return "contracts";
    default:
      return null;
  }
}

export interface AttachmentMatchResult {
  projectId: string | null;
  confidence: "high" | "low" | "none";
  reason: string;
  /** File category derived from the document itself (overrides a wrong classifier content_type). */
  category: FileCategory | null;
  /** Attachments with newly-extracted text_content, when extraction ran. Caller persists. */
  extractedAttachments: AttachmentMeta[] | null;
}

interface FindProjectsRow {
  id: string;
  name: string;
  address: string | null;
  status: string | null;
  match_score: number;
  match_reason: string;
}

/**
 * Try to resolve a project for an email the classifier couldn't match, by
 * reading its attachments.
 */
export async function matchProjectFromAttachments(
  admin: SupabaseClient,
  email: { id: string; subject: string | null; attachments: AttachmentMeta[] | null },
): Promise<AttachmentMatchResult> {
  const attachments = (email.attachments ?? []).filter((a) => a && a.storage_path);
  if (attachments.length === 0) {
    return { projectId: null, confidence: "none", reason: "no readable attachment", category: null, extractedAttachments: null };
  }

  // 1. Make sure we have text. extractAttachmentText mutates+returns the array
  //    and only hits Claude for attachments whose text_content is undefined.
  let withText: AttachmentMeta[] = attachments;
  let extracted = false;
  try {
    const res = await extractAttachmentText(admin, attachments);
    withText = res.attachments;
    extracted = res.updated;
  } catch (e) {
    console.error(`[pdf-match] extraction failed for email ${email.id}:`, (e as Error).message);
    return { projectId: null, confidence: "none", reason: "extraction failed", category: null, extractedAttachments: null };
  }

  const docText = withText
    .map((a) => a.text_content)
    .filter((t): t is string => !!t && t.trim().length > 0)
    .join("\n\n---\n\n")
    .substring(0, 12000);

  const extractedAttachments = extracted ? withText : null;

  if (!docText.trim()) {
    return { projectId: null, confidence: "none", reason: "no extractable text", category: null, extractedAttachments };
  }

  // 2. Read the document: pull job-site address / client name / work scope AND
  //    the doc type. The work scope matters because Penney often runs multiple
  //    jobs for the same homeowner (e.g. "DiSalvo Addition" vs "DiSalvo
  //    Kitchen") — the scope ("foundation excavation") is what disambiguates.
  let address: string | null = null;
  let clientName: string | null = null;
  let workSummary: string | null = null;
  let category: FileCategory | null = null;
  try {
    const client = await getAnthropicClientServer();
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: 250,
      messages: [
        {
          role: "user",
          content: `This is text extracted from a construction document sent to Penney Construction, a general contractor (Penney is the BUYER — "Bill to: Penney" / "Ryan Penney" means Penney is purchasing, NOT that Penney is the job). Return ONLY JSON with four fields:
- "address": the JOB SITE address the work is performed at (not Penney's office, not the vendor/sub's address), or null.
- "client_name": the homeowner / job name the work is for. Often a surname in a line-item description (e.g. "Disalvo- excavate foundation" -> "Disalvo"). Never "Penney". Null if truly absent.
- "work_summary": 2-5 words naming the actual work/scope (e.g. "foundation excavation", "kitchen remodel", "roof framing"), or null.
- "document_type": one of "invoice", "estimate", "quote", "contract", "receipt", "other".

If you can't tell a field, use null (or "other" for document_type).

DOCUMENT:\n${docText}`,
        },
      ],
    });
    const txt = resp.content.find((c) => c.type === "text");
    if (txt && txt.type === "text") {
      const raw = txt.text.trim().replace(/^```json\s*/, "").replace(/```$/, "").trim();
      const parsed = JSON.parse(raw) as {
        address?: string | null;
        client_name?: string | null;
        work_summary?: string | null;
        document_type?: string | null;
      };
      address = parsed.address || null;
      clientName = parsed.client_name || null;
      workSummary = parsed.work_summary || null;
      category = categoryFromDocType(parsed.document_type || null);
    }
  } catch (e) {
    console.error(`[pdf-match] document read failed for email ${email.id}:`, (e as Error).message);
    return { projectId: null, confidence: "none", reason: "document read failed", category: null, extractedAttachments };
  }

  const query = [address, clientName, workSummary].filter(Boolean).join(" ").trim();
  if (!query) {
    return { projectId: null, confidence: "none", reason: "no address/client in document", category, extractedAttachments };
  }

  // 3. Deterministic fuzzy match against active projects.
  const { data, error } = await admin.rpc("find_projects", { search_query: query, limit_n: 3 });
  if (error) {
    console.error(`[pdf-match] find_projects failed for email ${email.id}:`, error.message);
    return { projectId: null, confidence: "none", reason: "matcher error", category, extractedAttachments };
  }
  const rows = (data ?? []) as FindProjectsRow[];
  if (rows.length === 0) {
    return { projectId: null, confidence: "none", reason: `no project match for "${query}"`, category, extractedAttachments };
  }

  const top = rows[0];
  const second = rows[1];
  const clearWinner = !second || top.match_score - second.match_score >= MIN_GAP;

  if (top.match_score >= MIN_SCORE && clearWinner) {
    return {
      projectId: top.id,
      confidence: "high",
      reason: `"${query}" → ${top.name} (score ${top.match_score.toFixed(2)})`,
      category,
      extractedAttachments,
    };
  }

  return {
    projectId: null,
    confidence: "low",
    reason: `weak match for "${query}" → ${top.name} (${top.match_score.toFixed(2)})`,
    category,
    extractedAttachments,
  };
}
