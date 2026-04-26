/**
 * Cookie/session-free Anthropic client for cron jobs and other
 * background tasks. Reads API key from env first, then admin client.
 */

import Anthropic from "@anthropic-ai/sdk";
import { createAdminClient } from "@/lib/supabase/admin";

export async function getAnthropicClientServer(): Promise<Anthropic> {
  let apiKey = process.env.CLAUDE_KEY
    || process.env.ANTHROPIC_API_KEY
    || process.env.ANTHROPIC_KEY;

  if (!apiKey) {
    const supabase = createAdminClient();
    const { data: setting } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "anthropic_api_key")
      .single();
    if (setting?.value) apiKey = setting.value;
  }

  if (!apiKey) throw new Error("No Anthropic API key configured");
  return new Anthropic({ apiKey });
}
