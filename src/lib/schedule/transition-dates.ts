import type { SupabaseClient } from "@supabase/supabase-js";
import { isFirm, stabilizePhaseDates, type CascadeInput } from "./cascade";
import { isMasterPhase } from "./progress";

/** Read the same forecast as the screen before a status/confirmation pins it. */
export async function phaseTransitionDates(
  db: SupabaseClient,
  projectId: string,
  phaseId: string,
  before: { status: string | null; is_confirmed: boolean | null; is_manually_scheduled?: boolean | null; event_type?: string | null },
  next: { status?: string | null; is_confirmed?: boolean | null },
) {
  if (before.event_type === "inspection" || isFirm(before) || before.is_manually_scheduled || !isFirm({
    status: next.status ?? before.status, is_confirmed: next.is_confirmed ?? before.is_confirmed,
  })) return { dates: null, error: null };
  const { data, error } = await db.from("schedule_phases")
    .select("id,name,event_type,phase_scope,sort_order,status,is_confirmed,is_manually_scheduled,start_date,end_date,planned_start_date,planned_end_date,actual_completed_at")
    .eq("project_id", projectId).or("phase_scope.eq.master,phase_scope.is.null");
  if (error) return { dates: null, error: "Could not check the current forecast. Refresh and try again." };
  return { dates: stabilizePhaseDates((data ?? []).filter(isMasterPhase) as CascadeInput[], phaseId, next), error: null };
}
