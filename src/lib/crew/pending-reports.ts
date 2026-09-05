import { crewToday } from "./schedule-dates";

export interface PendingDailyReport {
  logId: string;
  projectId: string;
  projectName: string;
  workDate: string;
  minutes: number;
  overdue: boolean;
  firstClockIn?: string;
  lastClockOut?: string;
}

export function groupPendingReports(rows: {
  id: string; project_id: string | null; started_at: string; ended_at: string | null;
  report_submitted_at: string | null; report_required: boolean; status: string;
}[], names: Map<string, string>, today = crewToday()): PendingDailyReport[] {
  const groups = new Map<string, PendingDailyReport>();
  for (const row of rows) {
    if (!row.report_required || row.report_submitted_at || !row.project_id || row.status !== "completed" || !row.ended_at) continue;
    const minutes = (Date.parse(row.ended_at) - Date.parse(row.started_at)) / 60000;
    if (!(minutes > 0)) continue;
    const workDate = crewToday(new Date(row.started_at));
    const key = row.project_id + workDate;
    const existing = groups.get(key);
    if (existing) {
      existing.minutes += minutes;
      if (row.started_at < existing.firstClockIn!) existing.firstClockIn = row.started_at;
      if (row.ended_at > existing.lastClockOut!) existing.lastClockOut = row.ended_at;
    }
    else groups.set(key, { logId: row.id, projectId: row.project_id, projectName: names.get(row.project_id) ?? "Job", workDate, minutes, overdue: workDate < today, firstClockIn: row.started_at, lastClockOut: row.ended_at });
  }
  return [...groups.values()].sort((a,b) => a.workDate.localeCompare(b.workDate)).map(r => ({ ...r, minutes: Math.round(r.minutes) }));
}
