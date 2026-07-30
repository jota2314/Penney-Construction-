"use client";

/**
 * Wall elevations — the rest of the drawing set.
 *
 * A plan tells you where things sit; an elevation tells you how they land on
 * the wall, which on a tile job is the part that matters: where the courses
 * fall, whether you finish on a sliver at the ceiling, whether the niche lines
 * up with the coursing, how high the valve and the bar sit.
 *
 * Drawn from the same RoomSpec as the plan and the 3D, so it can't disagree
 * with them. Not editable on purpose — the plan is the editing surface, and two
 * places to drag the same vanity is two places for them to get out of step.
 */

import {
  type RoomSpec,
  type WallId,
  type DesignMaterial,
  WALL_IDS,
  WALL_LABELS,
  formatFeetInches,
  findMaterial,
  wallRunIn,
} from "@/types/design";
import { elevationItems, tileCourses, type ElevationItem } from "@/lib/design/plan";

const PAD = 46;

export function ElevationView({ spec }: { spec: RoomSpec }) {
  return (
    <div className="space-y-4">
      <p className="text-[11px] text-muted-foreground">
        Each wall as you face it from inside the room. Tile coursing is drawn at the real
        product size, so the last course at the ceiling is the one you&apos;d actually cut.
      </p>
      {WALL_IDS.map((id) => (
        <WallElevation key={id} spec={spec} wall={id} />
      ))}
    </div>
  );
}

function WallElevation({ spec, wall }: { spec: RoomSpec; wall: WallId }) {
  const runIn = wallRunIn(wall, spec.room);
  const ceilIn = spec.room.ceilingHeightIn;

  const w = spec.walls.find((x) => x.id === wall);
  const lower = findMaterial(spec, w?.finish.materialId);
  const upper = findMaterial(spec, w?.finish.upperMaterialId);
  const splitIn =
    w?.finish.upperMaterialId && w.finish.splitHeightIn
      ? Math.min(w.finish.splitHeightIn, ceilIn)
      : ceilIn;

  // Cheap enough to recompute; the React Compiler memoizes it better than a
  // hand-written useMemo, which it refuses to optimize around.
  const items = elevationItems(spec, wall);

  // Fit the wall into a fixed drawing box; taller rooms just draw smaller.
  const boxW = 640;
  const scale = (boxW - PAD * 2) / runIn;
  const boxH = ceilIn * scale + PAD * 2;

  const X = (uIn: number) => PAD + uIn * scale;
  // Elevations are drawn with the floor at the BOTTOM, so y is inverted.
  const Y = (heightIn: number) => boxH - PAD - heightIn * scale;

  const lowerCourses = tileCourses(lower, runIn, splitIn);
  const upperCourses =
    upper && splitIn < ceilIn ? tileCourses(upper, runIn, ceilIn - splitIn) : null;

  return (
    <div className="rounded-lg border bg-card p-2 overflow-x-auto">
      <div className="flex items-baseline justify-between mb-1 px-1">
        <span className="text-xs font-medium">{WALL_LABELS[wall]}</span>
        <span className="text-[11px] text-muted-foreground">
          {formatFeetInches(runIn)} wide x {formatFeetInches(ceilIn)} high
        </span>
      </div>

      <svg width={boxW} height={boxH} className="min-w-[640px]">
        {/* Wall face */}
        <rect
          x={X(0)}
          y={Y(ceilIn)}
          width={runIn * scale}
          height={ceilIn * scale}
          className="fill-muted/30 stroke-foreground"
          strokeWidth={1.5}
        />

        {/* Finishes as flat colour bands behind the coursing */}
        <FinishBand
          material={lower}
          x={X(0)}
          y={Y(splitIn)}
          width={runIn * scale}
          height={splitIn * scale}
        />
        {upper && splitIn < ceilIn && (
          <FinishBand
            material={upper}
            x={X(0)}
            y={Y(ceilIn)}
            width={runIn * scale}
            height={(ceilIn - splitIn) * scale}
          />
        )}

        {/* Tile coursing */}
        <Courses
          courses={lowerCourses}
          X={X}
          Y={Y}
          runIn={runIn}
          fromIn={0}
          toIn={splitIn}
          scale={scale}
        />
        {upperCourses && (
          <Courses
            courses={upperCourses}
            X={X}
            Y={Y}
            runIn={runIn}
            fromIn={splitIn}
            toIn={ceilIn}
            scale={scale}
          />
        )}

        {/* The wainscot line is a real trim detail, so it's drawn heavier */}
        {upper && splitIn < ceilIn && (
          <line
            x1={X(0)}
            y1={Y(splitIn)}
            x2={X(runIn)}
            y2={Y(splitIn)}
            className="stroke-amber-600"
            strokeWidth={2}
          />
        )}

        {items.map((item) => (
          <ElevationShape key={`${item.kind}-${item.id}`} item={item} X={X} Y={Y} scale={scale} />
        ))}

        {/* Overall dimension string under the wall */}
        <DimLine
          x1={X(0)}
          x2={X(runIn)}
          y={boxH - PAD + 22}
          label={formatFeetInches(runIn)}
        />
        {/* Ceiling height up the left side */}
        <VertDim x={PAD - 22} y1={Y(0)} y2={Y(ceilIn)} label={formatFeetInches(ceilIn)} />
      </svg>

      {items.length === 0 && (
        <p className="text-[11px] text-muted-foreground px-1 pb-1">
          Nothing on this wall yet.
        </p>
      )}
    </div>
  );
}

