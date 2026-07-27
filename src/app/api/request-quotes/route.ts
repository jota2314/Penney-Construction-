import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendEmail } from "@/lib/google/gmail";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    const { projectId, projectName, lineItemId, trade, scope, subject, body, recipients } = await request.json();

    if (!recipients?.length) {
      return NextResponse.json({ error: "No recipients selected" }, { status: 400 });
    }
    if (!lineItemId) {
      return NextResponse.json({
        error: "lineItemId required — every quote request must be tied to an estimate line item",
      }, { status: 400 });
    }

    const results: { sub: string; email: string; success: boolean; error?: string; quoteId?: string }[] = [];

    for (const recipient of recipients as { id: string; name: string; email: string }[]) {
      try {
        // Send email via Gmail
        await sendEmail({
          to: recipient.email,
          subject,
          body,
        });

        // Create quote_request entry, anchored to the estimate line item
        const { data: quote } = await supabase
          .from("quote_requests")
          .insert({
            project_id: projectId,
            project_name: projectName,
            subcontractor_name: recipient.name,
            subcontractor_id: recipient.id,
            trade: trade || null,
            scope_description: scope || null,
            estimate_line_item_id: lineItemId,
            status: "just_sent",
            sent_at: new Date().toISOString(),
            created_by: user.id,
          })
          .select("id")
          .single();

        // Log the email
        await supabase.from("email_logs").insert({
          subject,
          from_email: user.email,
          to_email: recipient.email,
          direction: "outbound",
          category: "quote",
          project_id: projectId,
          sent_at: new Date().toISOString(),
        });

        results.push({ sub: recipient.name, email: recipient.email, success: true, quoteId: quote?.id });
      } catch (err) {
        results.push({ sub: recipient.name, email: recipient.email, success: false, error: err instanceof Error ? err.message : "Failed" });
      }
    }

    const sent = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    return NextResponse.json({
      success: true,
      message: `Sent to ${sent} sub${sent !== 1 ? "s" : ""}${failed > 0 ? `, ${failed} failed` : ""}`,
      results,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
