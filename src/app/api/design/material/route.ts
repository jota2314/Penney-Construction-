import { NextResponse } from "next/server";
import sharp from "sharp";
import type Anthropic from "@anthropic-ai/sdk";
import { getUser } from "@/lib/auth/get-user";
import { canViewDesignStudio } from "@/lib/auth/role-access";
import { createClient } from "@/lib/supabase/server";
import { getAnthropicClient, CLAUDE_OPUS_FALLBACK, logAiUsage } from "@/lib/ai/claude";
import {
  uploadBase64,
  designSwatchPath,
  signSpecMaterials,
  stripSignedUrls,
  mediaTypeToExt,
  DESIGN_BUCKET,
} from "@/lib/design/storage";
import { computeTakeoff } from "@/lib/design/takeoff";
import { applyDesignOps, type DesignOp } from "@/lib/design/ops";
import { defaultRoomSpec, type RoomSpec } from "@/types/design";

/**
 * Tile photo → a real material in the design's palette.
 *
 * Two things happen here, and the second is what makes the render believable:
 *
 * 1. Vision reads the product — colour, size, finish, grout. The SIZE is the
 *    critical field: it sets the texture repeat, so getting it wrong makes the
 *    whole room read as fake even if the colour is perfect. The model is told to
 *    say so rather than guess when the photo gives it nothing to judge scale by.
 *
 * 2. A single tile face is cropped out and flattened into a swatch. A raw photo
 *    tiled across a wall repeats its lighting, its grout lines and its
 *    perspective, which looks like wallpaper. One clean face, repeated at true
 *    scale by the viewer, looks like tile.
 */

export const maxDuration = 90;

/** Swatches are tiled small across a surface; more than this buys nothing. */
const SWATCH_PX = 512;

const READ_TILE_TOOL: Anthropic.Tool = {
  name: "report_tile",
  description: "Report what this tile actually is, and where one clean face sits in the photo.",
  input_schema: {
    type: "object",
    required: ["name", "baseColor", "confidentAboutSize", "cropRect"],
    properties: {
      name: {
        type: "string",
        description: "Product description, e.g. 'Matte white 3x12 ceramic subway'.",
      },
      kind: { type: "string", enum: ["tile", "stone", "wood", "metal", "glass", "paint", "other"] },
      baseColor: { type: "string", description: "Dominant colour as hex." },
      groutColor: { type: "string", description: "Grout colour as hex, if visible." },
      tileWidthIn: { type: "number", description: "Real product width in INCHES." },
      tileHeightIn: { type: "number", description: "Real product height in INCHES." },
      confidentAboutSize: {
        type: "boolean",
        description:
          "TRUE only if the photo genuinely shows the scale (a ruler, a known object, a visible box label, or a stated size). FALSE if you are inferring from appearance alone.",
      },
      sizeReasoning: {
        type: "string",
        description: "One line: what in the photo told you the size, or why you can't tell.",
      },
      groutWidthIn: { type: "number", description: "Joint width in inches. 0.0625 or 0.125 typically." },
      pattern: {
        type: "string",
        enum: ["stack", "running", "vertical_stack", "herringbone", "basketweave", "none"],
        description: "The bond shown in the photo, if any is shown.",
      },
      finish: { type: "string", enum: ["matte", "polished", "honed", "satin", "textured"] },
      roughness: { type: "number", description: "0 = mirror, 1 = flat matte." },
      metalness: { type: "number", description: "0 for tile and stone." },
      cropRect: {
        type: "object",
        required: ["x", "y", "width", "height"],
        description:
          "Normalised 0-1 box around ONE clean tile face: flattest angle, evenest lighting, no grout line crossing it, no glare, no hand or packaging.",
        properties: {
          x: { type: "number" },
          y: { type: "number" },
          width: { type: "number" },
          height: { type: "number" },
        },
      },
    },
  },
};

