/**
 * Adding and mutating items from the plan editor.
 *
 * Separate from lib/design/ops.ts on purpose: those operations are the vocabulary
 * the AI writes in, and they are applied on the server. These are direct,
 * local edits made by a hand on a mouse, applied optimistically in the browser
 * so dragging feels immediate. Both end up producing the same RoomSpec.
 */

import {
  type RoomSpec,
  type Fixture,
  type FixtureType,
  type WallId,
  type WallOpening,
  type OpeningType,
  WALL_IDS,
  wallRunIn,
} from "@/types/design";
import { FIXTURE_DEFAULTS, DEFAULT_MOUNT_HEIGHT_IN } from "@/lib/design/ops";
import { fixtureFootprint, openingSegment, clamp } from "@/lib/design/plan";

/** Unique-enough id that stays readable in the spec JSON. */
function newId(prefix: string, existing: string[]): string {
  let n = 1;
  while (existing.includes(`${prefix}-${n}`)) n++;
  return `${prefix}-${n}`;
}

/** Which way a fixture should face to have its back on a given wall. */
export function rotationForWall(wall: WallId): number {
  switch (wall) {
    case "back": return 0;
    case "left": return 90;
    case "front": return 180;
    case "right": return 270;
  }
}

/**
 * Finds an empty spot for a new fixture.
 *
 * Tries each wall in turn and slides along it looking for a gap, because a new
 * vanity dropped in the middle of the room on top of the tub is useless. Falls
 * back to the room centre when the room is genuinely full — the owner can drag
 * it out, and that is better than refusing to add it.
 */
export function placeNewFixture(spec: RoomSpec, type: FixtureType): { x: number; z: number; rotationDeg: number } {
  const d = FIXTURE_DEFAULTS[type] ?? { widthIn: 24, depthIn: 24, heightIn: 30 };
  const probe: Fixture = {
    id: "__probe__",
    type,
    widthIn: d.widthIn,
    depthIn: d.depthIn,
    heightIn: d.heightIn,
    x: 0,
    z: 0,
    rotationDeg: 0,
  };

  for (const wall of WALL_IDS) {
    const rotationDeg = rotationForWall(wall);
    const { spanX, spanZ } = fixtureFootprint({ ...probe, rotationDeg });
    const run = wallRunIn(wall, spec.room);
    const along = wall === "back" || wall === "front" ? spanX : spanZ;
    if (along > run) continue;

    // Step along the wall in 6" increments looking for clear floor.
    for (let offset = 0; offset + along <= run; offset += 6) {
      const centreAlong = offset + along / 2;
      let x: number;
      let z: number;
      switch (wall) {
        case "back": x = centreAlong; z = spanZ / 2; break;
        case "front": x = centreAlong; z = spec.room.lengthIn - spanZ / 2; break;
        case "left": x = spanX / 2; z = centreAlong; break;
        case "right": x = spec.room.widthIn - spanX / 2; z = centreAlong; break;
      }
      if (!collides({ ...probe, rotationDeg, x, z }, spec)) {
        return { x, z, rotationDeg };
      }
    }
  }

  return {
    x: spec.room.widthIn / 2,
    z: spec.room.lengthIn / 2,
    rotationDeg: 0,
  };
}

function collides(candidate: Fixture, spec: RoomSpec): boolean {
  const c = fixtureFootprint(candidate);
  for (const other of spec.fixtures) {
    const o = fixtureFootprint(other);
    const overlapX = Math.abs(candidate.x - other.x) < (c.spanX + o.spanX) / 2;
    const overlapZ = Math.abs(candidate.z - other.z) < (c.spanZ + o.spanZ) / 2;
    if (overlapX && overlapZ) return true;
  }
  return false;
}

export function addFixture(spec: RoomSpec, type: FixtureType): { spec: RoomSpec; id: string } {
  const d = FIXTURE_DEFAULTS[type] ?? { widthIn: 24, depthIn: 24, heightIn: 30 };
  const { x, z, rotationDeg } = placeNewFixture(spec, type);
  const id = newId(`fx-${type.replace(/_/g, "-")}`, spec.fixtures.map((f) => f.id));

  const fixture: Fixture = {
    id,
    type,
    widthIn: d.widthIn,
    depthIn: d.depthIn,
    heightIn: d.heightIn,
    x,
    z,
    yIn: DEFAULT_MOUNT_HEIGHT_IN[type] ?? 0,
    rotationDeg,
    options: defaultOptions(type),
  };

  return { spec: { ...spec, fixtures: [...spec.fixtures, fixture] }, id };
}

function defaultOptions(type: FixtureType): Record<string, string | number | boolean> {
  switch (type) {
    case "vanity": return { sinks: 1, style: "freestanding" };
    case "tub": return { style: "alcove" };
    case "shower": return { enclosure: "glass_panel", curbHeightIn: 4 };
    case "mirror": return { shape: "rect", frame: "none" };
    case "toilet": return { style: "floor" };
    default: return {};
  }
}

/**
 * Adds an opening to whichever wall has the most uninterrupted run left.
 *
 * A window dropped on top of the door is the most likely annoyance, so the
 * placement deliberately looks for the emptiest wall rather than defaulting to
 * a fixed one.
 */
