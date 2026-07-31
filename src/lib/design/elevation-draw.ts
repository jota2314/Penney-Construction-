/**
 * Elevation drawings, as a display list.
 *
 * The first version drew every fixture as a labelled rectangle, which is a
 * diagram, not a drawing. A vanity elevation has to show the toe kick, the door
 * and drawer divisions, the counter overhang and the backsplash, because those
 * are the things someone checks on an elevation. So each fixture gets a real
 * profile.
 *
 * Output is primitives in INCHES with the origin at the wall's bottom-left,
 * v up. Two thin renderers consume it — SVG on screen and jsPDF for the sheet —
 * so the drawing is authored once and can't drift between the two.
 */

import {
  type RoomSpec,
  type WallId,
  type Fixture,
  type DesignMaterial,
  findMaterial,
  wallRunIn,
  formatFeetInches,
} from "@/types/design";
import {
  elevationItems,
  tileCourses,
  projectFixtureOntoWall,
  wallFixtureHeightIn,
  partitionDoorway,
} from "@/lib/design/plan";

// ── Primitives ───────────────────────────────────────────────────────────────

export type Prim =
  | {
      t: "rect";
      x: number; y: number; w: number; h: number;
      fill?: string; stroke?: string; lw?: number; dash?: boolean;
    }
  | {
      t: "line";
      x1: number; y1: number; x2: number; y2: number;
      stroke: string; lw?: number; dash?: boolean;
    }
  | {
      t: "circle";
      cx: number; cy: number; r: number;
      fill?: string; stroke?: string; lw?: number;
    }
  | {
      /**
       * Free-form outline. The reason this exists: a toilet, a tub and a basin
       * are curved objects, and drawing them out of rectangles gives you the
       * stack of boxes the first version produced. Points are sampled, so one
       * primitive covers arcs, ogees and radiused corners without the renderers
       * needing to understand any of them.
       */
      t: "poly";
      pts: [number, number][];
      fill?: string; stroke?: string; lw?: number; close?: boolean; dash?: boolean;
    }
  | {
      t: "text";
      x: number; y: number; s: string;
      /** Point size at 1:1; the renderer scales it independently of geometry. */
      size: number;
      align?: "left" | "center" | "right";
      color?: string;
      bold?: boolean;
    };

export interface ElevationDrawing {
  wall: WallId;
  runIn: number;
  heightIn: number;
  prims: Prim[];
  /** Notes worth showing beside the drawing (slivers, missing finishes). */
  notes: string[];
}

// Drawing weights, kept together so the sheet reads consistently.
const INK = "#1f2937";
const LIGHT = "#9ca3af";
const HAIR = "#b6bfcc";
const DIM = "#b45309";
const GLASS = "#7dd3fc";

// ── Curve helpers ────────────────────────────────────────────────────────────

/** Points along an ellipse arc, angles in degrees, CCW. */
function arcPts(
  cx: number, cy: number, rx: number, ry: number,
  a0: number, a1: number, n = 12,
): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const a = ((a0 + ((a1 - a0) * i) / n) * Math.PI) / 180;
    pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
  }
  return pts;
}

/** A rectangle with radiused corners, as an outline. */
function roundRectPts(
  x: number, y: number, w: number, h: number, r: number, n = 5,
): [number, number][] {
  const rr = Math.min(r, w / 2, h / 2);
  return [
    ...arcPts(x + w - rr, y + h - rr, rr, rr, 0, 90, n),
    ...arcPts(x + rr, y + h - rr, rr, rr, 90, 180, n),
    ...arcPts(x + rr, y + rr, rr, rr, 180, 270, n),
    ...arcPts(x + w - rr, y + rr, rr, rr, 270, 360, n),
  ];
}

/**
 * Smooth left-to-right profile through control points, mirrored about a centre.
 *
 * Used for the bowl of a toilet and the shell of a freestanding tub: give it a
 * few (halfWidth, height) pairs up one side and it returns a closed, symmetric
 * silhouette with the corners eased.
 */
