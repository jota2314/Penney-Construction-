/**
 * Quantity takeoff computed from the RoomSpec geometry.
 *
 * This is the reason the tool models real geometry rather than just generating a
 * picture: the same spec that draws the room also measures it, so the render and
 * the quantities can never disagree.
 *
 * Everything here is derived, never stored. Nothing in this file writes to a
 * project, an estimate, or a line item — the design studio is a sandbox, and a
 * concept-stage number has no business flowing into a live job's budget on its
 * own. Copy a figure out deliberately or not at all.
 *
 * Conventions follow how the work is actually bid on the North Shore:
 *   - areas in SF, linear runs in LF, both rounded up at the end
 *   - openings deducted only when they break the tiled band
 *   - niches deduct their face and add back their interior
 *   - waste is reported separately from net so the net stays checkable
 */

import {
  type RoomSpec,
  type WallSpec,
  type WallOpening,
  type DesignMaterial,
  type Fixture,
  findMaterial,
  wallRunIn,
} from "@/types/design";

const SQIN_PER_SF = 144;

/** Diagonal and herringbone lays cut more tile, so they carry more waste. */
const WASTE_BY_PATTERN: Record<string, number> = {
  stack: 0.1,
  running: 0.1,
  vertical_stack: 0.1,
  basketweave: 0.15,
  herringbone: 0.15,
  none: 0.1,
};

export interface TileQuantity {
  materialId: string;
  materialName: string;
  /** Measured surface, SF, openings already deducted. */
  netSf: number;
  /** netSf plus waste. What you would actually order. */
  orderSf: number;
  wastePct: number;
  /** Null when the material has no modular size (paint, slab). */
  pieces: number | null;
  /** Where the area came from, so a surprising number can be traced. */
  breakdown: { label: string; sf: number }[];
}

export interface DesignTakeoff {
  tile: TileQuantity[];
  paintSf: number;
  /** Bullnose / Schluter edge — niche perimeters, curbs, outside corners. */
  edgeTrimLf: number;
  /** Shower curb, if any. */
  curbLf: number;
  fixtureCounts: { type: string; label: string; count: number }[];
  floorAreaSf: number;
  perimeterLf: number;
  /** Anything the takeoff could not measure honestly. Always show these. */
  warnings: string[];
}

// ── Surface collection ───────────────────────────────────────────────────────

interface SurfaceHit {
  materialId: string;
  label: string;
  sf: number;
}

/**
 * How much of an opening falls inside a tiled band running 0..bandTopIn.
 *
 * A door in a full-height tiled wall deducts fully; the same door in a 48"
 * wainscot only deducts the part below 48".
 */
function openingAreaInBand(op: WallOpening, bandTopIn: number): number {
  const top = Math.min(op.vIn + op.heightIn, bandTopIn);
  const bottom = Math.min(op.vIn, bandTopIn);
  const h = Math.max(0, top - bottom);
  return (h * op.widthIn) / SQIN_PER_SF;
}

/** Interior faces of a recessed niche: back, two jambs, head and sill. */
function nicheInteriorSf(op: WallOpening): number {
  const d = op.depthIn ?? 3.5;
  const back = op.widthIn * op.heightIn;
  const jambs = 2 * d * op.heightIn;
  const headSill = 2 * d * op.widthIn;
  return (back + jambs + headSill) / SQIN_PER_SF;
}

