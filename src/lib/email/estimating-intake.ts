import type { SupabaseClient } from "@supabase/supabase-js";
import { isEstimateRequest } from "@/lib/estimates/workbench";

/** Reads classified mail; never sends a message or awards a subcontractor. */
export async function runEstimatingIntake(db: SupabaseClient, deadline = Date.now() + 5000) {
  const { data, error } = await db.from("inbox_emails")
    .select("id,content_type,subject,ai_summary,sender_type,ai_action_required")
    .eq("direction", "inbound").eq("content_type", "inquiry").eq("is_dismissed", false)
    .is("project_id", null).is("estimating_intake_checked_at", null).gte("created_at", "2026-09-05T00:00:00Z")
    .order("created_at", { ascending: false }).limit(30);
  if (error) throw new Error(error.message);
  let linked = 0;
  let needsReview = 0;
  for (const email of (data || []).filter(isEstimateRequest)) {
    if (Date.now() >= deadline) break;
    const result = await db.rpc("intake_estimate_request", { email_id: email.id });
    if (result.error) throw new Error(`Estimate intake failed: ${result.error.message}`);
    const { error: stampError } = await db.from("inbox_emails").update({ estimating_intake_checked_at: new Date().toISOString() }).eq("id", email.id);
    if (stampError) throw new Error(stampError.message);
    if (result.data) linked++; else needsReview++;
  }
  return { linked, needsReview };
}
