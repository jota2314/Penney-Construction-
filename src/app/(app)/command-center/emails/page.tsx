import type { Metadata } from "next";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { createClient } from "@/lib/supabase/server";
import { EmailInbox } from "@/components/command-center/email-inbox";

export const metadata: Metadata = { title: "Email Inbox | Penney Construction" };

export default async function EmailsPage() {
  const user = await requireAuth();
  // Honor impersonation — profile.id is the effective user (impersonated when active, real otherwise)
  const effectiveUserId = user.profile?.id ?? user.id;
  const supabase = await createClient();

  const [{ data: emails, count }, { data: subs }, { data: customers }, { data: projects }] =
    await Promise.all([
      supabase
        .from("inbox_emails")
        .select("id, gmail_message_id, subject, from_name, from_email, to_name, to_email, date, direction, snippet, is_processed, is_dismissed, project_id, attachments, sender_type, urgency, ai_summary, ai_action_required, matched_customer_id, matched_subcontractor_id, matched_project_id, ai_classified_at", { count: "exact" })
        .eq("created_by", effectiveUserId)
        .order("date", { ascending: false }),
      supabase.from("subcontractors").select("id, email, company_name"),
      supabase.from("customers").select("id, email, first_name, last_name"),
      supabase.from("projects").select("id, name"),
    ]);

  // Build email lookup sets for categorization
  const subEmails = (subs ?? []).filter((s) => s.email).map((s) => s.email!.toLowerCase());
  const customerEmails = (customers ?? []).filter((c) => c.email).map((c) => c.email!.toLowerCase());

  // Build entity ID → name lookups for matched_* badges
  const customerNames: Record<string, string> = {};
  for (const c of customers ?? []) {
    customerNames[c.id] = `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() || c.email || "Customer";
  }
  const subNames: Record<string, string> = {};
  for (const s of subs ?? []) {
    subNames[s.id] = s.company_name || s.email || "Sub";
  }
  const projectNames: Record<string, string> = {};
  for (const p of projects ?? []) {
    projectNames[p.id] = p.name;
  }

  const unprocessed = (emails ?? []).filter(
    (e) => !e.is_processed && !e.is_dismissed
  ).length;

  return (
    <>
      <Header title="Email" backHref="/command-center" />
      <div className="flex flex-1 flex-col gap-4 p-4 sm:p-6 min-w-0 overflow-auto">
        <EmailInbox
          initialEmails={emails ?? []}
          totalCount={count ?? 0}
          unprocessedCount={unprocessed}
          subEmails={subEmails}
          customerEmails={customerEmails}
          customerNames={customerNames}
          subNames={subNames}
          projectNames={projectNames}
        />
      </div>
    </>
  );
}
