"use client";

/**
 * Toolbar and properties panel that sit alongside the plan.
 *
 * The buttons are the "do it myself" half of the tool: the AI gives you a room,
 * these let you add a window or shove the vanity a foot left without describing
 * it in words. Every control writes the same RoomSpec, so a hand edit and an AI
 * edit are indistinguishable afterwards.
 */

import {
  DoorOpen,
  AppWindow,
  Square,
  Trash2,
  RotateCw,
  Plus,
  Minus,
  FlipHorizontal,
  ArrowLeftRight,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  type RoomSpec,
  type FixtureType,
  type OpeningType,
  formatFeetInches,
  WALL_IDS,
  WALL_LABELS,
} from "@/types/design";
import {
  addFixture,
  addOpening,
  updateFixture,
  removeFixture,
  updateOpening,
  removeOpening,
  moveOpeningToWall,
  resizeRoom,
} from "@/lib/design/plan-edits";
import { checkClearances, normalizeAngle } from "@/lib/design/plan";
import type { Selection } from "./plan-editor";

/** The fixtures worth a one-click button. Anything rarer, ask the AI for. */
const FIXTURE_BUTTONS: { type: FixtureType; label: string }[] = [
  { type: "vanity", label: "Vanity" },
  { type: "toilet", label: "Toilet" },
  { type: "tub", label: "Tub" },
  { type: "shower", label: "Shower" },
  { type: "mirror", label: "Mirror" },
  { type: "linen_cabinet", label: "Linen" },
  { type: "knee_wall", label: "Knee wall" },
  { type: "partition", label: "Full wall" },
  { type: "bench", label: "Bench" },
  { type: "towel_bar", label: "Towel bar" },
];

const OPENING_BUTTONS: { type: OpeningType; label: string; icon: typeof DoorOpen }[] = [
  { type: "window", label: "Window", icon: AppWindow },
  { type: "door", label: "Door", icon: DoorOpen },
  { type: "niche", label: "Niche", icon: Square },
];

