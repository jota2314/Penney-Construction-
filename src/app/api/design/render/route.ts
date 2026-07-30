import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth/get-user";
import { canViewDesignStudio } from "@/lib/auth/role-access";
import { createClient } from "@/lib/supabase/server";
import {
  uploadBase64,
  designRenderPath,
  designViewportPath,
  signPath,
  DESIGN_BUCKET,
} from "@/lib/design/storage";
import { buildRenderPrompt, referenceMaterials } from "@/lib/design/render-prompt";
import type { RoomSpec } from "@/types/design";

/**
 * Photoreal render.
 *
 * The 3D viewport capture is sent as the STRUCTURAL reference and the tile
 * swatches as material references, so the output is a photograph of the room
 * that was actually modelled rather than a plausible bathroom. `input_fidelity:
 * high` is what holds the geometry; without it the model redecorates.
 *
 * Model and parameter names were verified against the live API rather than
 * assumed: `image[]` takes multiple references, quality is low|medium|high|auto,
 * input_fidelity is high|low, and size must be divisible by 16.
 */

export const maxDuration = 300;

/**
 * Render models, in the order we want them.
 *
 * `input_fidelity: high` is the parameter that makes the model obey the
 * reference geometry instead of redecorating, and it is the entire reason this
 * render can be trusted next to the takeoff numbers. gpt-image-2 REJECTS that
 * parameter (verified against the live API: "does not support the
 * 'input_fidelity' parameter"), so despite being newer it is not first —
 * structural fidelity matters more here than raw image quality.
 *
 * Ordering is a judgement call, not a measurement. If gpt-image-2 later proves
 * to hold geometry well enough on its own, move it to the front.
 */
const IMAGE_MODELS: { model: string; supportsInputFidelity: boolean }[] = [
  { model: "gpt-image-1.5", supportsInputFidelity: true },
  { model: "gpt-image-2", supportsInputFidelity: false },
  { model: "gpt-image-1", supportsInputFidelity: true },
];

/** 3:2 landscape — how interiors are actually shot, and divisible by 16. */
const RENDER_SIZE = "1536x1024";

export async function POST(request: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!canViewDesignStudio(user.profile?.email ?? user.email)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "No OPENAI_API_KEY configured — renders are unavailable." },
      { status: 503 },
    );
  }

  let body: { designId?: string; viewportBase64?: string; quality?: "low" | "medium" | "high" };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Bad request body" }, { status: 400 });
  }

  const { designId, viewportBase64, quality = "high" } = body;
  if (!designId || !viewportBase64) {
    return NextResponse.json(
      { error: "designId and a viewport capture are required" },
      { status: 400 },
    );
  }

  const supabase = await createClient();

  const { data: design, error: designError } = await supabase
    .from("bathroom_designs")
    .select("id, spec")
    .eq("id", designId)
    .eq("owner_id", user.id)
    .single();

  if (designError || !design?.spec) {
    return NextResponse.json({ error: "Design not found" }, { status: 404 });
  }

  const spec = design.spec as RoomSpec;

  // Strip any data-URL prefix the browser's toDataURL adds.
  const cleanViewport = viewportBase64.replace(/^data:image\/\w+;base64,/, "");
  const viewportBuffer = Buffer.from(cleanViewport, "base64");

  // Keep the capture: it is the evidence of what the render was told to obey.
  const viewportPath = designViewportPath(designId, spec.version);
  await uploadBase64(supabase, viewportPath, cleanViewport, "image/png");

  const prompt = buildRenderPrompt(spec);

  // ── Assemble the multipart request ─────────────────────────────────────────
  const form = new FormData();
  form.append("prompt", prompt);
  form.append("size", RENDER_SIZE);
  form.append("quality", quality);
  form.append("n", "1");

  // Order matters: the structural capture must be first.
  form.append(
    "image[]",
    new Blob([new Uint8Array(viewportBuffer)], { type: "image/png" }),
    "viewport.png",
  );

  for (const mat of referenceMaterials(spec)) {
    const signed = await signPath(supabase, mat.texturePath);
    if (!signed) continue;
    try {
      const res = await fetch(signed);
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      form.append(
        "image[]",
        new Blob([new Uint8Array(buf)], { type: "image/png" }),
        `${mat.id}.png`,
      );
    } catch {
      // A missing swatch just means one less material reference.
    }
  }

  // ── Call the image model ───────────────────────────────────────────────────
  let imageB64: string | null = null;
  let usedModel = "";
  const failures: string[] = [];

  for (const { model, supportsInputFidelity } of IMAGE_MODELS) {
    const attempt = new FormData();
    for (const [k, v] of form.entries()) attempt.append(k, v);
    attempt.append("model", model);
    // Sent only where accepted — passing it to a model that rejects it fails
    // the whole request rather than being ignored.
    if (supportsInputFidelity) attempt.append("input_fidelity", "high");

    try {
      const res = await fetch("https://api.openai.com/v1/images/edits", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: attempt,
      });

      const json = await res.json();

      if (!res.ok) {
        failures.push(`${model}: ${json?.error?.message ?? res.status}`);
        continue;
      }

      const b64 = json?.data?.[0]?.b64_json;
      if (typeof b64 === "string" && b64.length > 0) {
        imageB64 = b64;
        usedModel = model;
        break;
      }
      failures.push(`${model}: response contained no image`);
    } catch (err) {
      failures.push(`${model}: ${err instanceof Error ? err.message : "request failed"}`);
    }
  }

  if (!imageB64) {
    return NextResponse.json(
      { error: "The render failed.", detail: failures.join(" | ") },
      { status: 502 },
    );
  }

  // ── Store it against this version ──────────────────────────────────────────
  const renderPath = designRenderPath(designId, spec.version);
  const buffer = Buffer.from(imageB64, "base64");
  const { error: uploadError } = await supabase.storage
    .from(DESIGN_BUCKET)
    .upload(renderPath, buffer, { contentType: "image/png", upsert: true });

  if (uploadError) {
    // The image exists but couldn't be filed. Hand it back rather than lose it.
    return NextResponse.json({
      renderUrl: `data:image/png;base64,${imageB64}`,
      stored: false,
      model: usedModel,
      warning: "Render succeeded but couldn't be saved — download it if you want to keep it.",
    });
  }

  // Attach to the current version row if one exists, otherwise create it.
  const { data: existingVersion } = await supabase
    .from("bathroom_design_versions")
    .select("id")
    .eq("design_id", designId)
    .eq("version_number", spec.version)
    .maybeSingle();

  if (existingVersion) {
    await supabase
      .from("bathroom_design_versions")
      .update({ render_path: renderPath, render_prompt: prompt, viewport_path: viewportPath })
      .eq("id", existingVersion.id);
  } else {
    await supabase.from("bathroom_design_versions").insert({
      design_id: designId,
      owner_id: user.id,
      version_number: spec.version,
      spec,
      summary: "Rendered",
      render_path: renderPath,
      render_prompt: prompt,
      viewport_path: viewportPath,
    });
  }

  return NextResponse.json({
    renderUrl: await signPath(supabase, renderPath),
    renderPath,
    stored: true,
    model: usedModel,
    version: spec.version,
  });
}
