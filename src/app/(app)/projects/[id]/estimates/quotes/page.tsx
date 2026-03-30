import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { createClient } from "@/lib/supabase/server";
import { ProjectQuotesTab } from "@/components/projects/project-quotes-tab";

export const metadata: Metadata = { title: "Sub Quotes | Penney Construction" };

export default async function QuotesPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAuth();
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: project }, { data: quotes }, { data: linkedEmails }] = await Promise.all([
    supabase.from("projects").select("id, name").eq("id", id).single(),
    supabase
      .from("quote_requests")
      .select("*")
      .eq("project_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("inbox_emails")
      .select("id, gmail_message_id, subject, from_name, from_email, to_name, to_email, date, direction, snippet, is_processed, attachments")
      .eq("project_id", id)
      .order("date", { ascending: false }),
  ]);

  if (!project) notFound();

  return (
    <>
      <Header title={`Sub Quotes — ${project.name}`} backHref={`/projects/${id}/estimates`} />
      <div className="flex flex-1 flex-col gap-4 sm:gap-6 p-4 sm:p-6">
        <ProjectQuotesTab
          quotes={quotes ?? []}
          projectName={project.name}
          linkedEmails={(linkedEmails ?? []) as Parameters<typeof ProjectQuotesTab>[0]["linkedEmails"]}
        />
      </div>
    </>
  );
}
