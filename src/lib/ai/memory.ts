"use server";

import { createClient } from "@/lib/supabase/server";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

// ── Load all active memories for injection into AI prompts ──

export async function loadMemories(supabase: SupabaseClient, userId: string): Promise<string> {
  const { data: memories } = await supabase
    .from("ai_memory")
    .select("category, key, value, relevance_score")
    .eq("user_id", userId)
    .eq("is_active", true)
    .order("relevance_score", { ascending: false })
    .limit(100);

  if (!memories || memories.length === 0) return "";

  // Group by category
  const groups: Record<string, string[]> = {};
  for (const m of memories) {
    const cat = m.category as string;
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(m.value);
  }

  const sections: string[] = [];

  if (groups.user_preference?.length) {
    sections.push(`**User Preferences:**\n${groups.user_preference.map((v) => `- ${v}`).join("\n")}`);
  }
  if (groups.company_rule?.length) {
    sections.push(`**Company Rules:**\n${groups.company_rule.map((v) => `- ${v}`).join("\n")}`);
  }
  if (groups.workflow_pattern?.length) {
    sections.push(`**Workflow Patterns:**\n${groups.workflow_pattern.map((v) => `- ${v}`).join("\n")}`);
  }
  if (groups.entity_note?.length) {
    sections.push(`**Entity Notes:**\n${groups.entity_note.map((v) => `- ${v}`).join("\n")}`);
  }
  if (groups.correction?.length) {
    sections.push(`**Corrections (avoid these mistakes):**\n${groups.correction.map((v) => `- ${v}`).join("\n")}`);
  }

  return `\n## AI MEMORY — Things You've Learned\nThese are facts, preferences, and patterns learned from past interactions. Follow them.\n\n${sections.join("\n\n")}`;
}

// ── Load recent action patterns for learning ──

export async function loadActionPatterns(supabase: SupabaseClient, userId: string): Promise<string> {
  // Get recent outcome stats
  const { data: outcomes } = await supabase
    .from("action_outcomes")
    .select("action_type, outcome, edited_fields")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(200);

  if (!outcomes || outcomes.length === 0) return "";

  // Count patterns
  const typeStats: Record<string, { approved: number; edited: number; rejected: number; commonEdits: Record<string, number> }> = {};

  for (const o of outcomes) {
    const t = o.action_type;
    if (!typeStats[t]) typeStats[t] = { approved: 0, edited: 0, rejected: 0, commonEdits: {} };

    if (o.outcome === "approved") typeStats[t].approved++;
    else if (o.outcome === "approved_with_edits") {
      typeStats[t].edited++;
      const fields = o.edited_fields as string[] | null;
      if (fields) {
        for (const f of fields) {
          typeStats[t].commonEdits[f] = (typeStats[t].commonEdits[f] || 0) + 1;
        }
      }
    } else if (o.outcome === "rejected") typeStats[t].rejected++;
  }

  // Build guidance from patterns
  const tips: string[] = [];

  for (const [type, stats] of Object.entries(typeStats)) {
    const total = stats.approved + stats.edited + stats.rejected;
    if (total < 3) continue; // Not enough data

    if (stats.rejected > total * 0.5) {
      tips.push(`- ${type}: User rejects >50% of these. Only propose when very confident.`);
    }
    if (stats.edited > total * 0.3) {
      const topEdits = Object.entries(stats.commonEdits)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([field]) => field);
      if (topEdits.length > 0) {
        tips.push(`- ${type}: User often edits ${topEdits.join(", ")} — double-check these fields.`);
      }
    }
  }

  if (tips.length === 0) return "";

  return `\n## LEARNED PATTERNS from past actions\n${tips.join("\n")}`;
}

// ── Save a new memory ──

