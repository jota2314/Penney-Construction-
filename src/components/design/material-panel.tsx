"use client";

/**
 * Materials: pick a tile, tune it, put it on something.
 *
 * Three ways in, in order of how often they get used:
 *   1. a preset — one click, real product sizes, no photo needed
 *   2. your saved library — the tiles you actually specify, kept across designs
 *   3. a photo — the accurate route, handled by the Tile button in the composer
 *
 * Everything writes to the same palette in the RoomSpec, so a preset and a
 * photographed tile behave identically once they're in.
 */

import { useRef, useState } from "react";
import { Check, Plus, Save, Library, Loader2, Trash2, Camera } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  type RoomSpec,
  type DesignMaterial,
  type TilePattern,
  type TileFinish,
  WALL_IDS,
  WALL_LABELS,
  formatFeetInches,
} from "@/types/design";
import {
  TILE_PRESETS,
  PRESET_GROUPS,
  presetToMaterial,
  type TilePreset,
} from "@/lib/design/tile-presets";

/** Where a material can be applied in one click. */
type Target = "floor" | "ceiling" | "allWalls" | (typeof WALL_IDS)[number];

const PATTERNS: { value: TilePattern; label: string }[] = [
  { value: "running", label: "Running" },
  { value: "stack", label: "Stacked" },
  { value: "vertical_stack", label: "Vertical" },
  { value: "herringbone", label: "Herringbone" },
  { value: "basketweave", label: "Basketweave" },
];

const FINISHES: { value: TileFinish; label: string }[] = [
  { value: "matte", label: "Matte" },
  { value: "satin", label: "Satin" },
  { value: "polished", label: "Polished" },
  { value: "honed", label: "Honed" },
  { value: "textured", label: "Textured" },
];

/** Common joint widths, as they're actually called out. */
const GROUTS: { value: number; label: string }[] = [
  { value: 0.0625, label: "1/16" },
  { value: 0.125, label: "1/8" },
  { value: 0.1875, label: "3/16" },
  { value: 0.25, label: "1/4" },
];

export interface LibraryMaterial extends DesignMaterial {
  libraryId: string;
}

