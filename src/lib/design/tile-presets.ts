/**
 * One-click tile catalogue.
 *
 * The photo route is the accurate one — shoot the actual sample and the swatch
 * is that product. But most of the time a design starts before anyone has
 * chosen a specific tile, and photographing something just to get a placeholder
 * is friction. These are the tiles that actually get specified on North Shore
 * bathrooms, at their real sizes, so a room can be dressed in one click and
 * swapped for the real product later.
 *
 * Every entry carries a TRUE product size and joint width, because those drive
 * the texture repeat and the takeoff. A preset with a made-up size would put a
 * believable but wrong quantity on the Quantities tab, which is worse than no
 * preset at all.
 */

import type { DesignMaterial, TilePattern, TileFinish } from "@/types/design";

export interface TilePreset {
  key: string;
  name: string;
  /** Short grouping for the picker. */
  group: "Wall tile" | "Floor tile" | "Stone & slab" | "Paint";
  kind: DesignMaterial["kind"];
  tileWidthIn?: number;
  tileHeightIn?: number;
  groutWidthIn?: number;
  groutColor?: string;
  pattern?: TilePattern;
  baseColor: string;
  roughness: number;
  metalness?: number;
  finish?: TileFinish;
  /** Shown under the swatch so the size is obvious before you click. */
  blurb: string;
}

