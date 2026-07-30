/**
 * RoomSpec — the single source of truth for a bathroom design.
 *
 * The same object drives three things, which is the whole point of modelling
 * real geometry instead of generating a picture: the 3D viewer draws it, the
 * takeoff measures it, and the photoreal renderer uses a capture of it as its
 * structural reference. Because they all read one spec, the pretty render and
 * the tile quantity can never disagree.
 *
 * ── UNITS ────────────────────────────────────────────────────────────────────
 * Every dimension in this file is INCHES. No exceptions, no mixed units. Inches
 * are what tape measures, tile catalogs, and Jorge's field notes use; three.js
 * conversion happens once at the render boundary, never in the data.
 *
 * ── COORDINATES ──────────────────────────────────────────────────────────────
 * Right-handed, Y up, origin at the finished-floor corner of the room.
 *
 *        x = 0                       x = room.width
 *   z = 0  ┌───────── BACK ──────────┐
 *          │                         │
 *        LEFT                      RIGHT
 *          │                         │
 *   z = L  └───────── FRONT ─────────┘
 *
 *   x runs left → right across the room
 *   z runs back → front (toward the viewer / the door)
 *   y runs floor → ceiling, y = 0 is the FINISHED floor
 *
 * By convention FRONT is the wall you enter through. That keeps conversational
 * instructions ("vanity on the left as you walk in") unambiguous.
 */

export type WallId = "back" | "front" | "left" | "right";

export const WALL_IDS: readonly WallId[] = ["back", "front", "left", "right"];

/** Human labels for the UI and for prompting the model. */
export const WALL_LABELS: Record<WallId, string> = {
  back: "Back wall",
  front: "Front wall (entry)",
  left: "Left wall",
  right: "Right wall",
};

// ── Materials ────────────────────────────────────────────────────────────────

export type MaterialKind =
  | "tile"
  | "paint"
  | "stone"
  | "wood"
  | "metal"
  | "glass"
  | "other";

export type TilePattern =
  | "stack"
  | "running"
  | "vertical_stack"
  | "herringbone"
  | "basketweave"
  | "none";

export type TileFinish = "matte" | "polished" | "honed" | "satin" | "textured";

/**
 * A finish, usually read off a photo of the real product.
 *
 * `tileWidthIn` / `tileHeightIn` are the true product dimensions and they are
 * load-bearing: they set the texture repeat so a 12x24 reads as a 12x24 in the
 * model, and they let the takeoff report a real piece count instead of a
 * decorative pattern that happens to look like tile.
 */
export interface DesignMaterial {
  id: string;
  name: string;
  kind: MaterialKind;

  /** Real product size, inches. Null for continuous finishes like paint. */
  tileWidthIn?: number | null;
  tileHeightIn?: number | null;
  groutWidthIn?: number;
  groutColor?: string;
  pattern?: TilePattern;

  /** Fallback colour used until a photo swatch exists. */
  baseColor: string;
  roughness?: number;
  metalness?: number;
  finish?: TileFinish | null;

  /** Storage paths in the `project-files` bucket. */
  sourcePhotoPath?: string | null;
  texturePath?: string | null;

  /** Signed URL, resolved at read time. Never persisted — these expire. */
  textureUrl?: string | null;
  sourcePhotoUrl?: string | null;
}

/** Points at a material in the design's palette. */
export type MaterialRef = string;

// ── Wall surfaces ────────────────────────────────────────────────────────────

/**
 * How one wall is finished.
 *
 * The wainscot split exists because it is the single most common real bathroom
 * condition: tile to some height, paint above. Modelling it as one material per
 * wall would force every design to be either fully tiled or fully painted.
 */
export interface WallFinish {
  /** Material from the floor up to `splitHeightIn` (or the full wall). */
  materialId: MaterialRef;
  /** Material above the split. Omit for a single-material wall. */
  upperMaterialId?: MaterialRef | null;
  /** Inches from finished floor. Only meaningful with `upperMaterialId`. */
  splitHeightIn?: number | null;
}

export type OpeningType = "door" | "window" | "niche" | "cased_opening";

/**
 * A hole in (or recess into) a wall.
 *
 * Positioned in the wall's own 2D frame: `u` runs along the wall from its left
 * end as seen from INSIDE the room facing it, `v` runs up from the floor. This
 * is how a person describes it on site ("niche starts 40 up, 18 off the corner")
 * and it keeps openings valid if the room is later resized.
 */
