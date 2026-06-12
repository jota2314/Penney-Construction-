/**
 * Shared agent memory — recall side.
 *
 * Reads the agent_memory table through the recall_memory RPC (migration 00085)
 * so the app's chats rank memories exactly like the MCP routines do:
 * pinned > project match > trigram text similarity > usage, capped small.
 *
 * Replaces the old src/lib/ai/memory.ts, which referenced ai_memory /
 * action_outcomes tables that were never created (migration 00054 was never
 * applied) and therefore silently no-oped.
 */

import { createClient } from "@/lib/supabase/server";

interface RecallRow {
  id: string;
  type: string;
  title: string;
  content: string;
  pinned: boolean;
  score: number;
}

export interface MemoryBlockOptions {
  /** Scope recall to one job — returns that project's memories plus globals. */
  projectId?: string;
  /** Free-text topic to rank by (e.g. the user's message). */
  query?: string;
  /** Hard cap on memories injected (default 8 — the anti-bloat budget). */
  limit?: number;
}

/**
 * Build the "Remembered context" prompt block. Returns "" when there is
 * nothing relevant or the lookup fails — memory must never break a chat.
 */
export async function buildMemoryBlock(opts: MemoryBlockOptions = {}): Promise<string> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("recall_memory", {
      p_query: opts.query ?? null,
      p_project_id: opts.projectId ?? null,
      p_agent_key: null,
      p_limit: opts.limit ?? 8,
    });
    if (error || !data?.length) return "";
    const rows = data as RecallRow[];

    // Reinforcement signal — fire-and-forget, never blocks the prompt.
    supabase
      .rpc("touch_memory", { p_ids: rows.map((r) => r.id) })
      .then(
        () => undefined,
        () => undefined,
      );

    const lines = rows.map(
      (r) => `- ${r.pinned ? "[HARD RULE] " : ""}**${r.title}**: ${r.content}`,
    );
    return `

## Remembered Context (shared agent memory)
Lessons saved by past sessions, routines, and corrections from the team. Apply them before acting. Items marked [HARD RULE] always apply. If the user corrects you or states a durable preference, save it with the save_memory tool.
${lines.join("\n")}`;
  } catch {
    return "";
  }
}
