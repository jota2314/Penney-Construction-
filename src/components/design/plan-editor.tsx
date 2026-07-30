"use client";

/**
 * Drag-and-drop floor plan.
 *
 * The editing surface: a top-down view where fixtures and openings are dragged
 * by hand. Everything writes straight back into the same RoomSpec the 3D viewer
 * and the takeoff read, so a nudge here updates the model and the tile
 * quantities together.
 *
 * SVG rather than canvas — hit testing is free, handles stay crisp at any zoom,
 * and the whole thing stays declarative against the spec.
 *
 * Pointer events (not mouse) so it works with a finger on the iPad on site.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type RoomSpec,
  type Fixture,
  type WallId,
  type WallOpening,
  formatFeetInches,
  WALL_LABELS,
} from "@/types/design";
import {
  planTransform,
  xToPx,
  zToPx,
  toPx,
  snapFixture,
  snapToQuarterInch,
  openingSegment,
  doorSwing,
  nearestWall,
  pointToU,
  checkClearances,
  normalizeAngle,
  isWallFixture,
  partitionDoorway,
  type PlanTransform,
} from "@/lib/design/plan";
import {
  updateFixture,
  updateOpening,
  moveOpeningToWall,
  resizeFixtureByHandle,
  resizeOpeningByHandle,
  resizeRoomByWall,
  type FixtureHandle,
  type OpeningHandle,
} from "@/lib/design/plan-edits";

export type Selection =
  | { kind: "fixture"; id: string }
  | { kind: "opening"; wall: WallId; id: string }
  | null;

interface DragState {
  kind: "fixture" | "opening" | "resize-fixture" | "resize-opening" | "wall";
  id: string;
  wall?: WallId;
  handle?: FixtureHandle | OpeningHandle;
  /** Pointer position at grab time, px. */
  startPx: { x: number; y: number };
  /** Item position at grab time, inches. */
  startIn: { x: number; z: number };
  /** Item size at grab time, inches. Resizes measure against this, not the
   *  live value, so rounding can't accumulate over a long drag. */
  startSize?: { w: number; d: number };
  /** Was this already the selection when grabbed? A second click on an
   *  already-selected door flips its hinge. */
  wasSelected?: boolean;
  moved: boolean;
}

