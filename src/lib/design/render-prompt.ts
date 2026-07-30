/**
 * Builds the photoreal render prompt from the RoomSpec.
 *
 * The image model is doing ONE job: making the geometry it is handed look like a
 * photograph. It is not being asked to design anything. Every layout decision
 * has already been made in the 3D model, and the reference capture carries it —
 * so the prompt's main work is describing materials (which a flat-shaded capture
 * conveys badly) and forbidding the model from moving anything.
 *
 * This matters beyond aesthetics. A render that quietly relocates the toilet or
 * widens the room is worse than no render, because the quantities alongside it
 * came from the real geometry and would no longer describe the picture.
 */

import {
  type RoomSpec,
  type DesignMaterial,
  findMaterial,
  formatFeetInches,
  WALL_LABELS,
} from "@/types/design";

function describeMaterial(m: DesignMaterial | undefined): string {
  if (!m) return "unspecified finish";
  const bits: string[] = [];

  if (m.tileWidthIn && m.tileHeightIn) {
    bits.push(`${trim(m.tileWidthIn)}x${trim(m.tileHeightIn)}`);
  }
  bits.push(m.name);
  if (m.finish) bits.push(`${m.finish} finish`);
  if (m.pattern && m.pattern !== "none" && m.tileWidthIn) {
    bits.push(`laid in a ${m.pattern.replace(/_/g, " ")} bond`);
  }
  if (m.groutColor && m.tileWidthIn) {
    bits.push(`${describeGrout(m.groutColor)} grout`);
  }
  return bits.join(", ");
}

function describeGrout(hex: string): string {
  const n = parseInt(hex.replace("#", ""), 16);
  if (Number.isNaN(n)) return "matching";
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  if (lum > 0.75) return "white";
  if (lum > 0.5) return "light grey";
  if (lum > 0.28) return "mid grey";
  return "charcoal";
}

function trim(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

export function buildRenderPrompt(spec: RoomSpec): string {
  const lines: string[] = [];

  lines.push(
    "Photograph this exact bathroom. The first reference image is a 3D model of the room — treat its geometry as fixed and authoritative.",
  );
  lines.push("");
  lines.push(
    `The room is ${formatFeetInches(spec.room.widthIn)} wide by ${formatFeetInches(spec.room.lengthIn)} deep with a ${formatFeetInches(spec.room.ceilingHeightIn)} ceiling.`,
  );
  lines.push("");

  // ── Finishes ───────────────────────────────────────────────────────────────
  lines.push("FINISHES:");
  lines.push(`- Floor: ${describeMaterial(findMaterial(spec, spec.floor.materialId))}`);
  lines.push(`- Ceiling: ${describeMaterial(findMaterial(spec, spec.ceiling.materialId))}`);

  for (const wall of spec.walls) {
    const lower = findMaterial(spec, wall.finish.materialId);
    const upper = findMaterial(spec, wall.finish.upperMaterialId);
    if (upper && wall.finish.splitHeightIn) {
      lines.push(
        `- ${WALL_LABELS[wall.id]}: ${describeMaterial(lower)} up to ${formatFeetInches(wall.finish.splitHeightIn)}, then ${describeMaterial(upper)} above`,
      );
    } else {
      lines.push(`- ${WALL_LABELS[wall.id]}: ${describeMaterial(lower)}`);
    }

    for (const op of wall.openings) {
      if (op.type === "niche") {
        const nicheMat = findMaterial(spec, op.materialId ?? wall.finish.materialId);
        lines.push(
          `  - Recessed niche ${formatFeetInches(op.widthIn)} x ${formatFeetInches(op.heightIn)}, lined in ${describeMaterial(nicheMat)}`,
        );
      }
    }
  }

  // ── Fixtures ───────────────────────────────────────────────────────────────
  if (spec.fixtures.length > 0) {
    lines.push("");
    lines.push("FIXTURES (already positioned in the reference — do not move them):");
    for (const f of spec.fixtures) {
      const mat = findMaterial(spec, f.materialId);
      const accent = findMaterial(spec, f.accentMaterialId);
      const parts = [
        `${formatFeetInches(f.widthIn)} ${f.label ?? f.type.replace(/_/g, " ")}`,
      ];
      if (mat) parts.push(mat.name);
      if (accent) parts.push(`with ${accent.name}`);
      const opts = Object.entries(f.options ?? {})
        .filter(([, v]) => v !== null && v !== "" && v !== false)
        .map(([k, v]) => `${k}: ${v}`);
      if (opts.length) parts.push(`(${opts.join(", ")})`);
      lines.push(`- ${parts.join(", ")}`);
    }
  }

  // ── The constraint that makes the render trustworthy ───────────────────────
  lines.push("");
  lines.push("STRICT REQUIREMENTS:");
  lines.push(
    "- Keep the camera position, framing and perspective of the reference image exactly.",
  );
  lines.push(
    "- Keep every wall, door, window, niche and fixture in exactly the position and size shown. Do not add, remove, resize or relocate anything.",
  );
  lines.push(
    "- Keep the tile at the scale shown: the same number of tile courses across each surface. Do not substitute a different tile size.",
  );
  lines.push(
    "- Render it as a real photograph: physically accurate materials, soft realistic bounce light, true reflections in glass and polished surfaces, subtle contact shadows.",
  );
  lines.push(
    "- Natural interior lighting. Clean and newly finished, no clutter, no towels, no people, no text, no watermark, no plants unless listed above.",
  );
  lines.push("- Shot on a 24mm lens at eye level, sharp throughout, neutral white balance.");

  if (spec.notes?.trim()) {
    lines.push("");
    lines.push(`DESIGN NOTES: ${spec.notes.trim()}`);
  }

  return lines.join("\n");
}

/**
 * Which swatches to send alongside the viewport capture.
 *
 * Capped deliberately. Each extra reference dilutes the model's attention on the
 * structural capture, which is the one image that must be obeyed. The largest
 * surfaces matter most, so tile is prioritised over trim metal.
 */
export function referenceMaterials(spec: RoomSpec, limit = 3): DesignMaterial[] {
  const used = new Set<string>();
  used.add(spec.floor.materialId);
  for (const w of spec.walls) {
    used.add(w.finish.materialId);
    if (w.finish.upperMaterialId) used.add(w.finish.upperMaterialId);
  }

  return spec.materials
    .filter((m) => used.has(m.id) && m.texturePath && m.kind !== "paint")
    .slice(0, limit);
}
