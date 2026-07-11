import type { Metadata } from "next";
import { Suspense } from "react";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { getScopedProjectIds } from "@/lib/auth/scoped-projects";
import { createClient } from "@/lib/supabase/server";
import { getTeamMembers } from "@/lib/actions/projects";
import { ProjectList } from "@/components/projects/project-list";
import { PROJECT_STATUSES } from "@/lib/constants/project";

export const metadata: Metadata = { title: "Active Projects | Penney Construction" };

export default async function ActiveProjectsPage() {
  const user = await requireAuth();
  const supabase = await createClient();
  const scopedIds = await getScopedProjectIds(supabase, user.profile);

  const [{ data: projects }, { data: customers }, teamMembers] =
    await Promise.all([
      supabase
        .from("projects")
        .select("*, customer:customers(first_name, last_name)")
        .in("status", PROJECT_STATUSES)
        .order("created_at", { ascending: false }),
      supabase
        .from("customers")
        .select("*")
        .order("last_name"),
      getTeamMembers(),
    ]);

  return (
    <>
      <Header title="Projects" backHref="/command-center" />
      <div className="flex flex-1 flex-col gap-4 sm:gap-6 p-4 sm:p-6 overflow-auto">
        <Suspense>
          <ProjectList
            projects={
              scopedIds === null
                ? projects ?? []
                : (projects ?? []).filter((p) => scopedIds.has(p.id))
            }
            customers={customers ?? []}
            teamMembers={teamMembers}
            mode="projects"
          />
        </Suspense>
      </div>
    </>
  );
}
