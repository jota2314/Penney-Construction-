import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendEmail } from "@/lib/google/gmail";

export const runtime = "nodejs";

/**
 * Send a change order to the client with PDF attachment + approval link.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { changeOrderId, clientEmail } = await request.json();
  if (!changeOrderId || !clientEmail) {
    return NextResponse.json({ error: "changeOrderId and clientEmail required" }, { status: 400 });
  }

  // Load CO
  const { data: co } = await supabase
    .from("change_orders")
    .select("*, projects(name, project_number, customers(first_name, last_name))")
    .eq("id", changeOrderId)
    .single();

  if (!co) return NextResponse.json({ error: "Change order not found" }, { status: 404 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const proj = co.projects as any;
  const custArr = proj?.customers;
  const cust = Array.isArray(custArr) ? custArr[0] : custArr;
  const clientName = cust ? cust.first_name : "there";

  // Generate the PDF
  const origin = request.headers.get("origin") || request.headers.get("x-forwarded-host") ? `https://${request.headers.get("x-forwarded-host")}` : "https://penney-construction-mf6m.vercel.app";
  const pdfRes = await fetch(`${origin}/api/generate-change-order?changeOrderId=${changeOrderId}`, {
    headers: { cookie: request.headers.get("cookie") || "" },
  });

  let attachments: { filename: string; mimeType: string; content: string }[] | undefined;
  if (pdfRes.ok) {
    const pdfBuffer = Buffer.from(await pdfRes.arrayBuffer());
    attachments = [{
      filename: `CO${co.change_order_number} - ${co.title}.pdf`,
      mimeType: "application/pdf",
      content: pdfBuffer.toString("base64"),
    }];
  }

  // Build approval link
  const approvalUrl = `${origin}/approve/${co.approval_token}`;

  const subject = `Change Order #${co.change_order_number} — ${proj?.name || "Project"} | Penney Construction`;

  const body = `Hi ${clientName},

Please review the attached Change Order #${co.change_order_number} for ${proj?.name || "your project"}.

${co.title}
Amount: $${Math.round(Number(co.price_impact)).toLocaleString()}

To approve this change order, please click the link below and sign:

${approvalUrl}

If you have any questions, reply to this email or call Jorge at (978) 473-0183.

Thank you,`;

  try {
    const sent = await sendEmail({
      to: clientEmail,
      subject,
      body,
      attachments,
    });

    // Update CO with sent info
    await supabase.from("change_orders").update({
      sent_to_client_at: new Date().toISOString(),
      client_email: clientEmail,
      status: co.status === "draft" ? "submitted" : co.status,
    }).eq("id", changeOrderId);

    // Log email
    await supabase.from("email_logs").insert({
      gmail_message_id: sent.id,
      direction: "outbound",
      category: "change_order",
      project_id: co.project_id,
      created_by: user.id,
    });

    return NextResponse.json({ success: true, message: `CO #${co.change_order_number} sent to ${clientEmail}`, approvalUrl });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Send failed" }, { status: 500 });
  }
}
