import { isClockInRow } from "@/lib/schedule/health";
import { isNonWorkPhaseName } from "@/lib/schedule/trade-keywords";

/**
 * "Work with nobody on it", the one rule behind the Job Board's Subs needed
 * chip and sheet (actions/sub-assign.ts) and the 5:30 PM digest's "Phases
 * next 14 days with nobody" (subs/sub-digest.ts). Pure, so the signed-in
 * sheet and the user-less cron share it and every phase the digest counts
 * can be cleared from the sheet.
 *
 * Window (applied by each caller's query): start_date <= today + NOBODY_DAYS
 * and end_date >= today, so a phase already under way still counts.
 */

/** Work this far ahead with nobody on it counts. */
export const NOBODY_DAYS = 14;

/** Same-day markers, not runs of work — never "needs a sub". */
export const NOT_WORK_EVENTS = new Set(["inspection", "meeting", "shop_meeting", "walkthrough", "clock_in", "clockin"]);

/** The columns the rule reads. Both callers' phase rows have them. */
export interface SubsNeededPhase {
  id: string;
  name: string;
  start_date: string | null;
  end_date: string | null;
  status: string | null;
  event_type: string | null;
  phase_scope: string | null;
  is_confirmed: boolean | null;
  planned_start_date: string | null;
  estimate_line_item_id: string | null;
  assigned_employee_ids: string[] | null;
  assigned_sub_ids: string[] | null;
  master_phase_id: string | null;
}

export function phaseHasPeople(p: Pick<SubsNeededPhase, "assigned_employee_ids" | "assigned_sub_ids">): boolean {
  return (p.assigned_employee_ids?.length ?? 0) + (p.assigned_sub_ids?.length ?? 0) > 0;
}

/** Open work: not done or on hold, not a marker event, not a clock-in placeholder, not an Order/Delivery/Permit-type row. */
export function isOpenWorkPhase(
  p: Pick<
    SubsNeededPhase,
    "name" | "start_date" | "end_date" | "status" | "event_type" | "phase_scope" | "is_confirmed" | "planned_start_date" | "estimate_line_item_id"
  >,
): boolean {
  if (p.status === "completed" || p.status === "on_hold") return false;
  if (NOT_WORK_EVENTS.has(p.event_type ?? "")) return false;
  if (isClockInRow({ ...p, end_date: p.end_date ?? p.start_date })) return false;
  return !isNonWorkPhaseName(p.name);
}

/** Work phases with nobody on them; a master is staffed when a day row under it has someone. */
export function nobodyPhases<T extends SubsNeededPhase>(phases: T[]): T[] {
  const staffed = new Set(
    phases.filter((p) => p.master_phase_id && phaseHasPeople(p)).map((p) => p.master_phase_id as string),
  );
  return phases.filter((p) => isOpenWorkPhase(p) && !phaseHasPeople(p) && !staffed.has(p.id));
}
