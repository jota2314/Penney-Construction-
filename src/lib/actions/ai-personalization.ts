"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getUser } from "@/lib/auth/get-user";

export type StoredMemory = {
  id: string;
  category: string;
  key: string | null;
  value: string;
  relevance_score: number | null;
  created_at: string | null;
};

export async function getUserAiInstructions(): Promise<string> {
  const user = await getUser();
  if (!user) return "";
  const supabase = await createClient();
  const { data } = await supabase
    .from("user_ai_instructions")
    .select("instructions")
    .eq("profile_id", user.id)
    .maybeSingle();
  return data?.instructions ?? "";
}

export async function saveUserAiInstructions(
  raw: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await getUser();
  if (!user) return { ok: false, error: "Not authenticated" };
  if (typeof raw !== "string") return { ok: false, error: "Invalid input" };
  if (raw.length > 10_000) return { ok: false, error: "Too long — keep under 10k characters." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("user_ai_instructions")
    .upsert(
      { profile_id: user.id, instructions: raw },
      { onConflict: "profile_id" }
    );
  if (error) return { ok: false, error: error.message };

  revalidatePath("/settings");
  return { ok: true };
}

export async function getUserMemories(): Promise<StoredMemory[]> {
  const user = await getUser();
  if (!user) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("ai_memory")
    .select("id, category, key, value, relevance_score, created_at")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .order("relevance_score", { ascending: false })
    .order("created_at", { ascending: false });
  return data ?? [];
}

export async function deleteUserMemory(
  memoryId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await getUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  const supabase = await createClient();
  // Soft-delete via is_active flag, scoped to this user's row only.
  const { error } = await supabase
    .from("ai_memory")
    .update({ is_active: false })
    .eq("id", memoryId)
    .eq("user_id", user.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/settings");
  return { ok: true };
}
