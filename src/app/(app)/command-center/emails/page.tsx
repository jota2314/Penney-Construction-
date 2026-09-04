import type { Metadata } from "next";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { createClient } from "@/lib/supabase/server";
import { EmailInbox } from "@/components/command-center/email-inbox";
import { stripAttachmentText } from "@/lib/email/strip-attachment-text";
import type { DraftRow } from "@/components/command-center/drafts-list";
import { mailboxFilter, viewerDirection } from "@/lib/email/mailbox-scope";

export const metadata: Metadata = { title: "Email Inbox | Penney Construction" };

interface PendingDraft {
  id: string;
  to_emails: unknown;
  subject: string | null;
  body: string | null;
  project_id: string | null;
  origin: string | null;
  created_by: string | null;
  created_at: string;
  file_ids: string[] | null;
  attachment_paths: string[] | null;
}

function toStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
  return [];
}

export default async function EmailsPage() {
  const user = await requireAuth();
  const effectiveUserId = user.profile?.id ?? user.id;
  const userName = user.profile?.full_name || user.email.split("@")[0];
  const viewerEmail = user.profile?.email ?? user.email;
  const supabase = await createClient();

  const [
    { data: emails, count },
    { data: subs },
    { data: customers },
    { data: projects },
    { data: pendingDrafts },
  ] = await Promise.all([
      // NO `body` here — 500 full email bodies (plus extracted PDF text in
      // attachments) made this page's payload tens of MB. The list renders
      // snippet/ai_summary; the detail pane hydrates `body` on selection.
      supabase
        .from("inbox_emails")
        .select(
          "id, gmail_message_id, thread_id, subject, from_name, from_email, to_name, to_email, date, direction, snippet, is_processed, is_dismissed, project_id, attachments, sender_type, urgency, ai_summary, ai_action_required, content_type, matched_customer_id, matched_subcontractor_id, matched_project_id, ai_classified_at, auto_triaged_at, auto_triage_outcome, created_by",
          { count: "exact" }
        )
        // Membership, not ownership — a message stored under a teammate's
        // sync still belongs in this inbox. See mailbox-scope.ts.
        .or(mailboxFilter(effectiveUserId))
        .order("date", { ascending: false })
        .limit(500),
      supabase.from("subcontractors").select("id, email, company_name"),
      supabase.from("customers").select("id, email, first_name, last_name"),
      supabase.from("projects").select("id, name, status, project_type"),
      // Unsent drafts power the "Drafts" toggle in the filter bar. Newest first
      // — overnight auto-triage replies are what this view is really for.
      supabase
        .from("email_drafts")
        .select(
          "id, to_emails, subject, body, project_id, origin, created_by, created_at, file_ids, attachment_paths",
        )
        .eq("status", "draft")
        .order("created_at", { ascending: false })
        .limit(200)
        .returns<PendingDraft[]>(),
    ]);

  const customerNames: Record<string, string> = {};
  for (const c of customers ?? []) {
    customerNames[c.id] =
      `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() || c.email || "Customer";
  }
  const subNames: Record<string, string> = {};
  for (const s of subs ?? []) {
    subNames[s.id] = s.company_name || s.email || "Sub";
  }
  const projectNames: Record<string, string> = {};
  for (const p of projects ?? []) {
    projectNames[p.id] = p.name;
  }

  const drafts: DraftRow[] = (pendingDrafts ?? []).map((d) => ({
    id: d.id,
    to: toStringArray(d.to_emails),
    subject: d.subject ?? "",
    bodyPreview: (d.body ?? "").replace(/\s+/g, " ").trim().slice(0, 140),
    projectName: d.project_id ? projectNames[d.project_id] ?? null : null,
    origin: d.origin,
    createdBy: d.created_by ?? "",
    createdAt: d.created_at,
    attachmentCount: (d.file_ids?.length ?? 0) + (d.attachment_paths?.length ?? 0),
  }));

  return (
    <>
      <Header title="Email" backHref="/command-center" />
      <div className="flex-1 min-h-0 min-w-0 overflow-hidden">
        <EmailInbox
          initialEmails={(emails ?? []).map((e) =>
            stripAttachmentText({
              ...e,
              body: null,
              direction: viewerDirection(e, effectiveUserId, viewerEmail),
            }),
          )}
          totalCount={count ?? 0}
          customerNames={customerNames}
          subNames={subNames}
          projectNames={projectNames}
          projects={projects ?? []}
          userName={userName}
          drafts={drafts}
        />
      </div>
    </>
  );
}
