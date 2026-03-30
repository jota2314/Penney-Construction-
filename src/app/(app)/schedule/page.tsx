import type { Metadata } from "next";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { createClient } from "@/lib/supabase/server";
import { ScheduleCalendar } from "@/components/schedule/schedule-calendar";

export const metadata: Metadata = { title: "Schedule | Penney Construction" };

export default async function SchedulePage() {
  await requireAuth();
  const supabase = await createClient();

  const { data: phases } = await supabase
    .from("schedule_phases")
    .select("*")
    .order("start_date");

  // Fetch project info for each unique project_id
  const projectIds = [
    ...new Set((phases ?? []).map((p) => p.project_id)),
  ];

  let projects: Record<string, { id: string; name: string; project_number: string }> = {};
  if (projectIds.length > 0) {
    const { data: projectData } = await supabase
      .from("projects")
      .select("id, name, project_number")
      .in("id", projectIds);

    if (projectData) {
      projects = Object.fromEntries(projectData.map((p) => [p.id, p]));
    }
  }

  // Merge project data into phases
  const phasesWithProjects = (phases ?? []).map((phase) => ({
    ...phase,
    project: projects[phase.project_id] ?? undefined,
  }));

  return (
    <>
      <Header title="Schedule" backHref="/command-center" />
      <div className="flex flex-1 flex-col gap-4 sm:gap-6 p-4 sm:p-6 overflow-auto">
        <ScheduleCalendar phases={phasesWithProjects} />
      </div>
    </>
  );
}
