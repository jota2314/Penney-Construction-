/**
 * Cron-driven auto-triage of newly stored inbox_emails.
 *
 * Philosophy: ONLY act on clear, unambiguous cases. If the Haiku classifier
 * matched a project AND the content type fits a known sub/vendor pattern,
 * auto-file the attachments under that project. Otherwise leave the email
 * for the existing email-by-email triage UI — never silently file something
 * the classifier was uncertain about.
 *
 * This respects the project-wide rule "User drives, AI suggests" for ambiguous
 * cases while addressing Jorge's daily pain ("every invoice should just be filed").
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { matchProjectFromAttachments } from "./match-project-from-attachment";
import { maybeDraftReply } from "./draft-reply";

type Category =
  | "construction_drawings"
  | "specs"
  | "pricing"
  | "contracts"
  | "permits"
  | "photos"
  | "invoices"
  | "estimates"
  | "other";

interface InboxAttachment {
  filename: string;
  mimeType: string;
  size: number;
  storage_path: string | null;
}

interface InboxEmail {
  id: string;
  subject: string | null;
  from_email: string | null;
  attachments: InboxAttachment[] | null;
  ai_classified_at: string | null;
  matched_project_id: string | null;
  matched_subcontractor_id: string | null;
  matched_customer_id: string | null;
  sender_type: string | null;
  content_type: string | null;
  is_processed: boolean | null;
}

export interface TriageRunSummary {
  scanned: number;
  auto_filed_emails: number;
  auto_filed_attachments: number;
  matched_via_pdf: number;
  drafts_created: number;
  skipped_no_classification: number;
  skipped_no_project_match: number;
  skipped_no_attachment: number;
  skipped_ambiguous_type: number;
  errors: number;
}

/**
 * Map a classifier content_type + sender_type into a project_files.category.
 * Returns null when the combination is ambiguous — those cases stay in the
 * manual triage queue.
 */
function categoryFor(
  contentType: string | null,
  senderType: string | null,
): Category | null {
  if (!contentType) return null;
  switch (contentType) {
    case "invoice":
      return "invoices";
    case "quote":
      // Sub quotes are pricing. Vendor quotes are also pricing.
      if (senderType === "sub" || senderType === "vendor") return "pricing";
      return null;
    case "contract":
      return "contracts";
    case "payment_receipt":
      return "invoices";
    default:
      return null;
  }
}

/**
 * Run a triage pass over recently stored emails that haven't been triaged yet.
 * Bounded to avoid pathological large catch-up batches.
 */
