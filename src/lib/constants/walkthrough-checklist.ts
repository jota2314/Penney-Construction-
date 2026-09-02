/**
 * Walkthrough checklist — the questions a site walk has to answer before an
 * estimate can be priced from unit rates instead of carried as a lump.
 *
 * Two kinds of question:
 *  - fact: shapes the scope (toilet moves? W/D stays?). No allowance, but a
 *    blank means the scope bullets are a guess.
 *  - trigger: a condition that needs a sub's eyes or a named allowance.
 *    Answered yes or left unknown → applyChecklistAllowances() adds an
 *    allowance line costed from sub_unit_rates (rateCode) or defaultCost.
 *
 * Keyed by project type; "common" applies to every type.
 */

export type ChecklistAnswer = "yes" | "no" | "unknown";

export interface ChecklistQuestion {
  key: string;
  label: string;
  trade: "plumbing" | "electrical" | "hvac" | "structural" | "general";
  kind: "fact" | "trigger";
  /** For triggers: what the allowance line is called and what it costs. */
  allowance?: {
    item: string;
    rateCode?: string;
    defaultCost: number;
    /** Client-facing bullets for the proposal. */
    proposal: string;
  };
}

export type ChecklistAnswers = Record<string, { answer: ChecklistAnswer; note?: string }>;

const COMMON: ChecklistQuestion[] = [
  {
    key: "panel_amps",
    label: "Main panel is 100A or larger with open spaces for new circuits",
    trade: "electrical",
    kind: "trigger",
    allowance: {
      item: "Electrical panel upgrade",
      rateCode: "EL-17",
      defaultCost: 1700,
      proposal:
        "- Allowance to replace the existing panel with a 100A 30-space main breaker panel with surge protection\n- Carried until the electrician confirms panel space and capacity\n- Unused balance is credited back",
    },
  },
  {
    key: "service_feed",
    label: "Service feed matches the panel (not a 60A feed on a 100A panel)",
    trade: "electrical",
    kind: "trigger",
    allowance: {
      item: "Service feed evaluation",
      defaultCost: 1500,
      proposal:
        "- Allowance for the electrician to evaluate and correct the service feed to the unit\n- Scope and price confirmed on site before any work proceeds\n- Unused balance is credited back",
    },
  },
  {
    key: "knob_tube",
    label: "No knob-and-tube, aluminum, or fuse panel found",
    trade: "electrical",
    kind: "trigger",
    allowance: {
      item: "Legacy wiring remediation",
      rateCode: "EL-18",
      defaultCost: 1300,
      proposal:
        "- One crew day carried to make safe and refeed legacy wiring found in the work area\n- Anything beyond one day is priced by written change order\n- Unused balance is credited back",
    },
  },
  {
    key: "stack_material",
    label: "Main waste stack is PVC and in good condition (not cast iron / corroded)",
    trade: "plumbing",
    kind: "trigger",
    allowance: {
      item: "Waste stack repair",
      rateCode: "PL-29",
      defaultCost: 600,
      proposal:
        "- Allowance to replace a section of the existing waste stack if it is found corroded or cracked once opened\n- Confirmed by the plumber before work proceeds\n- Unused balance is credited back",
    },
  },
  {
    key: "concealed",
    label: "Walls/floors to be opened are original (pre-1960) or show water damage",
    trade: "structural",
    kind: "trigger",
    allowance: {
      item: "Concealed conditions",
      defaultCost: 1200,
      proposal:
        "- Allowance for rot, insect damage, or non-code framing found once walls and floors are opened\n- Anything found is photographed and reviewed with you before the work is done\n- Unused balance is credited back",
    },
  },
];

const BATHROOM: ChecklistQuestion[] = [
  { key: "toilet_moves", label: "Toilet stays in its current location", trade: "plumbing", kind: "fact" },
  {
    key: "joists_vs_toilet",
    label: "If the toilet moves, the new drain runs with the joists (not across them)",
    trade: "plumbing",
    kind: "trigger",
    allowance: {
      item: "Toilet relocation across joists",
      defaultCost: 1200,
      proposal:
        "- Allowance to reroute the toilet drain where it has to cross floor joists\n- Confirmed by the plumber at rough-in\n- Unused balance is credited back",
    },
  },
  { key: "fixture_layout", label: "Tub/shower and vanity stay in their current locations", trade: "plumbing", kind: "fact" },
  {
    key: "vent_path",
    label: "Existing vent is to code and reachable (no re-venting needed after gut)",
    trade: "plumbing",
    kind: "trigger",
    allowance: {
      item: "Additional vent work",
      defaultCost: 900,
      proposal:
        "- Allowance for vent work the plumber finds necessary once the walls are open\n- Unused balance is credited back",
    },
  },
  { key: "fan_vent", label: "Bath fan has a vent path to the exterior", trade: "hvac", kind: "fact" },
  { key: "floor_level", label: "Floor is level enough for tile with minor leveling", trade: "structural", kind: "fact" },
  { key: "wd_stays", label: "Washer/dryer stays in place and stays connected during the job", trade: "plumbing", kind: "fact" },
  { key: "tub_material", label: "New tub is acrylic (not cast iron needing a crew to carry it up)", trade: "general", kind: "fact" },
  { key: "bath_heat", label: "Existing heat in the bathroom stays as is", trade: "hvac", kind: "fact" },
];

