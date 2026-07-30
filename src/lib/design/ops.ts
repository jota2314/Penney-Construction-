/**
 * Design operations — the only way the model is allowed to change a RoomSpec.
 *
 * The model never returns a whole spec on an edit. If it did, every turn would
 * be a full rewrite and any detail it forgot to echo back would silently vanish
 * — a niche, a tile size, a note about the client's tub. Instead it emits small
 * typed operations and the server applies them to the stored spec, so anything
 * it doesn't mention simply survives untouched.
 *
 * This mirrors the rule the estimating side already lives by: upsert, never wipe.
 *
 * Everything is inches, matching src/types/design.ts.
 */

import {
  type RoomSpec,
  type WallId,
  type WallOpening,
  type Fixture,
  type DesignMaterial,
  type FixtureType,
  type TilePattern,
  WALL_IDS,
} from "@/types/design";

export type DesignOp =
  | { op: "set_room"; name?: string; widthIn?: number; lengthIn?: number; ceilingHeightIn?: number }
  | {
      op: "define_material";
      id: string;
      name?: string;
      kind?: DesignMaterial["kind"];
      tileWidthIn?: number | null;
      tileHeightIn?: number | null;
      groutWidthIn?: number;
      groutColor?: string;
      pattern?: TilePattern;
      baseColor?: string;
      roughness?: number;
      metalness?: number;
      finish?: DesignMaterial["finish"];
    }
  | {
      op: "set_finish";
      target: "floor" | "ceiling" | WallId;
      materialId: string;
      upperMaterialId?: string | null;
      splitHeightIn?: number | null;
      pattern?: TilePattern;
      rotationDeg?: number;
      isWet?: boolean;
    }
  | {
      op: "place_opening";
      wall: WallId;
      id: string;
      type?: WallOpening["type"];
      uIn?: number;
      vIn?: number;
      widthIn?: number;
      heightIn?: number;
      depthIn?: number;
      hinge?: "left" | "right";
      swing?: "in" | "out";
      materialId?: string | null;
      label?: string;
    }
  | { op: "remove_opening"; wall: WallId; id: string }
  | {
      op: "place_fixture";
      id: string;
      type?: FixtureType;
      label?: string;
      widthIn?: number;
      depthIn?: number;
      heightIn?: number;
      x?: number;
      z?: number;
      yIn?: number;
      rotationDeg?: number;
      materialId?: string | null;
      accentMaterialId?: string | null;
      color?: string | null;
      options?: Record<string, string | number | boolean | null>;
    }
  | { op: "remove_fixture"; id: string }
  | { op: "note_assumption"; text: string }
  | { op: "set_notes"; text: string };

export interface OpResult {
  spec: RoomSpec;
  /** Plain-language log of what changed, shown back to the owner. */
  changes: string[];
  /** Ops that could not be applied. Surfaced, never swallowed. */
  problems: string[];
}

/** Sensible defaults per fixture type, so a bare "add a toilet" still works. */
export const FIXTURE_DEFAULTS: Record<string, { widthIn: number; depthIn: number; heightIn: number }> = {
  vanity: { widthIn: 36, depthIn: 21, heightIn: 34 },
  toilet: { widthIn: 20, depthIn: 28, heightIn: 30 },
  tub: { widthIn: 60, depthIn: 30, heightIn: 20 },
  shower: { widthIn: 36, depthIn: 36, heightIn: 84 },
  mirror: { widthIn: 30, depthIn: 1, heightIn: 36 },
  medicine_cabinet: { widthIn: 24, depthIn: 5, heightIn: 30 },
  linen_cabinet: { widthIn: 24, depthIn: 16, heightIn: 72 },
  towel_bar: { widthIn: 24, depthIn: 3, heightIn: 3 },
  sconce: { widthIn: 5, depthIn: 5, heightIn: 9 },
  ceiling_light: { widthIn: 14, depthIn: 14, heightIn: 3 },
  radiator: { widthIn: 30, depthIn: 4, heightIn: 24 },
  bench: { widthIn: 30, depthIn: 15, heightIn: 18 },
  knee_wall: { widthIn: 36, depthIn: 4.5, heightIn: 36 },
};

/** Wall-mounted things sit at a default height when none is given. */
export const DEFAULT_MOUNT_HEIGHT_IN: Record<string, number> = {
  mirror: 40,
  medicine_cabinet: 46,
  towel_bar: 48,
  sconce: 62,
};

