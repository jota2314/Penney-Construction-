import { Suspense } from "react";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { createClient } from "@/lib/supabase/server";
import { getTeamMembers } from "@/lib/actions/projects";
import { ProjectList } from "@/components/projects/project-list";

export default async function ProjectsPage() {
  await requireAuth();
  const supabase = await createClient();

  const [{ data: projects }, { data: customers }, teamMembers] =
    await Promise.all([
      supabase
        .from("projects")
        .select("*, customer:customers(first_name, last_name)")
        .order("created_at", { ascending: false }),
      supabase
        .from("customers")
        .select("*")
        .order("last_name"),
      getTeamMembers(),
    ]);

  return (
    <>
      <Header title="Projects" />
      <div className="flex flex-1 flex-col gap-6 p-6">
        <Suspense>
          <ProjectList
            projects={projects ?? []}
            customers={customers ?? []}
            teamMembers={teamMembers}
          />
        </Suspense>
      </div>
    </>
  );
}