export function PlanEditor({
  spec,
  onSpecChange,
  selection,
  onSelectionChange,
  className,
}: {
  spec: RoomSpec;
  /** `commit` false while a drag is in flight, true on release. */
  onSpecChange: (next: RoomSpec, commit: boolean) => void;
  selection: Selection;
  onSelectionChange: (next: Selection) => void;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const dragRef = useRef<DragState | null>(null);
  const [guides, setGuides] = useState<{ x: boolean; z: boolean }>({ x: false, z: false });

  // Track the container so the plan always fills the pane.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const t = useMemo(
    () => planTransform(spec.room, size.w, size.h),
    [spec.room, size.w, size.h],
  );

  const issues = useMemo(() => checkClearances(spec), [spec]);
  const issueByFixture = useMemo(() => {
    const m = new Map<string, "warn" | "error">();
    for (const i of issues) {
      if (i.severity === "error" || !m.has(i.fixtureId)) m.set(i.fixtureId, i.severity);
    }
    return m;
  }, [issues]);

  /** Pointer position in SVG pixel space. */
  const pointerPx = useCallback((e: React.PointerEvent | PointerEvent) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);

  // ── Drag ───────────────────────────────────────────────────────────────────

  const beginFixtureDrag = (e: React.PointerEvent, f: Fixture) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    onSelectionChange({ kind: "fixture", id: f.id });
    dragRef.current = {
      kind: "fixture",
      id: f.id,
      startPx: pointerPx(e),
      startIn: { x: f.x, z: f.z },
      moved: false,
    };
  };

  const beginOpeningDrag = (e: React.PointerEvent, wall: WallId, op: WallOpening) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const wasSelected =
      selection?.kind === "opening" && selection.id === op.id && selection.wall === wall;
    onSelectionChange({ kind: "opening", wall, id: op.id });
    const seg = openingSegment(wall, op, spec.room);
    dragRef.current = {
      kind: "opening",
      id: op.id,
      wall,
      startPx: pointerPx(e),
      startIn: { x: (seg.x1 + seg.x2) / 2, z: (seg.z1 + seg.z2) / 2 },
      wasSelected,
      moved: false,
    };
  };

  const beginFixtureResize = (e: React.PointerEvent, f: Fixture, handle: FixtureHandle) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    onSelectionChange({ kind: "fixture", id: f.id });
    dragRef.current = {
      kind: "resize-fixture",
      id: f.id,
      handle,
      startPx: pointerPx(e),
      startIn: { x: f.x, z: f.z },
      startSize: { w: f.widthIn, d: f.depthIn },
      moved: false,
    };
  };

  const beginOpeningResize = (
    e: React.PointerEvent,
    wall: WallId,
    op: WallOpening,
    handle: OpeningHandle,
  ) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    onSelectionChange({ kind: "opening", wall, id: op.id });
    dragRef.current = {
      kind: "resize-opening",
      id: op.id,
      wall,
      handle,
      startPx: pointerPx(e),
      startIn: { x: op.uIn, z: 0 },
      startSize: { w: op.widthIn, d: 0 },
      moved: false,
    };
  };

  const beginWallDrag = (e: React.PointerEvent, wall: WallId) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    onSelectionChange(null);
    dragRef.current = {
      kind: "wall",
      id: wall,
      wall,
      startPx: pointerPx(e),
      startIn: { x: spec.room.widthIn, z: spec.room.lengthIn },
      moved: false,
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;

    const now = pointerPx(e);
    const dxIn = (now.x - drag.startPx.x) / t.scale;
    const dzIn = (now.y - drag.startPx.y) / t.scale;

    // Ignore sub-pixel jitter so a click doesn't register as a drag.
    if (!drag.moved && Math.hypot(now.x - drag.startPx.x, now.y - drag.startPx.y) < 3) return;
    drag.moved = true;

    if (drag.kind === "resize-fixture") {
      onSpecChange(
        resizeFixtureByHandle(
          spec,
          drag.id,
          drag.handle as FixtureHandle,
          drag.startSize?.w ?? 0,
          drag.startSize?.d ?? 0,
          drag.startIn.x,
          drag.startIn.z,
          dxIn,
          dzIn,
        ),
        false,
      );
      return;
    }

    if (drag.kind === "resize-opening") {
      onSpecChange(
        resizeOpeningByHandle(
          spec,
          drag.wall as WallId,
          drag.id,
          drag.handle as OpeningHandle,
          drag.startIn.x,
          drag.startSize?.w ?? 0,
          dxIn,
          dzIn,
        ),
        false,
      );
      return;
    }

    if (drag.kind === "wall") {
      // Outward is +x for the right wall and −x for the left, and likewise on z.
      const wall = drag.wall as WallId;
      const outward =
        wall === "right" ? dxIn
        : wall === "left" ? -dxIn
        : wall === "front" ? dzIn
        : -dzIn;
      const base = wall === "left" || wall === "right" ? drag.startIn.x : drag.startIn.z;
      const current =
        wall === "left" || wall === "right" ? spec.room.widthIn : spec.room.lengthIn;
      // resizeRoomByWall takes an incremental delta, so feed it the difference
      // between where this drag should have got to and where the room is now.
      onSpecChange(resizeRoomByWall(spec, wall, base + outward - current), false);
      return;
    }

    if (drag.kind === "fixture") {
      const f = spec.fixtures.find((x) => x.id === drag.id);
      if (!f) return;
      const snapped = snapFixture(f, drag.startIn.x + dxIn, drag.startIn.z + dzIn, spec);
      setGuides({ x: snapped.snappedX, z: snapped.snappedZ });
      onSpecChange(
        updateFixture(spec, f.id, {
          x: snapToQuarterInch(snapped.x),
          z: snapToQuarterInch(snapped.z),
        }),
        false,
      );
      return;
    }

    // Openings slide along their wall, and hop to a neighbouring wall when
    // dragged onto it — which is how you'd move a window round a corner.
    const wall = drag.wall as WallId;
    const op = spec.walls.find((w) => w.id === wall)?.openings.find((o) => o.id === drag.id);
    if (!op) return;

    const px = drag.startIn.x + dxIn;
    const pz = drag.startIn.z + dzIn;
    const target = nearestWall(px, pz, spec.room);

    if (target.wall !== wall && target.distance < 14) {
      const u = pointToU(target.wall, px, pz, op.widthIn, spec.room);
      onSpecChange(moveOpeningToWall(spec, wall, op.id, target.wall, snapToQuarterInch(u)), false);
      drag.wall = target.wall;
      onSelectionChange({ kind: "opening", wall: target.wall, id: op.id });
      return;
    }

    const u = pointToU(wall, px, pz, op.widthIn, spec.room);
    onSpecChange(updateOpening(spec, wall, op.id, { uIn: snapToQuarterInch(u) }), false);
  };

  const endDrag = () => {
    const drag = dragRef.current;
    dragRef.current = null;
    setGuides({ x: false, z: false });

    // Clicking an already-selected door (without dragging) flips its hinge —
    // the fastest way to try the other swing.
    if (drag && !drag.moved && drag.kind === "opening" && drag.wasSelected) {
      const op = spec.walls
        .find((w) => w.id === drag.wall)
        ?.openings.find((o) => o.id === drag.id);
      if (op?.type === "door") {
        onSpecChange(
          updateOpening(spec, drag.wall as WallId, op.id, {
            hinge: (op.hinge ?? "left") === "left" ? "right" : "left",
          }),
          true,
        );
        return;
      }
    }

    // Only persist if something actually moved — a plain click shouldn't
    // create a version.
    if (drag?.moved) onSpecChange(spec, true);
  };

  // Delete / nudge with the keyboard once something is selected.
  useEffect(() => {
    if (!selection) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      const step = e.shiftKey ? 6 : 1;
      let dx = 0;
      let dz = 0;
      if (e.key === "ArrowLeft") dx = -step;
      else if (e.key === "ArrowRight") dx = step;
      else if (e.key === "ArrowUp") dz = -step;
      else if (e.key === "ArrowDown") dz = step;
      else if (e.key === "Escape") {
        onSelectionChange(null);
        return;
      } else return;

      e.preventDefault();

      if (selection.kind === "fixture") {
        const f = spec.fixtures.find((x) => x.id === selection.id);
        if (!f) return;
        const snapped = snapFixture(f, f.x + dx, f.z + dz, spec);
        onSpecChange(updateFixture(spec, f.id, { x: snapped.x, z: snapped.z }), true);
      } else {
        const op = spec.walls
          .find((w) => w.id === selection.wall)
          ?.openings.find((o) => o.id === selection.id);
        if (!op) return;
        // Along-wall movement only; the wall decides which axis that is.
        const along = selection.wall === "back" ? dx
          : selection.wall === "front" ? -dx
          : selection.wall === "right" ? dz
          : -dz;
        if (along === 0) return;
        onSpecChange(
          updateOpening(spec, selection.wall, op.id, { uIn: Math.max(0, op.uIn + along) }),
          true,
        );
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selection, spec, onSpecChange, onSelectionChange]);

  const wallPx = Math.max(4, toPx(4.5, t));

  return (
    <div ref={containerRef} className={className}>
      <svg
        ref={svgRef}
        width={size.w}
        height={size.h}
        className="touch-none select-none"
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerDown={() => onSelectionChange(null)}
      >
        <Grid t={t} spec={spec} />

        {/* Floor */}
        <rect
          x={xToPx(0, t)}
          y={zToPx(0, t)}
          width={t.widthPx}
          height={t.heightPx}
          className="fill-muted/40"
        />

        <Walls t={t} wallPx={wallPx} onWallDrag={beginWallDrag} />

        {spec.walls.map((w) =>
          w.openings.map((op) => (
            <OpeningShape
              key={`${w.id}-${op.id}`}
              wall={w.id}
              op={op}
              spec={spec}
              t={t}
              wallPx={wallPx}
              selected={
                selection?.kind === "opening" &&
                selection.id === op.id &&
                selection.wall === w.id
              }
              onPointerDown={(e) => beginOpeningDrag(e, w.id, op)}
              onResizeStart={(e, h) => beginOpeningResize(e, w.id, op, h)}
            />
          )),
        )}

        {spec.fixtures.map((f) => (
          <FixtureShape
            key={f.id}
            f={f}
            t={t}
            selected={selection?.kind === "fixture" && selection.id === f.id}
            issue={issueByFixture.get(f.id)}
            onPointerDown={(e) => beginFixtureDrag(e, f)}
            onResizeStart={(e, h) => beginFixtureResize(e, f, h)}
          />
        ))}

        <SnapGuides t={t} spec={spec} selection={selection} guides={guides} />
        <RoomDimensions t={t} spec={spec} />
      </svg>
    </div>
  );
}