function mirroredProfile(
  cx: number,
  pairs: [number, number][],
  smooth = 3,
): [number, number][] {
  const eased: [number, number][] = [];
  for (let i = 0; i < pairs.length - 1; i++) {
    const [w0, y0] = pairs[i];
    const [w1, y1] = pairs[i + 1];
    for (let s = 0; s < smooth; s++) {
      const t = s / smooth;
      // Cosine ease keeps the join tangent instead of showing a crease.
      const k = (1 - Math.cos(t * Math.PI)) / 2;
      eased.push([w0 + (w1 - w0) * k, y0 + (y1 - y0) * k]);
    }
  }
  eased.push(pairs[pairs.length - 1]);

  const right = eased.map(([hw, y]) => [cx + hw, y] as [number, number]);
  const left = [...eased].reverse().map(([hw, y]) => [cx - hw, y] as [number, number]);
  return [...right, ...left];
}

// ── Entry point ──────────────────────────────────────────────────────────────

export function buildElevation(spec: RoomSpec, wall: WallId): ElevationDrawing {
  const runIn = wallRunIn(wall, spec.room);
  const ceilIn = spec.room.ceilingHeightIn;
  const prims: Prim[] = [];
  const notes: string[] = [];

  const w = spec.walls.find((x) => x.id === wall);
  const lower = findMaterial(spec, w?.finish.materialId);
  const upper = findMaterial(spec, w?.finish.upperMaterialId);
  const splitIn =
    w?.finish.upperMaterialId && w.finish.splitHeightIn
      ? Math.min(w.finish.splitHeightIn, ceilIn)
      : ceilIn;

  // ── Finish fields + coursing ───────────────────────────────────────────────
  pushFinish(prims, notes, lower, 0, splitIn, runIn, "lower");
  if (upper && splitIn < ceilIn) {
    pushFinish(prims, notes, upper, splitIn, ceilIn, runIn, "upper");
    // The cap line is a real trim detail, so it's drawn heavier than a joint.
    prims.push({ t: "line", x1: 0, y1: splitIn, x2: runIn, y2: splitIn, stroke: DIM, lw: 1.6 });
  }

  // ── Room outline: floor, ceiling, corners ──────────────────────────────────
  prims.push({ t: "rect", x: 0, y: 0, w: runIn, h: ceilIn, stroke: INK, lw: 1.8 });
  // Floor line drawn heaviest — it's the datum everything is measured from.
  prims.push({ t: "line", x1: -4, y1: 0, x2: runIn + 4, y2: 0, stroke: INK, lw: 2.6 });

  // ── Fixtures and openings ──────────────────────────────────────────────────
  const items = elevationItems(spec, wall);
  for (const item of items) {
    if (item.kind === "fixture") {
      const f = spec.fixtures.find((x) => x.id === item.id);
      if (f) drawFixture(prims, f, spec, wall, item.uIn, item.widthIn);
    } else {
      const op = w?.openings.find((o) => o.id === item.id);
      if (op) {
        drawOpening(prims, {
          type: item.kind,
          uIn: op.uIn,
          widthIn: op.widthIn,
          vIn: op.vIn,
          heightIn: op.heightIn,
        });
      }
    }
  }

  // ── Dimensions ─────────────────────────────────────────────────────────────
  // Overall run below the wall, then a segment string for the openings so you
  // can set them out from the corner without doing the arithmetic.
  dimString(prims, 0, runIn, -9, formatFeetInches(runIn));

  const openings = [...(w?.openings ?? [])].sort((a, b) => a.uIn - b.uIn);
  if (openings.length) {
    let cursor = 0;
    const y = -19;
    for (const op of openings) {
      if (op.uIn - cursor > 1) dimString(prims, cursor, op.uIn, y, formatFeetInches(op.uIn - cursor));
      dimString(prims, op.uIn, op.uIn + op.widthIn, y, formatFeetInches(op.widthIn));
      cursor = op.uIn + op.widthIn;
    }
    if (runIn - cursor > 1) dimString(prims, cursor, runIn, y, formatFeetInches(runIn - cursor));
  }

  // Ceiling height up the left edge.
  vDimString(prims, 0, ceilIn, -12, formatFeetInches(ceilIn));

  return { wall, runIn, heightIn: ceilIn, prims, notes };
}

