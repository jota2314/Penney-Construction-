/**
 * Eval endpoint for the chat-improve workflow.
 *
 * Mirrors /api/chat but:
 *   - Auth via shared secret instead of cookie (so external evals can hit
 *     a Vercel preview without managing browser sessions).
 *   - Impersonates Jorge (the primary user) via service-role Supabase.
 *   - Returns JSON synchronously instead of streaming SSE.
 *
 * Side effects MATCH /api/chat exactly: read tools auto-execute, write
 * tools become "proposed_actions" without firing — same as the user UI.
 * Conversation messages are saved so memory + history work.
 *
 * Required env:
 *   CHAT_EVAL_SECRET           Shared secret (header: x-eval-secret).
 *   SUPABASE_SERVICE_ROLE_KEY  Already set; used by createAdminClient.
 *   NEXT_PUBLIC_SUPABASE_URL   Already set.
 *   ANTHROPIC_API_KEY          Already set.
 */
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getAnthropicClient,
  CLAUDE_SONNET_FALLBACK,
  logAiUsage,
} from "@/lib/ai/claude";
import { ALL_TOOLS, FIELD_TOOLS, isReadTool } from "@/lib/ai/shared-tools";
import { executeTool } from "@/lib/ai/shared-tool-handlers";
import { buildBrainPrompt } from "@/lib/ai/prompts/brain";
import { buildProjectPrompt } from "@/lib/ai/prompts/project";
import { loadBrainContext, loadProjectContext } from "@/lib/ai/shared-context";
import { loadMemories, loadActionPatterns } from "@/lib/ai/memory";
import { loadProjectDocsContext } from "@/lib/ai/project-docs";
import type Anthropic from "@anthropic-ai/sdk";

export const runtime = "nodejs";
export const maxDuration = 120;

type MessageParam = Anthropic.MessageParam;
type ContentBlockParam = Anthropic.ContentBlockParam;

const EVAL_USER_EMAIL = "jbetancur@penneyconstructioninc.com";

