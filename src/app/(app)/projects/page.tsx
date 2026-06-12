import type { Metadata } from "next";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { createClient } from "@/lib/supabase/server";
import { ProjectsView } from "@/components/projects/projects-view";
import { fetchTimeEntriesCompat } from "@/lib/crew/time-entries-compat";

export const metadata: Metadata = { title: "Projects | Penney Construction" };

export default async function ProjectsPage() {
  await requireAuth();
  const supabase = await createClient();

  const now = new Date();
  const weekAgo = new Date(now);
  weekAgo.setDate(weekAgo.getDate() - 7);

  const [{ data: projects }, { data: customers }, { data: recentEmails }, { data: recentQuotes }, { data: recentTodos }, { data: recentTime }, { data: allPhases }, { data: allEstimates }] = await Promise.all([
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
    // Count recent field shifts per project (last 7 days) — single clock
    // system = daily_logs.
    fetchTimeEntriesCompat(supabase, { since: weekAgo.toISOString() }).then((data) => ({ data })),
    // Schedule phases for progress calculation
    supabase
      .from("schedule_phases")
      .select("project_id, status")
      .not("project_id", "is", null),
    // Latest estimate total per project — this is the real number we
    // want to show on the card, not the initial estimated_value guess.
    supabase
      .from("estimates")
      .select("id, project_id, total_price, created_at, status")
      .not("project_id", "is", null)
      .order("created_at", { ascending: false }),
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

  // Compute progress per project from schedule phases
  const progressMap: Record<string, number> = {};
  const phasesByProject = new Map<string, { total: number; completed: number }>();
  for (const ph of allPhases ?? []) {
    if (!ph.project_id) continue;
    if (!phasesByProject.has(ph.project_id)) {
      phasesByProject.set(ph.project_id, { total: 0, completed: 0 });
    }
    const entry = phasesByProject.get(ph.project_id)!;
    entry.total++;
    if (ph.status === "completed") entry.completed++;
  }
  for (const [pid, { total, completed }] of phasesByProject) {
    progressMap[pid] = total > 0 ? Math.round((completed / total) * 100) : 0;
  }

  // Latest estimate per project (estimates are ordered desc by created_at,
  // so the first row we see per project_id is the newest). Keep the id so
  // the table can deep-link straight to the proposal.
  const latestEstimateMap: Record<string, { id: string; total: number }> = {};
  for (const e of allEstimates ?? []) {
    if (!e.project_id) continue;
    if (latestEstimateMap[e.project_id] === undefined) {
      latestEstimateMap[e.project_id] = { id: e.id, total: Number(e.total_price) || 0 };
    }
  }

  // Add heat scores + progress + latest estimate to projects
  const projectsWithHeat = (projects ?? []).map((p) => ({
    ...p,
    heatScore: heatMap[p.id] || 0,
    progress: progressMap[p.id] ?? p.progress ?? null,
    latest_estimate_total: latestEstimateMap[p.id]?.total ?? null,
    latest_estimate_id: latestEstimateMap[p.id]?.id ?? null,
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