// ── Pieces ───────────────────────────────────────────────────────────────────

function Grid({ t, spec }: { t: PlanTransform; spec: RoomSpec }) {
  // One line per foot. Denser than that is noise at this scale.
  const lines: React.ReactNode[] = [];
  for (let ft = 1; ft * 12 < spec.room.widthIn; ft++) {
    const x = xToPx(ft * 12, t);
    lines.push(
      <line
        key={`vx${ft}`}
        x1={x}
        y1={zToPx(0, t)}
        x2={x}
        y2={zToPx(spec.room.lengthIn, t)}
        className="stroke-border"
        strokeWidth={ft % 5 === 0 ? 1 : 0.5}
      />,
    );
  }
  for (let ft = 1; ft * 12 < spec.room.lengthIn; ft++) {
    const y = zToPx(ft * 12, t);
    lines.push(
      <line
        key={`hz${ft}`}
        x1={xToPx(0, t)}
        y1={y}
        x2={xToPx(spec.room.widthIn, t)}
        y2={y}
        className="stroke-border"
        strokeWidth={ft % 5 === 0 ? 1 : 0.5}
      />,
    );
  }
  return <g opacity={0.5}>{lines}</g>;
}

/**
 * The four walls, each draggable to resize the room.
 *
 * The wall itself is the handle rather than a separate grip — it is a big
 * obvious target and matches the mental model ("push that wall out a foot").
 * A wider transparent strip sits over each one so you can catch it without
 * pixel-hunting.
 */
