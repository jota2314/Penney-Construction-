import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendEmail } from "@/lib/google/gmail";

export const runtime = "nodejs";

/**
 * Test-send a change order PDF to the currently logged-in user.
 * No CC, no DB writes, no status change, no email_logs row — pure preview.
 */
export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const myEmail = user.email;
    if (!myEmail) {
      return NextResponse.json({ error: "Your account has no email on file" }, { status: 400 });
    }

    const { changeOrderId } = await request.json();
    if (!changeOrderId) {
      return NextResponse.json({ error: "changeOrderId required" }, { status: 400 });
    }

    const { data: co } = await supabase
      .from("change_orders")
      .select("change_order_number, title, price_impact, project_id, projects(name)")
      .eq("id", changeOrderId)
      .single();

    if (!co) return NextResponse.json({ error: "Change order not found" }, { status: 404 });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const proj = co.projects as any;
    const projectName = (Array.isArray(proj) ? proj[0]?.name : proj?.name) || "Project";

    // Generate the PDF using the same internal route.
    const xfHost = request.headers.get("x-forwarded-host");
    const origin = xfHost
      ? `https://${xfHost}`
      : (request.headers.get("origin") || "https://www.penneyconstruction.build");
    const pdfRes = await fetch(`${origin}/api/generate-change-order?changeOrderId=${changeOrderId}`, {
      headers: { cookie: request.headers.get("cookie") || "" },
    });

    if (!pdfRes.ok) {
      const msg = await pdfRes.text().catch(() => "");
      return NextResponse.json(
        { error: `PDF generation failed (${pdfRes.status})`, detail: msg.slice(0, 500) },
        { status: 502 },
      );
    }

    const pdfBuffer = Buffer.from(await pdfRes.arrayBuffer());
    const attachments = [{
      filename: `CO${co.change_order_number} - ${co.title}.pdf`,
      mimeType: "application/pdf",
      content: pdfBuffer.toString("base64"),
    }];

    const subject = `[TEST] Change Order #${co.change_order_number} — ${projectName}`;
    const body = `This is a test send of Change Order #${co.change_order_number} (${co.title}) for ${projectName}.

Amount: $${Math.round(Number(co.price_impact)).toLocaleString()}

The PDF is attached. The client has NOT received this email — it was sent only to you for review.

— Penney Construction app`;

    const sent = await sendEmail({
      to: myEmail,
      subject,
      body,
      attachments,
    });

    return NextResponse.json({
      success: true,
      message: `Test sent to ${myEmail}`,
      gmailMessageId: sent.id,
    });
  } catch (e) {
    console.error("test-send-change-order failed:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Test send failed" },
      { status: 500 },
    );
  }
}