const KITCHEN: ChecklistQuestion[] = [
  { key: "sink_moves", label: "Sink stays on the same wall", trade: "plumbing", kind: "fact" },
  {
    key: "kitchen_waste",
    label: "Kitchen waste line to the stack is sound (no replacement needed)",
    trade: "plumbing",
    kind: "trigger",
    allowance: {
      item: "Kitchen waste line replacement",
      defaultCost: 500,
      proposal:
        "- Allowance to replace the kitchen waste line back to the stack if it is found deteriorated\n- Unused balance is credited back",
    },
  },
  { key: "range_fuel", label: "Range fuel is decided (gas or electric) and the line/circuit exists", trade: "plumbing", kind: "fact" },
  { key: "hood_vent", label: "Hood has a duct path to the exterior", trade: "hvac", kind: "fact" },
  { key: "island_power", label: "Island or peninsula receptacles have a path from below", trade: "electrical", kind: "fact" },
  { key: "cabinet_walls", label: "Walls receiving cabinets are plumb and not being moved", trade: "structural", kind: "fact" },
];

const BASEMENT: ChecklistQuestion[] = [
  {
    key: "under_slab",
    label: "New drains can tie in above the slab (no slab cut needed)",
    trade: "plumbing",
    kind: "trigger",
    allowance: {
      item: "Slab cut and repour for new drain",
      defaultCost: 2400,
      proposal:
        "- Allowance to saw-cut, trench, and repour the slab for new waste lines\n- Confirmed by the plumber once the drain route is set\n- Unused balance is credited back",
    },
  },
  {
    key: "ejector",
    label: "Gravity drain is available (no ejector pump needed)",
    trade: "plumbing",
    kind: "trigger",
    allowance: {
      item: "Sewage ejector pump",
      rateCode: "PL-09",
      defaultCost: 1200,
      proposal:
        "- Allowance for a sewage ejector pump if the new bath cannot drain by gravity\n- Unused balance is credited back",
    },
  },
  {
    key: "overhead_lines",
    label: "No heat/water lines hang below finished ceiling height",
    trade: "plumbing",
    kind: "trigger",
    allowance: {
      item: "Raise overhead lines",
      rateCode: "PL-26",
      defaultCost: 1000,
      proposal:
        "- Allowance to raise heat and water lines that hang below the new ceiling height\n- Unused balance is credited back",
    },
  },
  { key: "beam_columns", label: "Main beam and lally columns stay and get boxed in", trade: "structural", kind: "fact" },
  { key: "moisture", label: "No signs of water intrusion at the foundation", trade: "structural", kind: "fact" },
  { key: "egress", label: "Egress requirements are understood (bedroom vs rec room)", trade: "general", kind: "fact" },
];

const ADDITION: ChecklistQuestion[] = [
  {
    key: "service_relocate",
    label: "Water and electric services are outside the addition footprint",
    trade: "plumbing",
    kind: "trigger",
    allowance: {
      item: "Relocate water and electric service",
      defaultCost: 4500,
      proposal:
        "- Allowance to relocate the water service and electric service out of the addition footprint\n- Confirmed by the plumber and electrician after their site walk\n- Unused balance is credited back",
    },
  },
  {
    key: "footing_frost",
    label: "Existing structure being built on has a footing and frost wall",
    trade: "structural",
    kind: "trigger",
    allowance: {
      item: "New footing and frost wall",
      defaultCost: 6000,
      proposal:
        "- Allowance to replace an existing slab or pier base with a code footing and frost wall\n- Confirmed once the existing foundation is exposed\n- Unused balance is credited back",
    },
  },
  { key: "plot_plan", label: "Client has a plot plan in hand or ordered", trade: "general", kind: "fact" },
  { key: "hvac_capacity", label: "Existing HVAC can carry the added square footage", trade: "hvac", kind: "fact" },
];

export const WALKTHROUGH_CHECKLIST: Record<string, ChecklistQuestion[]> = {
  bathroom: [...COMMON, ...BATHROOM],
  kitchen: [...COMMON, ...KITCHEN],
  remodel: [...COMMON, ...BATHROOM.slice(0, 4), ...KITCHEN.slice(0, 3), ...BASEMENT.slice(0, 3)],
  addition: [...COMMON, ...ADDITION],
  new_construction: [...COMMON.slice(3), ...ADDITION.slice(2)],
  other: COMMON,
  deck: [],
  roofing: [],
  siding: [],
};

export function checklistFor(projectType: string | null | undefined): ChecklistQuestion[] {
  return WALKTHROUGH_CHECKLIST[projectType ?? "other"] ?? WALKTHROUGH_CHECKLIST.other;
}

/** Marker written into the allowance line's notes so we never add it twice. */
export function checklistLineMarker(key: string): string {
  return `[checklist:${key}]`;
}