export function MaterialPanel({
  spec,
  onSpecChange,
  library,
  onSaveToLibrary,
  onDeleteFromLibrary,
  savingLibrary,
  onUploadTile,
  uploadingTile,
}: {
  spec: RoomSpec;
  onSpecChange: (next: RoomSpec, commit: boolean) => void;
  library: LibraryMaterial[];
  onSaveToLibrary: (m: DesignMaterial) => void;
  onDeleteFromLibrary: (libraryId: string) => void;
  savingLibrary?: boolean;
  /** Reads a real product off a photo — the accurate route. */
  onUploadTile?: (file: File) => void;
  uploadingTile?: boolean;
}) {
  const photoRef = useRef<HTMLInputElement>(null);
  const [selectedId, setSelectedId] = useState<string | null>(
    spec.materials[0]?.id ?? null,
  );
  const selected = spec.materials.find((m) => m.id === selectedId) ?? null;

  const addMaterial = (m: DesignMaterial) => {
    onSpecChange({ ...spec, materials: [...spec.materials, m] }, true);
    setSelectedId(m.id);
  };

  const patchSelected = (patch: Partial<DesignMaterial>) => {
    if (!selected) return;
    onSpecChange(
      {
        ...spec,
        materials: spec.materials.map((m) =>
          m.id === selected.id ? { ...m, ...patch } : m,
        ),
      },
      true,
    );
  };

  const applyTo = (target: Target) => {
    if (!selected) return;
    let next = spec;

    if (target === "floor") {
      next = { ...next, floor: { ...next.floor, materialId: selected.id } };
    } else if (target === "ceiling") {
      next = { ...next, ceiling: { materialId: selected.id } };
    } else if (target === "allWalls") {
      next = {
        ...next,
        walls: next.walls.map((w) => ({
          ...w,
          finish: { ...w.finish, materialId: selected.id },
        })),
      };
    } else {
      next = {
        ...next,
        walls: next.walls.map((w) =>
          w.id === target ? { ...w, finish: { ...w.finish, materialId: selected.id } } : w,
        ),
      };
    }
    onSpecChange(next, true);
  };

  return (
    <div className="space-y-3 text-sm">
      {/* The accurate route, first: a photo of the actual product. Everything
          below is a stand-in until someone has picked something real. */}
      {onUploadTile && (
        <section>
          <input
            ref={photoRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) onUploadTile(file);
            }}
          />
          <Button
            className="w-full h-8 text-xs"
            onClick={() => photoRef.current?.click()}
            disabled={uploadingTile}
          >
            {uploadingTile ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <Camera className="h-4 w-4 mr-1" />
            )}
            Add tile from a photo
          </Button>
          <p className="text-[11px] text-muted-foreground mt-1">
            The customer&apos;s photo, or a shot of the sample at the supplier. Reads the
            colour, size and finish off the picture.
          </p>
        </section>
      )}

      {/* ── Palette ─────────────────────────────────────────────────────── */}
      <section>
        <Label>In this design</Label>
        <div className="grid grid-cols-4 gap-1.5">
          {spec.materials.map((m) => (
            <Swatch
              key={m.id}
              material={m}
              selected={m.id === selectedId}
              onClick={() => setSelectedId(m.id)}
              usage={usageLabel(spec, m.id)}
            />
          ))}
        </div>
      </section>

      {/* ── Selected material ───────────────────────────────────────────── */}
      {selected && (
        <section className="rounded-md border p-2.5 space-y-2">
          <Input
            value={selected.name}
            onChange={(e) => patchSelected({ name: e.target.value })}
            className="h-7 text-xs font-medium"
          />

          {/* Real product size — this is what drives the render scale and the
              takeoff, so it's the first thing shown, not buried. */}
          {selected.kind !== "paint" && selected.kind !== "stone" && (
            <div className="grid grid-cols-2 gap-2">
              <NumField
                label="Tile width"
                value={selected.tileWidthIn ?? 12}
                onCommit={(v) => patchSelected({ tileWidthIn: v })}
              />
              <NumField
                label="Tile height"
                value={selected.tileHeightIn ?? 24}
                onCommit={(v) => patchSelected({ tileHeightIn: v })}
              />
            </div>
          )}

          {selected.kind !== "paint" && selected.kind !== "stone" && (
            <>
              <Label>Pattern</Label>
              <ChoiceRow
                choices={PATTERNS}
                current={selected.pattern ?? "stack"}
                onPick={(v) => patchSelected({ pattern: v as TilePattern })}
              />

              <Label>Grout joint</Label>
              <ChoiceRow
                choices={GROUTS.map((g) => ({ value: g.value, label: `${g.label}"` }))}
                current={selected.groutWidthIn ?? 0.125}
                onPick={(v) => patchSelected({ groutWidthIn: Number(v) })}
              />

              <div className="flex items-center gap-2">
                <Label className="mb-0">Grout colour</Label>
                <input
                  type="color"
                  value={selected.groutColor ?? "#cfcabf"}
                  onChange={(e) => patchSelected({ groutColor: e.target.value })}
                  className="h-6 w-10 rounded border bg-transparent"
                  aria-label="Grout colour"
                />
              </div>
            </>
          )}

          <Label>Finish</Label>
          <ChoiceRow
            choices={FINISHES}
            current={selected.finish ?? "matte"}
            onPick={(v) => patchSelected({ finish: v as TileFinish })}
          />

          <div className="flex items-center gap-2">
            <Label className="mb-0">Colour</Label>
            <input
              type="color"
              value={selected.baseColor}
              onChange={(e) => patchSelected({ baseColor: e.target.value })}
              className="h-6 w-10 rounded border bg-transparent"
              aria-label="Base colour"
            />
            {selected.texturePath && (
              <span className="text-[10px] text-muted-foreground">
                photo swatch in use
              </span>
            )}
          </div>

          {/* ── Apply ─────────────────────────────────────────────────── */}
          <Label>Put it on</Label>
          <div className="flex flex-wrap gap-1">
            <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => applyTo("floor")}>
              Floor
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => applyTo("allWalls")}>
              All walls
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => applyTo("ceiling")}>
              Ceiling
            </Button>
          </div>
          <div className="flex flex-wrap gap-1">
            {WALL_IDS.map((id) => (
              <Button
                key={id}
                size="sm"
                variant="outline"
                className="h-7 text-[11px]"
                onClick={() => applyTo(id)}
              >
                {WALL_LABELS[id].replace(" (entry)", "").replace(" wall", "")}
              </Button>
            ))}
          </div>

          <Button
            size="sm"
            variant="secondary"
            className="h-7 text-[11px] w-full"
            onClick={() => onSaveToLibrary(selected)}
            disabled={savingLibrary}
          >
            {savingLibrary ? (
              <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5 mr-1" />
            )}
            Save to my library
          </Button>
        </section>
      )}

      {/* ── Library ─────────────────────────────────────────────────────── */}
      {library.length > 0 && (
        <section>
          <Label>
            <span className="inline-flex items-center gap-1">
              <Library className="h-3 w-3" />
              My library
            </span>
          </Label>
          <div className="space-y-1">
            {library.map((m) => (
              <div key={m.libraryId} className="flex items-center gap-1.5">
                <button
                  className="flex items-center gap-2 flex-1 rounded border p-1 hover:border-primary/60 text-left"
                  onClick={() =>
                    addMaterial({
                      ...m,
                      id: uniqueId(m.id, spec.materials.map((x) => x.id)),
                    })
                  }
                >
                  <SwatchChip material={m} />
                  <span className="text-[11px] truncate">{m.name}</span>
                  <Plus className="h-3 w-3 ml-auto shrink-0 text-muted-foreground" />
                </button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0 text-destructive shrink-0"
                  onClick={() => onDeleteFromLibrary(m.libraryId)}
                  aria-label={`Remove ${m.name} from library`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Presets ─────────────────────────────────────────────────────── */}
      {PRESET_GROUPS.map((group) => {
        const items = TILE_PRESETS.filter((p) => p.group === group);
        if (items.length === 0) return null;
        return (
          <section key={group}>
            <Label>{group}</Label>
            <div className="grid grid-cols-2 gap-1.5">
              {items.map((p) => (
                <PresetButton
                  key={p.key}
                  preset={p}
                  onClick={() =>
                    addMaterial(presetToMaterial(p, spec.materials.map((m) => m.id)))
                  }
                />
              ))}
            </div>
          </section>
        );
      })}

      <p className="text-[11px] text-muted-foreground">
        For a real product, use the <strong>Tile</strong> button in the chat and send a
        photo — that reads the actual colour and size off the sample.
      </p>
    </div>
  );
}

// ── Bits ─────────────────────────────────────────────────────────────────────

function Label({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`text-[11px] uppercase tracking-wide text-muted-foreground mb-1.5 ${className}`}>
      {children}
    </div>
  );
}

/**
 * A tiny CSS approximation of the tile, purely for the picker.
 *
 * Deliberately not the real texture: generating a canvas per swatch would stall
 * the panel, and at 40px nobody can tell. The 3D view is the truth.
 */
function SwatchChip({ material }: { material: DesignMaterial }) {
  const isTile = Boolean(material.tileWidthIn && material.tileHeightIn);
  return (
    <span
      className="h-6 w-6 rounded border shrink-0"
      style={{
        backgroundColor: material.baseColor,
        backgroundImage:
          material.textureUrl
            ? `url(${material.textureUrl})`
            : isTile
              ? `linear-gradient(${material.groutColor ?? "#ccc"} 1px, transparent 1px), linear-gradient(90deg, ${material.groutColor ?? "#ccc"} 1px, transparent 1px)`
              : undefined,
        backgroundSize: material.textureUrl ? "cover" : "8px 5px",
      }}
    />
  );
}

function Swatch({
  material,
  selected,
  onClick,
  usage,
}: {
  material: DesignMaterial;
  selected: boolean;
  onClick: () => void;
  usage: string | null;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded border p-1 text-left ${selected ? "border-primary ring-1 ring-primary" : "hover:border-primary/50"}`}
      title={material.name}
    >
      <div
        className="h-8 w-full rounded-sm border mb-1"
        style={{
          backgroundColor: material.baseColor,
          backgroundImage: material.textureUrl ? `url(${material.textureUrl})` : undefined,
          backgroundSize: "cover",
        }}
      />
      <div className="text-[9px] leading-tight truncate">{material.name}</div>
      {usage && <div className="text-[9px] text-muted-foreground truncate">{usage}</div>}
    </button>
  );
}

function PresetButton({ preset, onClick }: { preset: TilePreset; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="rounded border p-1.5 text-left hover:border-primary/60"
    >
      <div
        className="h-7 w-full rounded-sm border mb-1"
        style={{
          backgroundColor: preset.baseColor,
          backgroundImage:
            preset.tileWidthIn
              ? `linear-gradient(${preset.groutColor} 1px, transparent 1px), linear-gradient(90deg, ${preset.groutColor} 1px, transparent 1px)`
              : undefined,
          backgroundSize: "10px 6px",
        }}
      />
      <div className="text-[10px] font-medium leading-tight">{preset.name}</div>
      <div className="text-[9px] text-muted-foreground leading-tight">{preset.blurb}</div>
    </button>
  );
}

function ChoiceRow({
  choices,
  current,
  onPick,
}: {
  choices: { value: string | number; label: string }[];
  current: string | number;
  onPick: (v: string | number) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {choices.map((c) => (
        <Button
          key={String(c.value)}
          size="sm"
          variant={c.value === current ? "default" : "outline"}
          className="h-7 text-[11px]"
          onClick={() => onPick(c.value)}
        >
          {c.value === current && <Check className="h-3 w-3 mr-1" />}
          {c.label}
        </Button>
      ))}
    </div>
  );
}

function NumField({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: number;
  onCommit: (v: number) => void;
}) {
  return (
    <label className="block">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <Input
        type="number"
        step="0.25"
        min="0.25"
        defaultValue={value}
        key={value}
        className="h-7 text-xs"
        onBlur={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v) && v > 0 && v !== value) onCommit(v);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
      />
      <span className="text-[10px] text-muted-foreground">{formatFeetInches(value)}</span>
    </label>
  );
}

/** Where a material is currently used, so the palette isn't anonymous. */
function usageLabel(spec: RoomSpec, id: string): string | null {
  const uses: string[] = [];
  if (spec.floor.materialId === id) uses.push("floor");
  if (spec.ceiling.materialId === id) uses.push("ceiling");
  const walls = spec.walls.filter(
    (w) => w.finish.materialId === id || w.finish.upperMaterialId === id,
  );
  if (walls.length === 4) uses.push("all walls");
  else if (walls.length) uses.push(`${walls.length} wall${walls.length > 1 ? "s" : ""}`);
  return uses.length ? uses.join(", ") : null;
}

function uniqueId(base: string, existing: string[]): string {
  if (!existing.includes(base)) return base;
  let n = 2;
  while (existing.includes(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}
