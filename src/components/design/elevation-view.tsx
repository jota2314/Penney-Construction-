"use client";

/**
 * Interactive elevation sheet.
 *
 * Originally read-only, which was the wrong call: sill and head heights only
 * exist in elevation, so this is the natural place to set them. Openings and
 * fixtures can be dragged and resized here, and clicking anything — including
 * bare wall — selects it so the panel beside shows its finishes.
 *
 * The picture still comes entirely from `buildElevation`; this only adds a hit
 * layer on top, so the screen and the PDF stay identical.
 */

import { useCallback, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import {
  type RoomSpec,
  type WallId,
  WALL_IDS,
  WALL_LABELS,
  formatFeetInches,
  findMaterial,
  wallRunIn,
} from "@/types/design";
import { buildElevation, ELEVATION_MARGIN, type Prim } from "@/lib/design/elevation-draw";
import { elevationItems, wallFixtureHeightIn } from "@/lib/design/plan";
import {
  moveFixtureOnElevation,
  resizeFixtureOnElevation,
  moveOpeningOnElevation,
  resizeOpeningOnElevation,
  type ElevHandle,
} from "@/lib/design/elevation-edit";
import type { Selection } from "./plan-editor";

interface Drag {
  kind: "fixture" | "opening";
  id: string;
  handle?: ElevHandle;
  startPx: { x: number; y: number };
  startU: number;
  startV: number;
  startW: number;
  startH: number;
  moved: boolean;
}

export function ElevationView({
  spec,
  onSpecChange,
  selection,
  onSelectionChange,
}: {
  spec: RoomSpec;
  onSpecChange: (next: RoomSpec, commit: boolean) => void;
  selection: Selection;
  onSelectionChange: (next: Selection) => void;
}) {
  return (
    <div className="space-y-4">
      <p className="text-[11px] text-muted-foreground">
        Drag anything to place it and pull its handles to size it — this is where sill and
        head heights live. Click a wall for its tile, or a fixture for its finishes.
      </p>
      {WALL_IDS.map((id) => (
        <WallSheet
          key={id}
          spec={spec}
          wall={id}
          onSpecChange={onSpecChange}
          selection={selection}
          onSelectionChange={onSelectionChange}
        />
      ))}
    </div>
  );
}

function WallSheet({
  spec,
  wall,
  onSpecChange,
  selection,
  onSelectionChange,
}: {
  spec: RoomSpec;
  wall: WallId;
  onSpecChange: (next: RoomSpec, commit: boolean) => void;
  selection: Selection;
  onSelectionChange: (next: Selection) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const [, bump] = useState(0);

  const drawing = buildElevation(spec, wall);
  const w = spec.walls.find((x) => x.id === wall);
  const lower = findMaterial(spec, w?.finish.materialId);
  const upper = findMaterial(spec, w?.finish.upperMaterialId);

  const m = ELEVATION_MARGIN;
  const contentW = drawing.runIn + m.left + m.right;
  const contentH = drawing.heightIn + m.top + m.bottom;
  const sheetW = 660;
  const scale = sheetW / contentW;
  const sheetH = contentH * scale;

  const X = (x: number) => (x + m.left) * scale;
  const Y = (y: number) => (drawing.heightIn + m.top - y) * scale;

  const pointer = useCallback((e: React.PointerEvent) => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r) return { x: 0, y: 0 };
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }, []);

  const wallSelected = selection?.kind === "wall" && selection.wall === wall;
  const items = elevationItems(spec, wall);

  const startDrag = (
    e: React.PointerEvent,
    kind: "fixture" | "opening",
    id: string,
    u: number,
    v: number,
    wd: number,
    ht: number,
    handle?: ElevHandle,
  ) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    onSelectionChange(
      kind === "fixture" ? { kind: "fixture", id } : { kind: "opening", wall, id },
    );
    dragRef.current = {
      kind,
      id,
      handle,
      startPx: pointer(e),
      startU: u,
      startV: v,
      startW: wd,
      startH: ht,
      moved: false,
    };
    bump((n) => n + 1);
  };

  const onMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const now = pointer(e);
    const dxPx = now.x - d.startPx.x;
    const dyPx = now.y - d.startPx.y;
    if (!d.moved && Math.hypot(dxPx, dyPx) < 3) return;
    d.moved = true;

    const duIn = dxPx / scale;
    // Screen y grows downward; wall v grows upward.
    const dvIn = -dyPx / scale;

    if (d.handle) {
      if (d.kind === "opening") {
        onSpecChange(
          resizeOpeningOnElevation(
            spec, wall, d.id, d.handle,
            d.startU, d.startV, d.startW, d.startH,
            duIn, dvIn,
          ),
          false,
        );
      } else {
        const along = d.handle.includes("e")
          ? d.startW + duIn
          : d.handle.includes("w")
            ? d.startW - duIn
            : d.startW;
        const ht = d.handle.includes("n")
          ? d.startH + dvIn
          : d.handle.includes("s")
            ? d.startH - dvIn
            : d.startH;
        onSpecChange(resizeFixtureOnElevation(spec, wall, d.id, along, ht), false);
      }
      return;
    }

    if (d.kind === "opening") {
      onSpecChange(
        moveOpeningOnElevation(spec, wall, d.id, d.startU + duIn, d.startV + dvIn),
        false,
      );
    } else {
      onSpecChange(
        moveFixtureOnElevation(spec, wall, d.id, d.startU + duIn, d.startV + dvIn),
        false,
      );
    }
  };

  const endDrag = () => {
    const d = dragRef.current;
    dragRef.current = null;
    if (d?.moved) onSpecChange(spec, true);
    bump((n) => n + 1);
  };

  return (
    <div
      className={`rounded-lg border bg-card overflow-hidden ${wallSelected ? "ring-2 ring-primary" : ""}`}
    >
      <button
        onClick={() => onSelectionChange({ kind: "wall", wall })}
        className="w-full flex items-baseline justify-between px-3 py-2 hover:bg-muted/40 text-left"
      >
        <span className="text-xs font-semibold">{WALL_LABELS[wall]}</span>
        <span className="text-[11px] text-muted-foreground truncate ml-2">
          {lower ? lower.name : "no finish"}
          {upper ? ` / ${upper.name}` : ""} · {formatFeetInches(wallRunIn(wall, spec.room))}
        </span>
      </button>

      <div className="overflow-x-auto px-2 pb-2">
        <svg
          ref={svgRef}
          width={sheetW}
          height={sheetH}
          className="min-w-[660px] touch-none select-none"
          onPointerMove={onMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onPointerDown={() => onSelectionChange({ kind: "wall", wall })}
        >
          {drawing.prims.map((p, i) => (
            <PrimShape key={i} p={p} X={X} Y={Y} scale={scale} />
          ))}

          {/* Hit + handle layer over the drawing */}
          {items.map((item) => {
            const isFixture = item.kind === "fixture";
            const f = isFixture ? spec.fixtures.find((x) => x.id === item.id) : null;
            if (isFixture && !f) return null;

            const selected =
              (isFixture && selection?.kind === "fixture" && selection.id === item.id) ||
              (!isFixture &&
                selection?.kind === "opening" &&
                selection.id === item.id &&
                selection.wall === wall);

            const uLeft = item.uIn - item.widthIn / 2;
            const height = f
              ? wallFixtureHeightIn(f, spec.room)
              : item.topIn - item.bottomIn;
            // Openings are grabbed by their left edge (that's what uIn means);
            // fixtures by their centre.
            const grabU = isFixture ? item.uIn : uLeft;

            return (
              <g key={`${item.kind}-${item.id}`}>
                <rect
                  x={X(uLeft)}
                  y={Y(item.topIn)}
                  width={Math.max(2, item.widthIn * scale)}
                  height={Math.max(2, (item.topIn - item.bottomIn) * scale)}
                  fill="transparent"
                  className="cursor-grab active:cursor-grabbing"
                  onPointerDown={(e) =>
                    startDrag(
                      e,
                      isFixture ? "fixture" : "opening",
                      item.id,
                      grabU,
                      item.bottomIn,
                      item.widthIn,
                      height,
                    )
                  }
                />

                {selected && (
                  <>
                    <rect
                      x={X(uLeft)}
                      y={Y(item.topIn)}
                      width={item.widthIn * scale}
                      height={(item.topIn - item.bottomIn) * scale}
                      className="fill-none stroke-primary"
                      strokeWidth={2}
                      pointerEvents="none"
                    />
                    {/* Live readout, so you can land on a real number */}
                    <text
                      x={X(item.uIn)}
                      y={Y(item.topIn) - 6}
                      textAnchor="middle"
                      className="fill-primary"
                      style={{ fontSize: 10, fontWeight: 600 }}
                      pointerEvents="none"
                    >
                      {formatFeetInches(item.widthIn)} x{" "}
                      {formatFeetInches(item.topIn - item.bottomIn)}
                      {item.bottomIn > 0.5
                        ? ` · ${formatFeetInches(item.bottomIn)} AFF`
                        : ""}
                    </text>

                    {(
                      [
                        ["w", uLeft, (item.bottomIn + item.topIn) / 2, "ew-resize"],
                        ["e", uLeft + item.widthIn, (item.bottomIn + item.topIn) / 2, "ew-resize"],
                        ["s", item.uIn, item.bottomIn, "ns-resize"],
                        ["n", item.uIn, item.topIn, "ns-resize"],
                      ] as const
                    ).map(([h, hu, hv, cur]) => (
                      <rect
                        key={h}
                        x={X(hu) - 5}
                        y={Y(hv) - 5}
                        width={10}
                        height={10}
                        rx={1.5}
                        className="fill-background stroke-primary"
                        strokeWidth={2}
                        style={{ cursor: cur }}
                        onPointerDown={(e) =>
                          startDrag(
                            e,
                            isFixture ? "fixture" : "opening",
                            item.id,
                            grabU,
                            item.bottomIn,
                            item.widthIn,
                            height,
                            h as ElevHandle,
                          )
                        }
                      />
                    ))}
                  </>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      {drawing.notes.length > 0 && (
        <div className="border-t bg-amber-500/5 px-3 py-1.5">
          {drawing.notes.map((n, i) => (
            <div
              key={i}
              className="flex items-start gap-1.5 text-[11px] text-muted-foreground"
            >
              <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0 text-amber-600" />
              <span>{n}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * One primitive.
 *
 * Line weights and text sizes are deliberately NOT scaled — a hairline must
 * stay a hairline and 6pt text readable whether the wall is 5 feet or 15.
 */
function PrimShape({
  p,
  X,
  Y,
  scale,
}: {
  p: Prim;
  X: (x: number) => number;
  Y: (y: number) => number;
  scale: number;
}) {
  switch (p.t) {
    case "rect":
      return (
        <rect
          x={X(p.x)}
          y={Y(p.y + p.h)}
          width={Math.max(0, p.w * scale)}
          height={Math.max(0, p.h * scale)}
          fill={p.fill ?? "none"}
          stroke={p.stroke ?? "none"}
          strokeWidth={p.lw ?? 1}
          strokeDasharray={p.dash ? "3 2" : undefined}
        />
      );
    case "line":
      return (
        <line
          x1={X(p.x1)}
          y1={Y(p.y1)}
          x2={X(p.x2)}
          y2={Y(p.y2)}
          stroke={p.stroke}
          strokeWidth={p.lw ?? 1}
          strokeDasharray={p.dash ? "3 2" : undefined}
        />
      );
    case "circle":
      return (
        <circle
          cx={X(p.cx)}
          cy={Y(p.cy)}
          r={Math.max(1, p.r * scale)}
          fill={p.fill ?? "none"}
          stroke={p.stroke ?? "none"}
          strokeWidth={p.lw ?? 1}
        />
      );
    case "poly": {
      const d = p.pts.map(([px, py]) => `${X(px)},${Y(py)}`).join(" ");
      return p.close ? (
        <polygon
          points={d}
          fill={p.fill ?? "none"}
          stroke={p.stroke ?? "none"}
          strokeWidth={p.lw ?? 1}
          strokeDasharray={p.dash ? "3 2" : undefined}
          strokeLinejoin="round"
        />
      ) : (
        <polyline
          points={d}
          fill="none"
          stroke={p.stroke ?? "none"}
          strokeWidth={p.lw ?? 1}
          strokeDasharray={p.dash ? "3 2" : undefined}
          strokeLinejoin="round"
        />
      );
    }
    case "text":
      return (
        <text
          x={X(p.x)}
          y={Y(p.y)}
          textAnchor={
            p.align === "center" ? "middle" : p.align === "right" ? "end" : "start"
          }
          fill={p.color ?? "#1f2937"}
          style={{ fontSize: p.size * 1.6, fontWeight: p.bold ? 600 : 400 }}
        >
          {p.s}
        </text>
      );
  }
}
