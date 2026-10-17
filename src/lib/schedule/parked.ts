/**
 * A "From Estimate" step still parked at the end of the plan: nobody has
 * dated or confirmed it. buildPlanFromEstimate lands every new step on one
 * placeholder day (the plan's last end date, or today) with no baseline, so
 * that date means nothing yet. It must not count as a scheduled day on the
 * crew board, in the sub's Today / This week, in the field digest, or in the
 * "Penciled in" list.
 *
 * A person dating it (updateSchedulePhase sets is_manually_scheduled) or
 * confirming it clears this. Floating master phases with a baseline
 * (planned_start_date set) are real plan steps and are NOT parked.
 */
export function isParkedPlanStep(p: {
  phase_scope?: string | null;
  is_confirmed?: boolean | null;
  is_manually_scheduled?: boolean | null;
  planned_start_date?: string | null;
  status?: string | null;
  created_by_sub_id?: string | null;
}): boolean {
  return (
    p.phase_scope === "master" &&
    !p.is_confirmed &&
    !p.is_manually_scheduled &&
    !p.planned_start_date &&
    (p.status ?? "not_started") === "not_started" &&
    !p.created_by_sub_id
  );
}