const TILE_SYSTEM = `You identify tile and finishes from photographs for a contractor's 3D bathroom model.

Report what you actually see. The size field drives the render scale and the material takeoff, so a confident wrong number is far worse than an honest "I can't tell". Set confidentAboutSize to false unless the photo really shows the scale.

For cropRect, pick the single cleanest tile face in the image: as square-on as possible, evenly lit, no grout joint running through it, no glare blowout, no fingers or box in frame. This crop becomes the repeating texture, so any grout line or shadow inside it will repeat across the whole wall.`;

export async function POST(request: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!canViewDesignStudio(user.profile?.email ?? user.email)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let body: {
    designId?: string;
    materialId?: string;
    base64?: string;
    mediaType?: string;
    /** Where to apply it straight away, if the owner already said. */
    applyTo?: "floor" | "ceiling" | "back" | "front" | "left" | "right" | null;
    /** Overrides vision when the owner knows the product size. */
    knownWidthIn?: number;
    knownHeightIn?: number;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Bad request body" }, { status: 400 });
  }

  const { designId, base64, mediaType = "image/jpeg", applyTo = null } = body;
  if (!designId || !base64) {
    return NextResponse.json({ error: "designId and an image are required" }, { status: 400 });
  }

  const supabase = await createClient();

  const { data: design, error: designError } = await supabase
    .from("bathroom_designs")
    .select("id, name, spec")
    .eq("id", designId)
    .eq("owner_id", user.id)
    .single();

  if (designError || !design) {
    return NextResponse.json({ error: "Design not found" }, { status: 404 });
  }

  const currentSpec: RoomSpec =
    design.spec && Object.keys(design.spec).length > 0
      ? (design.spec as RoomSpec)
      : defaultRoomSpec(design.name);

  // ── Read the tile ──────────────────────────────────────────────────────────
  const anthropic = await getAnthropicClient();
  let report: Record<string, unknown> | null = null;
  let usedModel = CLAUDE_OPUS_FALLBACK[0];

  try {
    for (const model of CLAUDE_OPUS_FALLBACK) {
      try {
        const response = await anthropic.messages.create({
          model,
          max_tokens: 1500,
          system: TILE_SYSTEM,
          tools: [READ_TILE_TOOL],
          tool_choice: { type: "tool", name: "report_tile" },
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "image",
                  source: {
                    type: "base64",
                    media_type: mediaType as "image/png" | "image/jpeg" | "image/webp" | "image/gif",
                    data: base64,
                  },
                },
                { type: "text", text: "What is this tile? Where is one clean face?" },
              ],
            },
          ],
        });
        usedModel = response.model;
        const tu = response.content.find(
          (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
        );
        if (tu) report = tu.input as Record<string, unknown>;
        await logAiUsage({
          userId: user.id,
          endpoint: "design/material",
          model: response.model,
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
          context: designId,
        }).catch(() => {});
        break;
      } catch {
        /* try the next model */
      }
    }
  } catch {
    /* fall through to the null check */
  }

  if (!report) {
    return NextResponse.json(
      { error: "Couldn't read that photo. Try a straight-on shot in even light." },
      { status: 502 },
    );
  }

  // ── Crop the swatch ────────────────────────────────────────────────────────
  const materialId = body.materialId || `mat-${Date.now().toString(36)}`;
  const ext = mediaTypeToExt(mediaType);

  const sourcePath = designSwatchPath(designId, `${materialId}-src`, ext);
  await uploadBase64(supabase, sourcePath, base64, mediaType);

  let texturePath: string | null = null;
  try {
    const input = Buffer.from(base64, "base64");
    const meta = await sharp(input).metadata();
    const iw = meta.width ?? 0;
    const ih = meta.height ?? 0;

    if (iw > 0 && ih > 0) {
      const rect = (report.cropRect ?? {}) as Record<string, number>;
      // Clamp the model's box to something extractable. A degenerate rect would
      // throw inside sharp and lose the swatch entirely.
      const left = Math.round(clamp01(rect.x ?? 0.35) * iw);
      const top = Math.round(clamp01(rect.y ?? 0.35) * ih);
      const width = Math.max(16, Math.round(clamp01(rect.width ?? 0.3) * iw));
      const height = Math.max(16, Math.round(clamp01(rect.height ?? 0.3) * ih));

      const safeW = Math.min(width, iw - left);
      const safeH = Math.min(height, ih - top);

      if (safeW >= 16 && safeH >= 16) {
        const swatch = await sharp(input)
          .extract({ left, top, width: safeW, height: safeH })
          .resize(SWATCH_PX, SWATCH_PX, { fit: "cover" })
          // Photos of tile are usually shot under warm room light; a gentle
          // normalise pulls them back toward how the product actually looks.
          .normalise()
          .png()
          .toBuffer();

        const path = designSwatchPath(designId, materialId, "png");
        const { error } = await supabase.storage
          .from(DESIGN_BUCKET)
          .upload(path, swatch, { contentType: "image/png", upsert: true });
        if (!error) texturePath = path;
      }
    }
  } catch {
    // No swatch is survivable — the material still carries its base colour.
  }

  // ── Add it to the palette ──────────────────────────────────────────────────
  const widthIn = body.knownWidthIn ?? (report.tileWidthIn as number | undefined);
  const heightIn = body.knownHeightIn ?? (report.tileHeightIn as number | undefined);
  const sizeKnown =
    body.knownWidthIn != null || report.confidentAboutSize === true;

  const ops: DesignOp[] = [
    {
      op: "define_material",
      id: materialId,
      name: String(report.name ?? "Tile"),
      kind: (report.kind as "tile") ?? "tile",
      tileWidthIn: widthIn ?? null,
      tileHeightIn: heightIn ?? null,
      groutWidthIn: (report.groutWidthIn as number) ?? 0.125,
      groutColor: String(report.groutColor ?? "#cfcabf"),
      pattern: (report.pattern as "stack") ?? "stack",
      baseColor: String(report.baseColor ?? "#d8d4cc"),
      roughness: (report.roughness as number) ?? 0.5,
      metalness: (report.metalness as number) ?? 0,
      finish: (report.finish as "matte") ?? null,
    },
  ];

  if (!sizeKnown && widthIn) {
    ops.push({
      op: "note_assumption",
      text: `${report.name}: size assumed at ${widthIn}x${heightIn} — the photo didn't show scale. Confirm before this drives a quantity.`,
    });
  }

  if (applyTo) {
    ops.push({ op: "set_finish", target: applyTo, materialId });
  }

  const applied = applyDesignOps(currentSpec, ops);

  // Attach the storage paths directly. These are owned by the upload flow, not
  // by the model, so ops deliberately cannot set them.
  const material = applied.spec.materials.find((m) => m.id === materialId);
  if (material) {
    material.sourcePhotoPath = sourcePath;
    material.texturePath = texturePath;
  }

  const nextSpec: RoomSpec = { ...applied.spec, version: currentSpec.version + 1 };

  await supabase
    .from("bathroom_designs")
    .update({ spec: stripSignedUrls(nextSpec) })
    .eq("id", designId)
    .eq("owner_id", user.id);

  await supabase.from("bathroom_design_versions").insert({
    design_id: designId,
    owner_id: user.id,
    version_number: nextSpec.version,
    spec: stripSignedUrls(nextSpec),
    summary: `Added material: ${report.name}`,
  });

  await supabase.from("bathroom_design_messages").insert({
    design_id: designId,
    owner_id: user.id,
    role: "assistant",
    content: sizeKnown
      ? `Added ${report.name}.${applyTo ? ` Applied to the ${applyTo}.` : ""}`
      : `Added ${report.name}. I couldn't tell the size from that photo — ${report.sizeReasoning ?? "no scale reference"}. Tell me the real size and I'll correct it.`,
    resulting_version: nextSpec.version,
    metadata: { model: usedModel, materialId },
  });

  return NextResponse.json({
    spec: await signSpecMaterials(supabase, nextSpec),
    takeoff: computeTakeoff(nextSpec),
    materialId,
    sizeKnown,
    sizeReasoning: report.sizeReasoning ?? null,
    report,
  });
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}