function collectWallSurfaces(spec: RoomSpec): SurfaceHit[] {
  const hits: SurfaceHit[] = [];
  const ceiling = spec.room.ceilingHeightIn;

  for (const wall of spec.walls) {
    const run = wallRunIn(wall.id, spec.room);
    const hasSplit =
      wall.finish.upperMaterialId != null &&
      wall.finish.splitHeightIn != null &&
      wall.finish.splitHeightIn > 0;

    const lowerTop = hasSplit
      ? Math.min(wall.finish.splitHeightIn as number, ceiling)
      : ceiling;

    pushBand(hits, spec, wall, wall.finish.materialId, 0, lowerTop, run);

    if (hasSplit && lowerTop < ceiling) {
      pushBand(
        hits,
        spec,
        wall,
        wall.finish.upperMaterialId as string,
        lowerTop,
        ceiling,
        run,
      );
    }

    // Niches are finished independently of the wall band they sit in.
    for (const op of wall.openings) {
      if (op.type !== "niche") continue;
      const nicheMat = op.materialId ?? wall.finish.materialId;
      hits.push({
        materialId: nicheMat,
        label: `${op.label ?? "Niche"} interior (${wall.id})`,
        sf: nicheInteriorSf(op),
      });
    }
  }

  return hits;
}

/** One horizontal band of a wall, from bottomIn to topIn, openings deducted. */
function pushBand(
  hits: SurfaceHit[],
  spec: RoomSpec,
  wall: WallSpec,
  materialId: string,
  bottomIn: number,
  topIn: number,
  runIn: number,
) {
  const height = Math.max(0, topIn - bottomIn);
  if (height === 0) return;

  let sf = (runIn * height) / SQIN_PER_SF;

  for (const op of wall.openings) {
    // A niche removes its face from the band but is added back as interior.
    const deductBelowTop = openingAreaInBand(op, topIn);
    const deductBelowBottom = openingAreaInBand(op, bottomIn);
    sf -= deductBelowTop - deductBelowBottom;
  }

  hits.push({
    materialId,
    label: `${wall.id} wall${bottomIn > 0 ? " (upper)" : ""}`,
    sf: Math.max(0, sf),
  });
}

/**
 * Floor area, with the footprints that never get tiled taken out.
 *
 * A tub and a shower pan sit on the subfloor, so tile stops at them. A vanity
 * does not deduct: on a remodel the floor is almost always run wall to wall so
 * the cabinet can be swapped later without a tile scar.
 */
function floorSurfaces(spec: RoomSpec): { sf: number; warnings: string[] } {
  const warnings: string[] = [];
  const gross = (spec.room.widthIn * spec.room.lengthIn) / SQIN_PER_SF;

  let deduct = 0;
  for (const f of spec.fixtures) {
    if (f.type === "tub" || f.type === "shower") {
      deduct += (f.widthIn * f.depthIn) / SQIN_PER_SF;
    }
  }

  if (deduct > gross * 0.6) {
    warnings.push(
      "Tub and shower footprints cover most of the floor — check fixture sizes and placement.",
    );
  }

  return { sf: Math.max(0, gross - deduct), warnings };
}

// ── Trim ─────────────────────────────────────────────────────────────────────

function edgeTrimLf(spec: RoomSpec): number {
  let inches = 0;

  // Niche perimeters get an edge profile on all four sides.
  for (const wall of spec.walls) {
    for (const op of wall.openings) {
      if (op.type !== "niche") continue;
      inches += 2 * (op.widthIn + op.heightIn);
    }
  }

  // Where a tiled wainscot stops, the top edge needs a cap.
  for (const wall of spec.walls) {
    const mat = findMaterial(spec, wall.finish.materialId);
    const hasSplit =
      wall.finish.upperMaterialId != null && (wall.finish.splitHeightIn ?? 0) > 0;
    if (hasSplit && mat?.kind === "tile") {
      inches += wallRunIn(wall.id, spec.room);
    }
  }

  return inches / 12;
}

