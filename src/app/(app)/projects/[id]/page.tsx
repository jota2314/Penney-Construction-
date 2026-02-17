import { notFound } from "next/navigation";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { createClient } from "@/lib/supabase/server";
import { getTeamMembers } from "@/lib/actions/projects";
import { ProjectDetail } from "@/components/projects/project-detail";
import { ProjectEstimatesSection } from "@/components/estimates/project-estimates-section";

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAuth();
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: project }, { data: customers }, { data: estimates }, teamMembers] =
    await Promise.all([
      supabase.from("projects").select("*").eq("id", id).single(),
      supabase.from("customers").select("*").order("last_name"),
      supabase
        .from("estimates")
        .select("*")
        .eq("project_id", id)
        .order("version", { ascending: false }),
      getTeamMembers(),
    ]);

  if (!project) notFound();

  // Fetch customer if linked
  let customer = null;
  if (project.customer_id) {
    const { data } = await supabase
      .from("customers")
      .select("*")
      .eq("id", project.customer_id)
      .single();
    customer = data;
  }

  // Resolve team member names
  const pmName =
    teamMembers.find((m) => m.id === project.assigned_pm)?.full_name ?? null;
  const estimatorName =
    teamMembers.find((m) => m.id === project.assigned_estimator)?.full_name ??
    null;

  return (
    <>
      <Header title={project.project_number} />
      <div className="flex flex-1 flex-col gap-6 p-6">
        <ProjectDetail
          project={project}
          customer={customer}
          customers={customers ?? []}
          teamMembers={teamMembers}
          pmName={pmName}
          estimatorName={estimatorName}
        />
        <ProjectEstimatesSection
          projectId={project.id}
          projectType={project.project_type}
          estimates={estimates ?? []}
        />
      </div>
    </>
  );
}
