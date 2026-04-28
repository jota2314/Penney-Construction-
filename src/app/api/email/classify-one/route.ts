import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  classifyEmail,
  loadClassificationContext,
  persistClassification,
} from "@/lib/email/classify";

/**
 * On-demand classifier for a single inbox_emails row.
 * Used by EmailChatPanel when a user opens an email that the cron hasn't
 * classified yet (e.g. pre-classifier imports).
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let emailId: string | undefined;
  try {
    const body = await request.json();
    emailId = body?.emailId;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!emailId) {
    return NextResponse.json({ error: "emailId required" }, { status: 400 });
  }

  const { data: email, error: loadErr } = await supabase
    .from("inbox_emails")
    .select(
      "id, from_name, from_email, subject, snippet, body, direction, ai_classified_at, sender_type, urgency, ai_summary, content_type, ai_action_required, matched_customer_id, matched_subcontractor_id, matched_project_id"
    )
    .eq("id", emailId)
    .single();

  if (loadErr || !email) {
    return NextResponse.json({ error: "Email not found" }, { status: 404 });
  }

  // Already classified — just return what's there
  if (email.ai_classified_at) {
    return NextResponse.json({
      classified: false,
      result: {
        sender_type: email.sender_type,
        urgency: email.urgency,
        summary: email.ai_summary,
        action_required: email.ai_action_required,
        content_type: email.content_type,
        matched_customer_id: email.matched_customer_id,
        matched_subcontractor_id: email.matched_subcontractor_id,
        matched_project_id: email.matched_project_id,
      },
    });
  }

  // Outbound emails — short-circuit, no Haiku call needed
  if (email.direction === "outbound") {
    const stub = {
      sender_type: "internal" as const,
      urgency: "low" as const,
      summary: "(outbound)",
      action_required: false,
      content_type: "other" as const,
      matched_customer_id: null,
      matched_subcontractor_id: null,
      matched_project_id: null,
    };
    await persistClassification(supabase, email.id, stub);
    return NextResponse.json({ classified: true, result: stub });
  }

  try {
    const context = await loadClassificationContext(supabase);
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
    return NextResponse.json({ classified: true, result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Classification failed" },
      { status: 500 }
    );
  }
}
