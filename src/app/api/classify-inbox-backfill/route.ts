import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  classifyEmail,
  persistClassification,
  loadClassificationContext,
} from "@/lib/email/classify";

export const maxDuration = 300; // 5 min

/**
 * Classify all emails missing ai_classified_at.
 * Auth: pass ?secret= matching CRON_SECRET, OR Authorization: Bearer <CRON_SECRET>.
 * Pagination: pass ?batch=50 to limit per call. Re-call until done.
 */
export async function POST(request: Request) {
  const url = new URL(request.url);
  const querySecret = url.searchParams.get("secret");
  const auth = request.headers.get("authorization");
  const expected = process.env.CRON_SECRET;
  if (!expected || (querySecret !== expected && auth !== `Bearer ${expected}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const batchSize = Math.min(parseInt(url.searchParams.get("batch") || "50", 10), 200);
  const supabase = createAdminClient();

  const context = await loadClassificationContext(supabase);

  const { data: emails, error } = await supabase
    .from("inbox_emails")
    .select("id, from_name, from_email, subject, snippet, body, direction")
    .is("ai_classified_at", null)
    .order("date", { ascending: false })
    .limit(batchSize);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!emails || emails.length === 0) {
    return NextResponse.json({ message: "Nothing to classify", classified: 0 });
  }

  const { count: remainingBefore } = await supabase
    .from("inbox_emails")
    .select("id", { count: "exact", head: true })
    .is("ai_classified_at", null);

  let classified = 0;
  const errors: string[] = [];

  for (const email of emails) {
    // Skip outbound (Penney → others) — no need to triage our own emails
    if (email.direction === "outbound") {
      await supabase
        .from("inbox_emails")
        .update({
          ai_classified_at: new Date().toISOString(),
          sender_type: "internal",
          urgency: "low",
          ai_summary: "(outbound)",
          ai_action_required: false,
        })
        .eq("id", email.id);
      classified++;
      continue;
    }

    try {
      const result = await classifyEmail({
        email: {
          from_name: email.from_name || "",
          from_email: email.from_email || "",
          subject: email.subject || "",
          snippet: email.snippet || "",
          body: (email.body || "").substring(0, 1500),
        },
        context,
      });
      await persistClassification(supabase, email.id, result);
      classified++;
    } catch (err) {
      errors.push(`${email.subject}: ${err instanceof Error ? err.message : "unknown"}`);
    }
  }

  const { count: remainingAfter } = await supabase
    .from("inbox_emails")
    .select("id", { count: "exact", head: true })
    .is("ai_classified_at", null);

  return NextResponse.json({
    classified,
    errors: errors.length > 0 ? errors : undefined,
    remainingBefore: remainingBefore ?? 0,
    remainingAfter: remainingAfter ?? 0,
    done: (remainingAfter ?? 0) === 0,
  });
}
