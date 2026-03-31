import type { Metadata } from "next";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { getTodos } from "@/lib/actions/command-center";
import { TodosList } from "@/components/command-center/todos-list";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Todos | Penney Construction" };

export default async function TodosPage() {
  await requireAuth();

  const supabase = await createClient();

  // Fetch todos and project list in parallel
  const [todos, projectsRes] = await Promise.all([
    getTodos().catch(() => []),
    supabase
      .from("projects")
      .select("id, name")
      .in("status", [
        "lead",
        "estimating",
        "proposal_sent",
        "contracted",
        "in_progress",
      ])
      .order("name"),
  ]);

  const projects = (projectsRes.data ?? []) as { id: string; name: string }[];

  return (
    <>
      <Header title="Todos" backHref="/command-center" />
      <div className="flex flex-1 flex-col gap-6 p-4 sm:p-6 min-w-0 overflow-auto">
        <TodosList todos={todos} projects={projects} />
      </div>
    </>
  );
}