// ── Finish ───────────────────────────────────────────────────────────────────

function pushFinish(
  prims: Prim[],
  notes: string[],
  material: DesignMaterial | undefined,
  fromIn: number,
  toIn: number,
  runIn: number,
  band: "lower" | "upper",
) {
  const height = toIn - fromIn;
  if (height <= 0) return;

  if (!material) {
    notes.push(`No finish set on the ${band} band.`);
    return;
  }

  prims.push({ t: "rect", x: 0, y: fromIn, w: runIn, h: height, fill: material.baseColor });

  const courses = tileCourses(material, runIn, height);
  if (!courses.horizontals.length && !courses.verticals.length) return;

  const courseStep = courses.horizontals[0] ?? height;
  const tileStep = courses.verticals[0] ?? runIn;
  const staggered = (material.pattern ?? "stack") === "running";

  for (const h of courses.horizontals) {
    if (h >= height) continue;
    prims.push({ t: "line", x1: 0, y1: fromIn + h, x2: runIn, y2: fromIn + h, stroke: HAIR, lw: 0.7 });
  }

  const courseCount = Math.ceil(height / courseStep);
  for (let c = 0; c < courseCount; c++) {
    const y0 = fromIn + c * courseStep;
    const y1 = Math.min(fromIn + (c + 1) * courseStep, toIn);
    // Only a running bond staggers; a stacked bond must line up or the drawing
    // is showing a pattern that isn't being installed.
    const offset = staggered && c % 2 === 1 ? tileStep / 2 : 0;
    for (let x = offset; x < runIn - 0.01; x += tileStep) {
      if (x <= 0.01) continue;
      prims.push({ t: "line", x1: x, y1: y0, x2: x, y2: y1, stroke: HAIR, lw: 0.6 });
    }
  }

  // A closing course thinner than half a tile is a cut worth knowing about now.
  const remainder = height % courseStep;
  if (remainder > 0.25 && remainder < courseStep / 2) {
    notes.push(
      `${material.name} closes on a ${formatFeetInches(remainder)} cut at the top — consider starting the first course higher.`,
    );
  }
}

// ── Openings ─────────────────────────────────────────────────────────────────

