/**
 * Cron-driven ASSIGNER for newly stored inbox_emails.
 *
 * Role: this cron is the office dispatcher's intake desk. It classifies each new
 * inbound email and gets it ready for the right agent — it does NOT do the work
 * and it does NOT mark the email done.
 *
 *   - Bills / receipts  -> Bookkeeper Bill (records to the P&L)
 *   - Everything else    -> Dispatch Dan (files documents, drafts replies)
 *
 * The crew agents read their queue through the MCP `list_inbox`, which returns
 * mail where `auto_triaged_at IS NULL`. So this cron must NEVER set
 * `auto_triaged_at` — doing so empties the crew's queue before they ever run
 * (the original bug: every email was stamped triaged 1-2 min after arrival).
 *
 * Instead the cron stamps its OWN marker, `assigned_at`, so it doesn't re-scan
 * the same mail every tick. `auto_triaged_at` stays NULL until an agent finishes
 * the email via `mark_triaged` / `record_invoice`.
 *
 * The one thing the cron does beyond classifying is cheap prep that makes the
 * agents faster: if the classifier couldn't match a project from the subject,
 * it opens the attachment, caches the extracted text, and matches the job off
 * the document. It never files and never drafts.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { matchProjectFromAttachments } from "./match-project-from-attachment";

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
  content_type: string | null;
}

export interface TriageRunSummary {
  scanned: number;
  assigned_invoice: number;
  assigned_dispatch: number;
  matched_via_pdf: number;
  skipped_no_classification: number;
  errors: number;
}

// Bills go to the Bookkeeper; everything else goes to the Dispatcher. The crew
// makes the fine-grained call (file vs draft vs no_action) — the cron only needs
// the coarse route so the dashboard can show who an email was handed to.
function routeFor(contentType: string | null): "assigned_invoice" | "assigned_dispatch" {
  if (contentType === "invoice" || contentType === "payment_receipt") return "assigned_invoice";
  return "assigned_dispatch";
}

/**
 * Classify + assign newly stored emails the cron hasn't routed yet. Bounded so a
 * backlog never blows the function budget.
 */
export async function runAutoTriage(
  admin: SupabaseClient,
  options: { limit?: number } = {},
): Promise<TriageRunSummary> {
  const limit = options.limit ?? 20;
  const summary: TriageRunSummary = {
    scanned: 0,
    assigned_invoice: 0,
    assigned_dispatch: 0,
    matched_via_pdf: 0,
    skipped_no_classification: 0,
    errors: 0,
  };

  // The cron's own queue: mail it hasn't assigned yet. Distinct from
  // auto_triaged_at (the crew's "done" flag), so the cron never hides work
  // from the agents.
  const { data: candidates, error } = await admin
    .from("inbox_emails")
    .select(
      "id, subject, from_email, attachments, ai_classified_at, matched_project_id, content_type",
    )
    .is("assigned_at", null)
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
    try {
      // Wait for the classifier — without content_type we can't route. Don't
      // stamp assigned_at; give the classifier another tick.
      if (!email.ai_classified_at) {
        summary.skipped_no_classification += 1;
        continue;
      }

      // Prep: if the subject didn't reveal a project, read the attachment and
      // match the job off the document. Cache the extracted text either way so
      // the agent's read_email is instant and we never re-extract.
      let projectId = email.matched_project_id;
      let matchedViaPdf = false;

      if (!projectId) {
        const hasReadable = (email.attachments ?? []).some((a) => a && a.storage_path);
        if (hasReadable) {
          const pdf = await matchProjectFromAttachments(admin, {
            id: email.id,
            subject: email.subject,
            attachments: email.attachments,
          });
          if (pdf.extractedAttachments) {
            await admin
              .from("inbox_emails")
              .update({ attachments: pdf.extractedAttachments })
              .eq("id", email.id);
          }
          if (pdf.projectId) {
            projectId = pdf.projectId;
            matchedViaPdf = true;
            summary.matched_via_pdf += 1;
            await admin
              .from("inbox_emails")
              .update({ matched_project_id: projectId })
              .eq("id", email.id)
              .is("matched_project_id", null);
            console.log(`[auto-triage] PDF-matched email ${email.id}: ${pdf.reason}`);
          }
        }
      }

      const route = routeFor(email.content_type);
      if (route === "assigned_invoice") summary.assigned_invoice += 1;
      else summary.assigned_dispatch += 1;

      // Assign it: stamp the cron's marker and record who it went to. Crucially
      // we do NOT touch auto_triaged_at — the agent sets that when the work is
      // actually done. Link the email to its project if we found one (don't
      // override an existing link).
      const update: Record<string, unknown> = {
        assigned_at: new Date().toISOString(),
        auto_triage_outcome: route,
      };
      await admin.from("inbox_emails").update(update).eq("id", email.id);

      if (projectId) {
        await admin
          .from("inbox_emails")
          .update({ project_id: projectId })
          .eq("id", email.id)
          .is("project_id", null);
      }
    } catch (e) {
      summary.errors += 1;
      console.error(`[auto-triage] error on email ${email.id}:`, (e as Error).message);
      // Stamp assigned_at so one poison email doesn't get retried forever.
      await admin
        .from("inbox_emails")
        .update({ assigned_at: new Date().toISOString(), auto_triage_outcome: "error" })
        .eq("id", email.id);
    }
  }

  return summary;
}
