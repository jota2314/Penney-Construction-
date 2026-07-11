import type { Metadata } from "next";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { createClient } from "@/lib/supabase/server";
import { ScheduleCalendar } from "@/components/schedule/schedule-calendar";

export const metadata: Metadata = { title: "Schedule | Penney Construction" };

export default async function SchedulePage() {
  await requireAuth();
  const supabase = await createClient();

  const [{ data: phases }, { data: allProjects }] = await Promise.all([
    supabase.from("schedule_phases").select("*").order("start_date"),
    supabase
      .from("projects")
      .select("id, name, project_number")
      .in("status", ["lead", "estimating", "proposal_sent", "contracted", "in_progress"])
      .order("name"),
  ]);

  const projects: Record<string, { id: string; name: string; project_number: string }> = {};
  for (const p of allProjects ?? []) {
    projects[p.id] = p;
  }

  // Also try to resolve project names for phases without project_id match
  // by using the phase's name or any other available data
  const phasesWithProjects = (phases ?? []).map((phase) => ({
    ...phase,
    project: phase.project_id ? projects[phase.project_id] ?? undefined : undefined,
  }));

  return (
    <>
      <Header title="Schedule" backHref="/command-center" />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto p-3 pb-28 sm:p-6 sm:pb-8">
        <ScheduleCalendar phases={phasesWithProjects} allProjects={allProjects ?? []} />
      </div>
    </>
  );
}
