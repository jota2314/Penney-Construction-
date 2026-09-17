"use server";

import { createClient } from "@/lib/supabase/server";
import { loadLaborLedger } from "@/lib/crew/load-labor-ledger";
import { z } from "zod";
import { getRateVisibility, canSeeRate } from '@/lib/auth/rate-visibility';

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
  /** Number of logs whose worker has no hourly rate set (so cost is understated). */
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
 * uses the shared daily break and historical-rate model. ADP reconciliation remains separate.
 */
export async function getProjectLaborCost(projectId: string): Promise<ProjectLaborCost> {
  if (!z.string().uuid().safeParse(projectId).success) throw new Error("Choose a valid project.");
  const supabase = await createClient();

  const ledger = await loadLaborLedger(supabase);
  const logs = ledger.rows.filter(r => r.project_id === projectId);
  if (!logs.length) return EMPTY;
  const labelByPhase = new Map(ledger.phases.map(p => [p.id, p.name]));
  const lineIdByPhase = new Map(ledger.phases.map(p => [p.id, p.estimate_line_item_id]));
  const nameByAuthor = new Map(ledger.employees.map(e => [e.profile_id, `${e.first_name} ${e.last_name}`.trim()]));
  const ledgerCosted = ledger.projects.find(p => p.id === projectId)?.labor_cost_source === 'ledger';
  const lineIds = [...new Set(logs.map(l => l.estimate_line_item_id ?? lineIdByPhase.get(l.schedule_phase_id)).filter(Boolean))];
  const labels = lineIds.length ? await supabase.from('estimate_line_items').select('id,description').in('id', lineIds) : {data: [], error: null};
  if (labels.error) throw new Error(labels.error.message);
  const labelByLine = new Map((labels.data ?? []).map(l => [l.id, l.description]));
  let totalCents = 0;
  let liveCents = 0;
  let totalHours = 0;
  let missingRateLogs = 0;
  const onClock = new Set<string>();
  const byKey = new Map<string, LaborCostLineItem>();
  const workersByKey = new Map<string, Map<string, LaborWorkerRow>>();

  for (const l of logs) {
    if (l.rawMinutes <= 0) continue;
    const isOpen = l.open;
    const hours = l.paidMinutes / 60;
    const rate = l.rate;
    if (!ledgerCosted && rate == null) missingRateLogs++;
    const cents = l.projectCostCents;
    totalHours += hours;
    totalCents += cents;
    if (isOpen) {
      liveCents += cents;
      onClock.add(l.author_id);
    }

    const lineItemId = l.estimate_line_item_id ?? lineIdByPhase.get(l.schedule_phase_id) ?? null;
    const label = labelByLine.get(lineItemId) ?? labelByPhase.get(l.schedule_phase_id) ?? "Other";
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
    if (worker.rate !== rate) worker.rate = null; // Mixed historical rates.
    worker.cents = (worker.cents ?? 0) + cents;
    lineWorkers.set(l.author_id, worker);
  }

  const visibility = await getRateVisibility();
  return {
    totalCents,
    liveCents,
    totalHours: Math.round(totalHours * 10) / 10,
    workersOnClock: onClock.size,
    missingRateLogs,
    byLineItem: [...byKey.values()]
      .map((e) => ({
        ...e,
        workers: [...(workersByKey.get(e.key)?.values() ?? [])].map(w => canSeeRate(visibility, {profileId:w.profileId}) ? w : {...w, rate:null, cents:null}).sort(
          (a, b) => (b.cents ?? 0) - (a.cents ?? 0),
        ),
      }))
      .sort((a, b) => b.cents - a.cents),
  };
}
