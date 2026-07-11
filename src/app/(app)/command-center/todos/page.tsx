import type { Metadata } from "next";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { getTodos } from "@/lib/actions/command-center";
import { TodosList } from "@/components/command-center/todos-list";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Todos | Penney Construction" };

export default async function TodosPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string | string[]; ai?: string | string[] }>;
}) {
  const user = await requireAuth();
  const params = await searchParams;

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

  // The `assignee` column on `todos` stores a first name (e.g. "Jorge") so
  // derive that from the current user's profile to enable the "Mine" filter.
  const fullName = user.profile?.full_name ?? user.email ?? "";
  const currentUserName = fullName.split(/\s+/)[0] || "";

  return (
    <>
      <Header title="Todos" backHref="/command-center" />
      <div className="flex flex-1 flex-col gap-6 p-4 sm:p-6 min-w-0 overflow-auto">
        <TodosList
          todos={todos}
          projects={projects}
          currentUserId={user.id}
          currentUserName={currentUserName}
          initialShowCreate={params.new === "1"}
          initialAiTodoId={typeof params.ai === "string" ? params.ai : undefined}
        />
      </div>
    </>
  );
}
