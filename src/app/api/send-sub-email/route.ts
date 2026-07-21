import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendEmail } from "@/lib/google/gmail";

// Sends a one-off email to a subcontractor from the project Subs tab
// (award notice, follow-up, quote request). Plain-text body — sendEmail
// wraps it in the company HTML template + signature.

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    const { projectId, quoteId, to, subject, body } = await request.json();

    const toEmail = typeof to === "string" ? to.trim() : "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toEmail)) {
      return NextResponse.json({ error: "Enter a valid email address" }, { status: 400 });
    }
    if (!subject?.trim() || !body?.trim()) {
      return NextResponse.json({ error: "Subject and message are required" }, { status: 400 });
    }

    let sent;
    try {
      sent = await sendEmail({ to: toEmail, subject: subject.trim(), body });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Send failed";
      if (msg.includes("No Google OAuth tokens")) {
        return NextResponse.json(
          { error: "Google isn't connected — sign in with Google from Settings, then try again." },
          { status: 400 }
        );
      }
      return NextResponse.json({ error: msg }, { status: 500 });
    }

    await supabase.from("email_logs").insert({
      gmail_message_id: sent.id,
      subject: subject.trim(),
      from_email: user.email,
      to_email: toEmail,
      direction: "outbound",
      category: "sub_outreach",
      project_id: projectId || null,
      sent_at: new Date().toISOString(),
      created_by: user.id,
    });

    // Emailing about a just-sent request means we're now waiting on the
    // sub — nudge the status so the list reads true.
    if (quoteId) {
      await supabase
        .from("quote_requests")
        .update({ status: "awaiting_reply" })
        .eq("id", quoteId)
        .in("status", ["just_sent"]);
    }

    return NextResponse.json({ success: true, id: sent.id });
  } catch (err) {
    console.error("send-sub-email error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to send" },
      { status: 500 }
    );
  }
}
