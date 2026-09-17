import type { SupabaseClient } from "@supabase/supabase-js";
import { loadLaborLedger } from "./load-labor-ledger";

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
  paid_minutes: number;
  wage_cents: number;
  project_cost_cents: number;
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
  const { rows, employees, projects } = await loadLaborLedger(supabase);
  const emps = new Map(employees.map(e => [e.profile_id, e]));
  const projs = new Map(projects.map(p => [p.id, p]));
  // Filter after allocating each daily break across all jobs.
  return rows.filter(r => (!filters.projectId || r.project_id === filters.projectId)
    && (!filters.schedulePhaseId || r.schedule_phase_id === filters.schedulePhaseId)
    && (!filters.employeeId || emps.get(r.author_id)?.id === filters.employeeId)
    && (!filters.since || r.started_at >= filters.since)
    && (filters.open === undefined || r.open === filters.open))
    .map(r => {
      const emp = emps.get(r.author_id); const project = projs.get(r.project_id);
      return {
        id: r.id, project_id: r.project_id, schedule_phase_id: r.schedule_phase_id,
        clock_in: r.started_at, clock_out: r.ended_at, break_minutes: r.breakMinutes,
        paid_minutes: r.paidMinutes, wage_cents: r.wageCents, project_cost_cents: r.projectCostCents,
        employee_id: emp?.id ?? null,
        employees: emp ? { first_name: emp.first_name, last_name: emp.last_name, hourly_rate: r.rate } : null,
        projects: project ? { name: project.name, project_number: project.project_number } : null,
        clock_in_on_site: r.clock_in_on_site, clock_in_distance_m: r.clock_in_distance_m,
      };
    });
}