export const TILE_PRESETS: TilePreset[] = [
  // ── Wall ───────────────────────────────────────────────────────────────────
  {
    key: "subway-white-running",
    name: "White 3x12 subway",
    group: "Wall tile",
    kind: "tile",
    tileWidthIn: 3,
    tileHeightIn: 12,
    // Rectified subway is set tight; 1/16 is what actually gets used.
    groutWidthIn: 0.0625,
    groutColor: "#dedad2",
    pattern: "running",
    baseColor: "#f6f4f0",
    roughness: 0.18,
    finish: "polished",
    blurb: "3x12 · running bond · light grout",
  },
  {
    key: "subway-white-vertical",
    name: "White 3x12 stacked vertical",
    group: "Wall tile",
    kind: "tile",
    tileWidthIn: 3,
    tileHeightIn: 12,
    groutWidthIn: 0.0625,
    groutColor: "#dedad2",
    pattern: "vertical_stack",
    baseColor: "#f6f4f0",
    roughness: 0.18,
    finish: "polished",
    blurb: "3x12 · stacked vertical",
  },
  {
    key: "handmade-4x12",
    name: "Handmade 4x12, sea salt",
    group: "Wall tile",
    kind: "tile",
    tileWidthIn: 4,
    tileHeightIn: 12,
    // Handmade tile is irregular, so it needs a wider joint.
    groutWidthIn: 0.1875,
    groutColor: "#d5cfc3",
    pattern: "running",
    baseColor: "#eef0ec",
    roughness: 0.22,
    finish: "satin",
    blurb: "4x12 · 3/16 joint · uneven glaze",
  },
  {
    key: "herringbone-2x8",
    name: "2x8 herringbone, bone",
    group: "Wall tile",
    kind: "tile",
    tileWidthIn: 2,
    tileHeightIn: 8,
    groutWidthIn: 0.0625,
    groutColor: "#ddd8ce",
    pattern: "herringbone",
    baseColor: "#f1ede4",
    roughness: 0.25,
    finish: "satin",
    blurb: "2x8 · herringbone · 15% waste",
  },

  // ── Floor ──────────────────────────────────────────────────────────────────
  {
    key: "carrara-12x24",
    name: "Carrara-look 12x24",
    group: "Floor tile",
    kind: "tile",
    tileWidthIn: 12,
    tileHeightIn: 24,
    groutWidthIn: 0.0625,
    groutColor: "#dcd9d3",
    pattern: "running",
    baseColor: "#eeece8",
    roughness: 0.16,
    finish: "polished",
    blurb: "12x24 · marble-look porcelain",
  },
  {
    key: "greige-12x24",
    name: "Greige 12x24 matte",
    group: "Floor tile",
    kind: "tile",
    tileWidthIn: 12,
    tileHeightIn: 24,
    groutWidthIn: 0.125,
    groutColor: "#b8b2a8",
    pattern: "running",
    baseColor: "#cdc7bc",
    roughness: 0.62,
    finish: "matte",
    blurb: "12x24 · warm grey · matte",
  },
  {
    key: "charcoal-12x24",
    name: "Charcoal 12x24 matte",
    group: "Floor tile",
    kind: "tile",
    tileWidthIn: 12,
    tileHeightIn: 24,
    groutWidthIn: 0.125,
    groutColor: "#5c5a57",
    pattern: "running",
    baseColor: "#4a4947",
    roughness: 0.68,
    finish: "matte",
    blurb: "12x24 · dark · matte",
  },
  {
    key: "wood-plank-6x36",
    name: "Wood-look 6x36 plank",
    group: "Floor tile",
    kind: "tile",
    tileWidthIn: 6,
    tileHeightIn: 36,
    groutWidthIn: 0.125,
    groutColor: "#9e8b74",
    pattern: "running",
    baseColor: "#a9855c",
    roughness: 0.72,
    finish: "textured",
    blurb: "6x36 · plank · running bond",
  },
  {
    key: "hex-mosaic-2",
    name: "2\" mosaic, white",
    group: "Floor tile",
    kind: "tile",
    // Drawn as a 2x2 field; the engine has no hex bond, so this reads as a
    // small-format mosaic rather than a true hex. Size and count are right.
    tileWidthIn: 2,
    tileHeightIn: 2,
    groutWidthIn: 0.125,
    groutColor: "#d8d4cb",
    pattern: "stack",
    baseColor: "#f4f2ed",
    roughness: 0.3,
    finish: "satin",
    blurb: "2x2 mosaic · lots of grout",
  },

  // ── Slab & paint ───────────────────────────────────────────────────────────
  {
    key: "quartz-white",
    name: "White quartz slab",
    group: "Stone & slab",
    kind: "stone",
    baseColor: "#efeeea",
    roughness: 0.2,
    finish: "polished",
    blurb: "Counter / cap · no joints",
  },
  {
    key: "soapstone",
    name: "Soapstone slab",
    group: "Stone & slab",
    kind: "stone",
    baseColor: "#3f4442",
    roughness: 0.35,
    finish: "honed",
    blurb: "Counter / cap · dark honed",
  },
  {
    key: "paint-warm-white",
    name: "Warm white paint",
    group: "Paint",
    kind: "paint",
    baseColor: "#f2efe8",
    roughness: 0.92,
    blurb: "Walls above tile / ceiling",
  },
  {
    key: "paint-deep-green",
    name: "Deep green paint",
    group: "Paint",
    kind: "paint",
    baseColor: "#3c4a41",
    roughness: 0.9,
    blurb: "Accent walls / vanity",
  },
];

/** Turns a preset into a palette material with a unique id. */
export function presetToMaterial(preset: TilePreset, existingIds: string[]): DesignMaterial {
  let id = `mat-${preset.key}`;
  let n = 2;
  while (existingIds.includes(id)) id = `mat-${preset.key}-${n++}`;

  return {
    id,
    name: preset.name,
    kind: preset.kind,
    tileWidthIn: preset.tileWidthIn ?? null,
    tileHeightIn: preset.tileHeightIn ?? null,
    groutWidthIn: preset.groutWidthIn ?? 0.125,
    groutColor: preset.groutColor ?? "#cfcabf",
    pattern: preset.pattern ?? "stack",
    baseColor: preset.baseColor,
    roughness: preset.roughness,
    metalness: preset.metalness ?? 0,
    finish: preset.finish ?? null,
    sourcePhotoPath: null,
    texturePath: null,
  };
}

export const PRESET_GROUPS = [
  "Wall tile",
  "Floor tile",
  "Stone & slab",
  "Paint",
] as const;
