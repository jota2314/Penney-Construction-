/**
 * Turning a drag on an elevation back into a spec edit.
 *
 * An elevation is a wall's own 2D frame, so moving something on it has to be
 * pushed back into ROOM coordinates — and which room axis a wall's `u` maps to,
 * and in which direction, differs per wall. That inversion is the whole reason
 * this file exists; doing it inline in the view is how a window ends up jumping
 * to the far end of the room when you nudge it.
 *
 * Vertical is the interesting half: sill and head heights only exist in
 * elevation, which is exactly why dragging here has to work.
 */

import {
  type RoomSpec,
  type WallId,
  type Fixture,
  wallRunIn,
} from "@/types/design";
import { fixtureFootprint, clamp } from "@/lib/design/plan";
import { updateFixture, updateOpening } from "@/lib/design/plan-edits";

/** Inverse of projectFixtureOntoWall's `u`: wall position → room x/z. */
export function uToRoomPosition(
  wall: WallId,
  uIn: number,
  room: { widthIn: number; lengthIn: number },
  current: { x: number; z: number },
): { x: number; z: number } {
  switch (wall) {
    case "back": return { x: uIn, z: current.z };
    case "front": return { x: room.widthIn - uIn, z: current.z };
    case "right": return { z: uIn, x: current.x };
    case "left": return { z: room.lengthIn - uIn, x: current.x };
  }
}

/** Fixture types whose height off the floor is a real, settable dimension. */
const WALL_MOUNTED = new Set([
  "mirror",
  "medicine_cabinet",
  "towel_bar",
  "sconce",
  "linen_cabinet",
]);

export function isWallMounted(type: string): boolean {
  return WALL_MOUNTED.has(type);
}

/**
 * Moves a fixture from an elevation drag.
 *
 * Horizontal always slides it along the wall. Vertical only applies to things
 * that actually hang on the wall — dragging a toilet upward should do nothing
 * rather than leave it floating.
 */
export function moveFixtureOnElevation(
  spec: RoomSpec,
  wall: WallId,
  id: string,
  newUIn: number,
  newBottomIn: number,
): RoomSpec {
  const f = spec.fixtures.find((x) => x.id === id);
  if (!f) return spec;

  const { spanX, spanZ } = fixtureFootprint(f);
  const along = wall === "back" || wall === "front" ? spanX : spanZ;
  const run = wallRunIn(wall, spec.room);

  const u = clamp(newUIn, along / 2, Math.max(along / 2, run - along / 2));
  const pos = uToRoomPosition(wall, u, spec.room, { x: f.x, z: f.z });

  const patch: Partial<Fixture> = { x: pos.x, z: pos.z };
  if (isWallMounted(f.type)) {
    patch.yIn = clamp(newBottomIn, 0, Math.max(0, spec.room.ceilingHeightIn - f.heightIn));
  }

  return updateFixture(spec, id, patch);
}

/**
 * Resizes a fixture from an elevation handle.
 *
 * The along-wall handle changes whichever of width/depth actually runs along
 * this wall — grabbing the side of a vanity seen end-on must not stretch its
 * face. Vertical always changes the real height.
 */
export function resizeFixtureOnElevation(
  spec: RoomSpec,
  wall: WallId,
  id: string,
  newAlongIn: number,
  newHeightIn: number,
): RoomSpec {
  const f = spec.fixtures.find((x) => x.id === id);
  if (!f) return spec;

  const rot = ((f.rotationDeg ?? 0) % 360 + 360) % 360;
  const swapped = rot === 90 || rot === 270;
  const wallRunsX = wall === "back" || wall === "front";
  // Which of the fixture's own dimensions is the one we can see across.
  const alongIsWidth = wallRunsX ? !swapped : swapped;

  const along = Math.max(6, newAlongIn);
  const height = Math.max(4, newHeightIn);

  return updateFixture(
    spec,
    id,
    alongIsWidth ? { widthIn: along, heightIn: height } : { depthIn: along, heightIn: height },
  );
}

/**
 * Moves an opening from an elevation drag.
 *
 * Both axes matter here: horizontal is the set-out from the corner, vertical is
 * the sill height, which the plan cannot show at all.
 */
export function moveOpeningOnElevation(
  spec: RoomSpec,
  wall: WallId,
  id: string,
  newUIn: number,
  newVIn: number,
): RoomSpec {
  const op = spec.walls.find((w) => w.id === wall)?.openings.find((o) => o.id === id);
  if (!op) return spec;

  const run = wallRunIn(wall, spec.room);
  return updateOpening(spec, wall, id, {
    uIn: clamp(newUIn, 0, Math.max(0, run - op.widthIn)),
    // A door has to sit on the floor; anything else can float.
    vIn: op.type === "door" || op.type === "cased_opening"
      ? 0
      : clamp(newVIn, 0, Math.max(0, spec.room.ceilingHeightIn - op.heightIn)),
  });
}

export type ElevHandle = "e" | "w" | "n" | "s" | "ne" | "nw" | "se" | "sw";

/**
 * Resizes an opening from an elevation handle.
 *
 * The opposite edge stays anchored, so stretching a window's head doesn't drag
 * its sill up with it.
 */
export function resizeOpeningOnElevation(
  spec: RoomSpec,
  wall: WallId,
  id: string,
  handle: ElevHandle,
  startU: number,
  startV: number,
  startW: number,
  startH: number,
  duIn: number,
  dvIn: number,
): RoomSpec {
  const run = wallRunIn(wall, spec.room);
  const ceil = spec.room.ceilingHeightIn;

  let u = startU;
  let v = startV;
  let w = startW;
  let h = startH;

  if (handle.includes("e")) w = startW + duIn;
  if (handle.includes("w")) { u = startU + duIn; w = startW - duIn; }
  if (handle.includes("n")) h = startH + dvIn;
  if (handle.includes("s")) { v = startV + dvIn; h = startH - dvIn; }

  const MIN = 6;
  if (w < MIN) { if (handle.includes("w")) u -= MIN - w; w = MIN; }
  if (h < MIN) { if (handle.includes("s")) v -= MIN - h; h = MIN; }

  u = clamp(u, 0, Math.max(0, run - MIN));
  v = clamp(v, 0, Math.max(0, ceil - MIN));
  w = Math.min(w, run - u);
  h = Math.min(h, ceil - v);

  const op = spec.walls.find((x) => x.id === wall)?.openings.find((o) => o.id === id);
  return updateOpening(spec, wall, id, {
    uIn: round4(u),
    vIn: op?.type === "door" || op?.type === "cased_opening" ? 0 : round4(v),
    widthIn: round4(w),
    heightIn: round4(h),
  });
}

function round4(n: number): number {
  return Math.round(n * 4) / 4;
}
