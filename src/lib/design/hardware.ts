/**
 * Hardware finish.
 *
 * Every metal in a bathroom is normally one finish — the faucet, the shower
 * trim, the glass hardware, the cabinet pulls and the towel bar all match. So
 * it's a single room-level choice with a per-fixture override for the odd case
 * (a black filler on a brass room), rather than a colour on every part.
 */

import type { RoomSpec, Fixture } from "@/types/design";

export type HardwareFinish =
  | "chrome"
  | "brushed_nickel"
  | "matte_black"
  | "brushed_brass"
  | "bronze";

export interface MetalLook {
  color: string;
  roughness: number;
  metalness: number;
}

/**
 * Real PBR values, not just tints. Matte black is barely metallic and quite
 * rough; polished chrome is a mirror. Using the same roughness for both is what
 * makes rendered fixtures look like plastic.
 */
export const HARDWARE_LOOKS: Record<HardwareFinish, MetalLook> = {
  chrome: { color: "#c9cdd0", roughness: 0.12, metalness: 0.96 },
  brushed_nickel: { color: "#b9bab5", roughness: 0.36, metalness: 0.88 },
  matte_black: { color: "#2b2b2d", roughness: 0.62, metalness: 0.35 },
  brushed_brass: { color: "#b9975b", roughness: 0.34, metalness: 0.9 },
  bronze: { color: "#6b4b32", roughness: 0.48, metalness: 0.75 },
};

export const HARDWARE_LABELS: Record<HardwareFinish, string> = {
  chrome: "Chrome",
  brushed_nickel: "Brushed nickel",
  matte_black: "Matte black",
  brushed_brass: "Brushed brass",
  bronze: "Bronze",
};

export const HARDWARE_ORDER: HardwareFinish[] = [
  "chrome",
  "brushed_nickel",
  "matte_black",
  "brushed_brass",
  "bronze",
];

/** The finish a given fixture's metal should use. */
export function metalFor(spec: RoomSpec, fixture?: Fixture | null): MetalLook {
  const override = fixture?.options?.hardware;
  const key = (typeof override === "string" ? override : spec.hardware) ?? "chrome";
  return HARDWARE_LOOKS[key as HardwareFinish] ?? HARDWARE_LOOKS.chrome;
}
