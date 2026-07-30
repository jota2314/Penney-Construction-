/**
 * Turns a RoomSpec into three.js-ready placement data.
 *
 * Pure functions only — no three.js imports, no React. Keeping the maths here
 * means the wall framing can be reasoned about (and fixed) without touching the
 * renderer, and the same numbers feed the takeoff.
 *
 * ── WALL FRAMES ──────────────────────────────────────────────────────────────
 * Each wall has a local 2D frame (u, v): u runs along the wall from its left end
 * as seen from INSIDE the room facing it, v runs up from the finished floor.
 * That is the frame openings are authored in, because it matches how a position
 * is called out on site ("niche 18 off the corner, 40 up").
 *
 * Mapping u back to world coordinates differs per wall, and the direction
 * matters — get it backwards and every window lands on the wrong side of the
 * room. The table below is derived from standing in the room and facing each
 * wall, so "left" always means the viewer's left.
 */

import {
  type RoomSpec,
  type RoomDimensions,
  type WallId,
  type WallOpening,
  inToFt,
  wallRunIn,
} from "@/types/design";

export interface WallFrame {
  id: WallId;
  /** Wall run and height, feet. */
  widthFt: number;
  heightFt: number;
  /** Centre of the wall plane in world space, feet. */
  position: [number, number, number];
  /** Y rotation, radians, so the wall's +u points along its local +x. */
  rotationY: number;
}

/**
 * Where each wall sits and which way it faces.
 *
 * rotationY is chosen so the plane's local +x follows increasing u and its
 * normal points INTO the room. The u directions come from standing inside the
 * room facing each wall and taking the viewer's left as u = 0:
 *   back  (z=0)  normal +z, u runs from x=0 toward +x  →   0°
 *   right (x=W)  normal -x, u runs from z=0 toward +z  → -90°
 *   front (z=L)  normal -z, u runs from x=W toward -x  → 180°
 *   left  (x=0)  normal +x, u runs from z=L toward -z  → +90°
 */
export function wallFrames(room: RoomDimensions): WallFrame[] {
  const w = inToFt(room.widthIn);
  const l = inToFt(room.lengthIn);
  const h = inToFt(room.ceilingHeightIn);
  const halfH = h / 2;

  return [
    {
      id: "back",
      widthFt: w,
      heightFt: h,
      position: [w / 2, halfH, 0],
      rotationY: 0,
    },
    {
      id: "right",
      widthFt: l,
      heightFt: h,
      position: [w, halfH, l / 2],
      rotationY: -Math.PI / 2,
    },
    {
      id: "front",
      widthFt: w,
      heightFt: h,
      position: [w / 2, halfH, l],
      rotationY: Math.PI,
    },
    {
      id: "left",
      widthFt: l,
      heightFt: h,
      position: [0, halfH, l / 2],
      rotationY: Math.PI / 2,
    },
  ];
}

export function wallFrame(id: WallId, room: RoomDimensions): WallFrame {
  const found = wallFrames(room).find((f) => f.id === id);
  if (!found) throw new Error(`Unknown wall: ${id}`);
  return found;
}

/**
 * An opening expressed in the wall plane's centred local coordinates, feet.
 *
 * The wall mesh is centred on its own origin, so u/v (measured from the wall's
 * bottom-left) shift by half the wall's run and height.
 */
export interface LocalRect {
  id: string;
  /** Centre of the rect in the wall's centred frame, feet. */
  cx: number;
  cy: number;
  widthFt: number;
  heightFt: number;
  depthFt: number;
  type: WallOpening["type"];
  materialId?: string | null;
  label?: string;
}

export function openingRects(
  openings: WallOpening[],
  frame: WallFrame,
): LocalRect[] {
  return openings.map((op) => {
    const wFt = inToFt(op.widthIn);
    const hFt = inToFt(op.heightIn);
    return {
      id: op.id,
      cx: inToFt(op.uIn) + wFt / 2 - frame.widthFt / 2,
      cy: inToFt(op.vIn) + hFt / 2 - frame.heightFt / 2,
      widthFt: wFt,
      heightFt: hFt,
      depthFt: inToFt(op.depthIn ?? 3.5),
      type: op.type,
      materialId: op.materialId,
      label: op.label,
    };
  });
}

