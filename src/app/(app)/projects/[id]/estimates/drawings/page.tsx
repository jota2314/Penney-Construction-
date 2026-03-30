import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { createClient } from "@/lib/supabase/server";
import { getProjectFiles } from "@/lib/actions/project-files";
import { ProjectDrawings } from "@/components/projects/project-drawings";

export const metadata: Metadata = { title: "Project Drawings | Penney Construction" };

export default async function DrawingsPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAuth();
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: project }, { data: linkedEmails }, uploadedFiles] = await Promise.all([
    supabase.from("projects").select("id, name").eq("id", id).single(),
    supabase
      .from("inbox_emails")
      .select("id, subject, date, attachments")
      .eq("project_id", id)
      .order("date", { ascending: false }),
    getProjectFiles(id),
  ]);

  if (!project) notFound();

  const drawings = uploadedFiles.filter(f => f.category === "construction_drawings");

  // Pull all PDFs from email attachments — these are project documents
  // (invoices/quotes already have their own dedicated tabs)
  const emailDrawings: { filename: string; size: number; storage_path: string; emailSubject: string; emailDate: string }[] = [];
  for (const email of linkedEmails ?? []) {
    const atts = (email.attachments as { filename: string; mimeType: string; size: number; storage_path: string | null }[] | null) ?? [];
    for (const att of atts) {
      if (!att.storage_path) continue;
      if (!att.mimeType?.includes("pdf")) continue;
      emailDrawings.push({
        filename: att.filename,
        size: att.size,
        storage_path: att.storage_path,
        emailSubject: email.subject,
        emailDate: email.date,
      });
    }
  }

  return (
    <>
      <Header title={`Drawings — ${project.name}`} backHref={`/projects/${id}/estimates`} />
      <div className="flex flex-1 flex-col gap-4 sm:gap-6 p-4 sm:p-6">
        <ProjectDrawings projectId={id} drawings={drawings} emailDrawings={emailDrawings} />
      </div>
    </>
  );
}
