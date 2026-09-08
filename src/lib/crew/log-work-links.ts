export type LogWorkItem = { lineItemId: string | null; description: string; hours: number | null; needsReview?: boolean };
type Relation<T> = T | T[] | null;
type Line = { description: string };
export type WorkLinkRow = {
  id: string; author_id: string | null; project_id: string | null;
  daily_report_id?: string | null; estimate_line_item_id?: string | null;
  line_item_needs_review?: boolean;
  started_at: string; ended_at: string | null;
  line_item?: Relation<Line>;
  phase?: Relation<{ estimate_line_item_id?: string | null; line_item?: Relation<Line> }>;
};
const one = <T,>(value: Relation<T> | undefined): T | null => Array.isArray(value) ? value[0] ?? null : value ?? null;

/** A shared report can describe multiple budget tasks. Keep their hours separate. */
export function logWorkLinks(log: WorkLinkRow, linkedShifts: WorkLinkRow[]): LogWorkItem[] {
  const rows = new Map<string, WorkLinkRow>();
  rows.set(log.id, log);
  for (const shift of linkedShifts) {
    if (shift.daily_report_id === log.id && shift.author_id === log.author_id && shift.project_id === log.project_id) rows.set(shift.id, shift);
  }
  const groups = new Map<string, LogWorkItem>();
  for (const row of rows.values()) {
    const phase = one(row.phase);
    const lineItemId = row.estimate_line_item_id ?? phase?.estimate_line_item_id ?? null;
    const line = row.estimate_line_item_id ? one(row.line_item) : one(phase?.line_item);
    const hours = row.ended_at ? Math.max(0, (Date.parse(row.ended_at) - Date.parse(row.started_at)) / 3600000) : 0;
    // A bare shared report is not an additional unallocated shift.
    if (!lineItemId && hours === 0 && rows.size > 1) continue;
    const key = lineItemId ?? "unallocated";
    const group: LogWorkItem = groups.get(key) ?? { lineItemId, description: line?.description ?? (lineItemId ? "Budget task" : "Budget line needs review"), hours: null };
    if (hours > 0) group.hours = (group.hours ?? 0) + hours;
    group.needsReview = group.needsReview || !!row.line_item_needs_review || !lineItemId;
    groups.set(key, group);
  }
  return [...groups.values()];
}