export function addOpening(
  spec: RoomSpec,
  type: OpeningType,
): { spec: RoomSpec; wall: WallId; id: string } {
  const defaults = OPENING_DEFAULTS[type];

  let best: { wall: WallId; uIn: number; free: number } | null = null;

  for (const wall of WALL_IDS) {
    const run = wallRunIn(wall, spec.room);
    if (defaults.widthIn > run) continue;
    const w = spec.walls.find((x) => x.id === wall);
    const taken = (w?.openings ?? [])
      .map((o) => ({ from: o.uIn, to: o.uIn + o.widthIn }))
      .sort((a, b) => a.from - b.from);

    // Widest gap on this wall.
    let cursor = 0;
    const gaps: { from: number; to: number }[] = [];
    for (const t of taken) {
      if (t.from - cursor > 0) gaps.push({ from: cursor, to: t.from });
      cursor = Math.max(cursor, t.to);
    }
    if (run - cursor > 0) gaps.push({ from: cursor, to: run });

    for (const g of gaps) {
      const free = g.to - g.from;
      if (free < defaults.widthIn) continue;
      const uIn = g.from + (free - defaults.widthIn) / 2;
      if (!best || free > best.free) best = { wall, uIn, free };
    }
  }

  const target = best ?? { wall: "back" as WallId, uIn: 0, free: 0 };
  const existingIds = spec.walls.flatMap((w) => w.openings.map((o) => o.id));
  const id = newId(`op-${type}`, existingIds);

  const opening: WallOpening = {
    id,
    type,
    uIn: Math.max(0, target.uIn),
    vIn: defaults.vIn,
    widthIn: defaults.widthIn,
    heightIn: defaults.heightIn,
    depthIn: defaults.depthIn,
    label: defaults.label,
  };

  return {
    spec: {
      ...spec,
      walls: spec.walls.map((w) =>
        w.id === target.wall ? { ...w, openings: [...w.openings, opening] } : w,
      ),
    },
    wall: target.wall,
    id,
  };
}

/** Sill and head heights that match how these are actually built. */
const OPENING_DEFAULTS: Record<
  OpeningType,
  { widthIn: number; heightIn: number; vIn: number; depthIn?: number; label: string }
> = {
  door: { widthIn: 30, heightIn: 80, vIn: 0, label: "Door" },
  cased_opening: { widthIn: 36, heightIn: 84, vIn: 0, label: "Cased opening" },
  // Bathroom windows sit high for privacy.
  window: { widthIn: 30, heightIn: 36, vIn: 42, label: "Window" },
  // Shower niche at a reachable height, standard 3.5" stud bay depth.
  niche: { widthIn: 24, heightIn: 14, vIn: 44, depthIn: 3.5, label: "Niche" },
};

export function updateFixture(
  spec: RoomSpec,
  id: string,
  patch: Partial<Fixture>,
): RoomSpec {
  return {
    ...spec,
    fixtures: spec.fixtures.map((f) => (f.id === id ? { ...f, ...patch } : f)),
  };
}

export function removeFixture(spec: RoomSpec, id: string): RoomSpec {
  return { ...spec, fixtures: spec.fixtures.filter((f) => f.id !== id) };
}

export function updateOpening(
  spec: RoomSpec,
  wall: WallId,
  id: string,
  patch: Partial<WallOpening>,
): RoomSpec {
  return {
    ...spec,
    walls: spec.walls.map((w) =>
      w.id === wall
        ? {
            ...w,
            openings: w.openings.map((o) => (o.id === id ? { ...o, ...patch } : o)),
          }
        : w,
    ),
  };
}

/** Moves an opening to a different wall, keeping it inside the new run. */
export function moveOpeningToWall(
  spec: RoomSpec,
  fromWall: WallId,
  id: string,
  toWall: WallId,
  uIn: number,
): RoomSpec {
  const source = spec.walls.find((w) => w.id === fromWall);
  const opening = source?.openings.find((o) => o.id === id);
  if (!opening) return spec;

  const run = wallRunIn(toWall, spec.room);
  const width = Math.min(opening.widthIn, run);
  const moved: WallOpening = {
    ...opening,
    widthIn: width,
    uIn: clamp(uIn, 0, Math.max(0, run - width)),
  };

  return {
    ...spec,
    walls: spec.walls.map((w) => {
      if (w.id === fromWall) {
        return { ...w, openings: w.openings.filter((o) => o.id !== id) };
      }
      if (w.id === toWall) {
        return { ...w, openings: [...w.openings, moved] };
      }
      return w;
    }),
  };
}

export function removeOpening(spec: RoomSpec, wall: WallId, id: string): RoomSpec {
  return {
    ...spec,
    walls: spec.walls.map((w) =>
      w.id === wall ? { ...w, openings: w.openings.filter((o) => o.id !== id) } : w,
    ),
  };
}

/** Resizes the room, keeping everything inside it. */
export function resizeRoom(
  spec: RoomSpec,
  widthIn: number,
  lengthIn: number,
  ceilingHeightIn: number,
): RoomSpec {
  return { ...spec, room: { widthIn, lengthIn, ceilingHeightIn } };
}

/** Centre point of an opening in room coordinates, for drawing and dragging. */
export function openingCentre(
  wall: WallId,
  op: WallOpening,
  spec: RoomSpec,
): { x: number; z: number } {
  const seg = openingSegment(wall, op, spec.room);
  return { x: (seg.x1 + seg.x2) / 2, z: (seg.z1 + seg.z2) / 2 };
}
