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
  const { data: project } = await supabase.from("projects").select("id, name").eq("id", id).single();
  if (!project) notFound();
  const allFiles = await getProjectFiles(id);
  const drawings = allFiles.filter(f => f.category === "construction_drawings");

  return (
    <>
      <Header title={`Drawings — ${project.name}`} backHref={`/projects/${id}/estimates`} />
      <div className="flex flex-1 flex-col gap-4 sm:gap-6 p-4 sm:p-6">
        <ProjectDrawings projectId={id} drawings={drawings} />
      </div>
    </>
  );
}