export function PlanPanel({
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
  const issues = checkClearances(spec);

  return (
    <div className="space-y-3 text-sm">
      {/* ── Add ─────────────────────────────────────────────────────────── */}
      <section>
        <SectionLabel>Add to the wall</SectionLabel>
        <div className="flex flex-wrap gap-1.5">
          {OPENING_BUTTONS.map(({ type, label, icon: Icon }) => (
            <Button
              key={type}
              size="sm"
              variant="outline"
              onClick={() => {
                const r = addOpening(spec, type);
                onSpecChange(r.spec, true);
                onSelectionChange({ kind: "opening", wall: r.wall, id: r.id });
              }}
            >
              <Icon className="h-3.5 w-3.5 mr-1" />
              {label}
            </Button>
          ))}
        </div>
      </section>

      <section>
        <SectionLabel>Add a fixture</SectionLabel>
        <div className="flex flex-wrap gap-1.5">
          {FIXTURE_BUTTONS.map(({ type, label }) => (
            <Button
              key={type}
              size="sm"
              variant="outline"
              onClick={() => {
                const r = addFixture(spec, type);
                onSpecChange(r.spec, true);
                onSelectionChange({ kind: "fixture", id: r.id });
              }}
            >
              <Plus className="h-3 w-3 mr-1" />
              {label}
            </Button>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground mt-1.5">
          Dropped against the emptiest wall. Drag it where you want it — it snaps to walls
          and to other fixtures. Arrow keys nudge 1&quot;, Shift+arrow 6&quot;.
        </p>
      </section>

      {/* ── Selected item ───────────────────────────────────────────────── */}
      {selection ? (
        <SelectedItem
          spec={spec}
          selection={selection}
          onSpecChange={onSpecChange}
          onSelectionChange={onSelectionChange}
        />
      ) : (
        <RoomProperties spec={spec} onSpecChange={onSpecChange} />
      )}

      {/* ── Clearances ──────────────────────────────────────────────────── */}
      {issues.length > 0 && (
        <section className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2">
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-amber-600 mb-1">
            <AlertTriangle className="h-3.5 w-3.5" />
            Clearances
          </div>
          <ul className="space-y-1 text-[11px] text-muted-foreground">
            {issues.slice(0, 6).map((i, n) => (
              <li key={n}>
                <button
                  className="text-left hover:text-foreground"
                  onClick={() => onSelectionChange({ kind: "fixture", id: i.fixtureId })}
                >
                  {i.severity === "error" ? "⛔ " : "⚠ "}
                  {i.message}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

// ── Sections ─────────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1.5">
      {children}
    </div>
  );
}

function RoomProperties({
  spec,
  onSpecChange,
}: {
  spec: RoomSpec;
  onSpecChange: (next: RoomSpec, commit: boolean) => void;
}) {
  return (
    <section className="rounded-md border p-2.5 space-y-2">
      <SectionLabel>Room</SectionLabel>
      <div className="grid grid-cols-3 gap-2">
        <InchField
          label="Width"
          step={6}
          value={spec.room.widthIn}
          onCommit={(v) =>
            onSpecChange(resizeRoom(spec, v, spec.room.lengthIn, spec.room.ceilingHeightIn), true)
          }
        />
        <InchField
          label="Depth"
          step={6}
          value={spec.room.lengthIn}
          onCommit={(v) =>
            onSpecChange(resizeRoom(spec, spec.room.widthIn, v, spec.room.ceilingHeightIn), true)
          }
        />
        <InchField
          label="Ceiling"
          step={6}
          value={spec.room.ceilingHeightIn}
          onCommit={(v) =>
            onSpecChange(resizeRoom(spec, spec.room.widthIn, spec.room.lengthIn, v), true)
          }
        />
      </div>
      <p className="text-[11px] text-muted-foreground">
        Click anything in the plan to edit it.
      </p>
    </section>
  );
}

function SelectedItem({
  spec,
  selection,
  onSpecChange,
  onSelectionChange,
}: {
  spec: RoomSpec;
  selection: Selection;
  onSpecChange: (next: RoomSpec, commit: boolean) => void;
  onSelectionChange: (next: Selection) => void;
}) {
  if (selection?.kind === "fixture") {
    const f = spec.fixtures.find((x) => x.id === selection.id);
    if (!f) return null;
    const rot = normalizeAngle(f.rotationDeg ?? 0);
    const isFullHeightPartition =
      f.type === "partition" && (f.options?.fullHeight ?? true);

    return (
      <section className="rounded-md border p-2.5 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <SectionLabel>{f.label ?? f.type.replace(/_/g, " ")}</SectionLabel>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-destructive"
            onClick={() => {
              onSpecChange(removeFixture(spec, f.id), true);
              onSelectionChange(null);
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <InchField
            label="Width"
            value={f.widthIn}
            onCommit={(v) => onSpecChange(updateFixture(spec, f.id, { widthIn: v }), true)}
          />
          <InchField
            label="Depth"
            value={f.depthIn}
            onCommit={(v) => onSpecChange(updateFixture(spec, f.id, { depthIn: v }), true)}
          />
          {/* A full-height partition takes its height from the ceiling, so the
              field would be a control that silently does nothing. Show the
              value it's actually using instead. */}
          {isFullHeightPartition ? (
            <div>
              <span className="text-[11px] text-muted-foreground">Height</span>
              <div className="h-7 flex items-center text-xs text-muted-foreground">
                to ceiling
              </div>
              <span className="text-[10px] text-muted-foreground">
                {formatFeetInches(spec.room.ceilingHeightIn)}
              </span>
            </div>
          ) : (
            <InchField
              label="Height"
              value={f.heightIn}
              onCommit={(v) => onSpecChange(updateFixture(spec, f.id, { heightIn: v }), true)}
            />
          )}
        </div>

        {f.type === "partition" && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-[11px] w-full"
            onClick={() =>
              onSpecChange(
                updateFixture(spec, f.id, {
                  options: { ...(f.options ?? {}), fullHeight: !isFullHeightPartition },
                  // Freeze the current ceiling as the starting height so
                  // turning it off doesn't snap the wall to a stale number.
                  ...(isFullHeightPartition ? { heightIn: spec.room.ceilingHeightIn } : {}),
                }),
                true,
              )
            }
          >
            {isFullHeightPartition ? "Set a custom height" : "Run it to the ceiling"}
          </Button>
        )}

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="h-7"
            onClick={() =>
              onSpecChange(
                updateFixture(spec, f.id, { rotationDeg: normalizeAngle(rot + 90) }),
                true,
              )
            }
          >
            <RotateCw className="h-3.5 w-3.5 mr-1" />
            Rotate
          </Button>
          <Badge variant="secondary" className="text-[10px]">
            back against {backWallLabel(rot)}
          </Badge>
        </div>

        {/* A knee wall's finish drives real tile area, so it's editable here. */}
        {(f.type === "knee_wall" || f.type === "partition") && (
          <div className="space-y-1.5">
            <div className="text-[11px] text-muted-foreground">Finished faces</div>
            <div className="flex gap-1">
              {[2, 1].map((n) => (
                <Button
                  key={n}
                  size="sm"
                  variant={Number(f.options?.finishedSides ?? 2) === n ? "default" : "outline"}
                  className="h-7 text-[11px] flex-1"
                  onClick={() =>
                    onSpecChange(
                      updateFixture(spec, f.id, {
                        options: { ...(f.options ?? {}), finishedSides: n },
                      }),
                      true,
                    )
                  }
                >
                  {n === 2 ? "Both sides" : "One side"}
                </Button>
              ))}
            </div>

            <div className="text-[11px] text-muted-foreground">Open ends</div>
            <div className="flex gap-1">
              {[0, 1, 2].map((n) => (
                <Button
                  key={n}
                  size="sm"
                  variant={Number(f.options?.exposedEnds ?? 1) === n ? "default" : "outline"}
                  className="h-7 text-[11px] flex-1"
                  onClick={() =>
                    onSpecChange(
                      updateFixture(spec, f.id, {
                        options: { ...(f.options ?? {}), exposedEnds: n },
                      }),
                      true,
                    )
                  }
                >
                  {n}
                </Button>
              ))}
            </div>
            {f.type === "partition" && (
              <>
                <div className="text-[11px] text-muted-foreground">Doorway through it</div>
                <div className="flex gap-1">
                  {[0, 30, 32, 36].map((n) => (
                    <Button
                      key={n}
                      size="sm"
                      variant={
                        Number(f.options?.doorwayWidthIn ?? 0) === n ? "default" : "outline"
                      }
                      className="h-7 text-[11px] flex-1"
                      onClick={() =>
                        onSpecChange(
                          updateFixture(spec, f.id, {
                            options: { ...(f.options ?? {}), doorwayWidthIn: n },
                          }),
                          true,
                        )
                      }
                    >
                      {n === 0 ? "Solid" : `${n}"`}
                    </Button>
                  ))}
                </div>
                {Number(f.options?.doorwayWidthIn ?? 0) > 0 && (
                  <div className="grid grid-cols-2 gap-2">
                    <InchField
                      label="Doorway from left"
                      value={Number(f.options?.doorwayOffsetIn ?? 0)}
                      onCommit={(v) =>
                        onSpecChange(
                          updateFixture(spec, f.id, {
                            options: { ...(f.options ?? {}), doorwayOffsetIn: v },
                          }),
                          true,
                        )
                      }
                    />
                    <InchField
                      label="Doorway height"
                      value={Number(f.options?.doorwayHeightIn ?? 80)}
                      onCommit={(v) =>
                        onSpecChange(
                          updateFixture(spec, f.id, {
                            options: { ...(f.options ?? {}), doorwayHeightIn: v },
                          }),
                          true,
                        )
                      }
                    />
                  </div>
                )}
              </>
            )}

            <p className="text-[11px] text-muted-foreground">
              {f.type === "partition"
                ? "Runs floor to ceiling and follows the room's ceiling height. Faces, open ends and any doorway returns count toward the tile in Quantities."
                : "Faces, open ends and the cap all count toward the tile in Quantities."}
            </p>
          </div>
        )}

        {/* Wall-hung pieces need a height off the floor. */}
        {(f.yIn ?? 0) > 0 || isWallMounted(f.type) ? (
          <InchField
            label="Height off floor"
            value={f.yIn ?? 0}
            onCommit={(v) => onSpecChange(updateFixture(spec, f.id, { yIn: v }), true)}
          />
        ) : null}
      </section>
    );
  }

  if (selection?.kind === "opening") {
    const wall = spec.walls.find((w) => w.id === selection.wall);
    const op = wall?.openings.find((o) => o.id === selection.id);
    if (!wall || !op) return null;

    return (
      <section className="rounded-md border p-2.5 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <SectionLabel>{op.label ?? op.type}</SectionLabel>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-destructive"
            onClick={() => {
              onSpecChange(removeOpening(spec, wall.id, op.id), true);
              onSelectionChange(null);
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <InchField
            label="Width"
            value={op.widthIn}
            onCommit={(v) => onSpecChange(updateOpening(spec, wall.id, op.id, { widthIn: v }), true)}
          />
          <InchField
            label="Height"
            value={op.heightIn}
            onCommit={(v) => onSpecChange(updateOpening(spec, wall.id, op.id, { heightIn: v }), true)}
          />
          <InchField
            label={op.type === "door" ? "Off floor" : "Sill height"}
            value={op.vIn}
            onCommit={(v) => onSpecChange(updateOpening(spec, wall.id, op.id, { vIn: v }), true)}
          />
          <InchField
            label="From corner"
            value={op.uIn}
            onCommit={(v) => onSpecChange(updateOpening(spec, wall.id, op.id, { uIn: v }), true)}
          />
          {op.type === "niche" && (
            <InchField
              label="Recess depth"
              value={op.depthIn ?? 3.5}
              onCommit={(v) => onSpecChange(updateOpening(spec, wall.id, op.id, { depthIn: v }), true)}
            />
          )}
        </div>

        {op.type === "door" && (
          <div>
            <div className="text-[11px] text-muted-foreground mb-1">Swing</div>
            <div className="grid grid-cols-2 gap-1">
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-[11px]"
                onClick={() =>
                  onSpecChange(
                    updateOpening(spec, wall.id, op.id, {
                      hinge: (op.hinge ?? "left") === "left" ? "right" : "left",
                    }),
                    true,
                  )
                }
              >
                <FlipHorizontal className="h-3.5 w-3.5 mr-1" />
                Hinge: {op.hinge ?? "left"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-[11px]"
                onClick={() =>
                  onSpecChange(
                    updateOpening(spec, wall.id, op.id, {
                      swing: (op.swing ?? "in") === "in" ? "out" : "in",
                    }),
                    true,
                  )
                }
              >
                <ArrowLeftRight className="h-3.5 w-3.5 mr-1" />
                Swings {op.swing ?? "in"}
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">
              Or just click the door in the plan to flip the hinge.
            </p>
          </div>
        )}

        <div>
          <div className="text-[11px] text-muted-foreground mb-1">Wall</div>
          <div className="flex flex-wrap gap-1">
            {WALL_IDS.map((id) => (
              <Button
                key={id}
                size="sm"
                variant={id === wall.id ? "default" : "outline"}
                className="h-7 text-[11px]"
                onClick={() => {
                  if (id === wall.id) return;
                  onSpecChange(moveOpeningToWall(spec, wall.id, op.id, id, op.uIn), true);
                  onSelectionChange({ kind: "opening", wall: id, id: op.id });
                }}
              >
                {WALL_LABELS[id].replace(" (entry)", "")}
              </Button>
            ))}
          </div>
        </div>
      </section>
    );
  }

  return null;
}

function isWallMounted(type: string): boolean {
  return ["mirror", "medicine_cabinet", "towel_bar", "sconce"].includes(type);
}

/** rotationDeg → which wall the fixture's back is on. Mirrors rotationForWall. */
function backWallLabel(rot: number): string {
  switch (normalizeAngle(rot)) {
    case 0: return "back wall";
    case 90: return "left wall";
    case 180: return "front wall";
    case 270: return "right wall";
    default: return `${rot}°`;
  }
}

/**
 * Inch input with − / + steppers.
 *
 * The steppers matter more than the text box: most sizing should be done by
 * clicking, and some dimensions can't be dragged at all. A window's HEIGHT and
 * sill are vertical, so a top-down plan physically cannot show them — these
 * buttons are the only click-based way to change them.
 *
 * Typing stays available and stays in raw inches, because asking someone to
 * type 5'-6" into a number field is worse than typing 66. The feet-inches
 * reading underneath keeps the number meaningful.
 */
function InchField({
  label,
  value,
  onCommit,
  step = 1,
}: {
  label: string;
  value: number;
  onCommit: (v: number) => void;
  step?: number;
}) {
  const bump = (by: number) => {
    const next = Math.max(0.25, Math.round((value + by) * 4) / 4);
    if (next !== value) onCommit(next);
  };

  return (
    <div className="block">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <div className="flex items-stretch gap-0.5">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 w-6 p-0 shrink-0"
          aria-label={`Decrease ${label}`}
          onClick={() => bump(-step)}
        >
          <Minus className="h-3 w-3" />
        </Button>
        <Input
          type="number"
          step="0.25"
          min="0"
          defaultValue={value}
          key={value}
          className="h-7 text-xs text-center px-1"
          onBlur={(e) => {
            const v = Number(e.target.value);
            if (Number.isFinite(v) && v > 0 && v !== value) onCommit(v);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 w-6 p-0 shrink-0"
          aria-label={`Increase ${label}`}
          onClick={() => bump(step)}
        >
          <Plus className="h-3 w-3" />
        </Button>
      </div>
      <span className="text-[10px] text-muted-foreground">{formatFeetInches(value)}</span>
    </div>
  );
}
