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
