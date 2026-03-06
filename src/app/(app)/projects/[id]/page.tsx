import { notFound } from "next/navigation";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { createClient } from "@/lib/supabase/server";
import { getTeamMembers } from "@/lib/actions/projects";
import { ProjectDetail } from "@/components/projects/project-detail";
import { ProjectScheduleSection } from "@/components/schedule/project-schedule-section";
import { ProjectSubcontractorsSection } from "@/components/projects/project-subcontractors-section";

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAuth();
  const { id } = await params;
  const supabase = await createClient();

  const [
    { data: project },
    { data: customers },
    { data: estimates },
    { data: schedulePhases },
    { data: employees },
    { data: subcontractors },
    teamMembers,
  ] = await Promise.all([
    supabase.from("projects").select("*").eq("id", id).single(),
    supabase.from("customers").select("*").order("last_name"),
    supabase
      .from("estimates")
      .select("*")
      .eq("project_id", id)
      .order("version", { ascending: false }),
    supabase
      .from("schedule_phases")
      .select("*")
      .eq("project_id", id)
      .order("sort_order")
      .order("start_date"),
    supabase.from("employees").select("*").order("last_name"),
    supabase.from("subcontractors").select("*").order("company_name"),
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
      <Header title={`${project.project_number} — ${project.name}`} />
      <div className="flex flex-1 flex-col gap-4 sm:gap-6 p-4 sm:p-6">
        <ProjectDetail
          project={project}
          customer={customer}
          customers={customers ?? []}
          teamMembers={teamMembers}
          pmName={pmName}
          estimatorName={estimatorName}
          estimates={estimates ?? []}
        />
        <ProjectScheduleSection
          projectId={project.id}
          phases={schedulePhases ?? []}
          employees={employees ?? []}
          subcontractors={subcontractors ?? []}
        />
        <ProjectSubcontractorsSection
          phases={schedulePhases ?? []}
          subcontractors={subcontractors ?? []}
        />
      </div>
    </>
  );
}
