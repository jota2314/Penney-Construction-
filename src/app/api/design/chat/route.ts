import { NextResponse } from "next/server";
import type Anthropic from "@anthropic-ai/sdk";
import { getUser } from "@/lib/auth/get-user";
import { canViewDesignStudio } from "@/lib/auth/role-access";
import { createClient } from "@/lib/supabase/server";
import { getAnthropicClient, CLAUDE_OPUS_FALLBACK, logAiUsage } from "@/lib/ai/claude";
import { DESIGN_TOOLS, DESIGN_SYSTEM_PROMPT } from "@/lib/design/design-tools";
import { applyDesignOps, type DesignOp } from "@/lib/design/ops";
import { sanitizeSpec } from "@/lib/design/geometry";
import { computeTakeoff } from "@/lib/design/takeoff";
import {
  uploadBase64,
  designRefPath,
  signSpecMaterials,
  stripSignedUrls,
  mediaTypeToExt,
} from "@/lib/design/storage";
import { defaultRoomSpec, type RoomSpec } from "@/types/design";

/**
 * The design conversation.
 *
 * Deliberately NOT streamed. The turn's real output is a set of geometry edits,
 * and the viewer can only redraw once they have all been applied and clamped —
 * streaming prose while the model is still deciding where the vanity goes would
 * show text that the final geometry then contradicts. A spinner is honest here.
 *
 * The model never returns a whole spec. It emits operations (lib/design/ops)
 * which are applied server-side to the stored spec, so anything it doesn't
 * mention survives untouched.
 */

export const maxDuration = 120;

/** Enough rounds for read-photo → build-room → place-fixtures, without looping. */
const MAX_TOOL_ROUNDS = 6;

/** Conversation window. Older turns are represented by the spec itself. */
const HISTORY_LIMIT = 16;

interface IncomingImage {
  base64: string;
  mediaType: string;
}

