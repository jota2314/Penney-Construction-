import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { createClient } from "@/lib/supabase/server";
import { getProjectFiles } from "@/lib/actions/project-files";
import { EstimatingHub } from "@/components/projects/estimating-hub";

export const metadata: Metadata = { title: "Estimating | Penney Construction" };

export default async function ProjectEstimatesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAuth();
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: project }, { data: estimates }, { data: quotes }, uploadedFiles] =
    await Promise.all([
      supabase.from("projects").select("*").eq("id", id).single(),
      supabase
        .from("estimates")
        .select("*")
        .eq("project_id", id)
        .order("version", { ascending: false }),
      supabase
        .from("quote_requests")
        .select("*")
        .eq("project_id", id)
        .order("created_at", { ascending: false }),
      getProjectFiles(id),
    ]);

  if (!project) notFound();

  const drawings = uploadedFiles.filter(
    (f) => f.category === "construction_drawings"
  );
  const pricingFiles = uploadedFiles.filter(
    (f) => f.category === "pricing" || f.category === "specs"
  );

  return (
    <>
      <Header
        title={`Estimating — ${project.name}`}
        backHref={`/projects/${id}`}
      />
      <div className="flex flex-1 flex-col gap-4 sm:gap-6 p-4 sm:p-6">
        <EstimatingHub
          project={project}
          estimates={estimates ?? []}
          quotes={quotes ?? []}
          drawingsCount={drawings.length}
          pricingFilesCount={pricingFiles.length}
        />
      </div>
    </>
  );
}
