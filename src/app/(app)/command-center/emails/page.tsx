import type { Metadata } from "next";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { createClient } from "@/lib/supabase/server";
import { EmailInbox } from "@/components/command-center/email-inbox";

export const metadata: Metadata = { title: "Email Inbox | Penney Construction" };

export default async function EmailsPage() {
  const user = await requireAuth();
  const effectiveUserId = user.profile?.id ?? user.id;
  const userName = user.profile?.full_name || user.email.split("@")[0];
  const supabase = await createClient();

  const [{ data: emails, count }, { data: subs }, { data: customers }, { data: projects }] =
    await Promise.all([
      supabase
        .from("inbox_emails")
        .select(
          "id, gmail_message_id, thread_id, subject, from_name, from_email, to_name, to_email, date, direction, snippet, body, is_processed, is_dismissed, project_id, attachments, sender_type, urgency, ai_summary, ai_action_required, content_type, matched_customer_id, matched_subcontractor_id, matched_project_id, ai_classified_at",
          { count: "exact" }
        )
        .eq("created_by", effectiveUserId)
        .order("date", { ascending: false })
        .limit(500),
      supabase.from("subcontractors").select("id, email, company_name"),
      supabase.from("customers").select("id, email, first_name, last_name"),
      supabase.from("projects").select("id, name, status, project_type"),
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

  return (
    <>
      <Header title="Email" backHref="/command-center" />
      <div className="flex-1 min-h-0 min-w-0 overflow-hidden">
        <EmailInbox
          initialEmails={emails ?? []}
          totalCount={count ?? 0}
          customerNames={customerNames}
          subNames={subNames}
          projectNames={projectNames}
          projects={projects ?? []}
          userName={userName}
        />
      </div>
    </>
  );
}
