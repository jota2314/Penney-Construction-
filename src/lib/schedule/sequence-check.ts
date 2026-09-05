// Schedule sequence check — "does this schedule build the job in an order that
// can actually happen?"
//
// Nothing in schedule_phases links one phase to another: every date is typed in
// on its own, so a schedule can say the insulation goes in three days before
// the inspector looks at the rough. The trade order was already written down —
// as prose, in the AI planning prompt (src/lib/ai/prompts/schedule.ts) — but
// nothing ever checked what got saved. This file reads the dates back and says
// what won't work.
//
// It never moves a date. It reports. The date is the office's call.

const DAY = 86400000;

export type PhaseStage =
  | "demo"
  | "prep"
  | "structure"
  | "rough_mep"
  | "rough_inspection"
  | "insulation"
  | "insulation_inspection"
  | "close_in"
  | "paint"
  | "finish_floor"
  | "tile"
  | "cabinets"
  | "countertop"
  | "finish_carpentry"
  | "finish_mep"
  | "glass"
  | "final_clean"
  | "final_inspection"
  // Not part of the interior sequence — these never gate anything.
  | "procurement"
  | "service"
  | "milestone"
  | "exterior"
  | "coordination"
  | "unknown";

export interface SequencePhase {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  event_type?: string | null;
  phase_scope?: string | null;
  status?: string | null;
}

export type Severity = "conflict" | "warning";

export interface SequenceIssue {
  /** The phase that is scheduled wrong — where the badge lands. */
  phaseId: string;
  /** The phase it collides with, when there is one. */
  relatedPhaseId?: string;
  rule: string;
  severity: Severity;
  /** One line, naming both phases and both dates. Written to be read on site. */
  message: string;
}

// ── Classification ────────────────────────────────────────────
// First pattern that matches wins, so the specific cases (finish plumbing,
// insulation inspection) sit above the general ones.

