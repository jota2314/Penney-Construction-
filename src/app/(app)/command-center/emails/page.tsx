import type { Metadata } from "next";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { createClient } from "@/lib/supabase/server";
import { EmailInbox } from "@/components/command-center/email-inbox";

export const metadata: Metadata = { title: "Email Inbox | Penney Construction" };

export default async function EmailsPage() {
  await requireAuth();
  const supabase = await createClient();

  const [{ data: emails, count }, { data: subs }, { data: customers }] =
    await Promise.all([
      supabase
        .from("inbox_emails")
        .select("id, gmail_message_id, subject, from_name, from_email, to_name, to_email, date, direction, snippet, is_processed, is_dismissed, project_id, attachments", { count: "exact" })
        .order("date", { ascending: false }),
      supabase.from("subcontractors").select("email, company_name"),
      supabase.from("customers").select("email, first_name, last_name"),
    ]);

  // Build email lookup sets for categorization
  const subEmails = (subs ?? []).filter((s) => s.email).map((s) => s.email!.toLowerCase());
  const customerEmails = (customers ?? []).filter((c) => c.email).map((c) => c.email!.toLowerCase());

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
        />
      </div>
    </>
  );
}
