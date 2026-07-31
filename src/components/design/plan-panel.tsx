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
  type WallId,
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
import { FIXTURE_STYLES, FIXTURE_MATERIAL_SLOTS } from "@/lib/design/fixture-styles";
import { HARDWARE_ORDER, HARDWARE_LABELS, HARDWARE_LOOKS } from "@/lib/design/hardware";
import type { Selection } from "./plan-editor";

/** Fixtures that show metal — these get the hardware picker. */
const FIXTURE_HAS_METAL = new Set<string>([
  "vanity", "shower", "tub", "toilet", "towel_bar", "sconce", "mirror", "medicine_cabinet",
]);

/** Fixtures where a plain colour is the quickest way to say what you mean. */
const FIXTURE_HAS_COLOR = new Set<string>([
  "vanity", "linen_cabinet", "bench", "knee_wall", "partition",
]);

/** Cabinet colours that actually get specified, plus a picker for anything else. */
const QUICK_COLORS = [
  "#ffffff", "#e8e4dc", "#9aa5a0", "#3f4a4d", "#2f3e46", "#3c4a41", "#6b4b32", "#1f2430",
];

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
      <div>
        <div className="text-[11px] text-muted-foreground mb-1">Hardware finish</div>
        <div className="flex flex-wrap gap-1">
          {HARDWARE_ORDER.map((h) => (
            <button
              key={h}
              title={HARDWARE_LABELS[h]}
              onClick={() => onSpecChange({ ...spec, hardware: h }, true)}
              className={`h-6 w-6 rounded-full border-2 ${(spec.hardware ?? "chrome") === h ? "border-primary" : "border-transparent"}`}
              style={{ backgroundColor: HARDWARE_LOOKS[h].color }}
            />
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground mt-1">
          Sets every tap, shower trim, pull and glass fitting at once.
        </p>
      </div>

      <p className="text-[11px] text-muted-foreground">
        Click anything in the plan or an elevation to edit it.
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
    const materialSlots = FIXTURE_MATERIAL_SLOTS[f.type];

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

        {/* Styles the 3D already renders — alcove vs freestanding, floating
            vanity, glass vs curtain — exposed as buttons instead of only being
            reachable by asking the AI in words. */}
        {(FIXTURE_STYLES[f.type] ?? []).map((control) => {
          const current = f.options?.[control.key] ?? control.fallback;
          return (
            <div key={control.key}>
              <div className="text-[11px] text-muted-foreground mb-1">{control.label}</div>
              <div className="flex flex-wrap gap-1">
                {control.choices.map((choice) => (
                  <Button
                    key={String(choice.value)}
                    size="sm"
                    variant={choice.value === current ? "default" : "outline"}
                    className="h-7 text-[11px]"
                    onClick={() =>
                      onSpecChange(
                        updateFixture(spec, f.id, {
                          options: { ...(f.options ?? {}), [control.key]: choice.value },
                          // A style change that implies a different object
                          // resizes it too, so picking "freestanding" doesn't
                          // leave a 60x30 freestanding tub that doesn't exist.
                          ...(choice.dimensions ?? {}),
                        }),
                        true,
                      )
                    }
                  >
                    {choice.label}
                  </Button>
                ))}
              </div>
            </div>
          );
        })}

        {/* Metal finish. Room-wide by default; overridable per fixture for the
            odd black filler on a brass room. */}
        {FIXTURE_HAS_METAL.has(f.type) && (
          <div>
            <div className="text-[11px] text-muted-foreground mb-1">Hardware</div>
            <div className="flex flex-wrap gap-1">
              {HARDWARE_ORDER.map((h) => {
                const active =
                  (f.options?.hardware ?? spec.hardware ?? "chrome") === h;
                return (
                  <button
                    key={h}
                    title={HARDWARE_LABELS[h]}
                    onClick={() =>
                      onSpecChange(
                        updateFixture(spec, f.id, {
                          options: { ...(f.options ?? {}), hardware: h },
                        }),
                        true,
                      )
                    }
                    className={`h-6 w-6 rounded-full border-2 ${active ? "border-primary" : "border-transparent"}`}
                    style={{ backgroundColor: HARDWARE_LOOKS[h].color }}
                  />
                );
              })}
            </div>
          </div>
        )}

        {/* Quick colour, for a cabinet or a painted piece — faster than adding a
            material when all you want is a different colour. */}
        {FIXTURE_HAS_COLOR.has(f.type) && (
          <div>
            <div className="text-[11px] text-muted-foreground mb-1">Colour</div>
            <div className="flex flex-wrap items-center gap-1">
              {QUICK_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => onSpecChange(updateFixture(spec, f.id, { color: c }), true)}
                  className={`h-6 w-6 rounded border-2 ${f.color === c ? "border-primary" : "border-transparent"}`}
                  style={{ backgroundColor: c }}
                />
              ))}
              <input
                type="color"
                value={f.color ?? "#3f4a4d"}
                onChange={(e) =>
                  onSpecChange(updateFixture(spec, f.id, { color: e.target.value }), true)
                }
                className="h-6 w-8 rounded border bg-transparent"
                aria-label="Custom colour"
              />
            </div>
          </div>
        )}

        {/* Which palette material this fixture is finished in. */}
        {materialSlots && (
          <div className="space-y-1.5">
            {materialSlots.materialLabel && (
              <MaterialPicker
                label={materialSlots.materialLabel}
                spec={spec}
                value={f.materialId ?? null}
                onPick={(id) => onSpecChange(updateFixture(spec, f.id, { materialId: id }), true)}
              />
            )}
            {materialSlots.accentLabel && (
              <MaterialPicker
                label={materialSlots.accentLabel}
                spec={spec}
                value={f.accentMaterialId ?? null}
                onPick={(id) =>
                  onSpecChange(updateFixture(spec, f.id, { accentMaterialId: id }), true)
                }
              />
            )}
          </div>
        )}

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

  if (selection?.kind === "wall") {
    return <WallFinish spec={spec} wall={selection.wall} onSpecChange={onSpecChange} />;
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

/**
 * Picks a material from the design's palette for a fixture finish.
 *
 * A plain select rather than swatches: fixture finishes are secondary to the
 * wall and floor choices, and a grid of swatches per fixture would crowd the
 * panel out.
 */
function MaterialPicker({
  label,
  spec,
  value,
  onPick,
}: {
  label: string;
  spec: RoomSpec;
  value: string | null;
  onPick: (id: string | null) => void;
}) {
  return (
    <label className="block">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <select
        value={value ?? ""}
        onChange={(e) => onPick(e.target.value || null)}
        className="h-7 w-full rounded-md border bg-background px-2 text-xs"
      >
        <option value="">Default</option>
        {spec.materials.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * Finish editor for a selected wall.
 *
 * This is the answer to "how do I pick the tile for this wall". Selecting a
 * wall — in the plan or on its elevation — lands here: pick the tile, and
 * optionally split it at a wainscot height with something else above.
 */
function WallFinish({
  spec,
  wall,
  onSpecChange,
}: {
  spec: RoomSpec;
  wall: WallId;
  onSpecChange: (next: RoomSpec, commit: boolean) => void;
}) {
  const w = spec.walls.find((x) => x.id === wall);
  if (!w) return null;

  const split = w.finish.splitHeightIn ?? 0;
  const hasSplit = Boolean(w.finish.upperMaterialId) && split > 0;

  const patch = (finish: Partial<typeof w.finish>) =>
    onSpecChange(
      {
        ...spec,
        walls: spec.walls.map((x) =>
          x.id === wall ? { ...x, finish: { ...x.finish, ...finish } } : x,
        ),
      },
      true,
    );

  return (
    <section className="rounded-md border p-2.5 space-y-2">
      <SectionLabel>{WALL_LABELS[wall]} finish</SectionLabel>

      <MaterialPicker
        label={hasSplit ? "Tile below the cap" : "Tile / finish"}
        spec={spec}
        value={w.finish.materialId}
        onPick={(id) => id && patch({ materialId: id })}
      />

      {hasSplit ? (
        <>
          <MaterialPicker
            label="Above the cap"
            spec={spec}
            value={w.finish.upperMaterialId ?? null}
            onPick={(id) => patch({ upperMaterialId: id })}
          />
          <InchField
            label="Cap height"
            value={split}
            onCommit={(v) => patch({ splitHeightIn: v })}
          />
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-[11px] w-full"
            onClick={() => patch({ upperMaterialId: null, splitHeightIn: null })}
          >
            One finish, floor to ceiling
          </Button>
        </>
      ) : (
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-[11px] w-full"
          onClick={() =>
            patch({
              // 48" is the usual wainscot: four courses of 12, or a tub surround
              // that dies just above the shower head on a half wall.
              splitHeightIn: 48,
              upperMaterialId:
                spec.materials.find((m) => m.kind === "paint")?.id ??
                w.finish.materialId,
            })
          }
        >
          Split it at a wainscot
        </Button>
      )}

      <Button
        size="sm"
        variant={w.isWet ? "default" : "outline"}
        className="h-7 text-[11px] w-full"
        onClick={() =>
          onSpecChange(
            {
              ...spec,
              walls: spec.walls.map((x) => (x.id === wall ? { ...x, isWet: !x.isWet } : x)),
            },
            true,
          )
        }
      >
        {w.isWet ? "Wet wall (shower/tub)" : "Mark as a wet wall"}
      </Button>

      <p className="text-[11px] text-muted-foreground">
        Add tiles on the <strong>Materials</strong> tab, then pick one here. A wet wall is
        counted separately in Quantities.
      </p>
    </section>
  );
}