export async function POST(request: Request) {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  // Impersonation-aware, matching the CEO dashboard: a View-as session loses
  // access. RLS is the real boundary — see is_design_studio_owner().
  if (!canViewDesignStudio(user.profile?.email ?? user.email)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let body: {
    designId?: string;
    message?: string;
    images?: IncomingImage[];
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Bad request body" }, { status: 400 });
  }

  const { designId, message = "", images = [] } = body;

  if (!designId) {
    return NextResponse.json({ error: "designId is required" }, { status: 400 });
  }
  if (!message.trim() && images.length === 0) {
    return NextResponse.json({ error: "Send a message or an image" }, { status: 400 });
  }

  const supabase = await createClient();

  // RLS already restricts this to the owner; the explicit owner_id filter keeps
  // the intent visible at the call site.
  const { data: design, error: designError } = await supabase
    .from("bathroom_designs")
    .select("id, name, spec, reference_photo_paths")
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

  // ── Persist the incoming images ────────────────────────────────────────────
  const savedPaths: string[] = [];
  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    const path = designRefPath(designId, i, mediaTypeToExt(img.mediaType));
    const saved = await uploadBase64(supabase, path, img.base64, img.mediaType);
    if (saved) savedPaths.push(saved);
  }

  // ── Build the conversation ─────────────────────────────────────────────────
  const { data: history } = await supabase
    .from("bathroom_design_messages")
    .select("role, content")
    .eq("design_id", designId)
    .order("created_at", { ascending: false })
    .limit(HISTORY_LIMIT);

  const messages: Anthropic.MessageParam[] = (history ?? [])
    .reverse()
    .filter((m) => m.content?.trim())
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

  const userContent: Anthropic.ContentBlockParam[] = [];
  for (const img of images) {
    userContent.push({
      type: "image",
      source: {
        type: "base64",
        media_type: img.mediaType as "image/png" | "image/jpeg" | "image/gif" | "image/webp",
        data: img.base64,
      },
    });
  }
  userContent.push({
    type: "text",
    text: message.trim() || "Here's the room. Build it.",
  });

  messages.push({ role: "user", content: userContent });

  // The current model is given as system context rather than conversation, so a
  // long chat can be truncated without the model losing track of the geometry.
  const specContext = `## Current model (version ${currentSpec.version})
This is the live state. Change only what is asked; everything else stays.

${JSON.stringify(stripSignedUrls(currentSpec), null, 1)}`;

  // ── Tool loop ──────────────────────────────────────────────────────────────
  const anthropic = await getAnthropicClient();
  const collectedOps: DesignOp[] = [];
  const assistantChunks: string[] = [];
  let usedModel = CLAUDE_OPUS_FALLBACK[0];
  let totalIn = 0;
  let totalOut = 0;

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const response = await callWithFallback(anthropic, {
        system: [
          { type: "text" as const, text: DESIGN_SYSTEM_PROMPT },
          { type: "text" as const, text: specContext },
        ],
        messages,
        tools: DESIGN_TOOLS,
        max_tokens: 4000,
      });

      usedModel = response.model;
      totalIn += response.usage.input_tokens;
      totalOut += response.usage.output_tokens;

      for (const block of response.content) {
        if (block.type === "text" && block.text.trim()) {
          assistantChunks.push(block.text.trim());
        }
      }

      const toolUses = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
      );

      if (toolUses.length === 0) break;

      messages.push({ role: "assistant", content: response.content });

      const results: Anthropic.ToolResultBlockParam[] = toolUses.map((tu) => {
        collectedOps.push({
          op: tu.name,
          ...(tu.input as Record<string, unknown>),
        } as DesignOp);
        return {
          type: "tool_result",
          tool_use_id: tu.id,
          content: "Applied.",
        };
      });

      messages.push({ role: "user", content: results });

      if (response.stop_reason !== "tool_use") break;
    }
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "The design assistant could not be reached.",
      },
      { status: 502 },
    );
  }

  // ── Apply, clamp, persist ──────────────────────────────────────────────────
  const applied = applyDesignOps(currentSpec, collectedOps);
  const sanitized = sanitizeSpec(applied.spec);

  const changed = collectedOps.length > 0;
  const nextSpec: RoomSpec = {
    ...sanitized.spec,
    version: changed ? currentSpec.version + 1 : currentSpec.version,
  };

  const problems = [...applied.problems, ...sanitized.adjusted];
  const assistantText =
    assistantChunks.join("\n\n") ||
    (changed ? applied.changes.join(" ") : "Nothing changed.");

  if (changed) {
    await supabase
      .from("bathroom_designs")
      .update({
        spec: stripSignedUrls(nextSpec),
        name: nextSpec.name,
        reference_photo_paths: [
          ...(design.reference_photo_paths ?? []),
          ...savedPaths,
        ],
      })
      .eq("id", designId)
      .eq("owner_id", user.id);

    await supabase.from("bathroom_design_versions").insert({
      design_id: designId,
      owner_id: user.id,
      version_number: nextSpec.version,
      spec: stripSignedUrls(nextSpec),
      summary: applied.changes.join(" ") || assistantText.slice(0, 200),
    });
  } else if (savedPaths.length > 0) {
    await supabase
      .from("bathroom_designs")
      .update({
        reference_photo_paths: [
          ...(design.reference_photo_paths ?? []),
          ...savedPaths,
        ],
      })
      .eq("id", designId)
      .eq("owner_id", user.id);
  }

  await supabase.from("bathroom_design_messages").insert([
    {
      design_id: designId,
      owner_id: user.id,
      role: "user",
      content: message.trim(),
      image_paths: savedPaths,
    },
    {
      design_id: designId,
      owner_id: user.id,
      role: "assistant",
      content: assistantText,
      resulting_version: changed ? nextSpec.version : null,
      metadata: { model: usedModel, changes: applied.changes, problems },
    },
  ]);

  await logAiUsage({
    userId: user.id,
    endpoint: "design/chat",
    model: usedModel,
    inputTokens: totalIn,
    outputTokens: totalOut,
    context: designId,
  }).catch(() => {});

  return NextResponse.json({
    spec: await signSpecMaterials(supabase, nextSpec),
    takeoff: computeTakeoff(nextSpec),
    assistantText,
    changes: applied.changes,
    problems,
  });
}

/** Tries each model in the Opus chain; geometry reasoning is worth the top tier. */
async function callWithFallback(
  anthropic: Anthropic,
  params: Omit<Anthropic.MessageCreateParamsNonStreaming, "model">,
): Promise<Anthropic.Message> {
  let lastError: unknown;
  for (const model of CLAUDE_OPUS_FALLBACK) {
    try {
      return await anthropic.messages.create({ ...params, model });
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("All models failed");
}