export interface WallOpening {
  id: string;
  type: OpeningType;
  /** Inches along the wall from its left end, to the opening's left edge. */
  uIn: number;
  /** Inches from finished floor to the opening's bottom edge. */
  vIn: number;
  widthIn: number;
  heightIn: number;
  /** Recess depth for niches. Ignored for doors and windows. */
  depthIn?: number;
  /** Niche interiors are usually tiled in an accent. */
  materialId?: MaterialRef | null;
  label?: string;
}

export interface WallSpec {
  id: WallId;
  finish: WallFinish;
  openings: WallOpening[];
  /** Marks a wet wall so the takeoff can separate shower tile from field tile. */
  isWet?: boolean;
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

export type FixtureType =
  | "vanity"
  | "toilet"
  | "tub"
  | "shower"
  | "mirror"
  | "medicine_cabinet"
  | "linen_cabinet"
  | "towel_bar"
  | "sconce"
  | "ceiling_light"
  | "radiator"
  | "bench";

/**
 * A placed object.
 *
 * `x` / `z` are the CENTRE of the fixture's footprint on the floor plan, and
 * `rotationDeg` turns it counter-clockwise about Y. At rotation 0 a fixture
 * faces FRONT (+z), i.e. its back is against the BACK wall — so "against the
 * back wall" needs no rotation, which is the common case.
 *
 * `widthIn` is measured across the fixture's face, `depthIn` front-to-back.
 */
export interface Fixture {
  id: string;
  type: FixtureType;
  label?: string;

  widthIn: number;
  depthIn: number;
  heightIn: number;

  x: number;
  z: number;
  /** Inches off the floor. Non-zero for wall-hung and floating pieces. */
  yIn?: number;
  rotationDeg?: number;

  /** Primary finish (cabinet colour, tub shell, metal trim). */
  materialId?: MaterialRef | null;
  /** Secondary finish, e.g. a vanity countertop. */
  accentMaterialId?: MaterialRef | null;
  color?: string | null;

