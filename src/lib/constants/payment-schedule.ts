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

/**
 * Every schedule ends with a holdback released only after final inspection
 * and the punch list are complete.
 *
 * The old presets ran the last payment at a third of the job, which meant the
 * client had effectively paid in full at substantial completion and the punch
 * list was chased with nothing outstanding. A 10% retainer is the standard
 * residential holdback: big enough that the last visit gets scheduled, small
 * enough that Penney is not financing the job.
 */
export const FINAL_HOLDBACK_PCT = 10;

const HOLDBACK_ROW: PaymentPresetRow = {
  label: "Final payment (10% holdback) — released after final inspection and punch list are complete",
  stage_key: "final_inspection",
  percent: FINAL_HOLDBACK_PCT,
};

export const PAYMENT_PRESETS: PaymentPreset[] = [
  {
    key: "thirds",
    name: "Standard (deposit / mid / completion / 10% holdback)",
    description: "The standard small-job split, with 10% held back until final inspection.",
    rows: [
      { label: "Deposit — upon signing (initiates permitting, scheduling, and material orders)", stage_key: "deposit", percent: 33.3 },
      { label: "Mid-project — structure framed and weathertight", stage_key: "weathertight", percent: 30 },
      { label: "Substantial completion — work complete and site cleaned", stage_key: "substantial_completion", percent: 26.7 },
      HOLDBACK_ROW,
    ],
  },
  {
    key: "rough_final",
    name: "Inspection-based (deposit / rough / completion / 10% holdback)",
    description: "Progress payments released on inspections, 10% held to the end.",
    rows: [
      { label: "Deposit — upon signing (initiates permitting, scheduling, and material orders)", stage_key: "deposit", percent: 33.3 },
      { label: "Rough inspections passed (frame, rough electrical / plumbing as applicable)", stage_key: "rough_inspection", percent: 30 },
      { label: "Substantial completion — work complete and site cleaned", stage_key: "substantial_completion", percent: 26.7 },
      HOLDBACK_ROW,
    ],
  },
  {
    key: "five_stage",
    name: "Large job (6 payments, 10% holdback)",
    description: "Bigger jobs — smaller draws tied to each build stage.",
    rows: [
      { label: "Deposit — upon signing", stage_key: "deposit", percent: 20 },
      { label: "Footings poured and inspected", stage_key: "footings", percent: 15 },
      { label: "Framing complete + rough inspections passed", stage_key: "rough_inspection", percent: 25 },
      { label: "Weathertight — roof and exterior complete", stage_key: "weathertight", percent: 20 },
      { label: "Substantial completion — work complete and site cleaned", stage_key: "substantial_completion", percent: 10 },
      HOLDBACK_ROW,
    ],
  },
];
