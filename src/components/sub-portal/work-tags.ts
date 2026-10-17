// "What got done" chips for the sub portal composer. A handful of taps, not
// a form.
//
// v3: every one of his trades gets its chips, not just the first one the
// table happened to list. MGL Tile is demolition + flooring + tile, and the
// old first-match rule only ever showed tile words, so Marcio never saw a
// "Demo" chip on a demo day. Each trade is a group: a headline chip ("Demo",
// "Tile") and its detail chips. Today's trade comes first with its headline
// pre-picked (the server works that trade out from his phase; the phone
// never guesses from a phase name). The other trades show their headline
// only, and tapping it opens that trade's details. A one-trade sub always
// sees his whole list.

import type { SubExceptionChip } from "@/lib/sub-portal/payload";

interface TradeChipList {
  /** The trade's own chip; pre-picked when it's today's trade. */
  headline: string;
  /** What got done, in the order the work goes. */
  chips: string[];
}

// Keys are the lowercased trades on subcontractors.trades (checked live
// 10/16). A directory trade matches a key when it equals it or contains it,
// so "finish_carpentry" finds carpentry, "radiant_heating" finds heating and
// "decks" / "decking" find deck.
const TRADE_TAGS: Record<string, TradeChipList> = {
  demolition: { headline: "Demo", chips: ["Haul-away", "Dumpster loaded", "Protection up", "Cleanup"] },
  excavation: { headline: "Excavation", chips: ["Dig", "Backfill", "Grading", "Drainage"] },
  foundation: { headline: "Foundation", chips: ["Footings", "Walls", "Waterproofing", "Backfill"] },
  concrete: { headline: "Concrete", chips: ["Forms", "Rebar", "Pour", "Strip forms"] },
  masonry: { headline: "Masonry", chips: ["Layout", "Block / brick", "Veneer", "Pointing"] },
  framing: { headline: "Framing", chips: ["Layout", "Walls", "Floor / roof framing", "Sheathing", "Beams / posts"] },
  roofing: { headline: "Roofing", chips: ["Tear-off", "Roof underlayment", "Shingles", "Flashing & vents"] },
  siding: { headline: "Siding", chips: ["Housewrap", "Exterior trim", "Caulk & touch-up"] },
  windows: { headline: "Windows", chips: ["Old units out", "Window install", "Flash & seal", "Window trim"] },
  doors: { headline: "Doors", chips: ["Door install", "Hardware", "Door trim"] },
  gutters: { headline: "Gutters", chips: ["Gutters hung", "Downspouts"] },
  deck: { headline: "Deck", chips: ["Deck framing", "Decking boards", "Railings", "Stairs"] },
  plumbing: { headline: "Plumbing", chips: ["Rough-in", "Drain / waste / vent", "Water lines", "Gas line", "Fixture set", "Water heater"] },
  heating: { headline: "Heating", chips: ["Boiler / furnace", "Baseboard / radiant", "Mini split", "Gas line", "Startup & test"] },
  hvac: { headline: "HVAC", chips: ["Ductwork", "Equipment set", "Line set", "Startup & test"] },
  electrical: { headline: "Electrical", chips: ["Rough wire", "Panel / service", "Devices & trim", "Light fixtures", "Low voltage"] },
  insulation: { headline: "Insulation", chips: ["Batts", "Spray foam", "Blown-in", "Air seal"] },
  drywall: { headline: "Drywall", chips: ["Hang", "Tape", "Skim coat", "Sand"] },
  plaster: { headline: "Plaster", chips: ["Blueboard", "Skim coat", "Finish coat"] },
  waterproofing: { headline: "Waterproofing", chips: ["Membrane", "Drainage", "Sealing"] },
  tile: { headline: "Tile", chips: ["Backer / prep", "Waterproofing", "Floor tile", "Wall tile", "Grout & seal"] },
  flooring: { headline: "Flooring", chips: ["Underlayment", "Floor install", "Sanding", "Finish coats"] },
  carpentry: { headline: "Carpentry", chips: ["Trim", "Doors", "Built-ins", "Punch list"] },
  cabinetry: { headline: "Cabinets", chips: ["Cabinet install", "Hardware", "Adjust & punch"] },
  painting: { headline: "Painting", chips: ["Prep & patch", "Prime", "First coat", "Final coat", "Trim & doors"] },
  landscaping: { headline: "Landscaping", chips: ["Grading", "Plantings", "Hardscape", "Cleanup"] },
};

