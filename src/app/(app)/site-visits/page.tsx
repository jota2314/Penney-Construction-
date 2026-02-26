import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { createClient } from "@/lib/supabase/server";
import { SiteVisitListPage } from "./site-visit-list-page";

export default async function SiteVisitsPage() {
  await requireAuth();
  const supabase = await createClient();

  const [{ data: siteVisits }, { data: projects }] = await Promise.all([
    supabase
      .from("site_visits")
      .select("*, project:projects(project_number, name)")
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
        />
      </div>
    </>
  );
}
