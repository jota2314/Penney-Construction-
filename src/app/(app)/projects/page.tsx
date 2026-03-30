import type { Metadata } from "next";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { createClient } from "@/lib/supabase/server";
import { ProjectsView } from "@/components/projects/projects-view";

export const metadata: Metadata = { title: "Projects | Penney Construction" };

export default async function ProjectsPage() {
  await requireAuth();
  const supabase = await createClient();

  const [{ data: projects }, { data: customers }] = await Promise.all([
    supabase
      .from("projects")
      .select("*, customer:customers(first_name, last_name, email, phone)")
      .order("updated_at", { ascending: false }),
    supabase
      .from("customers")
      .select("*")
      .order("last_name"),
  ]);

  return (
    <>
      <Header title="Projects" backHref="/command-center" />
      <div className="flex flex-1 flex-col gap-4 sm:gap-6 p-4 sm:p-6 overflow-auto">
        <ProjectsView
          projects={projects ?? []}
          customers={customers ?? []}
        />
      </div>
    </>
  );
}