const RULES: { stage: PhaseStage; re: RegExp }[] = [
  // Overhead and markers first — these must never gate a trade.
  { stage: "milestone", re: /^milestone\b|substantial completion/i },
  {
    stage: "coordination",
    re: /^\d{1,2}:\d{2}\b|client decision|coordination|walkthrough|site visit|on site,|pre-?con\b/i,
  },
  {
    stage: "service",
    re: /general conditions|supervision|dumpster|debris removal|porta|mobilization|dust protection|site protection|floor protection|daily cleanup|permit/i,
  },
  // Procurement is only an explicit "Order —" or a supply-only allowance line.
  // "LVP Flooring — Supply & Install" is the install, not the order.
  { stage: "procurement", re: /^order\b|\bsupply\s*\(?allowance/i },

  // Inspections by name too — plenty carry event_type 'phase'.
  { stage: "final_inspection", re: /inspection.*(final|building)|final.*inspection/i },
  { stage: "insulation_inspection", re: /insulation.*inspection|inspection.*insulation/i },
  { stage: "rough_inspection", re: /\binspections?\b/i },

  { stage: "final_clean", re: /final clean|punch list|\bpunch\b/i },

  // Exterior scope — its own chain, doesn't gate interior close-in.
  // \b on roof matters: "waterproofing" contains "roofing".
  {
    stage: "exterior",
    // No "service upgrade" here — a 200-amp service upgrade is electrical rough.
    re: /siding|\broof(ing|s)?\b|shingle|gutter|downspout|excavat|\bdeck(ing)?\b|railing|porch|patio|landing|garage door|exterior (trim|structural|siding)|underground electric/i,
  },

  { stage: "demo", re: /demo(lition)?|gut to studs|tear.?out|strip out|safe off|wallpaper removal|scrap(e|ing)/i },
  // Subfloor/underlayment prep is not the finish floor, and gates nothing.
  { stage: "prep", re: /subfloor|underlayment|floor(ing)? prep|leveling/i },
  { stage: "structure", re: /fram(e|ing)|footing|foundation|concrete|slab|steel|beam|structural|blocking|\bpost\b/i },

  // Finish trades before rough, or "Finish Plumbing" reads as a rough.
  {
    stage: "finish_mep",
    re: /finish (electric|plumb|mep)|(electric|plumb)\w*\s*(finish|trim)|device trim|fixture|appliance|hvac finish/i,
  },
  // "Shower - Glass" and "Shower Door Template" are both the glass sub.
  { stage: "glass", re: /shower\s*[-–—]?\s*(glass|door)|glass (door|enclosure)/i },
  { stage: "countertop", re: /counter ?tops?/i },
  { stage: "cabinets", re: /cabinet|vanity(?!.*supply)/i },
  {
    stage: "finish_carpentry",
    re: /finish carpentry|interior (trim|doors)|millwork|baseboard|casing|wainscot|beadboard|chair rail|closet doors|attic drop|stair(case)? (tread|riser)|\btrim\b/i,
  },
  { stage: "tile", re: /tile|backsplash|grout/i },
  { stage: "finish_floor", re: /\bfloor(ing|s)?\b(?!.*protection)|\blvp\b|hardwood|refinish.*floor/i },
  { stage: "paint", re: /paint|primer|priming/i },
  { stage: "close_in", re: /blueboard|plaster|drywall|sheetrock|skim|rock lath|\btape\b|\bmud\b/i },
  { stage: "insulation", re: /insulat|fire ?stop|fireproof|air seal/i },
  { stage: "rough_mep", re: /plumb|electric|hvac|mechanical|ductwork|repipe|waste line|\bpanel\b/i },
];

/**
 * Phase names carry a headline and then the scope:
 * "Bathroom Electrical — vanity lights, GFCI, exhaust fan". The headline names
 * the trade; the tail lists parts and is full of other trades' words, which is
 * how wallpaper removal ends up classified as electrical. So match the headline
 * first and only fall back to the whole string when the headline says nothing.
 * Parentheticals are always asides — drop them.
 */
function nameParts(name: string): [string, string] {
  const noParens = name.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
  const head = noParens.split(/\s+—\s+|\s+–\s+|\s+-\s+|:\s+|,/)[0].trim();
  return [head || noParens, noParens];
}

export function classifyPhase(p: SequencePhase): PhaseStage {
  if (p.event_type === "inspection") {
    if (/final|building/i.test(p.name)) return "final_inspection";
    if (/insulation/i.test(p.name)) return "insulation_inspection";
    return "rough_inspection";
  }
  if (p.event_type === "meeting" || p.event_type === "walkthrough" || p.event_type === "shop_meeting") {
    return "coordination";
  }
  // Procurement reads off the RAW name — "Vanity 48in — Supply (Allowance)"
  // loses the word that makes it an order once parentheticals are stripped.
  // Parens are dropped rather than matched, so "(Supply Allowance)" and
  // "Supply (Allowance)" both read the same. A "Supply & Install" line is the
  // install, not the order, and stays out of this.
  const bare = p.name.replace(/[()]/g, " ").replace(/\s+/g, " ");
  if (/^order\b/i.test(bare) || /\bsupply\s+allowance\b/i.test(bare)) return "procurement";
  const [head, full] = nameParts(p.name);
  for (const r of RULES) if (r.re.test(head)) return r.stage;
  for (const r of RULES) if (r.re.test(full)) return r.stage;
  return "unknown";
}

// ── Helpers ───────────────────────────────────────────────────

function days(a: string, b: string): number {
  return Math.round(
    (new Date(`${b}T00:00:00`).getTime() - new Date(`${a}T00:00:00`).getTime()) / DAY
  );
}

/**
 * Enough of the name to know which bar is meant, without the paragraph of
 * scope. "Inspection" alone is useless when a job has five of them, so keep
 * the tail up to a readable length.
 */
function shortName(name: string): string {
  const clean = name.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
  if (clean.length <= 44) return clean;
  const cut = clean.slice(0, 44);
  const space = cut.lastIndexOf(" ");
  return `${(space > 20 ? cut.slice(0, space) : cut).replace(/[\s—–,-]+$/, "")}…`;
}

function fmt(d: string): string {
  const dt = new Date(`${d}T00:00:00`);
  return `${dt.getMonth() + 1}/${dt.getDate()}`;
}

/**
 * Which room a phase is in, when the name says. Used to keep the wet-trade
 * rules from firing across rooms — painting the bathroom while the kitchen
 * ceiling gets skimmed is a normal week, not a conflict.
 */
const AREAS = ["kitchen", "bath", "dining", "living", "bedroom", "basement", "attic", "hall", "laundry", "mudroom", "office"];

function areasOf(name: string): string[] {
  const lower = name.toLowerCase();
  return AREAS.filter((a) => lower.includes(a));
}

/** True unless we positively know the two phases are in different rooms. */
function sharesArea(a: string, b: string): boolean {
  const aa = areasOf(a);
  const bb = areasOf(b);
  if (aa.length === 0 || bb.length === 0) return true;
  return aa.some((x) => bb.includes(x));
}

/** Which trade an inspection is gating, from its own name. */
function inspectionTrade(name: string): RegExp | null {
  if (/plumb/i.test(name)) return /plumb|repipe|waste line/i;
  if (/electric/i.test(name)) return /electric|\bpanel\b|devices|lighting/i;
  if (/mechanical|hvac/i.test(name)) return /hvac|mechanical|duct/i;
  if (/fram|structur/i.test(name)) return /fram|blocking|structural|beam|steel/i;
  if (/footing|foundation/i.test(name)) return /footing|foundation|concrete|slab/i;
  return null;
}

// ── The check ─────────────────────────────────────────────────

/** Past this, one bad phase floods the panel — the duplicate warning explains the rest. */
const MAX_PER_RULE_PER_PHASE = 3;

export function checkSequence(phases: SequencePhase[]): SequenceIssue[] {
  const live = phases
    .filter((p) => p.phase_scope !== "daily" && p.event_type !== "crew" && p.start_date && p.end_date)
    .sort((a, b) => a.start_date.localeCompare(b.start_date));
  const tagged = live.map((p) => ({ ...p, stage: classifyPhase(p) }));
  const of = (...stages: PhaseStage[]) => tagged.filter((p) => stages.includes(p.stage));

  const issues: SequenceIssue[] = [];
  const seen = new Set<string>();
  const counts = new Map<string, number>();
  const add = (i: SequenceIssue) => {
    const key = `${i.rule}:${i.phaseId}:${i.relatedPhaseId ?? ""}`;
    if (seen.has(key)) return;
    const bucket = `${i.rule}:${i.phaseId}`;
    const n = counts.get(bucket) ?? 0;
    if (n >= MAX_PER_RULE_PER_PHASE) return;
    counts.set(bucket, n + 1);
    seen.add(key);
    issues.push(i);
  };

  const roughs = of("rough_mep");
  const roughInspections = of("rough_inspection");
  const insulation = of("insulation");
  const insulationInspections = of("insulation_inspection");
  const closeIn = of("close_in");
  const paint = of("paint");
  const floors = of("finish_floor");
  const tile = of("tile");
  const glass = of("glass");
  const structure = of("structure");

  // 1. Roughs have to be finished before anything covers them.
  for (const ins of insulation) {
    for (const r of roughs) {
      if (r.end_date > ins.start_date) {
        add({
          phaseId: ins.id,
          relatedPhaseId: r.id,
          rule: "rough-before-insulation",
          severity: "conflict",
          message: `${shortName(ins.name)} starts ${fmt(ins.start_date)}, but ${shortName(r.name)} runs to ${fmt(r.end_date)} — insulating over unfinished rough.`,
        });
      }
    }
  }

  // 2. Nothing closes a wall before the inspector has seen it.
  for (const closer of [...insulation, ...closeIn]) {
    for (const insp of roughInspections) {
      if (insp.start_date >= closer.start_date) {
        add({
          phaseId: closer.id,
          relatedPhaseId: insp.id,
          rule: "close-in-before-inspection",
          severity: "conflict",
          message: `${shortName(closer.name)} starts ${fmt(closer.start_date)}, before ${shortName(insp.name)} on ${fmt(insp.start_date)} — that covers the work the inspector is coming to see.`,
        });
      }
    }
  }

  // 3. Plaster can't start until the insulation inspection has passed.
  for (const c of closeIn) {
    for (const insp of insulationInspections) {
      if (insp.start_date >= c.start_date) {
        add({
          phaseId: c.id,
          relatedPhaseId: insp.id,
          rule: "close-in-before-insulation-inspection",
          severity: insp.start_date === c.start_date ? "warning" : "conflict",
          message:
            insp.start_date === c.start_date
              ? `${shortName(c.name)} starts the same day as ${shortName(insp.name)} (${fmt(insp.start_date)}) — no room if it fails.`
              : `${shortName(c.name)} starts ${fmt(c.start_date)}, before ${shortName(insp.name)} on ${fmt(insp.start_date)}.`,
        });
      }
    }
  }

  // 4. An inspection booked before its own trade has finished.
  for (const insp of [...roughInspections, ...insulationInspections]) {
    const trade = inspectionTrade(insp.name);
    if (!trade) continue;
    const pool = insp.stage === "insulation_inspection" ? insulation : [...roughs, ...structure];
    for (const t of pool) {
      if (trade.test(t.name) && t.end_date > insp.start_date) {
        add({
          phaseId: insp.id,
          relatedPhaseId: t.id,
          rule: "inspection-before-trade-done",
          severity: "conflict",
          message: `${shortName(insp.name)} is booked ${fmt(insp.start_date)}, but ${shortName(t.name)} runs to ${fmt(t.end_date)} — the work won't be ready.`,
        });
      }
    }
  }

  // 5. Paint over wet plaster, and plaster over a room already painted.
  for (const pt of paint) {
    for (const c of closeIn) {
      if (!sharesArea(pt.name, c.name)) continue;
      // Order matters: plaster that starts after the paint finished is the
      // paint-it-twice case, and it also satisfies the overlap test below.
      if (c.start_date > pt.end_date) {
        add({
          phaseId: c.id,
          relatedPhaseId: pt.id,
          rule: "plaster-after-paint",
          severity: "conflict",
          message: `${shortName(c.name)} starts ${fmt(c.start_date)}, after ${shortName(pt.name)} finished ${fmt(pt.end_date)} — that room gets painted twice.`,
        });
      } else if (pt.start_date < c.end_date) {
        add({
          phaseId: pt.id,
          relatedPhaseId: c.id,
          rule: "paint-over-wet-plaster",
          severity: "conflict",
          message: `${shortName(pt.name)} starts ${fmt(pt.start_date)} while ${shortName(c.name)} runs to ${fmt(c.end_date)} — no cure time.`,
        });
      }
    }
  }

  // 6. Finish floor goes in after the wet trades are out of that room.
  for (const f of floors) {
    for (const wet of [...closeIn, ...paint]) {
      if (!sharesArea(f.name, wet.name)) continue;
      if (f.start_date < wet.end_date) {
        add({
          phaseId: f.id,
          relatedPhaseId: wet.id,
          rule: "floor-before-wet-trades",
          severity: "conflict",
          message: `${shortName(f.name)} goes down ${fmt(f.start_date)} but ${shortName(wet.name)} runs to ${fmt(wet.end_date)} — finish floor under the wet trades.`,
        });
      }
    }
  }

  // 7. Rough started before the walls it runs through exist.
  for (const r of roughs) {
    for (const s of structure) {
      if (!sharesArea(r.name, s.name)) continue;
      if (r.start_date < s.start_date && s.start_date <= r.end_date) {
        add({
          phaseId: r.id,
          relatedPhaseId: s.id,
          rule: "rough-before-framing",
          severity: "warning",
          message: `${shortName(r.name)} starts ${fmt(r.start_date)}, before ${shortName(s.name)} starts ${fmt(s.start_date)}.`,
        });
      }
    }
  }

  // 8. Glass is templated off finished tile, then fabricated.
  for (const g of glass) {
    for (const t of tile) {
      if (g.start_date < t.end_date) {
        add({
          phaseId: g.id,
          relatedPhaseId: t.id,
          rule: "glass-before-tile-done",
          severity: "warning",
          message: `${shortName(g.name)} is set for ${fmt(g.start_date)} but ${shortName(t.name)} runs to ${fmt(t.end_date)} — glass templates off finished tile and takes a week or two to come back.`,
        });
      }
    }
  }

  // 9. Material ordered with no lead time before the crew needs it.
  const MIN_LEAD = 5;
  for (const order of of("procurement")) {
    const key = order.name
      .replace(/^order\s*[—–-]?\s*/i, "")
      .match(/tile|vanity|cabinet|floor|counter|door|window|fixture|appliance/i);
    if (!key) continue;
    const installers = tagged
      .filter(
        (p) =>
          p.stage !== "procurement" &&
          // You can't install it before it was ordered — those are other scopes
          // that merely share a word (demo of the old flooring, etc.).
          p.start_date >= order.start_date &&
          new RegExp(key[0], "i").test(p.name)
      )
      .sort((a, b) => a.start_date.localeCompare(b.start_date));
    const first = installers[0];
    if (!first) continue;
    const lead = days(order.end_date, first.start_date);
    if (lead < MIN_LEAD) {
      add({
        phaseId: order.id,
        relatedPhaseId: first.id,
        rule: "no-lead-time",
        severity: "warning",
        message: `${shortName(order.name)} lands ${fmt(order.end_date)} and ${shortName(first.name)} starts ${fmt(first.start_date)} — ${lead} day${lead === 1 ? "" : "s"} of lead time.`,
      });
    }
  }

  // 10. The same phase entered more than once — usually one per estimate line.
  //
  // A shared headline is not enough on its own. "Inspection — Rough Frame" and
  // "Inspection — Rough Plumbing" on one day is a single inspector visit, and
  // "Paint — Kitchen" alongside "Paint — Bathroom" is two rooms one painter
  // does in the same week. So a duplicate also has to be the same stage and
  // has to not name a different room — and inspections are never duplicates.
  const NEVER_DUPLICATE: PhaseStage[] = [
    "service",
    "procurement",
    "rough_inspection",
    "insulation_inspection",
    "final_inspection",
    "milestone",
    "coordination",
  ];
  const byName = new Map<string, typeof tagged>();
  for (const p of tagged) {
    if (NEVER_DUPLICATE.includes(p.stage)) continue;
    const k = `${p.stage}::${nameParts(p.name)[0].toLowerCase()}`;
    byName.set(k, [...(byName.get(k) ?? []), p]);
  }
  for (const [, group] of byName) {
    if (group.length < 2) continue;
    const overlapping = group.filter((p) =>
      group.some(
        (q) =>
          q.id !== p.id &&
          p.start_date <= q.end_date &&
          q.start_date <= p.end_date &&
          sharesArea(p.name, q.name)
      )
    );
    if (overlapping.length < 2) continue;
    for (const p of overlapping.slice(1)) {
      add({
        phaseId: p.id,
        relatedPhaseId: overlapping[0].id,
        rule: "duplicate-phase",
        severity: "warning",
        message: `"${nameParts(p.name)[0]}" is on the schedule ${overlapping.length} times over the same days — one mobilization, ${overlapping.length} bars.`,
      });
    }
  }

  return issues;
}

/** Issues keyed by the phase they land on, for badge rendering. */
export function issuesByPhase(issues: SequenceIssue[]): Map<string, SequenceIssue[]> {
  const out = new Map<string, SequenceIssue[]>();
  for (const i of issues) out.set(i.phaseId, [...(out.get(i.phaseId) ?? []), i]);
  return out;
}