function Walls({
  t,
  wallPx,
  onWallDrag,
}: {
  t: PlanTransform;
  wallPx: number;
  onWallDrag: (e: React.PointerEvent, wall: WallId) => void;
}) {
  const x0 = xToPx(0, t);
  const z0 = zToPx(0, t);
  const w = t.widthPx;
  const h = t.heightPx;
  const grab = Math.max(wallPx * 2, 12);

  const walls: {
    id: WallId;
    x: number; y: number; width: number; height: number;
    gx: number; gy: number; gw: number; gh: number;
    cursor: string;
  }[] = [
    {
      id: "back",
      x: x0 - wallPx, y: z0 - wallPx, width: w + wallPx * 2, height: wallPx,
      gx: x0 - wallPx, gy: z0 - wallPx - grab / 2, gw: w + wallPx * 2, gh: grab,
      cursor: "ns-resize",
    },
    {
      id: "front",
      x: x0 - wallPx, y: z0 + h, width: w + wallPx * 2, height: wallPx,
      gx: x0 - wallPx, gy: z0 + h - grab / 4, gw: w + wallPx * 2, gh: grab,
      cursor: "ns-resize",
    },
    {
      id: "left",
      x: x0 - wallPx, y: z0, width: wallPx, height: h,
      gx: x0 - wallPx - grab / 2, gy: z0, gw: grab, gh: h,
      cursor: "ew-resize",
    },
    {
      id: "right",
      x: x0 + w, y: z0, width: wallPx, height: h,
      gx: x0 + w - grab / 4, gy: z0, gw: grab, gh: h,
      cursor: "ew-resize",
    },
  ];

  return (
    <g>
      {walls.map((wl) => (
        <g key={wl.id}>
          <rect
            x={wl.x}
            y={wl.y}
            width={wl.width}
            height={wl.height}
            className="fill-foreground/80"
          />
          <rect
            x={wl.gx}
            y={wl.gy}
            width={wl.gw}
            height={wl.gh}
            fill="transparent"
            style={{ cursor: wl.cursor }}
            onPointerDown={(e) => onWallDrag(e, wl.id)}
          />
        </g>
      ))}
    </g>
  );
}

/**
 * Doors, windows, cased openings and niches.
 *
 * Drawn with the conventional plan symbols so it reads like a drawing: a door
 * shows its swing, a window shows a thin sill line through the wall, a niche is
 * a dashed recess.
 */
