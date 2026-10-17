import { isMaterialSupplier } from "@/lib/finance/spend-category";

/**
 * Phase name → trade, in the words subcontractors.trades already uses.
 *
 * The schedule names work the way the office talks ("Demo", "Blueboard &
 * plaster", "Heat: bathroom baseboard"); the sub directory files people under
 * lowercased trades ("demolition", "plaster", "heating"). This is the one
 * translation between the two, used by the sub portal (today's trade chip),
 * the Subs needed sheet and the board's suggestion chips (which sub does this
 * kind of work), and the inspection route (is this inspection his).
 *
 * Pure and client-safe. It never looks at people's names: a phase that says
 * "Marcio" is not a tile phase because of it.
 *
 * Built from the live vocabulary on 10/16: 85 distinct trades on 169 subs and
 * every phase name active from 9/16 to 12/15.
 */

/** Work that isn't anybody's trade: orders, deliveries, money, site services, visits. */
const NON_WORK_START =
  /^\s*(order|orders|delivery|deliver|deliveries|selection|selections|payment|draw|pick ?up|permit|building permit|architect|engineer|substantial completion|final inspections?|milestone|contract|pre-?con|materials?|site walk|change order #?\s*\d*\s*signed)\b/i;
const NON_WORK_ANYWHERE =
  /\b(delivery|delivered|dumpsters?|portable (toilet|restroom)s?|porta[- ]?(john|potty)|jiffy|walk-?through|walk with|general conditions|general job costs|all costs|supervision|tools (&|and) equipment|vehicle (&|and) trailer|needs allocation|shop labor|non-billable|site protection|dust (control|containment)|weather protection|protection (&|and) (final clean\w*|cleanup|daily cleanup|setup)|selection due|pick ?up at|picks up|supplier arrival|debris hauling|crew booking|decision|owner supply|supply allowance|supply \(allowance|owner['’]?s (trades|fabricator|order)|client['’]?s \w+)\b/i;
const PROTECTION_ONLY = /^\s*protection\s*$/i;

/**
 * True for a schedule line nobody is booked to do: an order, a delivery, a
 * selection or payment milestone, a dumpster, a walkthrough, overhead rows.
 */
export function isNonWorkPhaseName(name: string | null | undefined): boolean {
  const n = (name ?? "").trim();
  if (!n) return true;
  return NON_WORK_START.test(n) || NON_WORK_ANYWHERE.test(n) || PROTECTION_ONLY.test(n);
}

interface TradeRule {
  trade: string;
  pattern: RegExp;
}

/**
 * Rule order only breaks ties. The trade whose words appear EARLIEST in the
 * name wins, so "Finish Electrical & Plumbing" is electrical, "Roofing —
 * Tear-off" is roofing and "Spray foam: roof slopes" is insulation.
 */
const PHASE_RULES: TradeRule[] = [
  { trade: "demolition", pattern: /\bdemo(lition|lish\w*)?\b/i },
  { trade: "excavation", pattern: /\bexcavat\w*|\bsite ?work\b|\btrench\w*|\bgrading\b|\bdig\b/i },
  { trade: "foundation", pattern: /\bfootings?\b|\bfoundations?\b|\bhelical\b|\bpiers?\b/i },
  { trade: "concrete", pattern: /\bconcrete\b|\bslab\b|\bpour\b|\bflatwork\b|\bstrip forms\b/i },
  { trade: "masonry", pattern: /\bmasonry\b|\bbrick\w*|\bchimney\b|\bstucco\b|\bretaining wall|\bpatio\b|\bstone ?wall/i },
  { trade: "hvac", pattern: /\bhvac\b|\bmechanical\b|\bmini[- ]?splits?\b|\bheat pump\b|\bduct(work|s)?\b|\bline ?set\b/i },
  { trade: "heating", pattern: /\bheat\b|\bheating\b|\bboiler\b|\bfurnace\b|\bradiant\b|\bbaseboard heat/i },
  { trade: "plumbing", pattern: /\bplumb\w*|\bvalve\b|\btoilets?\b|\btub\b|\bwater heater\b|\brepipe\b|\bgas line\b|\bwaste (line|pipe|main)\b|\bcast iron\b|\bsewer\b/i },
  { trade: "electrical", pattern: /\belectric\w*|\bwiring\b|\brecessed\b|\bhome ?runs?\b|\bgfci\b|\bsmoke (&|and) co\b|\blight fixtures?\b|\bbreaker\b|\bservice upgrade\b|\bexhaust fan\b|\bbath fan\b/i },
  { trade: "insulation", pattern: /\binsulat\w*|\bspray ?foam\b|\bair[- ]?seal\w*|\bfire ?stop\w*/i },
  { trade: "framing", pattern: /\bfram\w*|\bblocking\b|\bsheathing\b|\bheaders?\b|\bjoists?\b|\brafters?\b|\bsubfloor\b|\bsteel beam\b|\bbeams?\b|\blally\b|\bledger\b|\bsills?\b|\bknee ?walls?\b/i },
  { trade: "roofing", pattern: /\broof\w*|\bshingles?\b|\bre-?roof\b/i },
  { trade: "siding", pattern: /\bsiding\b|\bexterior trim\b|\bfascia\b|\bsoffits?\b|\bclapboards?\b|\bhouse ?wrap\b/i },
  { trade: "gutters", pattern: /\bgutters?\b|\bdownspouts?\b/i },
  { trade: "garage_doors", pattern: /\bgarage doors?\b|\boverhead doors?\b/i },
  { trade: "windows", pattern: /\bwindows?\b|\bskylights?\b|\bawning\b/i },
  { trade: "glass", pattern: /\bshower (glass|doors?)\b|\bglass\b|\bmirrors? install/i },
  { trade: "doors", pattern: /\bdoors?\b/i },
  { trade: "tile", pattern: /\btile\w*|\bbacksplash\b|\bgrout\b|\bgo ?board\b|\bshower (pan|base|curb)\b|\btub surround\b|\bheated (floor )?mat\b/i },
  { trade: "countertops", pattern: /\bcounter ?tops?\b|\bquartz\b|\bgranite\b|\bstone ?works?\b/i },
  { trade: "cabinetry", pattern: /\bcabinet\w*|\bvanity\b|\bvanities\b/i },
  { trade: "flooring", pattern: /\bfloor(ing|s)?\b|\bhardwood\b|\blvp\b|\blaminate\b|\bwhite oak\b|\bred oak\b|\bsand (&|and) finish\b/i },
  { trade: "plaster", pattern: /\bplaster\w*|\bblue ?board\b|\bskim\w*|\bveneer\b/i },
  { trade: "drywall", pattern: /\bdrywall\b|\bsheetrock\b|\btape (&|and) mud\b|\bmudding\b/i },
  { trade: "painting", pattern: /\bpaint\w*|\bstain(ing)?\b|\bprimer?\b/i },
  { trade: "decking", pattern: /\bdeck(s|ing)?\b|\brailings?\b|\bbalcony\b|\btimbertech\b|\bazek\b/i },
  { trade: "finish_carpentry", pattern: /\bfinish carpentry\b|\btrim\b|\bbaseboards?\b|\bcasings?\b|\bcrown\b|\bmou?ldings?\b|\bmillwork\b|\bbookcases?\b|\bbuilt-?ins?\b|\bstair (treads|risers)\b|\btreads\b|\b(drop-?down|attic) stairs?\b|\bbeadboard\b|\bwainscot\w*|\bchair rail\b/i },
  { trade: "carpentry", pattern: /\bcarpent\w*/i },
  { trade: "waterproofing", pattern: /\bwaterproof\w*/i },
  { trade: "landscaping", pattern: /\blandscap\w*|\bpaving\b|\bpavers?\b|\bloam\b|\bseed\b/i },
  { trade: "septic", pattern: /\bseptic\b|\btitle ?5\b/i },
];

/** Inspections are named by what the inspector signs off. */
const INSPECTION_RULES: TradeRule[] = [
  { trade: "foundation", pattern: /\bfootings?\b|\bfoundations?\b|\bpiers?\b|\blally\b/i },
  { trade: "plumbing", pattern: /\bplumb\w*|\bgas\b/i },
  { trade: "electrical", pattern: /\belectric\w*/i },
  { trade: "hvac", pattern: /\bmechanical\b|\bhvac\b|\bmini[- ]?splits?\b/i },
  { trade: "framing", pattern: /\bfram\w*/i },
  { trade: "insulation", pattern: /\binsulat\w*|\benergy\b|\bblower ?door\b/i },
];

function rankedMatches(name: string, rules: TradeRule[]): string[] {
  const hits: { trade: string; at: number; order: number }[] = [];
  rules.forEach((rule, order) => {
    const m = rule.pattern.exec(name);
    if (m) hits.push({ trade: rule.trade, at: m.index, order });
  });
  hits.sort((a, b) => a.at - b.at || a.order - b.order);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const h of hits) {
    if (seen.has(h.trade)) continue;
    seen.add(h.trade);
    out.push(h.trade);
  }
  return out;
}

const INSPECTION_WORD = /\binspections?\b/i;

/** Every trade an inspection covers, in name order: "Rough Electrical & Plumbing" → electrical, plumbing. */
export function tradesForInspectionName(name: string | null | undefined): string[] {
  const n = (name ?? "").trim();
  if (!n) return [];
  return rankedMatches(n, INSPECTION_RULES);
}

/**
 * The trade an inspection belongs to: "Rough plumbing inspection" → plumbing,
 * "Inspection — Rough Frame" → framing. A final building inspection is
 * nobody's trade (null). Combined inspections return the first trade named;
 * use `tradesForInspectionName` to check them all.
 */
export function tradeForInspectionName(name: string | null | undefined): string | null {
  return tradesForInspectionName(name)[0] ?? null;
}

/** Every trade a phase name mentions, earliest first. Empty for non-work rows. */
export function tradesForPhaseName(name: string | null | undefined): string[] {
  const n = (name ?? "").trim();
  if (!n || isNonWorkPhaseName(n)) return [];
  if (INSPECTION_WORD.test(n)) return tradesForInspectionName(n);
  return rankedMatches(n, PHASE_RULES);
}

/**
 * The trade a phase is: "Demo" / "Demolition" → demolition, "Tile: pan, Go
 * Board…" → tile, "Blueboard & Plaster" → plaster. Null when the name names no
 * trade ("Punch list & final clean") or isn't work at all ("Order — Tile").
 */
export function tradeForPhaseName(name: string | null | undefined): string | null {
  return tradesForPhaseName(name)[0] ?? null;
}

// ── The directory side ──────────────────────────────────────────

/** Directory spellings folded onto one trade. Anything unlisted stays as typed (lowercased). */
const CANONICAL: Record<string, string> = {
  demo: "demolition",
  cleanout: "demolition",
  radiant_heating: "heating",
  boiler: "heating",
  mechanical: "hvac",
  plastering: "plaster",
  veneer_plaster: "plaster",
  deck: "decking",
  decks: "decking",
  railings: "decking",
  hardwood_flooring: "flooring",
  floors: "flooring",
  paint: "painting",
  painter: "painting",
  shower_doors: "glass",
  glazing: "glass",
  stonework: "masonry",
  retaining_walls: "masonry",
  site_work: "excavation",
  millwork: "finish_carpentry",
  exterior_trim: "siding",
  cabinets: "cabinetry",
  helical_piers: "foundation",
  roofer: "roofing",
  electrician: "electrical",
  plumber: "plumbing",
};

/** One spelling per trade: "Hardwood Flooring" → flooring, "radiant_heating" → heating. */
export function normalizeTrade(raw: string | null | undefined): string | null {
  const key = (raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s/-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  if (!key) return null;
  return CANONICAL[key] ?? key;
}

/** Trades close enough that a sub filed under one does the other. */
const RELATED: Record<string, string[]> = {
  heating: ["heating", "hvac"],
  hvac: ["hvac", "heating"],
  plaster: ["plaster", "drywall"],
  drywall: ["drywall", "plaster"],
  carpentry: ["carpentry", "finish_carpentry"],
  finish_carpentry: ["finish_carpentry", "carpentry"],
  concrete: ["concrete", "foundation"],
  foundation: ["foundation", "concrete"],
  landscaping: ["landscaping", "paving"],
  paving: ["paving", "landscaping"],
};

/** The directory trades that count as doing `trade`. */
export function tradeGroup(trade: string | null | undefined): string[] {
  const t = normalizeTrade(trade);
  if (!t) return [];
  return RELATED[t] ?? [t];
}

/** Does a sub with these directory trades do this kind of work? */
export function subDoesTrade(
  subTrades: readonly (string | null | undefined)[] | null | undefined,
  trade: string | null | undefined,
): boolean {
  const group = tradeGroup(trade);
  if (!group.length || !subTrades?.length) return false;
  return subTrades.some((t) => {
    const n = normalizeTrade(t);
    return !!n && group.includes(n);
  });
}

/**
 * Is this inspection his trade? Every trade the name covers counts ("Rough
 * electrical & plumbing" is the electrician's and the plumber's), with the
 * related trades (heating ↔ hvac). A final or building inspection names no
 * trade, so it is nobody's. The one rule for the sub portal: the job
 * payload's my_trade, the Dates inspection rows and the inspections route
 * all use it, so a button that shows is a button that saves.
 */
export function subDoesInspection(
  subTrades: readonly (string | null | undefined)[] | null | undefined,
  inspectionName: string | null | undefined,
): boolean {
  return tradesForInspectionName(inspectionName).some((trade) => subDoesTrade(subTrades, trade));
}

/**
 * A free-text trade (quote or invoice rows: "windows, doors", "framing_-_labor")
 * as the trades it names.
 */
export function tradesInText(raw: string | null | undefined): string[] {
  const parts = (raw ?? "")
    .split(/,|&|\/|\band\b|_-_/i)
    .map((p) => normalizeTrade(p.replace(/\b(labor|materials?|supply|install)\b/gi, "")))
    .filter((p): p is string => !!p);
  return Array.from(new Set(parts));
}

/** Does a quote/invoice trade field name this kind of work? */
export function textNamesTrade(raw: string | null | undefined, trade: string | null | undefined): boolean {
  const group = tradeGroup(trade);
  if (!group.length) return false;
  return tradesInText(raw).some((t) => group.includes(t));
}

const LABELS: Record<string, string> = {
  demolition: "Demolition",
  hvac: "HVAC",
  finish_carpentry: "Finish carpentry",
  garage_doors: "Garage doors",
  countertops: "Countertops",
  cabinetry: "Cabinets",
  glass: "Shower glass",
};

/**
 * A client-safe name for the trade, fit for a schedule row a homeowner might
 * see: "Demolition", "Tile", "HVAC". Never a person or company.
 */
export function tradeLabel(trade: string | null | undefined): string {
  const t = normalizeTrade(trade);
  if (!t) return "Sub work";
  if (LABELS[t]) return LABELS[t];
  const words = t.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Directory trades that mean "sells or designs", not "installs". A sub filed
 * only under these never gets booked onto work: suggestions skip them.
 */
const NON_INSTALLER_TRADES = new Set([
  "lumber",
  "materials",
  "building_materials",
  "lumber_&_materials",
  "decking_material",
  "exterior_materials",
  "plumbing_supplier",
  "plumbing_fixtures",
  "showroom",
  "hardware",
  "printing",
  "admin_printing",
  "apparel",
  "phone_service_vendor",
  "staffing",
  "dumpster",
  "disposal",
  "staging_rental",
  "architect",
  "architecture",
  "engineering",
  "surveying",
  "consulting",
  "kitchen_design",
  "interior_design",
]);

/** "lumber", "kitchen_design", "architect": a trade that sells or designs rather than installs. */
export function isNonInstallerTrade(trade: string | null | undefined): boolean {
  const t = normalizeTrade(trade);
  return !!t && NON_INSTALLER_TRADES.has(t);
}

/**
 * A material dealer or a non-installing vendor: the lumberyard, the supply
 * house, the architect. `isMaterialSupplier` decides by name (Jackson Lumber,
 * Building Center of Gloucester); a sub whose every trade is a supply or
 * design trade is out too.
 */
export function isNonInstallerSub(sub: {
  company_name?: string | null;
  trades?: readonly (string | null | undefined)[] | null;
}): boolean {
  if (isMaterialSupplier(sub.company_name)) return true;
  const trades = (sub.trades ?? []).map((t) => normalizeTrade(t)).filter((t): t is string => !!t);
  return trades.length > 0 && trades.every((t) => NON_INSTALLER_TRADES.has(t));
}
