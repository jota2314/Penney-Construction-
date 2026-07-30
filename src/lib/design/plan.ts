/**
 * Top-down plan maths for the drag-and-drop editor.
 *
 * Pure functions, no React and no DOM, so the tricky part — converting a
 * dragged pixel position back into a wall's own `u` coordinate — can be
 * reasoned about and corrected in one place.
 *
 * ── PLAN ORIENTATION ─────────────────────────────────────────────────────────
 * Drawn the way a floor plan is normally read:
 *
 *     screen x  →  room x   (left to right)
 *     screen y  →  room z   (back wall at the TOP, entry wall at the BOTTOM)
 *
 * So you look down at the room standing at the door, which is the orientation
 * that makes "move the vanity to the left wall" mean what it looks like.
 */

import {
  type RoomSpec,
  type WallId,
  type Fixture,
  type WallOpening,
  type RoomDimensions,
  wallRunIn,
} from "@/types/design";

/** Inches → screen px and back. */
export interface PlanTransform {
  scale: number;
  padPx: number;
  widthPx: number;
  heightPx: number;
}

export function planTransform(
  room: RoomDimensions,
  viewportW: number,
  viewportH: number,
  padPx = 44,
): PlanTransform {
  const usableW = Math.max(1, viewportW - padPx * 2);
  const usableH = Math.max(1, viewportH - padPx * 2);
  const scale = Math.min(usableW / room.widthIn, usableH / room.lengthIn);
  return {
    scale,
    padPx,
    widthPx: room.widthIn * scale,
    heightPx: room.lengthIn * scale,
  };
}

export function toPx(inches: number, t: PlanTransform): number {
  return inches * t.scale;
}

export function xToPx(xIn: number, t: PlanTransform): number {
  return t.padPx + xIn * t.scale;
}

export function zToPx(zIn: number, t: PlanTransform): number {
  return t.padPx + zIn * t.scale;
}

export function pxToX(px: number, t: PlanTransform): number {
  return (px - t.padPx) / t.scale;
}

