"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAnthropicClientServer } from "@/lib/ai/claude-server";
import { getCurrentEstimate } from "@/lib/estimates/current-estimate";

const MODEL = "claude-haiku-4-5-20251001";

export interface LineSuggestion {
  id: string;
  description: string;
  trade: string | null;
  total_cost: number | null;
  reason: string;
  rank: number;
}

/**
 * Given a schedule phase, ask Claude Haiku to rank the project's estimate
 * line items by how likely each one is the right budget line for this phase.
 * Returns top 5 suggestions ordered best first.
 */
export async function suggestLineItemsForPhase(
  phaseId: string,
): Promise<{ suggestions: LineSuggestion[]; error?: string }> {
  const supabase = await createClient();

  const { data: phase } = await supabase
    .from("schedule_phases")
    .select("id, name, notes, project_id, start_date, end_date")
    .eq("id", phaseId)
    .single();
  if (!phase || !phase.project_id) {
    return { suggestions: [], error: "Phase not found or has no project" };
  }

  const estimate = await getCurrentEstimate<{ id: string; version: number }>(
    supabase,
    phase.project_id,
    "id, version"
  );
  if (!estimate) return { suggestions: [], error: "No estimate exists for this project yet" };

  const { data: lines } = await supabase
    .from("estimate_line_items")
    .select("id, description, trade, total_cost")
    .eq("estimate_id", estimate.id)
    .order("sort_order");
  if (!lines?.length) return { suggestions: [], error: "Estimate has no line items" };

  if (lines.length === 1) {
    return {
      suggestions: [{
        ...lines[0],
        reason: "Only line item on the estimate.",
        rank: 1,
      }],
    };
  }

  const phaseDescriptor = [
    `Phase: ${phase.name}`,
    phase.notes ? `Notes: ${phase.notes}` : null,
    `Dates: ${phase.start_date} → ${phase.end_date}`,
  ].filter(Boolean).join("\n");

  const lineList = lines
    .map((l, i) => `${i + 1}. [${l.id}] trade=${l.trade ?? "?"}, cost=$${l.total_cost ?? "?"} — ${l.description}`)
    .join("\n");

  const prompt = `You match construction schedule phases to budget line items for Penney Construction.

The schedule phase is:
${phaseDescriptor}

The project's estimate has these line items:
${lineList}

Rank the top 5 most likely matches (or all of them if fewer than 5). Match on trade overlap, scope keywords, and reasonableness. Return JSON only:
{"matches":[{"id":"<uuid>","reason":"<one short sentence why>"}, ...]}
Order best first. Do not invent IDs — only use IDs from the list above.`;

  let parsed: { matches: { id: string; reason: string }[] };
  try {
    const client = await getAnthropicClientServer();
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 600,
      messages: [{ role: "user", content: prompt }],
    });
    const textBlock = response.content.find((c) => c.type === "text");
    if (!textBlock || textBlock.type !== "text") throw new Error("No text response");
    const raw = textBlock.text.trim().replace(/^```json\s*/, "").replace(/```$/, "").trim();
    parsed = JSON.parse(raw);
  } catch (err) {
    return { suggestions: [], error: err instanceof Error ? err.message : "AI ranking failed" };
  }

  const lineById = new Map(lines.map((l) => [l.id, l]));
  const suggestions: LineSuggestion[] = [];
  for (const [i, m] of (parsed.matches ?? []).entries()) {
    const line = lineById.get(m.id);
    if (line) {
      suggestions.push({ ...line, reason: m.reason, rank: i + 1 });
    }
    if (suggestions.length >= 5) break;
  }

  return { suggestions };
}

export async function linkPhaseToLineItem(
  phaseId: string,
  lineItemId: string,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };

  const { data: line } = await supabase
    .from("estimate_line_items")
    .select("id")
    .eq("id", lineItemId)
    .single();
  if (!line) return { ok: false, error: "Line item not found" };

  const { data: phase, error } = await supabase
    .from("schedule_phases")
    .update({ estimate_line_item_id: lineItemId })
    .eq("id", phaseId)
    .select("id, project_id")
    .single();
  if (error) return { ok: false, error: error.message };

  revalidatePath("/command-center");
  if (phase?.project_id) revalidatePath(`/projects/${phase.project_id}`);
  return { ok: true };
}

export async function unlinkPhaseFromLineItem(
  phaseId: string,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("schedule_phases")
    .update({ estimate_line_item_id: null })
    .eq("id", phaseId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/command-center");
  return { ok: true };
}
