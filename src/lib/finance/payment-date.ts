/**
 * Which schedule phase marks a payment stage as earned, most specific first.
 * These are matched against the lowercased phase name; the first pattern that
 * hits any phase wins, and the LAST such phase's end date is the collect date.
 */
const STAGE_ANCHORS: Record<string, RegExp[]> = {
  deposit: [/deposit|mobilization|pre-con/],
  weathertight: [/roof complete|weathertight|dry-in/, /roofing|copper|siding/],
  close_in: [/closed in/, /blueboard|plaster|drywall/],
  rough_inspection: [/rough inspection/, /inspection — rough/, /rough-ins|rough plumbing|rough electrical/],
  finish: [/floors \+ kitchen|finish complete/, /kitchen install|cabinet install/, /flooring|hardwood/],
  final: [/substantial completion/, /final inspection|final building/, /punch/],
  final_inspection: [/final inspection|final building/, /substantial completion/, /punch/],
  substantial_completion: [/substantial completion/, /punch/, /final inspection/],
};

/**
 * Trades a milestone label can name, and the phases that satisfy each.
 *
 * These are CONJUNCTIONS, not alternatives. "Tile, plaster, cabinets &
 * flooring complete" is not earned when the plaster finishes — it is earned
 * when the LAST of those four finishes. Taking the first keyword that matched
 * dated that draw weeks early.
 */
const TRADE_HINTS: [RegExp, RegExp][] = [
  [/foundation|footing/, /foundation|footing|concrete/],
  [/fram/, /framing|structural/],
  [/roof|shingle|copper/, /roof|copper|dry-in/],
  [/sid(e|ing)/, /siding/],
  [/window|exterior door/, /window|french door|slider/],
  [/rough/, /rough inspection|inspection — rough|rough-ins|rough plumbing|rough electrical/],
  [/insulat/, /insulation/],
  [/blueboard|plaster|drywall/, /blueboard|plaster|drywall/],
  [/tile/, /tile|backsplash/],
  [/trim|millwork|carpentry/, /trim|millwork|finish carpentry/],
  [/cabinet|kitchen/, /cabinet|kitchen install/],
  [/counter/, /countertop|counters/],
  [/floor/, /flooring|hardwood|lvp/],
  [/paint/, /paint/],
  [/appliance/, /appliance/],
  [/deck|porch|stair/, /deck|porch|stair|railing/],
  [/punch|final|substantial|completion/, /substantial completion|punch|final inspection|final building/],
];

interface AnchorPhase {
  name: string;
  end: string;
}

export interface PaymentAnchor {
  /** The phase whose completion dates the payment — the last one required. */
  name: string;
  end: string;
  /** Every phase this draw waits on, so the tooltip can show its reasoning. */
  requires: string[];
}

/** Latest-ending phase matching a pattern, or null. */
function lastMatching(phases: AnchorPhase[], re: RegExp): AnchorPhase | null {
  const hits = phases.filter((ph) => re.test(ph.name.toLowerCase()));
  if (hits.length === 0) return null;
  return hits.reduce((a, b) => (b.end > a.end ? b : a));
}

/**
 * Resolve one milestone to the date it becomes collectable.
 *
 * The label wins when it names trades, because it is the more specific
 * statement of what has to be finished; the stage_key is only a fallback for
 * labels that say nothing useful. Returns null when nothing in the schedule
 * plausibly represents the stage — better a blank than a made-up payday.
 */
export function resolvePaymentDate(
  stageKey: string | null,
  label: string,
  phases: AnchorPhase[],
  requireAllTrades = false,
): PaymentAnchor | null {
  if (phases.length === 0) return null;
  const lower = label.toLowerCase();

  // Every trade the label names must be complete — take the latest.
  const required: AnchorPhase[] = [];
  for (const [labelRe, phaseRe] of TRADE_HINTS) {
    if (!labelRe.test(lower)) continue;
    const hit = lastMatching(phases, phaseRe);
    if (hit) required.push(hit);
    else if (requireAllTrades) return null;
  }

  if (required.length > 0) {
    const latest = required.reduce((a, b) => (b.end > a.end ? b : a));
    return {
      name: latest.name,
      end: latest.end,
      requires: Array.from(new Set(required.map((r) => r.name))),
    };
  }

  // Nothing recognisable in the label — fall back to the stage key.
  for (const re of STAGE_ANCHORS[stageKey ?? ""] ?? []) {
    const hit = lastMatching(phases, re);
    if (hit) return { name: hit.name, end: hit.end, requires: [hit.name] };
  }
  return null;
}