// For a sub whose trades match nothing above ("general", "remodeling").
const DEFAULT_CHIPS = ["Demo", "Rough-in", "Finish work"];

// Ends every list. The three office alerts ("Finished here" and friends) are
// their own chips now (EXCEPTION_CHIPS), so they aren't repeated here.
const COMMON_TAIL = ["Ready for inspection"];

/** One trade's chips in the composer. `headline` null = the fallback list, always open. */
export interface WorkChipGroup {
  key: string;
  headline: string | null;
  chips: string[];
}

export interface WorkChips {
  groups: WorkChipGroup[];
  /** "Ready for inspection": after every group. */
  tail: string[];
  /** Today's trade headline, picked when the composer opens; null = nothing picked. */
  preselect: string | null;
}

/** The table key a directory trade (or a server-resolved phase trade) belongs to. */
function tradeKey(trade: string): string | null {
  const t = trade.toLowerCase().trim();
  if (!t) return null;
  if (TRADE_TAGS[t]) return t;
  return Object.keys(TRADE_TAGS).find((k) => t.includes(k)) ?? null;
}

/**
 * His chips: one group per trade he has, today's trade first. `todayTrade`
 * is SubComposerContext.today_phase.trade (already resolved on the server);
 * it leads even when his directory record doesn't list it, since the phase
 * says that's the work today.
 */
export function workChipsFor(trades: string[], todayTrade?: string | null): WorkChips {
  const todayKey = todayTrade ? tradeKey(todayTrade) : null;
  const keys: string[] = [];
  for (const t of [todayTrade ?? "", ...trades]) {
    const k = tradeKey(t);
    if (k && !keys.includes(k)) keys.push(k);
  }

  // A chip shows once even when two trades share it ("Waterproofing" for
  // tile and foundation, "Doors" as carpentry detail and as a headline).
  // Headlines are claimed first so a detail chip never repeats one.
  const seen = new Set<string>(keys.map((k) => TRADE_TAGS[k].headline));
  const once = (list: string[]) =>
    list.filter((c) => {
      if (seen.has(c)) return false;
      seen.add(c);
      return true;
    });

  const groups: WorkChipGroup[] = keys.map((k) => ({ key: k, headline: TRADE_TAGS[k].headline, chips: once(TRADE_TAGS[k].chips) }));
  if (groups.length === 0) groups.push({ key: "general", headline: null, chips: once(DEFAULT_CHIPS) });

  return {
    groups,
    tail: once(COMMON_TAIL),
    preselect: todayKey ? TRADE_TAGS[todayKey].headline : null,
  };
}

/**
 * Old flat list (every chip of every trade, then the tail). Only the v2
 * shell (portal-app.tsx) still calls this; it goes at cutover.
 */
export function workTagsFor(trades: string[]): string[] {
  const { groups, tail } = workChipsFor(trades);
  return [...groups.flatMap((g) => (g.headline ? [g.headline, ...g.chips] : g.chips)), ...tail];
}

/**
 * The three chips that tell the office right away (each one is its own
 * notice, plan §4.3). Any combination can go on one post.
 */
export const EXCEPTION_CHIPS: { key: SubExceptionChip; label: string }[] = [
  { key: "finished", label: "Finished here" },
  { key: "waiting", label: "Waiting on something" },
  { key: "problem", label: "Problem found" },
];

export const EXCEPTION_LABEL: Record<SubExceptionChip, string> = {
  finished: "Finished here",
  waiting: "Waiting on something",
  problem: "Problem found",
};

/**
 * The post's text, the way the composer has always written it: a "Work:"
 * line from the chips, then the alert chips on their own line, then his
 * words. The alerts ride in `exceptions[]` too; the text keeps them readable
 * in the office feed and on the post.
 */
export function buildPostText({
  chips,
  exceptions,
  note,
}: {
  chips: string[];
  exceptions: SubExceptionChip[];
  note: string;
}): string {
  const alerts = EXCEPTION_CHIPS.filter((c) => exceptions.includes(c.key)).map((c) => c.label);
  return [chips.length ? `Work: ${chips.join(", ")}` : "", alerts.join(" · "), note.trim()].filter(Boolean).join("\n");
}
