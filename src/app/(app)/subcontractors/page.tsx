import type { Metadata } from "next";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { createClient } from "@/lib/supabase/server";
import { getMode } from "@/lib/mode/get-mode";
import { SubcontractorListPrecon } from "@/components/subcontractors/subcontractor-list-precon";
import { SubcontractorListConstruction } from "@/components/subcontractors/subcontractor-list-construction";
import type { Subcontractor } from "@/types/database";

export const metadata: Metadata = { title: "Subcontractors | Penney Construction" };

export default async function SubcontractorsPage() {
  await requireAuth();
  const supabase = await createClient();
  const mode = await getMode();

  if (mode === "construction") {
    // Fetch schedule phases + active projects + contracts
    const [{ data: phases }, { data: proj }, { data: contracts }] =
      await Promise.all([
        supabase.from("schedule_phases").select("*"),
        supabase
          .from("projects")
          .select("id, name, project_number")
          .in("status", ["in_progress", "contracted"]),
        supabase.from("project_subcontractors").select("*"),
      ]);

    const schedulePhases = phases ?? [];
    const projects = proj ?? [];

    // Only show approved subs assigned to at least one phase of an active project
    const activeProjectIds = new Set(projects.map((p) => p.id));
    const assignedSubIds = new Set<string>();
    for (const phase of schedulePhases) {
      if (activeProjectIds.has(phase.project_id)) {
        for (const subId of phase.assigned_sub_ids ?? []) {
          assignedSubIds.add(subId);
        }
      }
    }

    const subIds = Array.from(assignedSubIds);
    let subcontractors: Subcontractor[] = [];

    if (subIds.length > 0) {
      const { data } = await supabase
        .from("subcontractors")
        .select("*")
        .eq("vetting_status", "approved")
        .in("id", subIds)
        .order("company_name");
      subcontractors = data ?? [];
    }

    return (
      <>
        <Header title="Subcontractors" backHref="/command-center" />
        <div className="flex flex-1 flex-col gap-4 sm:gap-6 p-4 sm:p-6">
          <SubcontractorListConstruction
            subcontractors={subcontractors}
            schedulePhases={schedulePhases}
            projects={projects}
            projectSubcontracts={contracts ?? []}
          />
        </div>
      </>
    );
  }

  // Pre-con mode — all subs, vetting pipeline + bid requests
  const { data: subcontractors } = await supabase
    .from("subcontractors")
    .select("*")
    .order("company_name");

  return (
    <>
      <Header title="Subcontractors" backHref="/command-center" />
      <div className="flex flex-1 flex-col gap-4 sm:gap-6 p-4 sm:p-6">
        <SubcontractorListPrecon subcontractors={subcontractors ?? []} />
      </div>
    </>
  );
}