function OpeningShape({
  wall,
  op,
  spec,
  t,
  wallPx,
  selected,
  onPointerDown,
  onResizeStart,
}: {
  wall: WallId;
  op: WallOpening;
  spec: RoomSpec;
  t: PlanTransform;
  wallPx: number;
  selected: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
  onResizeStart: (e: React.PointerEvent, handle: OpeningHandle) => void;
}) {
  const seg = openingSegment(wall, op, spec.room);
  const horizontal = wall === "back" || wall === "front";

  const x1 = xToPx(Math.min(seg.x1, seg.x2), t);
  const y1 = zToPx(Math.min(seg.z1, seg.z2), t);
  const lengthPx = toPx(op.widthIn, t);

  const rectX = horizontal ? x1 : x1 - wallPx;
  const rectY = horizontal ? y1 - wallPx : y1;
  const rectW = horizontal ? lengthPx : wallPx * 2;
  const rectH = horizontal ? wallPx * 2 : lengthPx;

  const isVoid = op.type === "door" || op.type === "window" || op.type === "cased_opening";
  const cx = rectX + rectW / 2;
  const cy = rectY + rectH / 2;

  return (
    <g
      onPointerDown={onPointerDown}
      className="cursor-grab active:cursor-grabbing"
      role="button"
      aria-label={`${op.label ?? op.type} on the ${wall} wall`}
    >
      {/* Knock the wall out */}
      {isVoid && <rect x={rectX} y={rectY} width={rectW} height={rectH} className="fill-background" />}

      {op.type === "door" && <DoorSwingSymbol wall={wall} op={op} spec={spec} t={t} />}

      {op.type === "window" && (
        <line
          x1={horizontal ? rectX : cx}
          y1={horizontal ? cy : rectY}
          x2={horizontal ? rectX + rectW : cx}
          y2={horizontal ? cy : rectY + rectH}
          className="stroke-sky-500"
          strokeWidth={3}
        />
      )}

      {op.type === "niche" && (
        <rect
          x={rectX}
          y={rectY}
          width={rectW}
          height={rectH}
          className="fill-amber-500/25 stroke-amber-600"
          strokeWidth={1}
          strokeDasharray="4 2"
        />
      )}

      {/* Bigger invisible grab target than the symbol itself */}
      <rect
        x={rectX - 6}
        y={rectY - 6}
        width={rectW + 12}
        height={rectH + 12}
        fill="transparent"
      />

      {selected && (
        <>
          <rect
            x={rectX - 4}
            y={rectY - 4}
            width={rectW + 8}
            height={rectH + 8}
            className="fill-none stroke-amber-500"
            strokeWidth={2}
            rx={2}
          />

          {/* End grips: drag either end to widen or narrow. The opposite end
              stays anchored, so a window stretches rather than slides. */}
          {(["start", "end"] as OpeningHandle[]).map((h) => {
            const atStart = h === "start";
            const hx = horizontal
              ? (atStart ? rectX : rectX + rectW)
              : rectX + rectW / 2;
            const hy = horizontal
              ? rectY + rectH / 2
              : (atStart ? rectY : rectY + rectH);
            return (
              <rect
                key={h}
                x={hx - 5}
                y={hy - 5}
                width={10}
                height={10}
                rx={1.5}
                className="fill-background stroke-amber-500"
                strokeWidth={2}
                style={{ cursor: horizontal ? "ew-resize" : "ns-resize" }}
                onPointerDown={(e) => onResizeStart(e, h)}
              />
            );
          })}

          <text
            x={cx}
            y={rectY - 10}
            textAnchor="middle"
            className="fill-amber-600 pointer-events-none"
            style={{ fontSize: 11, fontWeight: 600 }}
          >
            {formatFeetInches(op.widthIn)}
          </text>
        </>
      )}
    </g>
  );
}

/**
 * Conventional door symbol: the leaf drawn solid at 90° open, and a dashed
 * quarter-circle showing the sweep.
 *
 * The whole thing comes from `doorSwing` in room coordinates and is only
 * converted to pixels here, so hinge side and in/out are correct on every wall
 * without four special cases in the drawing code.
 */
function DoorSwingSymbol({
  wall,
  op,
  spec,
  t,
}: {
  wall: WallId;
  op: WallOpening;
  spec: RoomSpec;
  t: PlanTransform;
}) {
  const s = doorSwing(wall, op, spec.room);
  const px = (p: { x: number; z: number }) => `${xToPx(p.x, t)},${zToPx(p.z, t)}`;

  return (
    <g className="pointer-events-none">
      <polyline
        points={s.arc.map(px).join(" ")}
        className="fill-none stroke-muted-foreground"
        strokeWidth={1}
        strokeDasharray="3 3"
      />
      {/* The leaf */}
      <line
        x1={xToPx(s.hinge.x, t)}
        y1={zToPx(s.hinge.z, t)}
        x2={xToPx(s.open.x, t)}
        y2={zToPx(s.open.z, t)}
        className="stroke-foreground"
        strokeWidth={2.5}
        strokeLinecap="round"
      />
      {/* Hinge point, so the pivot side is unmistakable */}
      <circle
        cx={xToPx(s.hinge.x, t)}
        cy={zToPx(s.hinge.z, t)}
        r={3}
        className="fill-foreground"
      />
    </g>
  );
}

