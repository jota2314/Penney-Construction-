"use client";

/**
 * Elevation sheet.
 *
 * A thin renderer over `buildElevation` — every drawing decision lives in
 * lib/design/elevation-draw so the PDF sheet draws the identical thing rather
 * than a second, slowly diverging version of it.
 *
 * Clicking a wall selects it, which is how its tile gets assigned: the panel
 * beside the plan then shows that wall's finish.
 */

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
import { AlertTriangle } from "lucide-react";

export function ElevationView({
  spec,
  selectedWall,
  onSelectWall,
}: {
  spec: RoomSpec;
  selectedWall?: WallId | null;
  onSelectWall?: (wall: WallId) => void;
}) {
  return (
    <div className="space-y-4">
      <p className="text-[11px] text-muted-foreground">
        Each wall as you face it from inside the room, at real tile coursing. Click a wall
        to set its tile.
      </p>
      {WALL_IDS.map((id) => (
        <WallSheet
          key={id}
          spec={spec}
          wall={id}
          selected={selectedWall === id}
          onSelect={() => onSelectWall?.(id)}
        />
      ))}
    </div>
  );
}

function WallSheet({
  spec,
  wall,
  selected,
  onSelect,
}: {
  spec: RoomSpec;
  wall: WallId;
  selected: boolean;
  onSelect: () => void;
}) {
  const drawing = buildElevation(spec, wall);
  const w = spec.walls.find((x) => x.id === wall);
  const lower = findMaterial(spec, w?.finish.materialId);
  const upper = findMaterial(spec, w?.finish.upperMaterialId);

  const m = ELEVATION_MARGIN;
  const contentW = drawing.runIn + m.left + m.right;
  const contentH = drawing.heightIn + m.top + m.bottom;

  // Fit to a fixed sheet width; a longer wall simply draws to a smaller scale.
  const sheetW = 660;
  const scale = sheetW / contentW;
  const sheetH = contentH * scale;

  // Model inches → sheet px. v is up in the model and down on screen.
  const X = (x: number) => (x + m.left) * scale;
  const Y = (y: number) => (drawing.heightIn + m.top - y) * scale;

  return (
    <div
      className={`rounded-lg border bg-card overflow-hidden ${selected ? "ring-2 ring-primary" : ""}`}
    >
      <button
        onClick={onSelect}
        className="w-full flex items-baseline justify-between px-3 py-2 hover:bg-muted/40 text-left"
      >
        <span className="text-xs font-semibold">{WALL_LABELS[wall]}</span>
        <span className="text-[11px] text-muted-foreground truncate ml-2">
          {lower ? lower.name : "no finish"}
          {upper ? ` / ${upper.name}` : ""} · {formatFeetInches(wallRunIn(wall, spec.room))}
        </span>
      </button>

      <div className="overflow-x-auto px-2 pb-2">
        <svg width={sheetW} height={sheetH} className="min-w-[660px]">
          {drawing.prims.map((p, i) => (
            <PrimShape key={i} p={p} X={X} Y={Y} scale={scale} />
          ))}
        </svg>
      </div>

      {drawing.notes.length > 0 && (
        <div className="border-t bg-amber-500/5 px-3 py-1.5">
          {drawing.notes.map((n, i) => (
            <div key={i} className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
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
 * Line weights and text sizes are deliberately NOT multiplied by the drawing
 * scale — a hairline has to stay a hairline and 6pt text has to stay readable
 * whether the wall is 5 feet or 15. Only geometry scales.
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
    case "text":
      return (
        <text
          x={X(p.x)}
          y={Y(p.y)}
          textAnchor={p.align === "center" ? "middle" : p.align === "right" ? "end" : "start"}
          fill={p.color ?? "#1f2937"}
          style={{ fontSize: p.size * 1.6, fontWeight: p.bold ? 600 : 400 }}
        >
          {p.s}
        </text>
      );
  }
}