export async function runAutoTriage(
  admin: SupabaseClient,
  options: { limit?: number } = {},
): Promise<TriageRunSummary> {
  const limit = options.limit ?? 20;
  const summary: TriageRunSummary = {
    scanned: 0,
    auto_filed_emails: 0,
    auto_filed_attachments: 0,
    matched_via_pdf: 0,
    drafts_created: 0,
    skipped_no_classification: 0,
    skipped_no_project_match: 0,
    skipped_no_attachment: 0,
    skipped_ambiguous_type: 0,
    errors: 0,
  };

  const { data: candidates, error } = await admin
    .from("inbox_emails")
    .select(
      "id, subject, from_email, attachments, ai_classified_at, matched_project_id, matched_subcontractor_id, matched_customer_id, sender_type, content_type, is_processed",
    )
    .is("auto_triaged_at", null)
    .eq("direction", "inbound")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("[auto-triage] candidate lookup failed:", error.message);
    summary.errors += 1;
    return summary;
  }

  for (const raw of candidates ?? []) {
    const email = raw as InboxEmail;
    summary.scanned += 1;
    let outcome: string = "no_action";
    try {
      // Skip if classifier hasn't run yet — try again next cron tick.
      if (!email.ai_classified_at) {
        summary.skipped_no_classification += 1;
        // Don't mark as triaged — give classifier another chance.
        continue;
      }

      // Resolve a project. The classifier only reads subject/snippet/body, so
      // an invoice whose only job reference is inside the PDF comes back
      // unmatched. When that happens and there's a readable attachment, open it
      // and try to match the job-site address / client name off the document.
      let projectId = email.matched_project_id;
      let pdfCategory: Category | null = null;
      let matchedViaPdf = false;

      if (!projectId) {
        const hasReadable = (email.attachments ?? []).some((a) => a && a.storage_path);
        if (hasReadable) {
          const pdf = await matchProjectFromAttachments(admin, {
            id: email.id,
            subject: email.subject,
            attachments: email.attachments,
          });
          // Cache any newly-extracted text regardless of match outcome so the
          // detail view is instant and we never re-extract.
          if (pdf.extractedAttachments) {
            await admin
              .from("inbox_emails")
              .update({ attachments: pdf.extractedAttachments })
              .eq("id", email.id);
          }
          if (pdf.projectId) {
            projectId = pdf.projectId;
            pdfCategory = pdf.category;
            matchedViaPdf = true;
            await admin
              .from("inbox_emails")
              .update({ matched_project_id: projectId })
              .eq("id", email.id);
            console.log(`[auto-triage] PDF-matched email ${email.id}: ${pdf.reason}`);
          }
        }
      }

      if (!projectId) {
        summary.skipped_no_project_match += 1;
        outcome = "no_match";
      } else {
        const attachments = (email.attachments ?? []).filter(
          (a) => a && a.storage_path,
        );

        if (attachments.length === 0) {
          summary.skipped_no_attachment += 1;
          outcome = "no_attachment";
        } else {
          // Prefer the classifier's category; fall back to what we read off the
          // PDF (handles emails the classifier mislabeled as content_type "other").
          const cat = categoryFor(email.content_type, email.sender_type) ?? pdfCategory;
          if (!cat) {
            summary.skipped_ambiguous_type += 1;
            outcome = "ambiguous";
          } else {
            // High-confidence path: auto-file every attachment under the matched project.
            let filed = 0;
            for (const att of attachments) {
              // Dedupe: skip if this storage_path is already linked to the project.
              const { count } = await admin
                .from("project_files")
                .select("id", { count: "exact", head: true })
                .eq("project_id", projectId)
                .eq("storage_path", att.storage_path!);
              if ((count ?? 0) > 0) continue;

              const { error: insErr } = await admin.from("project_files").insert({
                project_id: projectId,
                filename: att.filename,
                storage_path: att.storage_path,
                mime_type: att.mimeType || "application/octet-stream",
                size: att.size ?? 0,
                category: cat,
                description: `Auto-filed by cron triage from "${email.subject ?? "(no subject)"}" (sender ${email.from_email ?? "unknown"})${matchedViaPdf ? " — matched via attachment" : ""}`,
              });
              if (insErr) {
                console.error(
                  `[auto-triage] insert failed for email ${email.id} file ${att.filename}:`,
                  insErr.message,
                );
                continue;
              }
              filed += 1;
            }

            if (filed > 0) {
              summary.auto_filed_emails += 1;
              summary.auto_filed_attachments += filed;
              if (matchedViaPdf) summary.matched_via_pdf += 1;
              outcome = "auto_filed";

              // Link the email itself to the project so the email detail page shows
              // it in the project's email list. Don't override an existing project_id.
              await admin
                .from("inbox_emails")
                .update({ project_id: projectId })
                .eq("id", email.id)
                .is("project_id", null);
            } else {
              outcome = "duplicate";
            }
          }
        }
      }

      // Part B: does this email deserve a written reply? If so, draft one and
      // park it in email_drafts (status="draft") for Jorge to review/approve.
      // Runs whether or not a project matched; isolated so a draft failure
      // never affects filing. NEVER sends.
      try {
        const draft = await maybeDraftReply(admin, { emailId: email.id, projectId });
        if (draft.drafted) {
          summary.drafts_created += 1;
          console.log(
            `[auto-triage] drafted reply for email ${email.id} (draft ${draft.draftId}): ${draft.reason}`,
          );
        }
      } catch (e) {
        console.error(
          `[auto-triage] draft-reply failed for email ${email.id}:`,
          (e as Error).message,
        );
      }
    } catch (e) {
      summary.errors += 1;
      outcome = "error";
      console.error(`[auto-triage] error on email ${email.id}:`, (e as Error).message);
    }

    // Mark as triaged so we don't reprocess.
    await admin
      .from("inbox_emails")
      .update({
        auto_triaged_at: new Date().toISOString(),
        auto_triage_outcome: outcome,
      })
      .eq("id", email.id);
  }

  return summary;
}