// ── Pieces ───────────────────────────────────────────────────────────────────

function FinishBand({
  material,
  x,
  y,
  width,
  height,
}: {
  material: DesignMaterial | undefined;
  x: number;
  y: number;
  width: number;
  height: number;
}) {
  if (!material || height <= 0) return null;
  return <rect x={x} y={y} width={width} height={height} fill={material.baseColor} opacity={0.55} />;
}

/**
 * Grout lines for one band.
 *
 * Verticals are offset per course for a running bond so the drawing shows the
 * actual bond rather than a uniform grid — that offset is exactly what someone
 * checks an elevation for.
 */
function Courses({
  courses,
  X,
  Y,
  runIn,
  fromIn,
  toIn,
  scale,
}: {
  courses: { horizontals: number[]; verticals: number[] };
  X: (u: number) => number;
  Y: (h: number) => number;
  runIn: number;
  fromIn: number;
  toIn: number;
  scale: number;
}) {
  if (!courses.horizontals.length && !courses.verticals.length) return null;

  const bandHeight = toIn - fromIn;
  const courseStep = courses.horizontals[0] ?? bandHeight;
  const tileStep = courses.verticals[0] ?? runIn;

  const lines: React.ReactNode[] = [];

  courses.horizontals.forEach((h, i) => {
    if (h > bandHeight) return;
    lines.push(
      <line
        key={`h${i}`}
        x1={X(0)}
        y1={Y(fromIn + h)}
        x2={X(runIn)}
        y2={Y(fromIn + h)}
        className="stroke-foreground/25"
        strokeWidth={0.6}
      />,
    );
  });

  // One set of verticals per course, offset on alternate courses.
  const courseCount = Math.ceil(bandHeight / courseStep);
  for (let c = 0; c < courseCount; c++) {
    const y0 = fromIn + c * courseStep;
    const y1 = Math.min(fromIn + (c + 1) * courseStep, toIn);
    const offset = c % 2 === 1 ? tileStep / 2 : 0;
    for (let x = offset; x < runIn; x += tileStep) {
      if (x <= 0) continue;
      lines.push(
        <line
          key={`v${c}-${x}`}
          x1={X(x)}
          y1={Y(y0)}
          x2={X(x)}
          y2={Y(y1)}
          className="stroke-foreground/20"
          strokeWidth={0.5}
        />,
      );
    }
  }

  // Flag a closing course thinner than half a tile — the sliver you'd rather
  // find here than on the wall.
  const remainder = bandHeight % courseStep;
  if (remainder > 0.25 && remainder < courseStep / 2) {
    lines.push(
      <text
        key="sliver"
        x={X(runIn) - 4}
        y={Y(toIn) + 11}
        textAnchor="end"
        className="fill-amber-600"
        style={{ fontSize: 9, fontWeight: 600 }}
      >
        {`closes on a ${formatFeetInches(remainder)} cut`}
      </text>,
    );
  }

  void scale;
  return <g>{lines}</g>;
}