export function pxToZ(px: number, t: PlanTransform): number {
  return (px - t.padPx) / t.scale;
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

/**
 * How much of the room a fixture covers on the floor, after rotation.
 *
 * At 0 and 180 the width runs along x; at 90 and 270 it runs along z. Anything
 * in between is treated as its bounding box, which is enough for snapping and
 * clearance and avoids pretending we support arbitrary angles well.
 */
export function fixtureFootprint(f: Fixture): { spanX: number; spanZ: number } {
  const rot = normalizeAngle(f.rotationDeg ?? 0);
  const swapped = rot === 90 || rot === 270;
  return {
    spanX: swapped ? f.depthIn : f.widthIn,
    spanZ: swapped ? f.widthIn : f.depthIn,
  };
}

export function normalizeAngle(deg: number): number {
  return ((Math.round(deg) % 360) + 360) % 360;
}

/**
 * The direction a fixture faces, in room coordinates.
 *
 * Derived from the 3D convention (rotation about +Y, local front = +z):
 * front = (sin θ, cos θ). At θ = 0 that is +z, i.e. facing the entry wall with
 * its back to the back wall.
 */
export function facingVector(rotationDeg: number): { x: number; z: number } {
  const r = (rotationDeg * Math.PI) / 180;
  return { x: Math.sin(r), z: Math.cos(r) };
}

// ── Openings ─────────────────────────────────────────────────────────────────

/**
 * Where an opening sits in room coordinates.
 *
 * The per-wall direction of `u` is the fiddly bit and is the mirror of
 * lib/design/geometry.ts: u always starts at the viewer's LEFT when standing
 * inside the room facing that wall, which for the front and left walls means u
 * runs OPPOSITE to the world axis.
 */
export function openingSegment(
  wall: WallId,
  op: Pick<WallOpening, "uIn" | "widthIn">,
  room: RoomDimensions,
): { x1: number; z1: number; x2: number; z2: number } {
  const { uIn, widthIn } = op;
  switch (wall) {
    case "back":
      return { x1: uIn, z1: 0, x2: uIn + widthIn, z2: 0 };
    case "right":
      return { x1: room.widthIn, z1: uIn, x2: room.widthIn, z2: uIn + widthIn };
    case "front":
      return {
        x1: room.widthIn - uIn - widthIn,
        z1: room.lengthIn,
        x2: room.widthIn - uIn,
        z2: room.lengthIn,
      };
    case "left":
      return {
        x1: 0,
        z1: room.lengthIn - uIn - widthIn,
        x2: 0,
        z2: room.lengthIn - uIn,
      };
  }
}

/**
 * Inverse of openingSegment: a point on (or near) a wall → that wall's `u`.
 *
 * Returns the u of the opening's LEFT edge given the position of its CENTRE,
 * because dragging grabs the middle of the thing.
 */
export function pointToU(
  wall: WallId,
  xIn: number,
  zIn: number,
  widthIn: number,
  room: RoomDimensions,
): number {
  let centreU: number;
  switch (wall) {
    case "back":
      centreU = xIn;
      break;
    case "right":
      centreU = zIn;
      break;
    case "front":
      centreU = room.widthIn - xIn;
      break;
    case "left":
      centreU = room.lengthIn - zIn;
      break;
  }
  const run = wallRunIn(wall, room);
  return clamp(centreU - widthIn / 2, 0, Math.max(0, run - widthIn));
}

/** Which wall a point is nearest, and how far off it is (inches). */
export function nearestWall(
  xIn: number,
  zIn: number,
  room: RoomDimensions,
): { wall: WallId; distance: number } {
  const candidates: { wall: WallId; distance: number }[] = [
    { wall: "back", distance: Math.abs(zIn) },
    { wall: "front", distance: Math.abs(room.lengthIn - zIn) },
    { wall: "left", distance: Math.abs(xIn) },
    { wall: "right", distance: Math.abs(room.widthIn - xIn) },
  ];
  return candidates.sort((a, b) => a.distance - b.distance)[0];
}

// ── Snapping ─────────────────────────────────────────────────────────────────

/** Snap distance in inches. Generous enough to catch, small enough to escape. */
const SNAP_IN = 3;

export interface SnapResult {
  x: number;
  z: number;
  /** Which edges snapped, for drawing the guide lines. */
  snappedX: boolean;
  snappedZ: boolean;
}

/**
 * Pulls a dragged fixture flush against walls and other fixtures.
 *
 * Bathrooms are small and almost everything is against something, so snapping
 * to the wall face (not the centre) is what actually helps: it means a vanity
 * lands with its back ON the wall rather than a half inch proud of it.
 */
export function snapFixture(
  fixture: Fixture,
  desiredX: number,
  desiredZ: number,
  spec: RoomSpec,
): SnapResult {
  const { spanX, spanZ } = fixtureFootprint(fixture);
  const halfX = spanX / 2;
  const halfZ = spanZ / 2;
  const { widthIn, lengthIn } = spec.room;

  let x = desiredX;
  let z = desiredZ;
  let snappedX = false;
  let snappedZ = false;

  // Walls
  if (Math.abs(x - halfX) <= SNAP_IN) {
    x = halfX;
    snappedX = true;
  } else if (Math.abs(widthIn - halfX - x) <= SNAP_IN) {
    x = widthIn - halfX;
    snappedX = true;
  }
  if (Math.abs(z - halfZ) <= SNAP_IN) {
    z = halfZ;
    snappedZ = true;
  } else if (Math.abs(lengthIn - halfZ - z) <= SNAP_IN) {
    z = lengthIn - halfZ;
    snappedZ = true;
  }

  // Other fixtures — edge to edge, so things sit side by side cleanly.
  for (const other of spec.fixtures) {
    if (other.id === fixture.id) continue;
    const o = fixtureFootprint(other);
    const oHalfX = o.spanX / 2;
    const oHalfZ = o.spanZ / 2;

    if (!snappedX) {
      for (const target of [
        other.x + oHalfX + halfX,
        other.x - oHalfX - halfX,
        other.x,
      ]) {
        if (Math.abs(x - target) <= SNAP_IN) {
          x = target;
          snappedX = true;
          break;
        }
      }
    }
    if (!snappedZ) {
      for (const target of [
        other.z + oHalfZ + halfZ,
        other.z - oHalfZ - halfZ,
        other.z,
      ]) {
        if (Math.abs(z - target) <= SNAP_IN) {
          z = target;
          snappedZ = true;
          break;
        }
      }
    }
  }

  // Keep it in the room regardless of what snapped.
  x = clamp(x, halfX, Math.max(halfX, widthIn - halfX));
  z = clamp(z, halfZ, Math.max(halfZ, lengthIn - halfZ));

  return { x, z, snappedX, snappedZ };
}

// ── Clearance ────────────────────────────────────────────────────────────────

export interface ClearanceIssue {
  fixtureId: string;
  message: string;
  severity: "warn" | "error";
}

/**
 * Code and common-sense clearances, checked live while dragging.
 *
 * These are the ones that actually get jobs rejected or make a finished
 * bathroom unusable, not an exhaustive code review. Reported, never enforced —
 * the tool should not refuse to draw something the owner wants to look at.
 */
export function checkClearances(spec: RoomSpec): ClearanceIssue[] {
  const issues: ClearanceIssue[] = [];
  const { widthIn, lengthIn } = spec.room;

  for (const f of spec.fixtures) {
    const { spanX, spanZ } = fixtureFootprint(f);

    // Toilet: 15" minimum from centreline to any wall or fixture (IRC P2705.1).
    if (f.type === "toilet") {
      const toWalls = Math.min(f.x, widthIn - f.x, f.z, lengthIn - f.z);
      if (toWalls < 15) {
        issues.push({
          fixtureId: f.id,
          message: `Toilet centreline is ${Math.round(toWalls)}" from a wall. Code minimum is 15".`,
          severity: "error",
        });
      }
      for (const other of spec.fixtures) {
        if (other.id === f.id) continue;
        if (other.type === "towel_bar" || other.type === "sconce" || other.type === "mirror") continue;
        const o = fixtureFootprint(other);
        const gapX = Math.abs(f.x - other.x) - o.spanX / 2;
        const gapZ = Math.abs(f.z - other.z) - o.spanZ / 2;
        const gap = Math.max(gapX, gapZ);
        if (gap < 15 && gap > -1000) {
          issues.push({
            fixtureId: f.id,
            message: `Only ${Math.round(Math.max(0, gap))}" from the toilet centreline to the ${other.label ?? other.type.replace(/_/g, " ")}. Code minimum is 15".`,
            severity: "error",
          });
          break;
        }
      }
    }

    // Overlap with another fixture — usually a dragging mistake.
    for (const other of spec.fixtures) {
      if (other.id >= f.id) continue;
      if (isFlat(other) || isFlat(f)) continue;
      const o = fixtureFootprint(other);
      const overlapX = Math.abs(f.x - other.x) < (spanX + o.spanX) / 2 - 0.5;
      const overlapZ = Math.abs(f.z - other.z) < (spanZ + o.spanZ) / 2 - 0.5;
      if (overlapX && overlapZ) {
        issues.push({
          fixtureId: f.id,
          message: `Overlaps the ${other.label ?? other.type.replace(/_/g, " ")}.`,
          severity: "warn",
        });
      }
    }
  }

  // Door swing wants clear floor in front of it.
  for (const wall of spec.walls) {
    for (const op of wall.openings) {
      if (op.type !== "door") continue;
      const seg = openingSegment(wall.id, op, spec.room);
      const cx = (seg.x1 + seg.x2) / 2;
      const cz = (seg.z1 + seg.z2) / 2;
      for (const f of spec.fixtures) {
        if (isFlat(f)) continue;
        const { spanX, spanZ } = fixtureFootprint(f);
        const dx = Math.abs(f.x - cx) - spanX / 2;
        const dz = Math.abs(f.z - cz) - spanZ / 2;
        const clear = Math.max(dx, dz);
        if (clear < op.widthIn * 0.75) {
          issues.push({
            fixtureId: f.id,
            message: `${f.label ?? f.type.replace(/_/g, " ")} is inside the door swing.`,
            severity: "warn",
          });
        }
      }
    }
  }

  return dedupe(issues);
}

/** Wall-hung things with no floor footprint can't block anything. */
function isFlat(f: Fixture): boolean {
  return (
    f.type === "mirror" ||
    f.type === "towel_bar" ||
    f.type === "sconce" ||
    f.type === "ceiling_light" ||
    f.type === "medicine_cabinet"
  );
}

function dedupe(issues: ClearanceIssue[]): ClearanceIssue[] {
  const seen = new Set<string>();
  return issues.filter((i) => {
    const key = `${i.fixtureId}|${i.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Rounds to the nearest quarter inch — finer than anyone frames to. */
export function snapToQuarterInch(v: number): number {
  return Math.round(v * 4) / 4;
}
