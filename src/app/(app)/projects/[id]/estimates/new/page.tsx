import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { createClient } from "@/lib/supabase/server";
import { EstimateBuilder } from "@/components/projects/estimate-builder";

export const metadata: Metadata = { title: "New Estimate | Penney Construction" };

export default async function NewEstimatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAuth();
  const { id } = await params;
  const supabase = await createClient();

  const { data: project } = await supabase
    .from("projects")
    .select("id, name, project_type, description, address")
    .eq("id", id)
    .single();

  if (!project) notFound();

  return (
    <>
      <Header
        title={`New Estimate — ${project.name}`}
        backHref={`/projects/${id}/estimates`}
      />
      <div className="flex flex-1 flex-col gap-4 p-4 sm:p-6 overflow-auto">
        <EstimateBuilder
          projectId={project.id}
          projectName={project.name}
          projectType={project.project_type}
          projectDescription={project.description}
        />
      </div>
    </>
  );
}
