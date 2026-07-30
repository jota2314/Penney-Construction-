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
      if (isFlatFixture(other) || isFlatFixture(f)) continue;
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

  // Anything standing in the arc the door actually sweeps. Respects hinge side
  // and direction, so flipping the swing clears the warning when it should —
  // and an out-swinging door is never blocked by what's inside the room.
  for (const wall of spec.walls) {
    for (const op of wall.openings) {
      if (op.type !== "door") continue;
      for (const f of fixturesBlockingSwing(wall.id, op, spec)) {
        issues.push({
          fixtureId: f.id,
          message: `${f.label ?? f.type.replace(/_/g, " ")} is in the door swing. Try the other hinge side, or swing it out.`,
          severity: "warn",
        });
      }
    }
  }

  return dedupe(issues);
}

/** Wall-hung things with no floor footprint can't block anything. */
export function isFlatFixture(f: Fixture): boolean {
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

// ── Rotated frames ───────────────────────────────────────────────────────────

/**
 * Room-space delta → a fixture's own local axes.
 *
 * Needed for resize handles: the handle on the "right side" of a vanity rotated
 * 90° is pointing along the room's z axis, so a raw pointer delta would resize
 * the wrong dimension. Local x is the width axis, local z the depth axis.
 *
 * Derived from the 3D convention (rotation about +Y):
 *   world = (lx·cosθ + lz·sinθ, −lx·sinθ + lz·cosθ)
 * so the inverse is:
 *   local = (wx·cosθ − wz·sinθ, wx·sinθ + wz·cosθ)
 */
export function worldToLocalDelta(
  dwx: number,
  dwz: number,
  rotationDeg: number,
): { dlx: number; dlz: number } {
  const r = (rotationDeg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return { dlx: dwx * c - dwz * s, dlz: dwx * s + dwz * c };
}

/** Inverse of worldToLocalDelta. */
export function localToWorldDelta(
  dlx: number,
  dlz: number,
  rotationDeg: number,
): { dwx: number; dwz: number } {
  const r = (rotationDeg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return { dwx: dlx * c + dlz * s, dwz: -dlx * s + dlz * c };
}

/**
 * Which way a wall's `u` axis points in room coordinates.
 *
 * Used to turn a pointer delta into movement along a wall. Front and left are
 * negative because u starts at the viewer's left standing inside the room.
 */
export function wallUDelta(wall: WallId, dwx: number, dwz: number): number {
  switch (wall) {
    case "back": return dwx;
    case "right": return dwz;
    case "front": return -dwx;
    case "left": return -dwz;
  }
}

/** Nothing useful is smaller than this, and zero-size shapes break hit testing. */
export const MIN_FIXTURE_IN = 6;
export const MIN_OPENING_IN = 6;
export const MIN_ROOM_IN = 24;

// ── Door swing ───────────────────────────────────────────────────────────────

/** Unit vector pointing INTO the room from a given wall. */
export function inwardNormal(wall: WallId): { x: number; z: number } {
  switch (wall) {
    case "back": return { x: 0, z: 1 };
    case "front": return { x: 0, z: -1 };
    case "left": return { x: 1, z: 0 };
    case "right": return { x: -1, z: 0 };
  }
}

/**
 * The two ends of an opening in `u` order.
 *
 * `start` is always the u = 0 end — the viewer's LEFT standing inside the room
 * facing that wall. openingSegment returns its points in world-axis order, and
 * on the front and left walls u runs backwards along that axis, so the ends are
 * swapped there. This is what makes "hinge on the left" mean the same thing on
 * all four walls.
 */
export function openingEnds(
  wall: WallId,
  op: Pick<WallOpening, "uIn" | "widthIn">,
  room: RoomDimensions,
): { start: { x: number; z: number }; end: { x: number; z: number } } {
  const s = openingSegment(wall, op, room);
  const a = { x: s.x1, z: s.z1 };
  const b = { x: s.x2, z: s.z2 };
  const flipped = wall === "front" || wall === "left";
  return flipped ? { start: b, end: a } : { start: a, end: b };
}

export interface DoorSwing {
  hinge: { x: number; z: number };
  /** Where the leaf sits when shut — the far end of the opening. */
  closed: { x: number; z: number };
  /** Where the leaf points at 90° open. */
  open: { x: number; z: number };
  /** Sampled quarter-circle from closed to open, for drawing. */
  arc: { x: number; z: number }[];
}

/**
 * Everything needed to draw and reason about a door's swing, in room inches.
 *
 * The arc is sampled rather than emitted as an SVG arc command on purpose: the
 * sweep-flag for an elliptical arc depends on wall, hinge side and swing
 * direction all at once, and getting one combination wrong draws the arc
 * inside-out. Parameterising it as
 *   p(t) = hinge + width·(along·cos t + swing·sin t),  t ∈ [0, π/2]
 * is correct for all sixteen combinations by construction.
 */
export function doorSwing(
  wall: WallId,
  op: Pick<WallOpening, "uIn" | "widthIn" | "hinge" | "swing">,
  room: RoomDimensions,
  samples = 12,
): DoorSwing {
  const ends = openingEnds(wall, op, room);
  const hingeLeft = (op.hinge ?? "left") === "left";
  const hinge = hingeLeft ? ends.start : ends.end;
  const other = hingeLeft ? ends.end : ends.start;

  const w = op.widthIn || 1;
  // Unit vector from the hinge along the wall toward the other jamb.
  const along = { x: (other.x - hinge.x) / w, z: (other.z - hinge.z) / w };

  const n = inwardNormal(wall);
  const outward = (op.swing ?? "in") === "in" ? 1 : -1;
  const swingDir = { x: n.x * outward, z: n.z * outward };

  const arc: { x: number; z: number }[] = [];
  for (let i = 0; i <= samples; i++) {
    const t = (i / samples) * (Math.PI / 2);
    const c = Math.cos(t);
    const s = Math.sin(t);
    arc.push({
      x: hinge.x + w * (along.x * c + swingDir.x * s),
      z: hinge.z + w * (along.z * c + swingDir.z * s),
    });
  }

  return {
    hinge,
    closed: { x: hinge.x + along.x * w, z: hinge.z + along.z * w },
    open: { x: hinge.x + swingDir.x * w, z: hinge.z + swingDir.z * w },
    arc,
  };
}

/** Is a point inside a fixture's floor footprint? */
function pointInFixture(px: number, pz: number, f: Fixture): boolean {
  const { spanX, spanZ } = fixtureFootprint(f);
  return (
    Math.abs(px - f.x) <= spanX / 2 &&
    Math.abs(pz - f.z) <= spanZ / 2
  );
}

/**
 * Does anything sit in the area a door sweeps through?
 *
 * Samples the swept quarter-disc rather than just the arc, so a fixture parked
 * partway into the swing is caught, not only one touching the fully-open
 * position. An OUT-swinging door sweeps outside the room and cannot be blocked
 * by anything in it, so it is never flagged.
 */
export function fixturesBlockingSwing(
  wall: WallId,
  op: Pick<WallOpening, "uIn" | "widthIn" | "hinge" | "swing">,
  spec: RoomSpec,
): Fixture[] {
  if ((op.swing ?? "in") === "out") return [];

  const { hinge, arc } = doorSwing(wall, op, spec.room, 8);
  const blockers = new Set<Fixture>();

  for (const f of spec.fixtures) {
    if (isFlatFixture(f)) continue;
    for (const a of arc) {
      // Walk in from the arc toward the hinge to cover the whole sector.
      for (const frac of [1, 0.75, 0.5, 0.25]) {
        const px = hinge.x + (a.x - hinge.x) * frac;
        const pz = hinge.z + (a.z - hinge.z) * frac;
        if (pointInFixture(px, pz, f)) {
          blockers.add(f);
          break;
        }
      }
      if (blockers.has(f)) break;
    }
  }

  return [...blockers];
}
