import type { Metadata } from "next";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { createClient } from "@/lib/supabase/server";
import { ProjectsView } from "@/components/projects/projects-view";

export const metadata: Metadata = { title: "Projects | Penney Construction" };

export default async function ProjectsPage() {
  await requireAuth();
  const supabase = await createClient();

  const now = new Date();
  const weekAgo = new Date(now);
  weekAgo.setDate(weekAgo.getDate() - 7);

  const [{ data: projects }, { data: customers }, { data: recentEmails }, { data: recentQuotes }, { data: recentTodos }, { data: recentTime }] = await Promise.all([
    supabase
      .from("projects")
      .select("*, customer:customers(first_name, last_name, email, phone)")
      .order("updated_at", { ascending: false }),
    supabase
      .from("customers")
      .select("*")
      .order("last_name"),
    // Count recent emails per project (last 7 days)
    supabase
      .from("inbox_emails")
      .select("project_id")
      .not("project_id", "is", null)
      .gte("date", weekAgo.toISOString()),
    // Count recent quotes per project (last 7 days)
    supabase
      .from("quote_requests")
      .select("project_id")
      .not("project_id", "is", null)
      .gte("created_at", weekAgo.toISOString()),
    // Count open todos per project
    supabase
      .from("todos")
      .select("project_id")
      .not("project_id", "is", null)
      .eq("status", "open"),
    // Count recent time entries per project (last 7 days)
    supabase
      .from("time_entries")
      .select("project_id")
      .gte("clock_in", weekAgo.toISOString()),
  ]);

  // Build heat scores per project
  const heatMap: Record<string, number> = {};
  for (const e of recentEmails ?? []) {
    if (e.project_id) heatMap[e.project_id] = (heatMap[e.project_id] || 0) + 2;
  }
  for (const q of recentQuotes ?? []) {
    if (q.project_id) heatMap[q.project_id] = (heatMap[q.project_id] || 0) + 3;
  }
  for (const t of recentTodos ?? []) {
    if (t.project_id) heatMap[t.project_id] = (heatMap[t.project_id] || 0) + 1;
  }
  for (const te of recentTime ?? []) {
    if (te.project_id) heatMap[te.project_id] = (heatMap[te.project_id] || 0) + 2;
  }

  // Add heat scores to projects
  const projectsWithHeat = (projects ?? []).map((p) => ({
    ...p,
    heatScore: heatMap[p.id] || 0,
  }));

  return (
    <>
      <Header title="Projects" backHref="/command-center" />
      <div className="flex flex-1 flex-col gap-4 sm:gap-6 p-4 sm:p-6 overflow-auto">
        <ProjectsView
          projects={projectsWithHeat}
          customers={customers ?? []}
        />
      </div>
    </>
  );
}
