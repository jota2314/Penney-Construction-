import { crewToday } from "@/lib/crew/schedule-dates";
import { MAX_SHIFT_MS } from "@/lib/crew/shift";

export interface WorkLog {
  id: string;
  author_id: string;
  project_id: string | null;
  started_at: string;
  ended_at: string | null;
  status: string;
  text?: string | null;
  estimate_line_item_id: string | null;
}
export interface ActualWork {
  projectId: string;
  projectName: string;
  task: string;
  notes?: string;
  clockedIn: boolean;
  differsFromPlan: boolean;
}

/** Time logs are evidence of attendance, never evidence that a task is finished. */
export function actualWorkByDay(
  logs: WorkLog[],
  employees: { id: string; profile_id: string | null }[],
  projects: Map<string, string>,
  lines: Map<string, string>,
  plans: Record<string, Record<string, { projectId: string | null; confirmed: boolean }[]>>,
  now = Date.now(),
): Record<string, Record<string, ActualWork[]>> {
  const employeeByProfile = new Map(employees.filter(e => e.profile_id).map(e => [e.profile_id, e.id]));
  const result: Record<string, Record<string, ActualWork[]>> = {};
  for (const log of logs) {
    const employeeId = employeeByProfile.get(log.author_id);
    const started = Date.parse(log.started_at);
    if (!employeeId || !log.project_id || !Number.isFinite(started) || started > now) continue;
    // Photo-only posts can have a zero-length duration. They are not shifts.
    if (log.ended_at && Date.parse(log.ended_at) <= started) continue;
    if (log.status !== "in_progress" && log.status !== "completed") continue;
    const key = `emp:${employeeId}`;
    const date = crewToday(new Date(started));
    const entries = ((result[key] ??= {})[date] ??= []);
    const task = lines.get(log.estimate_line_item_id ?? "") ?? "Work recorded — line item not linked";
    const active = log.status === "in_progress" && !log.ended_at && now - started < MAX_SHIFT_MS;
    const existing = entries.find(e => e.projectId === log.project_id && e.task === task);
    if (existing) { existing.clockedIn ||= active; if (log.text) existing.notes = log.text; continue; }
    entries.push({
      projectId: log.project_id,
      projectName: projects.get(log.project_id) ?? "Project",
      task,
      notes: log.text ?? undefined,
      clockedIn: active,
      differsFromPlan: !(plans[key]?.[date] ?? []).some(p => p.confirmed && p.projectId === log.project_id),
    });
  }
  return result;
}