export async function POST(request: Request) {
  // ── 1. Auth via shared secret ───────────────────────────────────
  const expected = process.env.CHAT_EVAL_SECRET;
  if (!expected) {
    return NextResponse.json(
      { error: "Eval endpoint disabled: CHAT_EVAL_SECRET not set" },
      { status: 503 }
    );
  }
  const got = request.headers.get("x-eval-secret");
  if (got !== expected) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // ── 2. Parse + validate body ────────────────────────────────────
  const { prompt, projectId, conversationId } = await request
    .json()
    .catch(() => ({}));
  if (!prompt || typeof prompt !== "string") {
    return NextResponse.json({ error: "prompt required" }, { status: 400 });
  }

  // ── 3. Resolve Jorge's profile (impersonated user) ──────────────
  const supabase = createAdminClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, role, full_name")
    .eq("email", EVAL_USER_EMAIL)
    .maybeSingle();

  if (!profile?.id) {
    return NextResponse.json(
      { error: `Eval user not found: ${EVAL_USER_EMAIL}` },
      { status: 500 }
    );
  }
  const userId = profile.id;
  const isField = profile.role === "field";
  const toolsForUser = isField ? FIELD_TOOLS : ALL_TOOLS;

  // Tools call supabase.auth.getUser() in several places — service-role
  // clients return null. Patch it so impersonation works end-to-end.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (supabase.auth as any).getUser = async () => ({
    data: {
      user: {
        id: userId,
        email: EVAL_USER_EMAIL,
        aud: "authenticated",
        role: "authenticated",
      },
    },
    error: null,
  });

  try {
    // ── 4. Conversation: reuse or create ───────────────────────────
    let convId = conversationId || null;
    let history: Array<{ role: string; content: string }> = [];

    if (!convId) {
      const { data: conv } = await supabase
        .from("conversations")
        .insert({
          user_id: userId,
          project_id: projectId || null,
          title: `[eval] ${prompt.substring(0, 80)}`,
        })
        .select("id")
        .single();
      if (conv) convId = conv.id;
    }

    if (convId) {
      await supabase.from("conversation_messages").insert({
        conversation_id: convId,
        role: "user",
        content: prompt,
        source: "text",
        metadata: { eval: true },
      });

      const { data: msgs } = await supabase
        .from("conversation_messages")
        .select("role, content")
        .eq("conversation_id", convId)
        .order("created_at", { ascending: true })
        .limit(50);
      history = msgs || [];
    }

    const messages: MessageParam[] =
      history.length > 0
        ? history.map((m) => ({
            role: m.role as "user" | "assistant",
            content: m.content,
          }))
        : [{ role: "user", content: prompt }];

    // ── 5. Build system prompt (same as /api/chat) ─────────────────
    const [memoryContext, patternContext] = await Promise.all([
      loadMemories(supabase, userId),
      loadActionPatterns(supabase, userId),
    ]);

    let systemPrompt: string;
    if (projectId) {
      const ctx = await loadProjectContext(supabase, projectId, isField);
      systemPrompt = ctx
        ? await buildProjectPrompt(ctx)
        : await buildBrainPrompt(await loadBrainContext(supabase, isField));
    } else {
      systemPrompt = await buildBrainPrompt(
        await loadBrainContext(supabase, isField)
      );
    }
    if (memoryContext) systemPrompt += memoryContext;
    if (patternContext) systemPrompt += patternContext;
    systemPrompt += await loadProjectDocsContext(supabase, projectId);

    // ── 6. Cached system + tools (matches /api/chat) ───────────────
    // Belt-and-suspenders: even though write tools NEVER auto-execute
    // in eval mode (only proposed_action), strip outbound-side-effect
    // tools entirely so a misclassification can't sneak through.
    const EVAL_BLOCKED_TOOLS = new Set([
      "send_email",
      "send_sms",
      "schedule_event",
    ]);
    const safeTools = toolsForUser.filter((t) => !EVAL_BLOCKED_TOOLS.has(t.name));
    const cachedTools = safeTools.map((t, i) =>
      i === safeTools.length - 1
        ? ({ ...t, cache_control: { type: "ephemeral" as const } } as Anthropic.Tool)
        : t
    );
    const cachedSystem: Anthropic.TextBlockParam[] = [
      { type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } },
    ];

    // ── 7. Tool loop ───────────────────────────────────────────────
    const anthropic = await getAnthropicClient();
    let usedModel = CLAUDE_SONNET_FALLBACK[0];
    let currentMessages: MessageParam[] = [...messages];
    let fullResponse = "";
    let totalInput = 0;
    let totalOutput = 0;
    let totalCacheCreate = 0;
    let totalCacheRead = 0;
    const toolCalls: Array<{
      name: string;
      input: unknown;
      auto_executed: boolean;
      result?: string;
    }> = [];
    const MAX_ROUNDS = 8;

    for (let round = 0; round < MAX_ROUNDS; round++) {
      let response: Anthropic.Message;
      try {
        response = await anthropic.messages.create({
          model: usedModel,
          max_tokens: 8192,
          system: cachedSystem,
          messages: currentMessages,
          tools: cachedTools,
        });
      } catch {
        if (usedModel !== CLAUDE_SONNET_FALLBACK[1]) {
          usedModel = CLAUDE_SONNET_FALLBACK[1];
          response = await anthropic.messages.create({
            model: usedModel,
            max_tokens: 8192,
            system: cachedSystem,
            messages: currentMessages,
            tools: cachedTools,
          });
        } else {
          throw new Error("All models failed");
        }
      }

      if (response.usage) {
        totalInput += response.usage.input_tokens;
        totalOutput += response.usage.output_tokens;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const u = response.usage as any;
        totalCacheCreate += u.cache_creation_input_tokens || 0;
        totalCacheRead += u.cache_read_input_tokens || 0;
      }

      const toolUseBlocks = response.content.filter(
        (b): b is Anthropic.ContentBlock & { type: "tool_use" } =>
          b.type === "tool_use"
      );
      const textBlocks = response.content.filter(
        (b): b is Anthropic.TextBlock => b.type === "text"
      );

      for (const block of textBlocks) {
        if (block.text) fullResponse += block.text;
      }

      if (toolUseBlocks.length === 0 || response.stop_reason !== "tool_use") {
        break;
      }

      const autoTools = toolUseBlocks.filter((t) => isReadTool(t.name));
      const writeTools = toolUseBlocks.filter((t) => !isReadTool(t.name));

      // Record write tools as "proposed" (no execution — matches UI behavior)
      for (const t of writeTools) {
        toolCalls.push({
          name: t.name,
          input: t.input,
          auto_executed: false,
        });
      }

      // Auto-execute read tools — but never the blocked ones, even if
      // their read/write classification flipped upstream.
      const autoResults = await Promise.all(
        autoTools.map(async (t) => {
          if (EVAL_BLOCKED_TOOLS.has(t.name)) {
            return {
              tool_use_id: t.id,
              result: JSON.stringify({
                error: "blocked_in_eval",
                message: `${t.name} is blocked in eval mode. No external side effects allowed.`,
              }),
            };
          }
          const result = await executeTool(
            t.name,
            t.input as Record<string, unknown>,
            supabase,
            userId
          );
          toolCalls.push({
            name: t.name,
            input: t.input,
            auto_executed: true,
            result: result.substring(0, 500),
          });
          return { tool_use_id: t.id, result };
        })
      );

      const toolResultsForClaude = toolUseBlocks.map((t) => {
        const auto = autoResults.find((r) => r.tool_use_id === t.id);
        if (auto) {
          return {
            type: "tool_result" as const,
            tool_use_id: t.id,
            content: auto.result,
          };
        }
        return {
          type: "tool_result" as const,
          tool_use_id: t.id,
          content: JSON.stringify({
            proposed: true,
            message:
              "Action proposed to user for approval. Do NOT re-propose.",
          }),
        };
      });

      currentMessages = [
        ...currentMessages,
        {
          role: "assistant" as const,
          content: response.content as ContentBlockParam[],
        },
        {
          role: "user" as const,
          content: toolResultsForClaude,
        },
      ];

      if (response.stop_reason !== "tool_use") break;
    }

    // ── 8. Save assistant response ─────────────────────────────────
    if (convId && fullResponse) {
      await supabase.from("conversation_messages").insert({
        conversation_id: convId,
        role: "assistant",
        content: fullResponse,
        metadata: { model: usedModel, eval: true },
      });
    }

    if (totalInput > 0 || totalOutput > 0) {
      logAiUsage({
        userId,
        endpoint: "chat-eval",
        model: usedModel,
        inputTokens: totalInput,
        outputTokens: totalOutput,
        context: projectId ? `eval:project:${projectId}` : "eval",
      });
    }

    return NextResponse.json({
      response: fullResponse,
      toolCalls,
      usage: {
        input_tokens: totalInput,
        output_tokens: totalOutput,
        cache_creation_input_tokens: totalCacheCreate,
        cache_read_input_tokens: totalCacheRead,
      },
      conversationId: convId,
      model: usedModel,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
