// Schedule cascade — "the plan slides, it doesn't re-stack."
//
// Penney builds a master schedule (planned_start_date / planned_end_date) that
// never lands as drawn. As phases get confirmed with subs/crew, their real
// dates (start_date / end_date) become firm. Everything still unconfirmed should
// follow reality WITHOUT the office hand-dragging dates — and without collapsing
// the parallel work and gaps baked into the master.
//
// So we cascade by DELTA PROPAGATION, not by re-stacking end-to-end:
//   - Walk phases in schedule order.
//   - Each confirmed / started / completed phase is an anchor. Its slip =
//     (live start − baseline start) in days. That becomes the running delta.
//   - A finish overrun also delays later tentative work that was planned after
//     that anchor finished. Parallel work and overhead do not become a chain.
//   - Each unconfirmed phase after it is shown at baseline + running delta,
//     preserving the master's shape (overlaps, gaps) but sliding to match.
//
// A phase is "firm" (real dates the client can count on) when it's confirmed OR
// already underway/done. Otherwise it's "estimated" and floats with the cascade.

import { inspectionCompletionDay } from "./inspection-completion-day";

export interface CascadeInput {
  id: string;
  name?: string | null;
  event_type?: string | null;
  phase_scope?: string | null;
  actual_completed_at?: string | null;
  sort_order: number | null;
  status: string | null;
  is_confirmed: boolean | null;
  is_manually_scheduled?: boolean | null;
  start_date: string | null;        // live
  end_date: string | null;          // live
  planned_start_date: string | null; // baseline / master
  planned_end_date: string | null;   // baseline / master
}

export interface CascadeResult {
  id: string;
  firm: boolean;            // confirmed or underway/done → real dates
  start_date: string | null; // effective live start after cascade
  end_date: string | null;   // effective live end after cascade
  slip_days: number;         // live − baseline, in days (0 if no baseline)
  actual_completion_date?: string;
}

const DAY = 86400000;

function parse(d: string | null): number | null {
  if (!d) return null;
  const t = Date.parse(d.length === 10 ? d + "T00:00:00Z" : d);
  return Number.isNaN(t) ? null : t;
}
function iso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

// A phase whose dates are real: locked with a sub, or physically happening/done.
export function isFirm(p: { is_confirmed: boolean | null; status: string | null }): boolean {
  return !!p.is_confirmed || p.status === "in_progress" || p.status === "completed";
}