function drawOpening(
  prims: Prim[],
  op: { type: string; uIn: number; widthIn: number; vIn: number; heightIn: number },
) {
  const { uIn: x, widthIn: w, vIn: y, heightIn: h } = op;

  if (op.type === "niche") {
    // Recess with a shelf, drawn dashed the way a recessed item is.
    prims.push({ t: "rect", x, y, w, h, fill: "#ffffff", stroke: DIM, lw: 1.2, dash: true });
    prims.push({ t: "line", x1: x, y1: y + h / 2, x2: x + w, y2: y + h / 2, stroke: DIM, lw: 0.8, dash: true });
    prims.push({ t: "text", x: x + w / 2, y: y + h + 3, s: "NICHE", size: 6, align: "center", color: DIM });
    return;
  }

  if (op.type === "window") {
    // Casing, sash, sill horn, muntin.
    prims.push({ t: "rect", x: x - 2.5, y: y - 2.5, w: w + 5, h: h + 5, stroke: INK, lw: 1 });
    prims.push({ t: "rect", x, y, w, h, fill: "#eff6ff", stroke: INK, lw: 1.4 });
    prims.push({ t: "rect", x: x + 2, y: y + 2, w: w - 4, h: h - 4, stroke: LIGHT, lw: 0.7 });
    prims.push({ t: "line", x1: x, y1: y + h / 2, x2: x + w, y2: y + h / 2, stroke: INK, lw: 1.1 });
    // Sill projecting past the casing.
    prims.push({ t: "line", x1: x - 4, y1: y - 2.5, x2: x + w + 4, y2: y - 2.5, stroke: INK, lw: 1.6 });
    return;
  }

  // Door or cased opening: casing, panel, hardware.
  prims.push({ t: "rect", x: x - 2.5, y, w: w + 5, h: h + 2.5, stroke: INK, lw: 1 });
  prims.push({ t: "rect", x, y, w, h, fill: "#ffffff", stroke: INK, lw: 1.4 });
  if (op.type === "door") {
    prims.push({ t: "rect", x: x + 4, y: y + 6, w: w - 8, h: h * 0.42, stroke: LIGHT, lw: 0.7 });
    prims.push({
      t: "rect",
      x: x + 4,
      y: y + 10 + h * 0.42,
      w: w - 8,
      h: h - h * 0.42 - 16,
      stroke: LIGHT,
      lw: 0.7,
    });
    // Lever at 36" — where it actually goes.
    prims.push({ t: "circle", cx: x + w - 4, cy: 36, r: 1.1, fill: INK });
  }
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

function drawFixture(
  prims: Prim[],
  f: Fixture,
  spec: RoomSpec,
  wall: WallId,
  uCentreIn: number,
  alongIn: number,
) {
  const x = uCentreIn - alongIn / 2;
  const w = alongIn;
  const base = f.yIn ?? 0;
  const h = wallFixtureHeightIn(f, spec.room);
  const top = base + h;

  // Facing the wall, is this fixture seen face-on or end-on? An alcove tub
  // against the back wall shows its apron; the same tub on the side wall shows
  // its end. Drawing the apron either way would be wrong.
  const p = projectFixtureOntoWall(f, wall, spec.room);
  const faceOn = Math.abs(p.alongIn - f.widthIn) < 0.51;

  switch (f.type) {
    case "vanity": {
      const counterT = 1.25;
      const toe = f.options?.style === "floating" ? 10 : 3.5;
      const cabTop = top - counterT;
      // Toe kick, set back
      if (toe > 0) prims.push({ t: "rect", x: x + 2, y: base, w: w - 4, h: toe, fill: "#e5e7eb", stroke: LIGHT, lw: 0.6 });
      // Cabinet
      prims.push({ t: "rect", x, y: base + toe, w, h: cabTop - base - toe, fill: "#f3f4f6", stroke: INK, lw: 1.2 });
      // Door / drawer divisions
      const sinks = Number(f.options?.sinks ?? 1);
      const bays = sinks >= 2 ? 4 : 2;
      for (let i = 1; i < bays; i++) {
        const dx = x + (w / bays) * i;
        prims.push({ t: "line", x1: dx, y1: base + toe, x2: dx, y2: cabTop, stroke: LIGHT, lw: 0.7 });
      }
      // A drawer bank across the top reads as a real cabinet
      prims.push({ t: "line", x1: x, y1: cabTop - 7, x2: x + w, y2: cabTop - 7, stroke: LIGHT, lw: 0.7 });
      for (let i = 0; i < bays; i++) {
        const cx = x + (w / bays) * (i + 0.5);
        prims.push({ t: "line", x1: cx - 2.5, y1: cabTop - 3.5, x2: cx + 2.5, y2: cabTop - 3.5, stroke: INK, lw: 1.1 });
      }
      // Counter with overhang + backsplash
      prims.push({ t: "rect", x: x - 0.75, y: cabTop, w: w + 1.5, h: counterT, fill: "#e7e5e4", stroke: INK, lw: 1.2 });
      prims.push({ t: "rect", x, y: top, w, h: 4, fill: "#e7e5e4", stroke: INK, lw: 0.9 });
      // Faucet + bowl (bowl dashed — it's below the counter line)
      for (let i = 0; i < Math.max(1, sinks); i++) {
        const cx = x + (w / Math.max(1, sinks)) * (i + 0.5);
        prims.push({ t: "line", x1: cx, y1: top + 4, x2: cx, y2: top + 11, stroke: INK, lw: 1.2 });
        prims.push({ t: "line", x1: cx, y1: top + 11, x2: cx + 4, y2: top + 11, stroke: INK, lw: 1.2 });
        // Bowl below the counter line, dashed because it's hidden by the top.
        prims.push({
          t: "poly",
          pts: arcPts(cx, cabTop, 7, 6, 180, 360, 14),
          stroke: LIGHT, lw: 0.6, dash: true,
        });
      }
      break;
    }

    case "toilet": {
      const wallHung = f.options?.style === "wall_hung";
      const cx = x + w / 2;
      const rimY = base + (wallHung ? 15.5 : 15);

      // Bowl: a real silhouette, narrow at the foot and flaring to the rim.
      // Drawn as stacked boxes this reads as a filing cabinet, which is what
      // the first version looked like.
      const bowl = wallHung
        ? mirroredProfile(cx, [
            [w * 0.30, base],
            [w * 0.40, base + 2],
            [w * 0.46, base + 6],
            [w * 0.48, rimY - 2],
            [w * 0.50, rimY],
          ])
        : mirroredProfile(cx, [
            [w * 0.30, base],
            [w * 0.26, base + 3],
            [w * 0.24, base + 7],
            [w * 0.34, rimY - 7],
            [w * 0.46, rimY - 3],
            [w * 0.50, rimY],
          ]);
      prims.push({ t: "poly", pts: bowl, fill: "#ffffff", stroke: INK, lw: 1.3, close: true });

      // Seat and lid, with the rounded lip that projects past the bowl.
      prims.push({
        t: "poly",
        pts: roundRectPts(x + w * 0.02, rimY, w * 0.96, 2.2, 1.1),
        fill: "#ffffff", stroke: INK, lw: 1.2, close: true,
      });

      if (!wallHung) {
        // Tank: eased corners and a lid overhang, not a plain box.
        const tankBot = rimY + 2.2;
        const tankH = 15;
        prims.push({
          t: "poly",
          pts: roundRectPts(x + w * 0.07, tankBot, w * 0.86, tankH, 1.6),
          fill: "#ffffff", stroke: INK, lw: 1.3, close: true,
        });
        prims.push({
          t: "poly",
          pts: roundRectPts(x + w * 0.03, tankBot + tankH, w * 0.94, 1.8, 0.9),
          fill: "#ffffff", stroke: INK, lw: 1.2, close: true,
        });
        // Flush lever
        prims.push({ t: "circle", cx: x + w * 0.82, cy: tankBot + tankH - 3.5, r: 0.9, fill: INK });
      } else {
        prims.push({
          t: "text",
          x: cx, y: base - 7, s: `${Math.round(base)}" AFF`,
          size: 5.5, align: "center", color: DIM,
        });
      }
      break;
    }

    case "tub": {
      const style = String(f.options?.style ?? "alcove");
      const cx = x + w / 2;

      if (style === "freestanding") {
        // A slipper shell: waisted at the foot, flaring to the rim.
        const shell = mirroredProfile(cx, [
          [w * 0.34, base],
          [w * 0.40, base + 2],
          [w * 0.47, base + h * 0.45],
          [w * 0.50, top - 1.5],
          [w * 0.50, top],
        ]);
        prims.push({ t: "poly", pts: shell, fill: "#ffffff", stroke: INK, lw: 1.5, close: true });
        // Inner rim line
        prims.push({
          t: "line",
          x1: x + w * 0.05, y1: top - 1.6, x2: x + w * 0.95, y2: top - 1.6,
          stroke: LIGHT, lw: 0.7,
        });
      } else {
        // Alcove: apron to the floor with the top corners eased, plus the
        // reveal that makes it read as a tub rather than a plinth.
        prims.push({
          t: "poly",
          pts: roundRectPts(x, base, w, h, 1.6),
          fill: "#ffffff", stroke: INK, lw: 1.5, close: true,
        });
        prims.push({ t: "line", x1: x, y1: top - 2.5, x2: x + w, y2: top - 2.5, stroke: INK, lw: 1.1 });
        if (faceOn) {
          prims.push({
            t: "poly",
            pts: roundRectPts(x + 2.5, base + 2, w - 5, h - 7, 1.2),
            stroke: LIGHT, lw: 0.6, close: true,
          });
        }
      }

      if (faceOn) {
        // Filler + valve above the rim
        prims.push({ t: "circle", cx, cy: 30, r: 1.6, stroke: INK, lw: 1 });
        prims.push({ t: "line", x1: cx, y1: 38, x2: cx, y2: 44, stroke: INK, lw: 1.2 });
        prims.push({ t: "line", x1: cx, y1: 44, x2: cx + 4, y2: 44, stroke: INK, lw: 1.2 });
      }
      break;
    }

    case "shower": {
      const curb = Number(f.options?.curbHeightIn ?? 4);
      const enclosure = String(f.options?.enclosure ?? "open");
      // Tiled curb
      if (curb > 0) prims.push({ t: "rect", x, y: base, w, h: curb, fill: "#e7e5e4", stroke: INK, lw: 1.2 });
      // Valve at 46", head at 78" — the heights that get roughed in.
      prims.push({ t: "circle", cx: x + w / 2, cy: 46, r: 2.2, stroke: INK, lw: 1.2 });
      prims.push({ t: "text", x: x + w / 2 + 6, y: 46 - 1.5, s: `46" valve`, size: 5.5, color: DIM });
      prims.push({ t: "line", x1: x + w / 2, y1: 78, x2: x + w / 2, y2: 78 + 4, stroke: INK, lw: 1.2 });
      prims.push({ t: "line", x1: x + w / 2 - 4, y1: 82, x2: x + w / 2 + 4, y2: 82, stroke: INK, lw: 1.6 });
      prims.push({ t: "text", x: x + w / 2 + 8, y: 78, s: `78" head`, size: 5.5, color: DIM });
      if (enclosure === "glass_panel" || enclosure === "glass_door") {
        const gTop = Number(f.options?.glassHeightIn ?? 76);
        prims.push({ t: "rect", x, y: curb, w, h: gTop - curb, stroke: GLASS, lw: 1.1, dash: true });
        prims.push({ t: "text", x: x + w / 2, y: gTop + 3, s: "GLASS", size: 5.5, align: "center", color: GLASS });
      }
      break;
    }

    case "mirror":
    case "medicine_cabinet": {
      prims.push({ t: "rect", x, y: base, w, h, fill: "#f8fafc", stroke: INK, lw: 1.2 });
      // Diagonal is the drawing convention for a mirrored face.
      prims.push({ t: "line", x1: x, y1: base, x2: x + w, y2: top, stroke: LIGHT, lw: 0.6 });
      break;
    }

    case "knee_wall":
    case "partition": {
      const doorway = partitionDoorway(f);
      if (doorway) {
        const dx = x + doorway.offsetIn;
        prims.push({ t: "rect", x, y: base, w: doorway.offsetIn, h, fill: "#eceae6", stroke: INK, lw: 1.3 });
        const rightW = w - doorway.offsetIn - doorway.widthIn;
        if (rightW > 0.5) {
          prims.push({ t: "rect", x: dx + doorway.widthIn, y: base, w: rightW, h, fill: "#eceae6", stroke: INK, lw: 1.3 });
        }
        const headerH = h - doorway.heightIn;
        if (headerH > 0.5) {
          prims.push({ t: "rect", x: dx, y: base + doorway.heightIn, w: doorway.widthIn, h: headerH, fill: "#eceae6", stroke: INK, lw: 1.3 });
        }
      } else {
        prims.push({ t: "rect", x, y: base, w, h, fill: "#eceae6", stroke: INK, lw: 1.3 });
      }
      if (f.type === "knee_wall") {
        // Cap
        prims.push({ t: "rect", x: x - 0.75, y: top, w: w + 1.5, h: 1.25, fill: "#e7e5e4", stroke: INK, lw: 1 });
      }
      break;
    }

    case "towel_bar": {
      prims.push({ t: "line", x1: x, y1: base, x2: x + w, y2: base, stroke: INK, lw: 1.6 });
      prims.push({ t: "line", x1: x, y1: base - 2.5, x2: x, y2: base + 1, stroke: INK, lw: 1.2 });
      prims.push({ t: "line", x1: x + w, y1: base - 2.5, x2: x + w, y2: base + 1, stroke: INK, lw: 1.2 });
      prims.push({ t: "text", x: x + w / 2, y: base - 8, s: `${Math.round(base)}" AFF`, size: 5.5, align: "center", color: DIM });
      break;
    }

    case "sconce": {
      prims.push({ t: "circle", cx: x + w / 2, cy: base + h / 2, r: Math.max(2, w / 2), fill: "#fffbeb", stroke: INK, lw: 1 });
      prims.push({ t: "text", x: x + w / 2, y: base - 7, s: `${Math.round(base)}" AFF`, size: 5.5, align: "center", color: DIM });
      break;
    }

    case "linen_cabinet": {
      prims.push({ t: "rect", x, y: base, w, h, fill: "#f3f4f6", stroke: INK, lw: 1.2 });
      // Shelves
      for (let i = 1; i < 5; i++) {
        const sy = base + (h / 5) * i;
        prims.push({ t: "line", x1: x + 1, y1: sy, x2: x + w - 1, y2: sy, stroke: LIGHT, lw: 0.5, dash: true });
      }
      prims.push({ t: "line", x1: x + w / 2, y1: base, x2: x + w / 2, y2: top, stroke: LIGHT, lw: 0.7 });
      break;
    }

    default: {
      prims.push({ t: "rect", x, y: base, w, h, fill: "#f3f4f6", stroke: LIGHT, lw: 1 });
      if (w > 30) {
        prims.push({
          t: "text",
          x: x + w / 2,
          y: base + h / 2,
          s: (f.label ?? f.type.replace(/_/g, " ")).toUpperCase(),
          size: 6,
          align: "center",
          color: LIGHT,
        });
      }
    }
  }
}

// ── Dimension strings ────────────────────────────────────────────────────────

function dimString(prims: Prim[], from: number, to: number, y: number, label: string) {
  const tick = 3;
  prims.push({ t: "line", x1: from, y1: y, x2: to, y2: y, stroke: DIM, lw: 0.8 });
  prims.push({ t: "line", x1: from, y1: y - tick, x2: from, y2: y + tick, stroke: DIM, lw: 0.8 });
  prims.push({ t: "line", x1: to, y1: y - tick, x2: to, y2: y + tick, stroke: DIM, lw: 0.8 });
  prims.push({ t: "text", x: (from + to) / 2, y: y + 4, s: label, size: 6.5, align: "center", color: DIM, bold: true });
}

function vDimString(prims: Prim[], from: number, to: number, x: number, label: string) {
  const tick = 3;
  prims.push({ t: "line", x1: x, y1: from, x2: x, y2: to, stroke: DIM, lw: 0.8 });
  prims.push({ t: "line", x1: x - tick, y1: from, x2: x + tick, y2: from, stroke: DIM, lw: 0.8 });
  prims.push({ t: "line", x1: x - tick, y1: to, x2: x + tick, y2: to, stroke: DIM, lw: 0.8 });
  prims.push({ t: "text", x: x - 5, y: (from + to) / 2, s: label, size: 6.5, align: "center", color: DIM, bold: true });
}

/** Room the drawing needs around the wall itself for dimensions and callouts. */
export const ELEVATION_MARGIN = { left: 22, right: 10, top: 10, bottom: 26 };
