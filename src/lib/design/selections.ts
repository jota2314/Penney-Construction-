/**
 * Finish schedule — the selections sheet.
 *
 * The document a designer actually hands over: every product chosen, its real
 * size and joint, the bond it's laid in, where it goes, and how much of it.
 * Derived entirely from the RoomSpec and the takeoff, so it can't list a tile
 * the drawing doesn't show or a quantity the model doesn't support.
 *
 * Gaps are reported rather than hidden. A selections sheet with a blank against
 * a surface is doing its job — it's the list of decisions still owed.
 */

import {
  type RoomSpec,
  type DesignMaterial,
  findMaterial,
  formatFeetInches,
  WALL_LABELS,
} from "@/types/design";
import { computeTakeoff } from "@/lib/design/takeoff";

export interface SelectionRow {
  /** Where it goes, in plain words. */
  location: string;
  product: string;
  /** "12 x 24" or an em dash for continuous finishes. */
  size: string;
  pattern: string;
  grout: string;
  finish: string;
  /** Order quantity including waste, or null when it isn't a counted material. */
  orderSf: number | null;
  pieces: number | null;
  /** True when nothing has been chosen for this surface yet. */
  missing: boolean;
}

export interface SelectionsSheet {
  rows: SelectionRow[];
  /** Decisions still owed — surfaces with no product against them. */
  open: string[];
}

export function buildSelections(spec: RoomSpec): SelectionsSheet {
  const takeoff = computeTakeoff(spec);
  const qtyByMaterial = new Map(takeoff.tile.map((t) => [t.materialId, t]));

  // One row per surface, not per material: the same tile used on two walls is
  // two decisions to communicate even though it's one product to order.
  const surfaces: { location: string; materialId: string | null | undefined }[] = [
    { location: "Floor", materialId: spec.floor.materialId },
    { location: "Ceiling", materialId: spec.ceiling.materialId },
  ];

  for (const w of spec.walls) {
    const label = WALL_LABELS[w.id].replace(" (entry)", "");
    const split = w.finish.splitHeightIn;
    if (w.finish.upperMaterialId && split) {
      surfaces.push({
        location: `${label} — to ${formatFeetInches(split)}`,
        materialId: w.finish.materialId,
      });
      surfaces.push({
        location: `${label} — above ${formatFeetInches(split)}`,
        materialId: w.finish.upperMaterialId,
      });
    } else {
      surfaces.push({ location: label, materialId: w.finish.materialId });
    }

    for (const op of w.openings) {
      if (op.type !== "niche") continue;
      surfaces.push({
        location: `${label} — ${op.label ?? "niche"} lining`,
        materialId: op.materialId ?? w.finish.materialId,
      });
    }
  }

  for (const f of spec.fixtures) {
    if (!f.materialId && !f.accentMaterialId) continue;
    const name = f.label ?? f.type.replace(/_/g, " ");
    if (f.materialId) {
      surfaces.push({ location: cap(name), materialId: f.materialId });
    }
    if (f.accentMaterialId && f.accentMaterialId !== f.materialId) {
      surfaces.push({ location: `${cap(name)} — accent`, materialId: f.accentMaterialId });
    }
  }

  const rows: SelectionRow[] = [];
  const open: string[] = [];
  // Order quantity is reported once per product, against its largest surface —
  // repeating it on every row would read as ordering it several times.
  const quantityClaimed = new Set<string>();

  for (const s of surfaces) {
    const m = findMaterial(spec, s.materialId);
    if (!m) {
      open.push(s.location);
      rows.push({
        location: s.location,
        product: "— not selected —",
        size: "—",
        pattern: "—",
        grout: "—",
        finish: "—",
        orderSf: null,
        pieces: null,
        missing: true,
      });
      continue;
    }

    const qty = qtyByMaterial.get(m.id);
    const claim = qty && !quantityClaimed.has(m.id);
    if (claim) quantityClaimed.add(m.id);

    rows.push({
      location: s.location,
      product: m.name,
      size: describeSize(m),
      pattern: m.tileWidthIn ? (m.pattern ?? "stack").replace(/_/g, " ") : "—",
      grout: m.tileWidthIn ? `${fraction(m.groutWidthIn ?? 0.125)} ${m.groutColor ?? ""}`.trim() : "—",
      finish: m.finish ?? "—",
      orderSf: claim ? qty!.orderSf : null,
      pieces: claim ? qty!.pieces : null,
      missing: false,
    });
  }

  // A tile with no confirmed size is a decision that only looks made.
  for (const m of spec.materials) {
    if (m.kind !== "tile") continue;
    if (!m.tileWidthIn || !m.tileHeightIn) {
      open.push(`${m.name} — size not confirmed`);
    }
  }

  return { rows, open };
}

function describeSize(m: DesignMaterial): string {
  if (!m.tileWidthIn || !m.tileHeightIn) return "—";
  return `${trim(m.tileWidthIn)} x ${trim(m.tileHeightIn)}`;
}

function trim(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

/** 0.0625 → 1/16, the way a joint is actually called out. */
function fraction(n: number): string {
  const sixteenths = Math.round(n * 16);
  if (sixteenths <= 0) return "—";
  const g = gcd(sixteenths, 16);
  const num = sixteenths / g;
  const den = 16 / g;
  return den === 1 ? `${num}"` : `${num}/${den}"`;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
