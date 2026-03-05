import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { createClient } from "@/lib/supabase/server";
import { getMode } from "@/lib/mode/get-mode";
import { SiteVisitListPage } from "./site-visit-list-page";

export default async function SiteVisitsPage() {
  await requireAuth();
  const supabase = await createClient();
  const mode = await getMode();

  const isPrecon = mode === "precon";

  if (isPrecon) {
    // Pre-con: pricing visits (estimation) OR visits with no project
    const [{ data: siteVisits }, { data: estimates }] = await Promise.all([
      supabase
        .from("site_visits")
        .select("*, project:projects(project_number, name)")
        .or("visit_type.eq.pricing,project_id.is.null")
        .order("visited_at", { ascending: false }),
      supabase
        .from("estimates")
        .select("id, name")
        .is("project_id", null)
        .in("status", ["draft", "review"])
        .order("created_at", { ascending: false }),
    ]);

    return (
      <>
        <Header title="Site Visits" />
        <div className="flex flex-1 flex-col gap-4 sm:gap-6 p-4 sm:p-6">
          <SiteVisitListPage
            siteVisits={siteVisits ?? []}
            projects={[]}
            estimates={estimates ?? []}
            mode={mode}
          />
        </div>
      </>
    );
  }

  // Construction: progress/punch_list visits with a project
  const [{ data: siteVisits }, { data: projects }] = await Promise.all([
    supabase
      .from("site_visits")
      .select("*, project:projects(project_number, name)")
      .not("project_id", "is", null)
      .in("visit_type", ["progress", "punch_list"])
      .order("visited_at", { ascending: false }),
    supabase
      .from("projects")
      .select("id, project_number, name, status")
      .not("status", "in", '("cancelled","completed")')
      .order("project_number", { ascending: false }),
  ]);

  return (
    <>
      <Header title="Site Visits" />
      <div className="flex flex-1 flex-col gap-4 sm:gap-6 p-4 sm:p-6">
        <SiteVisitListPage
          siteVisits={siteVisits ?? []}
          projects={projects ?? []}
          estimates={[]}
          mode={mode}
        />
      </div>
    </>
  );
}