function canCarryFinishDelay(p: CascadeInput): boolean {
  if (["crew", "meeting", "walkthrough", "shop_meeting"].includes(p.event_type ?? "")) return false;
  // These run alongside the job. A dumpster staying longer must not move the
  // trades, and a delayed delivery needs a specific dependency, not every trade.
  return !/general conditions|supervision|dumpster|debris removal|porta|mobilization|dust protection|site protection|floor protection|daily cleanup|^order\b|\bsupply\s*\(?allowance|^milestone\b|client decision|coordination|site visit|pre-?con\b/i.test(p.name ?? "");
}

function sameWorkArea(a: string | null | undefined, b: string | null | undefined): boolean {
  const areas = ["kitchen", "bath", "dining", "living", "bedroom", "basement", "attic", "hall", "laundry", "mudroom", "office"];
  const left = areas.filter(area => (a ?? "").toLowerCase().includes(area));
  const right = areas.filter(area => (b ?? "").toLowerCase().includes(area));
  return !left.length || !right.length || left.some(area => right.includes(area));
}

/**
 * Compute effective live dates for every phase by propagating the slip of the
 * most recent firm phase onto the unconfirmed phases that follow it.
 */
export function cascadeSchedule(phases: CascadeInput[]): Map<string, CascadeResult> {
  const ordered = [...phases].sort((a, b) => {
    const so = (a.sort_order ?? 0) - (b.sort_order ?? 0);
    if (so !== 0) return so;
    return (parse(a.planned_start_date) ?? parse(a.start_date) ?? 0) -
      (parse(b.planned_start_date) ?? parse(b.start_date) ?? 0);
  });

  const out = new Map<string, CascadeResult>();
  let runningDelta = 0; // ms of slip carried forward from the last firm phase
  let finishAnchor: { phase: CascadeInput; baselineEnd: number; delay: number } | null = null;

  for (const p of ordered) {
    const firm = isFirm(p);
    const baseStart = parse(p.planned_start_date);
    const baseEnd = parse(p.planned_end_date);
    const actualDate = p.event_type === "inspection" && p.status === "completed"
      ? inspectionCompletionDay(p.actual_completed_at) : null;
    const liveStart = parse(actualDate ?? p.start_date);
    const liveEnd = parse(actualDate ?? p.end_date);

    if (firm) {
      // Firm phase: its live dates win. Update the running delta off baseline.
      if (baseStart != null && liveStart != null) runningDelta = liveStart - baseStart;
      if (canCarryFinishDelay(p)) {
        finishAnchor = baseEnd != null && liveEnd != null
          ? { phase: p, baselineEnd: baseEnd, delay: Math.max(0, liveEnd - baseEnd) }
          : null;
      }
      const s = liveStart ?? baseStart;
      const e = liveEnd ?? baseEnd ?? s;
      out.set(p.id, {
        id: p.id,
        firm: true,
        start_date: s != null ? iso(s) : null,
        end_date: e != null ? iso(e) : null,
        slip_days: baseStart != null && s != null ? Math.round((s - baseStart) / DAY) : 0,
        ...(actualDate ? { actual_completion_date: actualDate } : {}),
      });
    } else if (p.is_manually_scheduled && liveStart != null && liveEnd != null) {
      // A deliberate move holds its saved dates without confirming the phase,
      // rewriting the original plan, or shifting unrelated tentative work.
      out.set(p.id, {
        id: p.id, firm: false, start_date: p.start_date, end_date: p.end_date,
        slip_days: baseStart != null ? Math.round((liveStart - baseStart) / DAY) : 0,
      });
    } else {
      // Unconfirmed: ride the baseline shifted by the carried delta. If no
      // baseline exists, fall back to whatever live dates are stored.
      let delta = runningDelta;
      if (baseStart != null && finishAnchor && canCarryFinishDelay(p) && baseStart > finishAnchor.baselineEnd &&
          sameWorkArea(p.name, finishAnchor.phase.name)) {
        delta = Math.max(delta, finishAnchor.delay);
      }
      const s = baseStart != null ? baseStart + delta : liveStart;
      const e = baseEnd != null ? baseEnd + delta : liveEnd ?? s;
      out.set(p.id, {
        id: p.id,
        firm: false,
        start_date: s != null ? iso(s) : null,
        end_date: e != null ? iso(e) : null,
        slip_days: Math.round(delta / DAY),
      });
    }
  }
  return out;
}

/** Use the same effective dates for charts, lists, checks and downstream reads. */
export function withEffectiveScheduleDates<T extends CascadeInput>(phases: T[]): T[] {
  const dates = cascadeSchedule(phases);
  return phases.map(p => ({
    ...p,
    start_date: dates.get(p.id)?.start_date ?? p.start_date,
    end_date: dates.get(p.id)?.end_date ?? p.end_date,
  }));
}

/** Freeze the forecast being reviewed when work first becomes firm. This is a
 * forecast snapshot, not an actual start/completion timestamp. */
export function stabilizePhaseDates(
  phases: CascadeInput[],
  phaseId: string,
  next: { status?: string | null; is_confirmed?: boolean | null },
): { start_date: string; end_date: string; is_manually_scheduled: true } | null {
  const before = phases.find(p => p.id === phaseId);
  if (!before || before.event_type === "inspection" || isFirm(before) || before.is_manually_scheduled || !isFirm({
    status: next.status ?? before.status,
    is_confirmed: next.is_confirmed ?? before.is_confirmed,
  })) return null;
  const effective = cascadeSchedule(phases).get(phaseId);
  return effective?.start_date && effective.end_date ? {
    start_date: effective.start_date, end_date: effective.end_date, is_manually_scheduled: true,
  } : null;
}
