import type { Metadata } from "next";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { createClient } from "@/lib/supabase/server";
import { EmailInbox } from "@/components/command-center/email-inbox";

export const metadata: Metadata = { title: "Email Inbox | Penney Construction" };

export default async function EmailsPage() {
  await requireAuth();
  const supabase = await createClient();

  const { data: emails, count } = await supabase
    .from("inbox_emails")
    .select("id, gmail_message_id, subject, from_name, from_email, to_name, to_email, date, direction, snippet, is_processed, is_dismissed, project_id, attachments", { count: "exact" })
    .order("date", { ascending: false });

  const unprocessed = (emails ?? []).filter(
    (e) => !e.is_processed && !e.is_dismissed
  ).length;

  return (
    <>
      <Header title="Email" />
      <div className="flex flex-1 flex-col gap-4 p-4 sm:p-6 min-w-0 overflow-auto">
        <EmailInbox
          initialEmails={emails ?? []}
          totalCount={count ?? 0}
          unprocessedCount={unprocessed}
        />
      </div>
    </>
  );
}
