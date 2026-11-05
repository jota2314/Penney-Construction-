"use server";

import { requireAuth } from "@/lib/auth/require-auth";
import { createClient } from "@/lib/supabase/server";
import type { Jobsite } from "@/components/field-feed/command-center-feed";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { crewToday } from "@/lib/crew/schedule-dates";
import { deriveCurrentScheduleActivity, deriveScheduleHealth, recentWorkDates, type ScheduleWorkLog } from "@/lib/schedule/health";
import { isMasterPhase } from "@/lib/schedule/progress";
import { withEffectiveScheduleDates } from "@/lib/schedule/cascade";

const TZ = "America/New_York";

function nowET(): Date {
  return new Date(new Date().toLocaleString("en-US", { timeZone: TZ }));
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

const PROJECT_COLORS = ["amber", "blue", "violet", "rose", "emerald", "cyan", "fuchsia"] as const;

type ProjectRow = {
  id: string;
  project_number: string;
  name: string;
  status: string;
  address: string | null;
  city: string | null;
  state: string | null;
  contract_value: number | null;
  estimated_value: number | null;
};

type PhaseRow = {
  id: string;
  project_id: string;
  name: string;
  start_date: string;
  end_date: string;
  status: "not_started" | "in_progress" | "completed" | "on_hold";
  phase_scope: string | null;
  event_type: string | null;
  is_confirmed: boolean | null;
  is_manually_scheduled: boolean | null;
  actual_completed_at: string | null;
  sort_order: number | null;
  planned_start_date: string | null;
  planned_end_date: string | null;
  estimate_line_item_id: string | null;
};
type WorkLogRow = ScheduleWorkLog & { project_id: string | null };

// Open clock-in (daily_logs status='in_progress'). project_id is direct on
// new project-first logs; older clock-ins only know their schedule phase.
type LiveLogRow = {
  project_id: string | null;
  author_id: string | null;
  phase: { project_id: string | null } | { project_id: string | null }[] | null;
};

async function getCrewInitials(supabase: Awaited<ReturnType<typeof createClient>>, liveLogs: LiveLogRow[]) {
  // Resolve open clock-ins → crew initials per project.
  const liveAuthorIds = Array.from(
    new Set(liveLogs.map((l) => l.author_id).filter((a): a is string => Boolean(a))),
  );
  const initialsByProfile = new Map<string, string>();
  if (liveAuthorIds.length > 0) {
    const { data: emps } = await supabase
      .from("employees")
      .select("profile_id, first_name, last_name")
      .in("profile_id", liveAuthorIds);
    for (const e of emps ?? []) {
      if (e.profile_id) {
        const initials = `${e.first_name?.[0] ?? ""}${e.last_name?.[0] ?? ""}`.toUpperCase();
        if (initials) initialsByProfile.set(e.profile_id, initials);
      }
    }
    const missing = liveAuthorIds.filter((id) => !initialsByProfile.has(id));
    if (missing.length > 0) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", missing);
      for (const pr of profs ?? []) {
        const parts = (pr.full_name ?? "").trim().split(/\s+/);
        const initials = `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase();
        if (initials) initialsByProfile.set(pr.id, initials);
      }
    }
  }
  return initialsByProfile;
}

/** Full schedule health for the desktop rail; never part of mobile startup. */
export async function getCommandCenterJobsites(): Promise<Jobsite[]> {
  await requireAuth();
  const supabase = await createClient();
  const today = startOfDay(nowET());
  const in14d = new Date(today);
  in14d.setDate(in14d.getDate() + 14);
  const projectsPromise = fetchAllRows<ProjectRow>((from, to) => supabase
    .from("projects")
    .select("id, project_number, name, status, address, city, state, contract_value, estimated_value")
    .neq("status", "cancelled")
    .eq("is_overhead", false)
    .order("updated_at", { ascending: false }).order("id")
    .range(from, to).throwOnError());
  const liveLogsPromise = Promise.resolve(supabase
    .from("daily_logs")
    .select("project_id, author_id, phase:schedule_phases!schedule_phase_id(project_id)")
    .eq("status", "in_progress")
    .gte("started_at", new Date(Date.now() - 24 * 3600 * 1000).toISOString())
    .throwOnError())
    .then(({ data }) => (data ?? []) as LiveLogRow[]);
  const schedulePromise = projectsPromise.then(async (projectRows): Promise<[PhaseRow[], WorkLogRow[]]> => {
    const projectIds = projectRows.map((p) => p.id);
    // Retain every master plan: limiting phases can mislabel a job as unplanned.
    return projectIds.length ? await Promise.all([
      fetchAllRows<PhaseRow>((from, to) => supabase.from("schedule_phases")
        .select("id, project_id, name, start_date, end_date, status, phase_scope, event_type, is_confirmed, is_manually_scheduled, actual_completed_at, sort_order, planned_start_date, planned_end_date, estimate_line_item_id")
        .in("project_id", projectIds).order("id").range(from, to).throwOnError()),
      fetchAllRows<WorkLogRow>((from, to) => supabase.from("daily_logs")
        .select("project_id, started_at, ended_at, status")
        .in("project_id", projectIds)
        .gte("started_at", new Date(Date.now() - 31 * 86400_000).toISOString())
        .order("id").range(from, to).throwOnError()),
    ]) : [[], []] as [PhaseRow[], WorkLogRow[]];
  });
  const [projectRows, liveLogs, [savedPhases, workLogs], initialsByProfile] = await Promise.all([
    projectsPromise, liveLogsPromise, schedulePromise,
    liveLogsPromise.then((logs) => getCrewInitials(supabase, logs)),
  ]);
  const todayDateStr = crewToday();
  const phases = projectRows.flatMap((project) => {
    const rows = savedPhases.filter((phase) => phase.project_id === project.id);
    const effective = new Map(withEffectiveScheduleDates(rows.filter(isMasterPhase)).map((phase) => [phase.id, phase]));
    return rows.map((phase) => effective.get(phase.id) ?? phase);
  });
  const scheduleHealth = new Map(projectRows.map((project) => [project.id, deriveScheduleHealth({
    status: project.status,
    phases: phases.filter((phase) => phase.project_id === project.id),
    today: todayDateStr,
    recentWorkDates: recentWorkDates(workLogs.filter((log) => log.project_id === project.id), todayDateStr),
  })]));
  const activeProjects = projectRows.filter((project) => ["in_progress", "contracted"].includes(project.status) || scheduleHealth.get(project.id)!.issues.length > 0);

  const phasesByProject = new Map<string, PhaseRow[]>();
  for (const p of phases) {
    const arr = phasesByProject.get(p.project_id) ?? [];
    arr.push(p);
    phasesByProject.set(p.project_id, arr);
  }

  const liveCrewByProject = new Map<string, string[]>();
  for (const l of liveLogs) {
    const phase = Array.isArray(l.phase) ? l.phase[0] : l.phase;
    const pid = l.project_id ?? phase?.project_id;
    if (!pid || !l.author_id) continue;
    const initials = initialsByProfile.get(l.author_id);
    if (!initials) continue;
    const arr = liveCrewByProject.get(pid) ?? [];
    if (!arr.includes(initials)) arr.push(initials);
    liveCrewByProject.set(pid, arr);
  }

  // Sites with crew on the clock first, then in-progress jobs, then pre-con.
  // Stable sort keeps most-recently-updated first within each group.
  const jobsiteRank = (p: ProjectRow) =>
    liveCrewByProject.has(p.id) ? 0 : p.status === "in_progress" ? 1 : 2;
  const orderedProjects = [...activeProjects].sort((a, b) => jobsiteRank(a) - jobsiteRank(b));

  const jobsites: Jobsite[] = orderedProjects.map((p, i) => {
    const ps = phasesByProject.get(p.id) ?? [];
    const { current, next } = deriveCurrentScheduleActivity(ps, todayDateStr);
    const phaseLabel = current?.name ?? (next && next.start_date <= in14d.toISOString().slice(0, 10) ? `Next: ${next.name}` : p.status === "in_progress" ? "No current master work" : p.status.replace(/_/g, " "));
    const status = current?.status === "in_progress" ? "in progress" : current?.name?.toLowerCase() ?? p.status.replace(/_/g, " ");
    const addressParts = [p.address, p.city].filter(Boolean).join(", ");

    return {
      id: p.id,
      project: p.name,
      address: addressParts || "—",
      crew: liveCrewByProject.get(p.id) ?? [],
      lead: null,
      status,
      phase: phaseLabel,
      scheduleIssues: scheduleHealth.get(p.id)?.issues.map((issue) => issue.text) ?? [],
      weather: "—",
      color: PROJECT_COLORS[i % PROJECT_COLORS.length],
      stage: (p.status === "in_progress" ? "active" : p.status === "contracted" ? "precon" : "review") as "active" | "precon" | "review",
    };
  });

  return jobsites;
}
