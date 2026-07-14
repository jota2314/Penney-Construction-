import type { Metadata } from "next";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { getScopedProjectIds } from "@/lib/auth/scoped-projects";
import { createClient } from "@/lib/supabase/server";
import { ProjectsView } from "@/components/projects/projects-view";
import { fetchTimeEntriesCompat } from "@/lib/crew/time-entries-compat";

export const metadata: Metadata = { title: "Projects | Penney Construction" };

export default async function ProjectsPage() {
  const user = await requireAuth();
  const supabase = await createClient();
  const scopedIds = await getScopedProjectIds(supabase, user.profile);

  const now = new Date();
  const weekAgo = new Date(now);
  weekAgo.setDate(weekAgo.getDate() - 7);

  const [{ data: projects }, { data: customers }, { data: recentEmails }, { data: recentQuotes }, { data: recentTodos }, { data: recentTime }, { data: allPhases }, { data: allEstimates }, { data: allWalkthroughs }] = await Promise.all([
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
    // Schedule phases for progress + live phase label
    supabase
      .from("schedule_phases")
      .select("project_id, name, status, start_date, end_date, event_type")
      .not("project_id", "is", null),
    // Latest estimate total per project — this is the real number we
    // want to show on the card, not the initial estimated_value guess.
    supabase
      .from("estimates")
      .select("id, project_id, total_price, created_at, status")
      .not("project_id", "is", null)
      .order("created_at", { ascending: false }),
    // Walkthrough visits per project — powers the walkthrough indicator on
    // the project cards/table (the /projects list dropped it in the rewrite).
    supabase
      .from("walkthroughs")
      .select("project_id, visited_at")
      .not("project_id", "is", null),
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

  // Compute progress per project from schedule phases. Crew-dispatch rows
  // (event_type "crew") share the table but aren't construction phases —
  // counting them deflates progress every time someone gets scheduled.
  const progressMap: Record<string, number> = {};
  const phasesByProject = new Map<string, { total: number; completed: number }>();
  for (const ph of allPhases ?? []) {
    if (!ph.project_id || ph.event_type === "crew") continue;
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

  // Live phase label per project: what the schedule says is happening today
  // (or the next phase starting within two weeks). The hand-set
  // projects.phase goes stale — jobs read "Pre-Con" at 70% built.
  const todayStr = now.toISOString().slice(0, 10);
  const horizon = new Date(now);
  horizon.setDate(horizon.getDate() + 14);
  const horizonStr = horizon.toISOString().slice(0, 10);
  const activePhaseMap: Record<string, { name: string; inProgress: boolean }> = {};
  const upcomingPhaseMap: Record<string, { name: string; start: string }> = {};
  for (const ph of allPhases ?? []) {
    if (!ph.project_id || ph.event_type === "crew" || !ph.name) continue;
    if (ph.status === "completed") continue;
    if (ph.start_date && ph.end_date && ph.start_date <= todayStr && ph.end_date >= todayStr) {
      const prev = activePhaseMap[ph.project_id];
      if (!prev || (ph.status === "in_progress" && !prev.inProgress)) {
        activePhaseMap[ph.project_id] = { name: ph.name, inProgress: ph.status === "in_progress" };
      }
    } else if (ph.start_date && ph.start_date > todayStr && ph.start_date <= horizonStr) {
      const prev = upcomingPhaseMap[ph.project_id];
      if (!prev || ph.start_date < prev.start) {
        upcomingPhaseMap[ph.project_id] = { name: ph.name, start: ph.start_date };
      }
    }
  }

  // Latest estimate per project (estimates are ordered desc by created_at,
  // so the first row we see per project_id is the newest). Only proposals
  // that are real numbers — accepted, sent, or Ryan-approved. Drafts and
  // dead options must not price the card. Keep the id so the table can
  // deep-link straight to the proposal.
  const cardEstimateStatuses = new Set(["accepted", "sent", "approved"]);
  const latestEstimateMap: Record<string, { id: string; total: number }> = {};
  for (const e of allEstimates ?? []) {
    if (!e.project_id || !cardEstimateStatuses.has(e.status)) continue;
    if (latestEstimateMap[e.project_id] === undefined) {
      latestEstimateMap[e.project_id] = { id: e.id, total: Number(e.total_price) || 0 };
    }
  }

  // PMs only see their own jobs (assigned PM or crew-assigned)
  const visibleProjects =
    scopedIds === null
      ? projects ?? []
      : (projects ?? []).filter((p) => scopedIds.has(p.id));

  // Walkthrough count + latest visit per project.
  const walkthroughMap: Record<string, { count: number; latest: string | null }> = {};
  for (const w of allWalkthroughs ?? []) {
    if (!w.project_id) continue;
    const entry = walkthroughMap[w.project_id] ?? { count: 0, latest: null };
    entry.count++;
    if (w.visited_at && (!entry.latest || w.visited_at > entry.latest)) {
      entry.latest = w.visited_at;
    }
    walkthroughMap[w.project_id] = entry;
  }

  // Add heat scores + progress + latest estimate to projects
  const projectsWithHeat = visibleProjects.map((p) => ({
    ...p,
    heatScore: heatMap[p.id] || 0,
    progress: progressMap[p.id] ?? p.progress ?? null,
    current_phase_name: activePhaseMap[p.id]?.name ?? upcomingPhaseMap[p.id]?.name ?? null,
    latest_estimate_total: latestEstimateMap[p.id]?.total ?? null,
    latest_estimate_id: latestEstimateMap[p.id]?.id ?? null,
    walkthrough_count: walkthroughMap[p.id]?.count ?? 0,
    walkthrough_latest: walkthroughMap[p.id]?.latest ?? null,
  }));

  return (
    <>
      <Header title="Projects" backHref="/command-center" backLabel="Command Center" />
      <div className="flex flex-1 flex-col gap-4 overflow-auto p-4 pb-24 sm:gap-6 sm:p-6">
        <ProjectsView
          projects={projectsWithHeat}
          customers={customers ?? []}
        />
      </div>
    </>
  );
}