function FixtureShape({
  f,
  t,
  selected,
  issue,
  onPointerDown,
  onResizeStart,
}: {
  f: Fixture;
  t: PlanTransform;
  selected: boolean;
  issue?: "warn" | "error";
  onPointerDown: (e: React.PointerEvent) => void;
  onResizeStart: (e: React.PointerEvent, handle: FixtureHandle) => void;
}) {
  // Drawn unrotated then rotated about its own centre. SVG rotates clockwise
  // with y pointing down, while the model's rotationDeg is counter-clockwise
  // about +Y, so the sign flips.
  const cx = xToPx(f.x, t);
  const cy = zToPx(f.z, t);
  const w = toPx(f.widthIn, t);
  const d = toPx(f.depthIn, t);
  const rot = -normalizeAngle(f.rotationDeg ?? 0);

  const label = f.label ?? f.type.replace(/_/g, " ");
  const showLabel = w > 44 && d > 22;

  // Built walls get wall poche rather than fixture fill, so a partition reads
  // as structure at a glance.
  const isPartition = isWallFixture(f);
  const doorway = partitionDoorway(f);

  const tone =
    issue === "error"
      ? "fill-destructive/20 stroke-destructive"
      : issue === "warn"
        ? "fill-amber-500/20 stroke-amber-600"
        : selected
          ? "fill-primary/20 stroke-primary"
          : isPartition
            ? "fill-foreground/70 stroke-foreground"
            : "fill-card stroke-muted-foreground";

  return (
    <g
      transform={`rotate(${rot} ${cx} ${cy})`}
      onPointerDown={onPointerDown}
      className="cursor-grab active:cursor-grabbing"
      role="button"
      aria-label={label}
    >
      <rect
        x={cx - w / 2}
        y={cy - d / 2}
        width={w}
        height={d}
        rx={3}
        className={tone}
        strokeWidth={selected ? 2.5 : 1.5}
      />

      {/* Front edge marker — which way the thing faces. Local front is +z,
          which is the bottom edge before rotation. A knee wall has no front,
          so it gets none. */}
      {!isPartition && <line
        x1={cx - w / 2 + 3}
        y1={cy + d / 2 - 2}
        x2={cx + w / 2 - 3}
        y2={cy + d / 2 - 2}
        className={selected ? "stroke-primary" : "stroke-muted-foreground"}
        strokeWidth={3}
        strokeLinecap="round"
      />}

      {/* Doorway: knock the wall out and tick the jambs, the same way an
          opening in a perimeter wall is drawn. */}
      {doorway && (
        <>
          <rect
            x={cx - w / 2 + toPx(doorway.offsetIn, t)}
            y={cy - d / 2 - 0.5}
            width={toPx(doorway.widthIn, t)}
            height={d + 1}
            className="fill-background"
          />
          {[0, doorway.widthIn].map((at) => (
            <line
              key={at}
              x1={cx - w / 2 + toPx(doorway.offsetIn + at, t)}
              y1={cy - d / 2}
              x2={cx - w / 2 + toPx(doorway.offsetIn + at, t)}
              y2={cy + d / 2}
              className="stroke-foreground"
              strokeWidth={1.5}
            />
          ))}
        </>
      )}

      {showLabel && !isPartition && (
        <text
          x={cx}
          y={cy + 4}
          textAnchor="middle"
          className="fill-foreground pointer-events-none"
          style={{ fontSize: Math.min(13, Math.max(9, w / 7)) }}
        >
          {label}
        </text>
      )}

      {/* Resize handles live inside the rotated group, so they sit on the
          fixture's own edges and drag along its own axes. */}
      {selected && (
        <FixtureHandles cx={cx} cy={cy} w={w} d={d} onResizeStart={onResizeStart} />
      )}

      {/* Live size readout while resizing, so you can hit a real number. */}
      {selected && (
        <text
          x={cx}
          y={cy - d / 2 - 6}
          textAnchor="middle"
          className="fill-primary pointer-events-none"
          style={{ fontSize: 11, fontWeight: 600 }}
        >
          {formatFeetInches(f.widthIn)} x {formatFeetInches(f.depthIn)}
        </text>
      )}
    </g>
  );
}

