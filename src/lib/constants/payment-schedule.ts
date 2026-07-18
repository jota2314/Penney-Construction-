// Payment schedule stages + one-click presets.
//
// stage_key values line up loosely with the 13-stage workflow pipeline
// (rough inspection, final inspection, ...) so milestone-based schedules
// like "deposit / rough / final" read the same way everywhere in the app.

export const PAYMENT_STAGE_OPTIONS = [
  { key: "deposit", label: "Deposit — upon signing" },
  { key: "start", label: "Start of work / mobilization" },
  { key: "footings", label: "Footings poured + inspected" },
  { key: "framing", label: "Framing complete" },
  { key: "rough_inspection", label: "Rough inspections passed" },
  { key: "weathertight", label: "Weathertight (roof + exterior)" },
  { key: "insulation", label: "Insulation / close-in inspection" },
  { key: "substantial_completion", label: "Substantial completion" },
  { key: "final_inspection", label: "Final inspection + punch list" },
  { key: "custom", label: "Custom milestone" },
] as const;

export type PaymentStageKey = (typeof PAYMENT_STAGE_OPTIONS)[number]["key"];

export interface PaymentPresetRow {
  label: string;
  stage_key: PaymentStageKey;
  percent: number;
}

export interface PaymentPreset {
  key: string;
  name: string;
  description: string;
  rows: PaymentPresetRow[];
}

// MA home improvement law (M.G.L. c.142A): the deposit may not exceed
// one-third of the contract price (except special-order materials). Every
// preset keeps the deposit at or under 33.33%.
export const MA_DEPOSIT_CAP_PCT = 33.34;

export const PAYMENT_PRESETS: PaymentPreset[] = [
  {
    key: "thirds",
    name: "Thirds (3 payments)",
    description: "Deposit / mid-project / final — the standard small-job split.",
    rows: [
      { label: "Deposit — upon signing (initiates permitting, scheduling, and material orders)", stage_key: "deposit", percent: 33.3 },
      { label: "Mid-project milestone — structure framed and weathertight", stage_key: "weathertight", percent: 33.3 },
      { label: "Substantial completion / final (punch list, final inspection and cleanup)", stage_key: "substantial_completion", percent: 33.4 },
    ],
  },
  {
    key: "rough_final",
    name: "Deposit / rough / final",
    description: "Progress payments released on inspections.",
    rows: [
      { label: "Deposit — upon signing (initiates permitting, scheduling, and material orders)", stage_key: "deposit", percent: 33.3 },
      { label: "Rough inspections passed (frame, rough electrical / plumbing as applicable)", stage_key: "rough_inspection", percent: 33.3 },
      { label: "Final inspection passed + substantial completion", stage_key: "final_inspection", percent: 33.4 },
    ],
  },
  {
    key: "five_stage",
    name: "5 milestones (inspection-based)",
    description: "Larger jobs — smaller draws tied to each build stage.",
    rows: [
      { label: "Deposit — upon signing", stage_key: "deposit", percent: 20 },
      { label: "Footings poured and inspected", stage_key: "footings", percent: 15 },
      { label: "Framing complete + rough inspections passed", stage_key: "rough_inspection", percent: 25 },
      { label: "Weathertight — roof and exterior complete", stage_key: "weathertight", percent: 20 },
      { label: "Final inspection + punch list complete", stage_key: "final_inspection", percent: 20 },
    ],
  },
];