  /** Type-specific detail; see FIXTURE_OPTION_HINTS for what each type reads. */
  options?: Record<string, string | number | boolean | null>;
}

/**
 * What `options` means per fixture type. Documented here rather than as a giant
 * discriminated union so the model can extend a fixture without a schema change,
 * and so the viewer can fall back to a sane default for anything unrecognised.
 */
export const FIXTURE_OPTION_HINTS: Partial<Record<FixtureType, string>> = {
  vanity: "sinks: 1|2, style: 'floating'|'freestanding', countertopThicknessIn",
  tub: "style: 'alcove'|'freestanding'|'drop_in', apron: boolean",
  shower: "enclosure: 'glass_panel'|'glass_door'|'curtain'|'open', curbHeightIn, hasBench",
  mirror: "shape: 'rect'|'round', frame: 'none'|'metal'|'wood'",
  toilet: "style: 'floor'|'wall_hung', oneOrTwoPiece: 1|2",
};

// ── The spec ─────────────────────────────────────────────────────────────────

export interface RoomDimensions {
  /** Left-to-right, inches. */
  widthIn: number;
  /** Back-to-front, inches. */
  lengthIn: number;
  /** Finished floor to finished ceiling, inches. */
  ceilingHeightIn: number;
}

export interface RoomSpec {
  /** Bumped on every accepted change so versions stay ordered. */
  version: number;
  name: string;
  room: RoomDimensions;
  walls: WallSpec[];
  floor: {
    materialId: MaterialRef;
    pattern?: TilePattern;
    /** Degrees; 45 gives a diagonal lay. */
    rotationDeg?: number;
  };
  ceiling: {
    materialId: MaterialRef;
  };
  fixtures: Fixture[];
  /** Every material referenced anywhere above. */
  materials: DesignMaterial[];
  /** Anything that matters but isn't geometry — client notes, open questions. */
  notes?: string;
  /**
   * Things the model inferred rather than was told. Surfaced in the UI so a
   * guessed dimension is never mistaken for a measured one.
   */
  assumptions?: string[];
}

// ── Defaults ─────────────────────────────────────────────────────────────────

/** Neutral starting palette so a brand-new design renders before any tile is chosen. */
export function defaultMaterials(): DesignMaterial[] {
  return [
    {
      id: "mat-floor",
      name: "Floor tile (unspecified)",
      kind: "tile",
      tileWidthIn: 12,
      tileHeightIn: 24,
      groutWidthIn: 0.125,
      groutColor: "#c9c4bb",
      pattern: "running",
      baseColor: "#cdc8c0",
      roughness: 0.55,
      metalness: 0,
      finish: "matte",
    },
    {
      id: "mat-wall-tile",
      name: "Wall tile (unspecified)",
      kind: "tile",
      tileWidthIn: 3,
      tileHeightIn: 12,
      groutWidthIn: 0.0625,
      groutColor: "#e6e2da",
      pattern: "running",
      baseColor: "#f2efe9",
      roughness: 0.35,
      metalness: 0,
      finish: "polished",
    },
    {
      id: "mat-paint",
      name: "Wall paint",
      kind: "paint",
      baseColor: "#eeeae3",
      roughness: 0.9,
      metalness: 0,
    },
    {
      id: "mat-ceiling",
      name: "Ceiling paint",
      kind: "paint",
      baseColor: "#fbfaf7",
      roughness: 0.95,
      metalness: 0,
    },
    {
      id: "mat-cabinet",
      name: "Vanity cabinet",
      kind: "wood",
      baseColor: "#3f4a4d",
      roughness: 0.5,
      metalness: 0,
    },
    {
      id: "mat-counter",
      name: "Countertop",
      kind: "stone",
      baseColor: "#e8e6e1",
      roughness: 0.25,
      metalness: 0,
    },
    {
      id: "mat-chrome",
      name: "Fixture metal",
      kind: "metal",
      baseColor: "#c8ccce",
      roughness: 0.2,
      metalness: 0.9,
    },
  ];
}

/**
 * A plain 5x8 — the most common full bath footprint in this market, so it is the
 * least surprising thing to show before any measurements arrive.
 */
export function defaultRoomSpec(name = "Untitled bathroom"): RoomSpec {
  return {
    version: 1,
    name,
    room: { widthIn: 60, lengthIn: 96, ceilingHeightIn: 96 },
    walls: WALL_IDS.map((id) => ({
      id,
      finish: { materialId: "mat-paint" },
      openings:
        id === "front"
          ? [
              {
                id: "op-door",
                type: "door" as const,
                uIn: 6,
                vIn: 0,
                widthIn: 30,
                heightIn: 80,
                label: "Entry door",
              },
            ]
          : [],
    })),
    floor: { materialId: "mat-floor", pattern: "running" },
    ceiling: { materialId: "mat-ceiling" },
    fixtures: [],
    materials: defaultMaterials(),
    assumptions: [
      "Room size is a placeholder 5'-0\" x 8'-0\" — replace with field measurements.",
    ],
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Run length of a wall, inches. Back/front span width; left/right span length. */
export function wallRunIn(wall: WallId, room: RoomDimensions): number {
  return wall === "back" || wall === "front" ? room.widthIn : room.lengthIn;
}

export function findMaterial(
  spec: RoomSpec,
  id: MaterialRef | null | undefined,
): DesignMaterial | undefined {
  if (!id) return undefined;
  return spec.materials.find((m) => m.id === id);
}

export const INCHES_PER_FOOT = 12;

/** Inches → feet. The viewer works in feet so three.js numbers stay readable. */
export function inToFt(inches: number): number {
  return inches / INCHES_PER_FOOT;
}

/** 78 → `6'-6"`. Used anywhere a dimension is shown to a human. */
export function formatFeetInches(inches: number): string {
  const rounded = Math.round(inches * 16) / 16;
  const negative = rounded < 0;
  const abs = Math.abs(rounded);
  const feet = Math.floor(abs / 12);
  const rem = abs - feet * 12;
  const whole = Math.floor(rem);
  const frac = rem - whole;

  const eighths = Math.round(frac * 8);
  let fracLabel = "";
  let carry = 0;
  if (eighths === 8) {
    carry = 1;
  } else if (eighths > 0) {
    const denom = 8 / gcd(eighths, 8);
    const numer = eighths / gcd(eighths, 8);
    fracLabel = ` ${numer}/${denom}`;
  }

  const inchPart = whole + carry;
  const sign = negative ? "-" : "";
  return `${sign}${feet}'-${inchPart}${fracLabel}"`;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}
