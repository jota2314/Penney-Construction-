// "What got done" chips for the sub portal — picked by the FIRST trade on
// the sub's directory record so a plumber sees plumbing words and an
// electrician sees electrical ones. Kept short on purpose: a handful of
// taps, not a form.

const TRADE_TAGS: Record<string, string[]> = {
  plumbing: ["Rough-in", "Drain / waste / vent", "Water lines", "Gas line", "Fixture set", "Water heater"],
  heating: ["Boiler / furnace", "Baseboard / radiant", "Mini split", "Gas line", "Startup & test"],
  hvac: ["Ductwork", "Equipment set", "Line set", "Startup & test"],
  electrical: ["Rough wire", "Panel / service", "Devices & trim", "Fixtures", "Low voltage"],
  painting: ["Prep & patch", "Prime", "First coat", "Final coat", "Trim & doors"],
  tile: ["Prep / backer", "Waterproofing", "Floor tile", "Wall tile", "Grout & seal"],
  flooring: ["Prep / underlayment", "Install", "Sand", "Finish coats"],
  insulation: ["Batts", "Spray foam", "Blown-in", "Air seal"],
  drywall: ["Hang", "Tape", "Skim / plaster", "Sand"],
  plaster: ["Blueboard", "Skim coat", "Finish"],
  roofing: ["Tear-off", "Underlayment", "Shingles", "Flashing & vents"],
  siding: ["Housewrap", "Trim", "Siding", "Caulk & touch-up"],
  excavation: ["Dig", "Backfill", "Grading", "Drainage"],
  concrete: ["Forms", "Rebar", "Pour", "Strip forms"],
  masonry: ["Layout", "Block / brick", "Veneer", "Pointing"],
  landscaping: ["Grading", "Plantings", "Hardscape", "Cleanup"],
};

// Ends every list — the things the office most wants to hear either way.
const COMMON_TAGS = ["Ready for inspection", "Waiting on parts", "Finished here"];

const DEFAULT_TAGS = ["Demo", "Rough-in", "Finish work"];

/** Chips for a sub with these trades: the first matching trade's list, then the common tail. */
export function workTagsFor(trades: string[]): string[] {
  const wanted = trades.map((t) => t.toLowerCase().trim());
  const key = Object.keys(TRADE_TAGS).find((k) => wanted.some((w) => w === k || w.includes(k)));
  const base = key ? TRADE_TAGS[key] : DEFAULT_TAGS;
  const out: string[] = [];
  for (const t of [...base, ...COMMON_TAGS]) if (!out.includes(t)) out.push(t);
  return out;
}