/**
 * Clamps openings that would run off the end of their wall.
 *
 * Openings are authored against a room size that can change later — resize a
 * room smaller and a window can end up hanging past the corner, which produces
 * a broken shape rather than an obvious error. Clamping keeps the model
 * renderable and reports what moved so it can be surfaced rather than hidden.
 */
export function clampOpenings(spec: RoomSpec): { spec: RoomSpec; adjusted: string[] } {
  const adjusted: string[] = [];
  const ceiling = spec.room.ceilingHeightIn;

  const walls = spec.walls.map((wall) => {
    const run = wallRunIn(wall.id, spec.room);

    const openings = wall.openings.map((op) => {
      const width = Math.min(op.widthIn, run);
      const height = Math.min(op.heightIn, ceiling);
      const uIn = Math.max(0, Math.min(op.uIn, run - width));
      const vIn = Math.max(0, Math.min(op.vIn, ceiling - height));

      if (
        width !== op.widthIn ||
        height !== op.heightIn ||
        uIn !== op.uIn ||
        vIn !== op.vIn
      ) {
        adjusted.push(
          `${op.label ?? op.type} on the ${wall.id} wall didn't fit and was pulled back inside the wall.`,
        );
      }

      return { ...op, widthIn: width, heightIn: height, uIn, vIn };
    });

    return { ...wall, openings };
  });

  return { spec: { ...spec, walls }, adjusted };
}

/**
 * Keeps fixtures inside the room.
 *
 * Same reasoning as openings: a conversational edit ("make it 6 inches
 * narrower") can push a vanity through a wall. Better to slide it and say so.
 */
export function clampFixtures(spec: RoomSpec): { spec: RoomSpec; adjusted: string[] } {
  const adjusted: string[] = [];
  const { widthIn, lengthIn } = spec.room;

  const fixtures = spec.fixtures.map((f) => {
    // Rotation swaps which axis the footprint spans.
    const rot = ((f.rotationDeg ?? 0) % 360 + 360) % 360;
    const swapped = rot === 90 || rot === 270;
    const spanX = swapped ? f.depthIn : f.widthIn;
    const spanZ = swapped ? f.widthIn : f.depthIn;

    const x = clamp(f.x, spanX / 2, Math.max(spanX / 2, widthIn - spanX / 2));
    const z = clamp(f.z, spanZ / 2, Math.max(spanZ / 2, lengthIn - spanZ / 2));

    if (x !== f.x || z !== f.z) {
      adjusted.push(
        `${f.label ?? f.type} was outside the room and got moved back inside.`,
      );
    }
    return { ...f, x, z };
  });

  return { spec: { ...spec, fixtures }, adjusted };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * World transform for a fixture.
 *
 * Fixture x/z are the footprint CENTRE in inches from the room's back-left
 * corner; rotation 0 faces FRONT (+z) so "against the back wall" needs no
 * rotation, the most common placement.
 */
export function fixtureTransform(
  f: { x: number; z: number; yIn?: number; rotationDeg?: number },
): { position: [number, number, number]; rotationY: number } {
  return {
    position: [inToFt(f.x), inToFt(f.yIn ?? 0), inToFt(f.z)],
    rotationY: ((f.rotationDeg ?? 0) * Math.PI) / 180,
  };
}

/**
 * A camera start that frames the whole room.
 *
 * Placed in the front-right upper corner looking at the room centre — the angle
 * a person naturally takes a bathroom photo from, which also makes the AI render
 * pass more predictable since its reference matches its training distribution.
 */
export function defaultCamera(room: RoomDimensions): {
  position: [number, number, number];
  target: [number, number, number];
} {
  const w = inToFt(room.widthIn);
  const l = inToFt(room.lengthIn);
  const h = inToFt(room.ceilingHeightIn);

  return {
    position: [w * 0.92, h * 0.72, l * 1.55],
    target: [w / 2, h * 0.42, l / 2],
  };
}

/** Normalises a spec: clamps geometry and returns everything that moved. */
export function sanitizeSpec(spec: RoomSpec): { spec: RoomSpec; adjusted: string[] } {
  const a = clampOpenings(spec);
  const b = clampFixtures(a.spec);
  return { spec: b.spec, adjusted: [...a.adjusted, ...b.adjusted] };
}
