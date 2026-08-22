"use server";

import { createClient } from "@/lib/supabase/server";
import { MAX_SHIFT_MS } from "@/lib/crew/shift";

export type LaborWorkerRow = {
  profileId: string;
  name: string;
  hours: number;
  /** Nulled together with rate when the viewer may not see this person's pay. */
  cents: number | null;
  rate: number | null;
};

export type LaborCostLineItem = {
  key: string;
  /** Estimate line item the hours resolved to (log's own stamp or the phase link); null when neither points anywhere. */
  lineItemId: string | null;
  description: string;
  cents: number;
  hours: number;
  /** Per-person breakdown of this line's hours, biggest cost first. */
  workers: LaborWorkerRow[];
};

export type ProjectLaborCost = {
  totalCents: number;
  /** Portion of totalCents still accruing from workers currently on the clock. */
  liveCents: number;
  totalHours: number;
  workersOnClock: number;
  /**
   * Number of logs whose worker is paid hourly but has no rate on file (so
   * cost is understated). Salaried people are excluded — they have no hourly
   * rate to set, so the warning would never be actionable.
   */
  missingRateLogs: number;
  byLineItem: LaborCostLineItem[];
};

const EMPTY: ProjectLaborCost = {
  totalCents: 0,
  liveCents: 0,
  totalHours: 0,
  workersOnClock: 0,
  missingRateLogs: 0,
  byLineItem: [],
};

/**
 * Live labor cost for a project from clocked field time: every daily_log on the
 * project's schedule phases, hours × the worker's hourly rate. Open (on-the-
 * clock) shifts count live, capped at the 12h max so a forgotten clock-out
 * can't inflate the burn. Rolled up per estimate line item (the phase's task).
 *
 * Computed on the fly — nothing is written to the ledger — so it always
 * reflects the current clocked time and needs no reconciliation.
 */
export async function getProjectLaborCost(projectId: string): Promise<ProjectLaborCost> {
  const supabase = await createClient();

  // labor_cost_source = 'ledger': labor dollars come from imported payroll
  // invoice rows (Nicole's ledger), which predate and outlast the clock-in
  // rollout on that job. Clocked hours stay visible but carry $0 here so the
  // budget doesn't count the same week twice.
  const { data: proj } = await supabase
    .from("projects")
    .select("labor_cost_source")
    .eq("id", projectId)
    .maybeSingle();
  const ledgerCosted = proj?.labor_cost_source === "ledger";

  const { data: phases } = await supabase
    .from("schedule_phases")
    .select("id, name, estimate_line_item_id, line_item:estimate_line_items!estimate_line_item_id(description)")
    .eq("project_id", projectId);
  if (!phases || phases.length === 0) return EMPTY;

  const labelByPhase = new Map<string, string>();
  const lineIdByPhase = new Map<string, string | null>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const p of phases as any[]) {
    const li = Array.isArray(p.line_item) ? p.line_item[0] : p.line_item;
    labelByPhase.set(p.id, li?.description ?? p.name ?? "Other");
    lineIdByPhase.set(p.id, (p.estimate_line_item_id as string | null) ?? null);
  }
  const phaseIds = [...labelByPhase.keys()];

  const { data: logs } = await supabase
    .from("daily_logs")
    .select(
      "schedule_phase_id, author_id, started_at, ended_at, status, estimate_line_item_id, line_item:estimate_line_items!estimate_line_item_id(description)",
    )
    .in("schedule_phase_id", phaseIds);
  if (!logs || logs.length === 0) return EMPTY;

  // Resolve each worker's rate + name (employees.profile_id == daily_logs.author_id).
  const authorIds = Array.from(new Set(logs.map((l) => l.author_id)));
  const rateByAuthor = new Map<string, number>();
  const nameByAuthor = new Map<string, string>();
  const salariedAuthors = new Set<string>();
  if (authorIds.length > 0) {
    const { data: emps } = await supabase
      .from("employees")
      .select("profile_id, hourly_rate, pay_type, first_name, last_name")
      .in("profile_id", authorIds);
    for (const e of emps ?? []) {
      if (e.profile_id) {
        rateByAuthor.set(e.profile_id, Number(e.hourly_rate) || 0);
        nameByAuthor.set(e.profile_id, `${e.first_name ?? ""} ${e.last_name ?? ""}`.trim() || "Crew member");
        if (e.pay_type === "salary") salariedAuthors.add(e.profile_id);
      }
    }
  }

  const now = Date.now();
  let totalCents = 0;
  let liveCents = 0;
  let totalHours = 0;
  let missingRateLogs = 0;
  const onClock = new Set<string>();
  const byKey = new Map<string, LaborCostLineItem>();
  const workersByKey = new Map<string, Map<string, LaborWorkerRow>>();

  for (const l of logs) {
    const start = new Date(l.started_at).getTime();
    const isOpen = l.status === "in_progress" || !l.ended_at;
    const ms = isOpen
      ? Math.min(now - start, MAX_SHIFT_MS)
      : new Date(l.ended_at as string).getTime() - start;
    if (ms <= 0) continue;

    const hours = ms / 3_600_000;
    const rate = ledgerCosted ? 0 : rateByAuthor.get(l.author_id);
    if (
      !ledgerCosted &&
      (rate === undefined || rate === 0) &&
      !salariedAuthors.has(l.author_id)
    ) {
      missingRateLogs++;
    }
    const cents = Math.round(hours * (rate ?? 0) * 100);

    totalHours += hours;
    totalCents += cents;
    if (isOpen) {
      liveCents += cents;
      onClock.add(l.author_id);
    }

    // A stamp on the log itself (a human or routed correction) beats the phase
    // the worker tapped at clock-in; the phase link is the fallback.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const own = Array.isArray((l as any).line_item)
      ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (l as any).line_item[0]
      : // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (l as any).line_item;
    const lineItemId =
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ((l as any).estimate_line_item_id as string | null) ?? lineIdByPhase.get(l.schedule_phase_id) ?? null;
    const label = own?.description ?? labelByPhase.get(l.schedule_phase_id) ?? "Other";
    const key = lineItemId ?? label;
    const entry = byKey.get(key) ?? { key, lineItemId, description: label, cents: 0, hours: 0, workers: [] };
    entry.cents += cents;
    entry.hours += hours;
    byKey.set(key, entry);

    let lineWorkers = workersByKey.get(key);
    if (!lineWorkers) {
      lineWorkers = new Map();
      workersByKey.set(key, lineWorkers);
    }
    const worker = lineWorkers.get(l.author_id) ?? {
      profileId: l.author_id,
      name: nameByAuthor.get(l.author_id) ?? "Crew member",
      hours: 0,
      cents: 0,
      rate: rate ?? null,
    };
    worker.hours += hours;
    worker.cents = (worker.cents ?? 0) + cents;
    lineWorkers.set(l.author_id, worker);
  }

  return {
    totalCents,
    liveCents,
    totalHours: Math.round(totalHours * 10) / 10,
    workersOnClock: onClock.size,
    missingRateLogs,
    byLineItem: [...byKey.values()]
      .map((e) => ({
        ...e,
        workers: [...(workersByKey.get(e.key)?.values() ?? [])].sort(
          (a, b) => (b.cents ?? 0) - (a.cents ?? 0),
        ),
      }))
      .sort((a, b) => b.cents - a.cents),
  };
}
