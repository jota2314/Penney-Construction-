import type { UnitType } from "@/types/database";

export const UNIT_TYPE_LABELS: Record<UnitType, string> = {
  sqft: "$/sqft",
  linear_ft: "$/LF",
  each: "$/each",
  lump_sum: "Lump Sum",
};

export const UNIT_TYPE_SHORT: Record<UnitType, string> = {
  sqft: "sqft",
  linear_ft: "LF",
  each: "ea",
  lump_sum: "LS",
};

export const UNIT_TYPE_OPTIONS: UnitType[] = [
  "sqft",
  "linear_ft",
  "each",
  "lump_sum",
];

export const TRADE_CATEGORIES = [
  "Plumbing",
  "Electrical",
  "Framing",
  "Demolition",
  "Dumpster",
  "Insulation",
  "Tile",
  "Plaster",
  "Painting",
  "Finish Carpentry",
  "Concrete",
  "HVAC",
  "Flooring",
  "Cabinets",
  "Windows & Doors",
  "Roofing",
  "Admin",
  "Materials — Lumber",
  "Materials — Sheathing",
  "Materials — Trim",
  "Materials — Decking",
  "Materials — Siding",
] as const;

export type TradeCategory = (typeof TRADE_CATEGORIES)[number];

// ── 22 standard residential-GC trades (display order = scope order) ──
export const REQUIRED_TRADES: { key: string; label: string; description: string }[] = [
  { key: "demolition",     label: "Demolition",                description: "Removal of existing walls, finishes, fixtures" },
  { key: "sitework",       label: "Site Work",                 description: "Excavation, grading, drainage, compaction" },
  { key: "concrete",       label: "Concrete",                  description: "Footings, foundation walls, slabs, piers" },
  { key: "framing",        label: "Framing",                   description: "Dimensional lumber: studs, plates, joists, rafters" },
  { key: "lvl_steel",      label: "LVL / Steel / Engineered",  description: "Engineered lumber, steel beams, columns, hangers" },
  { key: "sheathing",      label: "Sheathing",                 description: "Wall and roof sheathing" },
  { key: "roofing",        label: "Roofing",                   description: "Shingles, underlayment, flashing, ridge vent, drip edge" },
  { key: "windows",        label: "Windows",                   description: "All windows per schedule" },
  { key: "exterior_doors", label: "Exterior Doors",            description: "Entry and sliding doors per schedule" },
  { key: "siding",         label: "Siding",                    description: "Siding material per elevations" },
  { key: "exterior_trim",  label: "Exterior Trim",             description: "Fascia, soffit, corner boards, window/door trim" },
  { key: "gutters",        label: "Gutters",                   description: "Gutters and downspouts" },
  { key: "insulation",     label: "Insulation",                description: "Wall, floor, and attic insulation per assembly notes" },
  { key: "drywall",        label: "Drywall",                   description: "Walls and ceilings, tape, mud, finish" },
  { key: "interior_doors", label: "Interior Doors",            description: "All interior doors per schedule" },
  { key: "interior_trim",  label: "Interior Trim",             description: "Casing, base, crown, chair rail" },
  { key: "flooring",       label: "Flooring",                  description: "All flooring per finish schedule, room by room" },
  { key: "kitchen",        label: "Kitchen",                   description: "Cabinets, island, countertops, appliances, hood" },
  { key: "bathroom",       label: "Bathroom",                  description: "Vanities, toilets, tubs, showers, tile, fixtures" },
  { key: "painting",       label: "Painting",                  description: "Interior walls/ceilings, exterior, trim" },
  { key: "electrical",     label: "Electrical",                description: "Rough + fixtures + panel/service if noted" },
  { key: "plumbing",       label: "Plumbing",                  description: "Rough + fixtures + water heater" },
  { key: "hvac",           label: "HVAC",                      description: "Equipment, ducts, zones per notes" },
];

export const TRADE_KEY_TO_LABEL: Record<string, string> = Object.fromEntries(
  REQUIRED_TRADES.map(t => [t.key, t.label])
);

export const TRADE_KEYS = REQUIRED_TRADES.map(t => t.key);
