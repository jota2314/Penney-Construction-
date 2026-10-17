/** Construction progress has one denominator everywhere: verified master work. */
export interface ProgressPhase {
  phase_scope?: string | null;
  event_type?: string | null;
  name?: string | null;
  status?: string | null;
  client_completed?: boolean;
  client_completed_at?: string | null;
}

export function isMasterPhase(phase: ProgressPhase): boolean {
  return (phase.phase_scope == null || phase.phase_scope === "master") &&
    !["crew", "clock_in", "clockin"].includes(phase.event_type ?? "") &&
    !/^clock[ -]?in\b/i.test(phase.name ?? "");
}

export function scheduleProgress(phases: readonly ProgressPhase[]) {
  const master = phases.filter(isMasterPhase);
  const completed = master.filter(phase => phase.status === "completed").length;
  return {
    total: master.length,
    completed,
    percent: master.length ? Math.round(completed / master.length * 100) : 0,
    pendingClientReports: master.filter(phase => phase.status !== "completed" &&
      (phase.client_completed || phase.client_completed_at)).length,
    readyToClose: master.length > 0 && completed === master.length,
  };
}
