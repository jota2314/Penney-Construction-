import type { Metadata } from "next";
import { Suspense } from "react";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { getScopedProjectIds } from "@/lib/auth/scoped-projects";
import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { ProjectsView } from "@/components/projects/projects-view";
import { fetchTimeEntriesCompat } from "@/lib/crew/time-entries-compat";
import { getTeamMembers } from "@/lib/actions/projects";

export const metadata: Metadata = { title: "Projects | Penney Construction" };

// Only proposals that are real numbers — accepted, sent, or Ryan-approved.
// Drafts and dead options must not price the card.
const CARD_ESTIMATE_STATUSES = ["accepted", "sent", "approved"];

async function ProjectsContent() {
  const user = await requireAuth();
  const supabase = await createClient();
  const scopedIds = await getScopedProjectIds(supabase, user.profile);

  const now = new Date();
  const weekAgo = new Date(now);
  weekAgo.setDate(weekAgo.getDate() - 7);

  const [teamMembers, { data: projects }, { data: cardStats }, { data: recentTime }, allPhases, allEstimates] = await Promise.all([
    getTeamMembers(),
    // Only the columns the cards/table actually render. `select("*")` was
    // shipping ~20 unused columns per project into the client payload —
    // including scope_of_work and notes, which are long text.
    supabase
      .from("projects")
      .select(
        "id, project_number, name, status, project_type, phase, address, city, state, description, estimated_value, contract_value, assigned_pm, progress, walkthrough_scheduled_at, updated_at, created_at, customer:customers(first_name, last_name, email, phone)"
      )
      .order("updated_at", { ascending: false }),
    // Per-project counters (recent emails, recent quotes, open todos,
    // walkthroughs) aggregated in Postgres. These used to be four separate
    // queries pulling raw rows to count in JS — the emails one alone returned
    // ~1,100 rows and got silently clipped by PostgREST's 1000-row cap, which
    // undercounted heat on the busiest jobs.
    supabase.rpc("project_card_stats", { since: weekAgo.toISOString() }),
    // Count recent field shifts per project (last 7 days) — single clock
    // system = daily_logs.
    fetchTimeEntriesCompat(supabase, { since: weekAgo.toISOString() }).then((data) => ({ data })),
    // Schedule phases for progress + live phase label. Paged: the table
    // grows ~13 rows per job and a plain select silently clips at 1000.
    fetchAllRows((from, to) =>
      supabase
        .from("schedule_phases")
        .select("project_id, name, status, start_date, end_date, event_type")
        .not("project_id", "is", null)
        .order("id")
        .range(from, to)
    ),
    // Latest estimate total per project — this is the real number we
    // want to show on the card, not the initial estimated_value guess.
    fetchAllRows((from, to) =>
      supabase
        .from("estimates")
        .select("id, project_id, total_price, created_at, status")
        .not("project_id", "is", null)
        .in("status", CARD_ESTIMATE_STATUSES)
        .order("created_at", { ascending: false })
        .order("id")
        .range(from, to)
    ),
  ]);

  type CardStat = {
    project_id: string;
    email_count: number;
    quote_count: number;
    open_todo_count: number;
    walkthrough_count: number;
    walkthrough_latest: string | null;
  };
  const stats = (cardStats ?? []) as CardStat[];

  // Build heat scores per project
  const heatMap: Record<string, number> = {};
  for (const s of stats) {
    const score =
      Number(s.email_count) * 2 +
      Number(s.quote_count) * 3 +
      Number(s.open_todo_count) * 1;
    if (score > 0) heatMap[s.project_id] = score;
  }
  for (const te of recentTime ?? []) {
    if (te.project_id) heatMap[te.project_id] = (heatMap[te.project_id] || 0) + 2;
  }

  // Compute progress per project from schedule phases. Crew-dispatch rows
  // (event_type "crew") share the table but aren't construction phases —
  // counting them deflates progress every time someone gets scheduled.
  const progressMap: Record<string, number> = {};
  const phasesByProject = new Map<string, { total: number; completed: number }>();
  for (const ph of allPhases) {
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
  for (const ph of allPhases) {
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
  // so the first row we see per project_id is the newest — the status
  // filter already ran server-side). Keep the id so the table can
  // deep-link straight to the proposal.
  const latestEstimateMap: Record<string, { id: string; total: number }> = {};
  for (const e of allEstimates) {
    if (!e.project_id) continue;
    if (latestEstimateMap[e.project_id] === undefined) {
      latestEstimateMap[e.project_id] = { id: e.id, total: Number(e.total_price) || 0 };
    }
  }

  // PMs only see their own jobs (assigned PM or crew-assigned)
  const visibleProjects =
    scopedIds === null
      ? projects ?? []
      : (projects ?? []).filter((p) => scopedIds.has(p.id));

  // Walkthrough count + latest visit per project (aggregated in Postgres).
  const walkthroughMap: Record<string, { count: number; latest: string | null }> = {};
  for (const s of stats) {
    const count = Number(s.walkthrough_count);
    if (count > 0) {
      walkthroughMap[s.project_id] = { count, latest: s.walkthrough_latest };
    }
  }

  const managerNames = new Map(teamMembers.map((member) => [member.id, member.full_name?.trim() || member.email]));

  // Add ownership, heat scores, progress, and latest estimate to projects.
  const projectsWithHeat = visibleProjects.map((p) => ({
    ...p,
    project_manager_name: p.assigned_pm ? managerNames.get(p.assigned_pm) ?? "Assigned manager unavailable" : null,
    // supabase-js types a to-one FK join as an array; at runtime it's an object.
    customer: p.customer as unknown as { first_name: string; last_name: string; email: string | null; phone: string | null } | null,
    heatScore: heatMap[p.id] || 0,
    progress: progressMap[p.id] ?? p.progress ?? null,
    current_phase_name: activePhaseMap[p.id]?.name ?? upcomingPhaseMap[p.id]?.name ?? null,
    latest_estimate_total: latestEstimateMap[p.id]?.total ?? null,
    latest_estimate_id: latestEstimateMap[p.id]?.id ?? null,
    walkthrough_count: walkthroughMap[p.id]?.count ?? 0,
    walkthrough_latest: walkthroughMap[p.id]?.latest ?? null,
  }));

  return <ProjectsView projects={projectsWithHeat} />;
}

export default function ProjectsPage() {
  return (
    <>
      <Header title="Projects" backHref="/command-center" backLabel="Command Center" />
      <div className="flex flex-1 flex-col gap-4 overflow-auto p-4 pb-24 sm:gap-6 sm:p-6">
        {/* Stream the data in behind the shell — the header and nav paint
            immediately instead of the whole route blocking on the queries.
            The boundary also keeps useSearchParams() in ProjectsView from
            deopting the route. */}
        <Suspense
          fallback={
            <div className="space-y-4">
              <div className="h-12 rounded-xl bg-muted animate-pulse" />
              <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="h-44 rounded-xl bg-muted animate-pulse" />
                ))}
              </div>
            </div>
          }
        >
          <ProjectsContent />
        </Suspense>
      </div>
    </>
  );
}
