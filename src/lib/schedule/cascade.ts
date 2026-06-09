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
//   - Each unconfirmed phase after it is shown at baseline + running delta,
//     preserving the master's shape (overlaps, gaps) but sliding to match.
//
// A phase is "firm" (real dates the client can count on) when it's confirmed OR
// already underway/done. Otherwise it's "estimated" and floats with the cascade.

export interface CascadeInput {
  id: string;
  sort_order: number | null;
  status: string | null;
  is_confirmed: boolean | null;
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
}

const DAY = 86400000;

function parse(d: string | null): number | null {
  if (!d) return null;
  const t = Date.parse(d.length === 10 ? d + "T00:00:00" : d);
  return Number.isNaN(t) ? null : t;
}
function iso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

// A phase whose dates are real: locked with a sub, or physically happening/done.
export function isFirm(p: { is_confirmed: boolean | null; status: string | null }): boolean {
  return !!p.is_confirmed || p.status === "in_progress" || p.status === "completed";
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

  for (const p of ordered) {
    const firm = isFirm(p);
    const baseStart = parse(p.planned_start_date);
    const baseEnd = parse(p.planned_end_date);
    const liveStart = parse(p.start_date);
    const liveEnd = parse(p.end_date);

    if (firm) {
      // Firm phase: its live dates win. Update the running delta off baseline.
      if (baseStart != null && liveStart != null) runningDelta = liveStart - baseStart;
      const s = liveStart ?? baseStart;
      const e = liveEnd ?? baseEnd ?? s;
      out.set(p.id, {
        id: p.id,
        firm: true,
        start_date: s != null ? iso(s) : null,
        end_date: e != null ? iso(e) : null,
        slip_days: baseStart != null && s != null ? Math.round((s - baseStart) / DAY) : 0,
      });
    } else {
      // Unconfirmed: ride the baseline shifted by the carried delta. If no
      // baseline exists, fall back to whatever live dates are stored.
      const s = baseStart != null ? baseStart + runningDelta : liveStart;
      const e = baseEnd != null ? baseEnd + runningDelta : liveEnd ?? s;
      out.set(p.id, {
        id: p.id,
        firm: false,
        start_date: s != null ? iso(s) : null,
        end_date: e != null ? iso(e) : null,
        slip_days: Math.round(runningDelta / DAY),
      });
    }
  }
  return out;
}
