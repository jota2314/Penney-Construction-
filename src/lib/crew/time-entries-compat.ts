import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Single clock system: field time lives in `daily_logs`. The rest of the app
 * (CEO dashboard, project/phase financials, team hours, AI context) was written
 * against the old `time_entries` table. Rather than rewrite each of those
 * queries, this helper reads `daily_logs` and returns rows in the exact shape
 * those consumers already expect — clock_in/clock_out/break_minutes plus the
 * embedded employee and project — so they keep working off the one source.
 *
 * Employees are resolved in JS (employees.profile_id == daily_logs.author_id)
 * because there's no FK to embed through.
 */
export interface CompatTimeEntry {
  id: string;
  project_id: string | null;
  schedule_phase_id: string;
  clock_in: string;
  clock_out: string | null;
  break_minutes: number;
  employee_id: string | null;
  employees: { first_name: string; last_name: string; hourly_rate: number | null } | null;
  projects: { name: string; project_number: string } | null;
  /** Geofence outcome at clock-in (null = no location/job pin). */
  clock_in_on_site: boolean | null;
  clock_in_distance_m: number | null;
}

export interface TimeEntryFilters {
  /** Filter to one project (matched via the log's schedule phase). */
  projectId?: string;
  /** Filter to one schedule phase. */
  schedulePhaseId?: string;
  /** Filter to one employee (employees.id — translated to its profile). */
  employeeId?: string;
  /** Only logs started at/after this ISO timestamp. */
  since?: string;
  /** true → on the clock now; false → finished shifts only; undefined → both. */
  open?: boolean;
}

export async function fetchTimeEntriesCompat(
  supabase: SupabaseClient,
  filters: TimeEntryFilters = {},
): Promise<CompatTimeEntry[]> {
  // Translate an employees.id filter to the matching profile id (author_id).
  let authorFilter: string | null = null;
  if (filters.employeeId) {
    const { data: emp } = await supabase
      .from("employees")
      .select("profile_id")
      .eq("id", filters.employeeId)
      .maybeSingle();
    if (!emp?.profile_id) return [];
    authorFilter = emp.profile_id;
  }

  const phaseSelect = filters.projectId
    ? "phase:schedule_phases!schedule_phase_id!inner(project_id, projects:project_id(name, project_number))"
    : "phase:schedule_phases!schedule_phase_id(project_id, projects:project_id(name, project_number))";

  let q = supabase
    .from("daily_logs")
    .select(
      `id, author_id, schedule_phase_id, started_at, ended_at, status, clock_in_on_site, clock_in_distance_m, ${phaseSelect}`,
    )
    .order("started_at", { ascending: false });

  if (authorFilter) q = q.eq("author_id", authorFilter);
  if (filters.schedulePhaseId) q = q.eq("schedule_phase_id", filters.schedulePhaseId);
  if (filters.projectId) q = q.eq("phase.project_id", filters.projectId);
  if (filters.since) q = q.gte("started_at", filters.since);
  if (filters.open === true) q = q.eq("status", "in_progress");
  if (filters.open === false) q = q.eq("status", "completed");

  const { data: logs } = await q;
  if (!logs || logs.length === 0) return [];

  // Resolve each author's employee record (id, name, rate).
  const authorIds = Array.from(new Set(logs.map((l) => l.author_id)));
  const empByProfile = new Map<
    string,
    { id: string; first_name: string; last_name: string; hourly_rate: number | null }
  >();
  if (authorIds.length > 0) {
    const { data: emps } = await supabase
      .from("employees")
      .select("id, first_name, last_name, hourly_rate, profile_id")
      .in("profile_id", authorIds);
    for (const e of emps ?? []) {
      if (e.profile_id) {
        empByProfile.set(e.profile_id, {
          id: e.id,
          first_name: e.first_name,
          last_name: e.last_name,
          hourly_rate: e.hourly_rate,
        });
      }
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (logs as any[]).map((l) => {
    const phase = Array.isArray(l.phase) ? l.phase[0] : l.phase;
    const project = phase ? (Array.isArray(phase.projects) ? phase.projects[0] : phase.projects) : null;
    const emp = empByProfile.get(l.author_id) ?? null;
    return {
      id: l.id,
      project_id: phase?.project_id ?? null,
      schedule_phase_id: l.schedule_phase_id,
      clock_in: l.started_at,
      clock_out: l.ended_at,
      break_minutes: 0,
      employee_id: emp?.id ?? null,
      employees: emp
        ? { first_name: emp.first_name, last_name: emp.last_name, hourly_rate: emp.hourly_rate }
        : null,
      projects: project ? { name: project.name, project_number: project.project_number } : null,
      clock_in_on_site: l.clock_in_on_site ?? null,
      clock_in_distance_m: l.clock_in_distance_m ?? null,
    };
  });
}
