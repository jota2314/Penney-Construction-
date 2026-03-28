"use server";

import { createClient } from "@/lib/supabase/server";

export async function saveApiKey(apiKey: string): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  // Upsert the key
  const { data: existing } = await supabase
    .from("app_settings")
    .select("id")
    .eq("key", "anthropic_api_key")
    .single();

  if (existing) {
    await supabase
      .from("app_settings")
      .update({ value: apiKey, updated_at: new Date().toISOString() })
      .eq("id", existing.id);
  } else {
    await supabase
      .from("app_settings")
      .insert({ key: "anthropic_api_key", value: apiKey });
  }
}

export async function getApiKeyStatus(): Promise<boolean> {
  const supabase = await createClient();

  const { data } = await supabase
    .from("app_settings")
    .select("id")
    .eq("key", "anthropic_api_key")
    .single();

  return !!data;
}