/**
 * Eight grab points: four corners resize both dimensions, four edge midpoints
 * resize one. Sized in screen pixels rather than inches so they stay usable on
 * a small fixture or a zoomed-out room.
 */
function FixtureHandles({
  cx,
  cy,
  w,
  d,
  onResizeStart,
}: {
  cx: number;
  cy: number;
  w: number;
  d: number;
  onResizeStart: (e: React.PointerEvent, handle: FixtureHandle) => void;
}) {
  const r = 5;
  const left = cx - w / 2;
  const right = cx + w / 2;
  const top = cy - d / 2;
  const bottom = cy + d / 2;

  // "n" is the fixture's back edge (local −z), "s" its front (local +z).
  const points: { h: FixtureHandle; x: number; y: number; cursor: string }[] = [
    { h: "nw", x: left, y: top, cursor: "nwse-resize" },
    { h: "n", x: cx, y: top, cursor: "ns-resize" },
    { h: "ne", x: right, y: top, cursor: "nesw-resize" },
    { h: "e", x: right, y: cy, cursor: "ew-resize" },
    { h: "se", x: right, y: bottom, cursor: "nwse-resize" },
    { h: "s", x: cx, y: bottom, cursor: "ns-resize" },
    { h: "sw", x: left, y: bottom, cursor: "nesw-resize" },
    { h: "w", x: left, y: cy, cursor: "ew-resize" },
  ];

  return (
    <g>
      {points.map((p) => (
        <rect
          key={p.h}
          x={p.x - r}
          y={p.y - r}
          width={r * 2}
          height={r * 2}
          rx={1.5}
          className="fill-background stroke-primary"
          strokeWidth={2}
          style={{ cursor: p.cursor }}
          onPointerDown={(e) => onResizeStart(e, p.h)}
        />
      ))}
    </g>
  );
}

function SnapGuides({
  t,
  spec,
  selection,
  guides,
}: {
  t: PlanTransform;
  spec: RoomSpec;
  selection: Selection;
  guides: { x: boolean; z: boolean };
}) {
  if (!selection || selection.kind !== "fixture") return null;
  if (!guides.x && !guides.z) return null;
  const f = spec.fixtures.find((x) => x.id === selection.id);
  if (!f) return null;

  return (
    <g className="stroke-primary" strokeWidth={1} strokeDasharray="4 4" opacity={0.9}>
      {guides.x && (
        <line
          x1={xToPx(f.x, t)}
          y1={zToPx(0, t)}
          x2={xToPx(f.x, t)}
          y2={zToPx(spec.room.lengthIn, t)}
        />
      )}
      {guides.z && (
        <line
          x1={xToPx(0, t)}
          y1={zToPx(f.z, t)}
          x2={xToPx(spec.room.widthIn, t)}
          y2={zToPx(f.z, t)}
        />
      )}
    </g>
  );
}

function RoomDimensions({ t, spec }: { t: PlanTransform; spec: RoomSpec }) {
  const left = xToPx(0, t);
  const right = xToPx(spec.room.widthIn, t);
  const top = zToPx(0, t);
  const bottom = zToPx(spec.room.lengthIn, t);

  return (
    <g className="fill-amber-600">
      <text
        x={(left + right) / 2}
        y={top - 16}
        textAnchor="middle"
        style={{ fontSize: 12, fontWeight: 600 }}
      >
        {formatFeetInches(spec.room.widthIn)}
      </text>
      <text
        x={left - 14}
        y={(top + bottom) / 2}
        textAnchor="middle"
        transform={`rotate(-90 ${left - 14} ${(top + bottom) / 2})`}
        style={{ fontSize: 12, fontWeight: 600 }}
      >
        {formatFeetInches(spec.room.lengthIn)}
      </text>
      <text
        x={(left + right) / 2}
        y={bottom + 26}
        textAnchor="middle"
        className="fill-muted-foreground"
        style={{ fontSize: 10 }}
      >
        {WALL_LABELS.front}
      </text>
    </g>
  );
}
