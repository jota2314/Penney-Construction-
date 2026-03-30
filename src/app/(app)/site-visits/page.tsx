import type { Metadata } from "next";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { createClient } from "@/lib/supabase/server";
import { SiteVisitListPage } from "./site-visit-list-page";

export const metadata: Metadata = { title: "Site Visits | Penney Construction" };

export default async function SiteVisitsPage() {
  await requireAuth();
  const supabase = await createClient();

  // Construction only: progress/punch_list visits with a project
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
      <Header title="Site Visits" backHref="/command-center" />
      <div className="flex flex-1 flex-col gap-4 sm:gap-6 p-4 sm:p-6 overflow-auto">
        <SiteVisitListPage
          siteVisits={siteVisits ?? []}
          projects={projects ?? []}
        />
      </div>
    </>
  );
}