function curbLf(spec: RoomSpec): number {
  const shower = spec.fixtures.find((f) => f.type === "shower");
  if (!shower) return 0;
  const enclosure = String(shower.options?.enclosure ?? "");
  if (enclosure === "open") return 0;
  const curbH = Number(shower.options?.curbHeightIn ?? 4);
  if (curbH <= 0) return 0;
  // Curb runs the open side(s); a corner shower typically has one long run.
  return Math.max(shower.widthIn, shower.depthIn) / 12;
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

const FIXTURE_LABELS: Record<string, string> = {
  vanity: "Vanity",
  toilet: "Toilet",
  tub: "Tub",
  shower: "Shower",
  mirror: "Mirror",
  medicine_cabinet: "Medicine cabinet",
  linen_cabinet: "Linen cabinet",
  towel_bar: "Towel bar",
  sconce: "Sconce",
  ceiling_light: "Ceiling light",
  radiator: "Radiator",
  bench: "Bench",
};

function countFixtures(fixtures: Fixture[]) {
  const counts = new Map<string, number>();
  for (const f of fixtures) {
    counts.set(f.type, (counts.get(f.type) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([type, count]) => ({
      type,
      label: FIXTURE_LABELS[type] ?? type,
      count,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

// ── Entry point ──────────────────────────────────────────────────────────────

export function computeTakeoff(spec: RoomSpec): DesignTakeoff {
  const warnings: string[] = [];

  const floor = floorSurfaces(spec);
  warnings.push(...floor.warnings);

  const hits: SurfaceHit[] = collectWallSurfaces(spec);
  hits.push({
    materialId: spec.floor.materialId,
    label: "Floor",
    sf: floor.sf,
  });
  hits.push({
    materialId: spec.ceiling.materialId,
    label: "Ceiling",
    sf: (spec.room.widthIn * spec.room.lengthIn) / SQIN_PER_SF,
  });

  // Group by material, then split tile from paint.
  const byMaterial = new Map<string, SurfaceHit[]>();
  for (const hit of hits) {
    if (hit.sf <= 0) continue;
    const list = byMaterial.get(hit.materialId) ?? [];
    list.push(hit);
    byMaterial.set(hit.materialId, list);
  }

  const tile: TileQuantity[] = [];
  let paintSf = 0;

  for (const [materialId, group] of byMaterial) {
    const mat = findMaterial(spec, materialId);
    const netSf = group.reduce((sum, h) => sum + h.sf, 0);

    if (!mat) {
      warnings.push(
        `Surface references material "${materialId}" which is not in the palette — its ${netSf.toFixed(0)} SF is uncounted.`,
      );
      continue;
    }

    if (mat.kind === "paint") {
      paintSf += netSf;
      continue;
    }

    const wastePct = WASTE_BY_PATTERN[mat.pattern ?? "stack"] ?? 0.1;
    const orderSf = netSf * (1 + wastePct);

    tile.push({
      materialId,
      materialName: mat.name,
      netSf: round(netSf, 1),
      orderSf: Math.ceil(orderSf),
      wastePct,
      pieces: pieceCount(mat, orderSf),
      breakdown: group
        .map((h) => ({ label: h.label, sf: round(h.sf, 1) }))
        .sort((a, b) => b.sf - a.sf),
    });
  }

  tile.sort((a, b) => b.netSf - a.netSf);

  if (spec.fixtures.length === 0) {
    warnings.push("No fixtures placed yet — fixture counts and floor deductions are empty.");
  }

  const perimeterIn = 2 * (spec.room.widthIn + spec.room.lengthIn);

  return {
    tile,
    paintSf: round(paintSf, 1),
    edgeTrimLf: round(edgeTrimLf(spec), 1),
    curbLf: round(curbLf(spec), 1),
    fixtureCounts: countFixtures(spec.fixtures),
    floorAreaSf: round(floor.sf, 1),
    perimeterLf: round(perimeterIn / 12, 1),
    warnings,
  };
}

/** Whole tiles to order. Null when the material has no modular size. */
function pieceCount(mat: DesignMaterial, orderSf: number): number | null {
  if (!mat.tileWidthIn || !mat.tileHeightIn) return null;
  const perTileSf = (mat.tileWidthIn * mat.tileHeightIn) / SQIN_PER_SF;
  if (perTileSf <= 0) return null;
  return Math.ceil(orderSf / perTileSf);
}

function round(n: number, places: number): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}