function ElevationShape({
  item,
  X,
  Y,
  scale,
}: {
  item: ElevationItem;
  X: (u: number) => number;
  Y: (h: number) => number;
  scale: number;
}) {
  const x = X(item.uIn - item.widthIn / 2);
  const y = Y(item.topIn);
  const w = item.widthIn * scale;
  const h = (item.topIn - item.bottomIn) * scale;
  if (w <= 0 || h <= 0) return null;

  const tone =
    item.kind === "niche"
      ? "fill-amber-500/20 stroke-amber-600"
      : item.kind === "window"
        ? "fill-sky-500/15 stroke-sky-500"
        : item.kind === "door" || item.kind === "cased_opening"
          ? "fill-background stroke-foreground"
          : "fill-card/80 stroke-muted-foreground";

  const showLabel = w > 46 && h > 16;

  return (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={2}
        className={tone}
        strokeWidth={item.kind === "fixture" ? 1.2 : 1.6}
        strokeDasharray={item.kind === "niche" ? "4 2" : undefined}
      />
      {showLabel && (
        <text
          x={x + w / 2}
          y={y + h / 2 + 3}
          textAnchor="middle"
          className="fill-foreground"
          style={{ fontSize: 9 }}
        >
          {item.label}
        </text>
      )}
      {/* Height above the floor — the number you'd set it by on site. */}
      {item.bottomIn > 0.5 && (
        <text
          x={x + w / 2}
          y={Y(item.bottomIn) + 10}
          textAnchor="middle"
          className="fill-amber-600"
          style={{ fontSize: 8.5, fontWeight: 600 }}
        >
          {formatFeetInches(item.bottomIn)} AFF
        </text>
      )}
    </g>
  );
}

function DimLine({
  x1,
  x2,
  y,
  label,
}: {
  x1: number;
  x2: number;
  y: number;
  label: string;
}) {
  return (
    <g className="stroke-amber-600 fill-amber-600">
      <line x1={x1} y1={y} x2={x2} y2={y} strokeWidth={1} />
      <line x1={x1} y1={y - 4} x2={x1} y2={y + 4} strokeWidth={1} />
      <line x1={x2} y1={y - 4} x2={x2} y2={y + 4} strokeWidth={1} />
      <text
        x={(x1 + x2) / 2}
        y={y - 4}
        textAnchor="middle"
        className="stroke-none"
        style={{ fontSize: 10, fontWeight: 600 }}
      >
        {label}
      </text>
    </g>
  );
}

function VertDim({
  x,
  y1,
  y2,
  label,
}: {
  x: number;
  y1: number;
  y2: number;
  label: string;
}) {
  return (
    <g className="stroke-amber-600 fill-amber-600">
      <line x1={x} y1={y1} x2={x} y2={y2} strokeWidth={1} />
      <line x1={x - 4} y1={y1} x2={x + 4} y2={y1} strokeWidth={1} />
      <line x1={x - 4} y1={y2} x2={x + 4} y2={y2} strokeWidth={1} />
      <text
        x={x - 6}
        y={(y1 + y2) / 2}
        textAnchor="middle"
        transform={`rotate(-90 ${x - 6} ${(y1 + y2) / 2})`}
        className="stroke-none"
        style={{ fontSize: 10, fontWeight: 600 }}
      >
        {label}
      </text>
    </g>
  );
}