export async function saveMemory(
  category: string,
  key: string,
  value: string,
  source: "user_taught" | "auto_learned" | "correction" = "user_taught"
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Not authenticated" };

  // Upsert: if same key exists, update value and bump relevance
  const { data: existing } = await supabase
    .from("ai_memory")
    .select("id, relevance_score")
    .eq("user_id", user.id)
    .eq("key", key)
    .eq("is_active", true)
    .single();

  if (existing) {
    const { error } = await supabase
      .from("ai_memory")
      .update({
        value,
        relevance_score: (existing.relevance_score as number) + 1,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id);
    return error ? { success: false, error: error.message } : { success: true };
  }

  const { error } = await supabase.from("ai_memory").insert({
    user_id: user.id,
    category,
    key,
    value,
    source,
  });

  return error ? { success: false, error: error.message } : { success: true };
}

// ── Record an action outcome ──

export async function recordActionOutcome(
  actionType: string,
  actionLabel: string | null,
  proposedData: Record<string, unknown>,
  finalData: Record<string, unknown>,
  outcome: "approved" | "approved_with_edits" | "rejected" | "skipped",
  emailId?: string,
  conversationId?: string,
): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  // Determine which fields were edited
  const editedFields: string[] = [];
  if (outcome === "approved_with_edits") {
    for (const [k, v] of Object.entries(finalData)) {
      if (JSON.stringify(proposedData[k]) !== JSON.stringify(v)) {
        editedFields.push(k);
      }
    }
  }

  await supabase.from("action_outcomes").insert({
    user_id: user.id,
    email_id: emailId || null,
    conversation_id: conversationId || null,
    action_type: actionType,
    action_label: actionLabel,
    proposed_data: proposedData,
    final_data: finalData,
    outcome,
    edited_fields: editedFields.length > 0 ? editedFields : null,
  });

  // Auto-learn from corrections: if user consistently edits the same field
  // for the same action type, create a memory
  if (outcome === "approved_with_edits" && editedFields.length > 0) {
    await autoLearnFromEdits(supabase, user.id, actionType, proposedData, finalData, editedFields);
  }
}

// ── Auto-learn patterns from user edits ──

async function autoLearnFromEdits(
  supabase: SupabaseClient,
  userId: string,
  actionType: string,
  proposedData: Record<string, unknown>,
  finalData: Record<string, unknown>,
  editedFields: string[],
): Promise<void> {
  // Check if the user has edited this same field 3+ times for this action type
  const { data: recentOutcomes } = await supabase
    .from("action_outcomes")
    .select("edited_fields, proposed_data, final_data")
    .eq("user_id", userId)
    .eq("action_type", actionType)
    .eq("outcome", "approved_with_edits")
    .order("created_at", { ascending: false })
    .limit(20);

  if (!recentOutcomes || recentOutcomes.length < 2) return;

  for (const field of editedFields) {
    // Count how many times this field was edited
    let editCount = 1; // current edit counts
    for (const prev of recentOutcomes) {
      const prevFields = prev.edited_fields as string[] | null;
      if (prevFields?.includes(field)) editCount++;
    }

    // If edited 3+ times, create a correction memory
    if (editCount >= 3) {
      const oldVal = proposedData[field];
      const newVal = finalData[field];
      const key = `${actionType}_${field}_correction`;
      const value = `For ${actionType}, the "${field}" field is often wrong. User usually changes it from "${oldVal}" to "${newVal}". Double-check this field.`;

      await supabase.from("ai_memory").upsert({
        user_id: userId,
        category: "correction",
        key,
        value,
        source: "auto_learned",
        relevance_score: editCount,
        is_active: true,
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id,key", ignoreDuplicates: false });
      // upsert may fail if no unique constraint on user_id+key, that's OK
    }
  }
}

// ── Parse "remember" commands from user messages ──

export function parseRememberCommand(message: string): {
  isRemember: boolean;
  category?: string;
  key?: string;
  value?: string;
} {
  const lower = message.toLowerCase().trim();

  // Match patterns like "remember that...", "note that...", "always...", "never..."
  const patterns = [
    /^remember\s+(?:that\s+)?(.+)/i,
    /^note\s+(?:that\s+)?(.+)/i,
    /^(?:from now on|going forward),?\s+(.+)/i,
    /^always\s+(.+)/i,
    /^never\s+(.+)/i,
    /^(?:keep in mind|don'?t forget)\s+(?:that\s+)?(.+)/i,
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match) {
      const content = match[1].trim();

      // Determine category from content
      let category = "user_preference";
      if (/handles?|responsible|in charge|manages?/i.test(content)) {
        category = "company_rule";
      } else if (/called|known as|same as|nickname|also goes by|is the same/i.test(content)) {
        category = "entity_note";
      } else if (/when.*then|after.*always|before.*make sure|if.*create/i.test(content)) {
        category = "workflow_pattern";
      } else if (/don'?t|never|stop|wrong|incorrect|should be|not/i.test(content)) {
        category = "correction";
      }

      // Generate a key from the content (first ~40 chars, slugified)
      const key = content
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, "")
        .trim()
        .replace(/\s+/g, "_")
        .substring(0, 60);

      return { isRemember: true, category, key, value: content };
    }
  }

  return { isRemember: false };
}
