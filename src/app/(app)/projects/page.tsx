import { Suspense } from "react";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { createClient } from "@/lib/supabase/server";
import { getTeamMembers } from "@/lib/actions/projects";
import { ProjectList } from "@/components/projects/project-list";
import { CRM_STATUSES } from "@/lib/constants/project";

export default async function CrmPage() {
  await requireAuth();
  const supabase = await createClient();

  const [{ data: projects }, { data: customers }, teamMembers] =
    await Promise.all([
      supabase
        .from("projects")
        .select("*, customer:customers(first_name, last_name), walkthrough_assignee:profiles!projects_walkthrough_assigned_to_fkey(full_name)")
        .in("status", CRM_STATUSES)
        .order("created_at", { ascending: false }),
      supabase
        .from("customers")
        .select("*")
        .order("last_name"),
      getTeamMembers(),
    ]);

  return (
    <>
      <Header title="CRM" />
      <div className="flex flex-1 flex-col gap-4 sm:gap-6 p-4 sm:p-6">
        <Suspense>
          <ProjectList
            projects={projects ?? []}
            customers={customers ?? []}
            teamMembers={teamMembers}
            mode="crm"
          />
        </Suspense>
      </div>
    </>
  );
}
