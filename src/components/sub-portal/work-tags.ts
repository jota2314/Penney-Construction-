// "What got done" chips for the sub portal — picked by the trades on the
// sub's directory record so a plumber sees plumbing words and an electrician
// sees electrical ones. Tapping a chip is the whole log for most days; the
// note box is there for anything else.

const TRADE_TAGS: Record<string, string[]> = {
  plumbing: [
    "Rough-in",
    "Drain / waste / vent",
    "Water lines",
    "Gas line",
    "Fixture set",
    "Water heater",
    "Pressure test",
    "Ready for inspection",
  ],
  heating: ["Boiler / furnace", "Baseboard / radiant", "Mini split", "Gas line", "Startup & test", "Ready for inspection"],
  hvac: ["Ductwork", "Equipment set", "Line set", "Startup & test", "Ready for inspection"],
  electrical: [
    "Rough wire",
    "Panel / service",
    "Devices & trim",
    "Fixtures",
    "Low voltage",
    "Ready for inspection",
  ],
  painting: ["Prep & patch", "Prime", "First coat", "Final coat", "Trim & doors", "Touch-ups"],
  tile: ["Prep / backer", "Waterproofing", "Floor tile", "Wall tile", "Grout & seal"],
  flooring: ["Prep / underlayment", "Install", "Sand", "Finish coats"],
  insulation: ["Batts", "Spray foam", "Blown-in", "Air seal"],
  drywall: ["Hang", "Tape", "Skim / plaster", "Sand"],
  plaster: ["Blueboard", "Skim coat", "Finish"],
  roofing: ["Tear-off", "Ice & water / underlayment", "Shingles", "Flashing & vents"],
  siding: ["Housewrap", "Trim", "Siding", "Caulk & touch-up"],
  excavation: ["Dig", "Backfill", "Grading", "Drainage"],
  concrete: ["Forms", "Rebar", "Pour", "Strip forms"],
  masonry: ["Layout", "Block / brick", "Veneer", "Pointing"],
  landscaping: ["Grading", "Plantings", "Hardscape", "Cleanup"],
};

// Ends every list — the things the office most wants to hear either way.
const COMMON_TAGS = ["Service call", "Punch list", "Waiting on parts", "Finished on this job"];

const DEFAULT_TAGS = ["Demo", "Rough-in", "Finish work", "Ready for inspection"];

const MAX_TAGS = 12;

/** Chips for a sub with these trades, in trade order, deduped, capped. */
export function workTagsFor(trades: string[]): string[] {
  const out: string[] = [];
  const push = (t: string) => {
    if (!out.includes(t) && out.length < MAX_TAGS) out.push(t);
  };
  // Walk the table in ITS order, not the sub's trade order, so a
  // "heating, plumbing" record still leads with the plumbing chips.
  const wanted = trades.map((t) => t.toLowerCase().trim());
  let matched = false;
  for (const [key, list] of Object.entries(TRADE_TAGS)) {
    if (!wanted.some((w) => w === key || w.includes(key))) continue;
    matched = true;
    list.forEach(push);
  }
  if (!matched) DEFAULT_TAGS.forEach(push);
  COMMON_TAGS.forEach(push);
  return out;
}