export function applyDesignOps(input: RoomSpec, ops: DesignOp[]): OpResult {
  // Deep clone so a partial failure can't leave the caller's spec half-edited.
  const spec: RoomSpec = JSON.parse(JSON.stringify(input));
  const changes: string[] = [];
  const problems: string[] = [];

  for (const op of ops) {
    try {
      applyOne(spec, op, changes, problems);
    } catch (err) {
      problems.push(
        `Couldn't apply ${op.op}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return { spec, changes, problems };
}

function applyOne(spec: RoomSpec, op: DesignOp, changes: string[], problems: string[]) {
  switch (op.op) {
    case "set_room": {
      if (op.name) spec.name = op.name;
      if (isPositive(op.widthIn)) spec.room.widthIn = op.widthIn;
      if (isPositive(op.lengthIn)) spec.room.lengthIn = op.lengthIn;
      if (isPositive(op.ceilingHeightIn)) spec.room.ceilingHeightIn = op.ceilingHeightIn;
      changes.push(
        `Room set to ${fmt(spec.room.widthIn)} x ${fmt(spec.room.lengthIn)}, ${fmt(spec.room.ceilingHeightIn)} ceiling.`,
      );
      return;
    }

    case "define_material": {
      const existing = spec.materials.find((m) => m.id === op.id);
      const merged: DesignMaterial = {
        id: op.id,
        name: op.name ?? existing?.name ?? op.id,
        kind: op.kind ?? existing?.kind ?? "tile",
        tileWidthIn: op.tileWidthIn !== undefined ? op.tileWidthIn : existing?.tileWidthIn,
        tileHeightIn: op.tileHeightIn !== undefined ? op.tileHeightIn : existing?.tileHeightIn,
        groutWidthIn: op.groutWidthIn ?? existing?.groutWidthIn ?? 0.125,
        groutColor: op.groutColor ?? existing?.groutColor ?? "#cfcabf",
        pattern: op.pattern ?? existing?.pattern ?? "stack",
        baseColor: op.baseColor ?? existing?.baseColor ?? "#d8d4cc",
        roughness: op.roughness ?? existing?.roughness ?? 0.6,
        metalness: op.metalness ?? existing?.metalness ?? 0,
        finish: op.finish !== undefined ? op.finish : existing?.finish,
        // Photo links are owned by the upload flow, never by the model.
        sourcePhotoPath: existing?.sourcePhotoPath ?? null,
        texturePath: existing?.texturePath ?? null,
        textureUrl: existing?.textureUrl ?? null,
        sourcePhotoUrl: existing?.sourcePhotoUrl ?? null,
      };

      if (existing) {
        Object.assign(existing, merged);
        changes.push(`Updated material "${merged.name}".`);
      } else {
        spec.materials.push(merged);
        changes.push(`Added material "${merged.name}".`);
      }
      return;
    }

    case "set_finish": {
      if (!materialExists(spec, op.materialId)) {
        problems.push(
          `Finish references material "${op.materialId}" which isn't defined — define it first.`,
        );
        return;
      }
      if (op.upperMaterialId && !materialExists(spec, op.upperMaterialId)) {
        problems.push(`Upper material "${op.upperMaterialId}" isn't defined.`);
        return;
      }

      if (op.target === "floor") {
        spec.floor.materialId = op.materialId;
        if (op.pattern) spec.floor.pattern = op.pattern;
        if (op.rotationDeg !== undefined) spec.floor.rotationDeg = op.rotationDeg;
        changes.push(`Floor finished in ${materialName(spec, op.materialId)}.`);
        return;
      }

      if (op.target === "ceiling") {
        spec.ceiling.materialId = op.materialId;
        changes.push(`Ceiling finished in ${materialName(spec, op.materialId)}.`);
        return;
      }

      const wall = spec.walls.find((w) => w.id === op.target);
      if (!wall) {
        problems.push(`No wall called "${op.target}".`);
        return;
      }
      wall.finish.materialId = op.materialId;
      wall.finish.upperMaterialId = op.upperMaterialId ?? null;
      wall.finish.splitHeightIn = op.splitHeightIn ?? null;
      if (op.isWet !== undefined) wall.isWet = op.isWet;

      changes.push(
        op.upperMaterialId
          ? `${cap(op.target)} wall: ${materialName(spec, op.materialId)} to ${fmt(op.splitHeightIn ?? 0)}, ${materialName(spec, op.upperMaterialId)} above.`
          : `${cap(op.target)} wall finished in ${materialName(spec, op.materialId)}.`,
      );
      return;
    }

    case "place_opening": {
      const wall = spec.walls.find((w) => w.id === op.wall);
      if (!wall) {
        problems.push(`No wall called "${op.wall}".`);
        return;
      }
      const existing = wall.openings.find((o) => o.id === op.id);
      const next: WallOpening = {
        id: op.id,
        type: op.type ?? existing?.type ?? "niche",
        uIn: op.uIn ?? existing?.uIn ?? 0,
        vIn: op.vIn ?? existing?.vIn ?? 0,
        widthIn: op.widthIn ?? existing?.widthIn ?? 24,
        heightIn: op.heightIn ?? existing?.heightIn ?? 24,
        depthIn: op.depthIn ?? existing?.depthIn ?? 3.5,
        hinge: op.hinge ?? existing?.hinge,
        swing: op.swing ?? existing?.swing,
        materialId: op.materialId !== undefined ? op.materialId : existing?.materialId,
        label: op.label ?? existing?.label,
      };
      if (existing) {
        Object.assign(existing, next);
        changes.push(`Moved/resized ${next.label ?? next.type} on the ${op.wall} wall.`);
      } else {
        wall.openings.push(next);
        changes.push(
          `Added a ${fmt(next.widthIn)} x ${fmt(next.heightIn)} ${next.type} on the ${op.wall} wall.`,
        );
      }
      return;
    }

    case "remove_opening": {
      const wall = spec.walls.find((w) => w.id === op.wall);
      if (!wall) {
        problems.push(`No wall called "${op.wall}".`);
        return;
      }
      const before = wall.openings.length;
      wall.openings = wall.openings.filter((o) => o.id !== op.id);
      if (wall.openings.length === before) {
        problems.push(`No opening "${op.id}" on the ${op.wall} wall.`);
      } else {
        changes.push(`Removed an opening from the ${op.wall} wall.`);
      }
      return;
    }

    case "place_fixture": {
      const existing = spec.fixtures.find((f) => f.id === op.id);
      const type = (op.type ?? existing?.type ?? "vanity") as FixtureType;
      const d = FIXTURE_DEFAULTS[type] ?? { widthIn: 24, depthIn: 24, heightIn: 30 };

      const next: Fixture = {
        id: op.id,
        type,
        label: op.label ?? existing?.label,
        widthIn: op.widthIn ?? existing?.widthIn ?? d.widthIn,
        depthIn: op.depthIn ?? existing?.depthIn ?? d.depthIn,
        heightIn: op.heightIn ?? existing?.heightIn ?? d.heightIn,
        x: op.x ?? existing?.x ?? spec.room.widthIn / 2,
        z: op.z ?? existing?.z ?? spec.room.lengthIn / 2,
        yIn: op.yIn ?? existing?.yIn ?? DEFAULT_MOUNT_HEIGHT_IN[type] ?? 0,
        rotationDeg: op.rotationDeg ?? existing?.rotationDeg ?? 0,
        materialId: op.materialId !== undefined ? op.materialId : existing?.materialId,
        accentMaterialId:
          op.accentMaterialId !== undefined ? op.accentMaterialId : existing?.accentMaterialId,
        color: op.color !== undefined ? op.color : existing?.color,
        options: { ...(existing?.options ?? {}), ...(op.options ?? {}) },
      };

      for (const key of ["materialId", "accentMaterialId"] as const) {
        const val = next[key];
        if (val && !materialExists(spec, val)) {
          problems.push(
            `${next.label ?? type} references material "${val}" which isn't defined — dropped it.`,
          );
          next[key] = null;
        }
      }

      if (existing) {
        Object.assign(existing, next);
        changes.push(`Updated the ${next.label ?? type}.`);
      } else {
        spec.fixtures.push(next);
        changes.push(
          `Placed a ${fmt(next.widthIn)} ${next.label ?? type.replace(/_/g, " ")}.`,
        );
      }
      return;
    }

    case "remove_fixture": {
      const before = spec.fixtures.length;
      spec.fixtures = spec.fixtures.filter((f) => f.id !== op.id);
      if (spec.fixtures.length === before) {
        problems.push(`No fixture "${op.id}".`);
      } else {
        changes.push(`Removed a fixture.`);
      }
      return;
    }

    case "note_assumption": {
      spec.assumptions = [...(spec.assumptions ?? []), op.text];
      return;
    }

    case "set_notes": {
      spec.notes = op.text;
      return;
    }

    default: {
      problems.push(`Unknown operation: ${JSON.stringify(op)}`);
    }
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────

function isPositive(n: number | undefined): n is number {
  return typeof n === "number" && Number.isFinite(n) && n > 0;
}

function materialExists(spec: RoomSpec, id: string): boolean {
  return spec.materials.some((m) => m.id === id);
}

function materialName(spec: RoomSpec, id: string): string {
  return spec.materials.find((m) => m.id === id)?.name ?? id;
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Compact inch formatting for change messages: 96 → 8'-0". */
function fmt(inches: number): string {
  const feet = Math.floor(inches / 12);
  const rem = Math.round((inches - feet * 12) * 4) / 4;
  if (feet === 0) return `${rem}"`;
  return rem === 0 ? `${feet}'` : `${feet}'-${rem}"`;
}

export { WALL_IDS };
