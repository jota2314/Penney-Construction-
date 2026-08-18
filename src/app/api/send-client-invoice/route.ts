import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendEmail } from "@/lib/google/gmail";

export const runtime = "nodejs";

const RYAN_EMAIL = "rpenney@penneyconstructioninc.com";

/**
 * Send a client invoice with PDF attachment. Always CCs Ryan. Auto-resolves the
 * customer email from the project. Mirrors send-change-order.
 *
 * Pass { testOnly: true } to email the PDF to the signed-in user only (the
 * client receives nothing) — same "Test Send" affordance change orders have.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const {
    invoiceId,
    clientEmail: overrideEmail,
    testOnly,
    preview,
    subject: overrideSubject,
    body: overrideBody,
  } = await request.json();
  if (!invoiceId) {
    return NextResponse.json({ error: "invoiceId required" }, { status: 400 });
  }

  const { data: inv } = await supabase
    .from("client_invoices")
    .select("*, projects(name, project_number, customers(first_name, last_name, email))")
    .eq("id", invoiceId)
    .single();

  if (!inv) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const proj = inv.projects as any;
  const custArr = proj?.customers;
  const cust = Array.isArray(custArr) ? custArr[0] : custArr;
  const clientName = cust?.first_name || "there";
  const resolvedEmail = overrideEmail || cust?.email;

  // For a test send, deliver to the signed-in user; otherwise to the client.
  const toEmail = testOnly ? user.email : resolvedEmail;
  if (!toEmail) {
    return NextResponse.json(
      { error: "No email on file for this customer. Add their email to the customer record first, or pass clientEmail." },
      { status: 400 },
    );
  }

  const total = Math.round(Number(inv.amount) || 0).toLocaleString();
  const defaultSubject = `Invoice #${inv.invoice_number} — ${proj?.name || "Project"} | Penney Construction`;
  const defaultBody = `Hi ${clientName},

Please find attached Invoice #${inv.invoice_number} for ${proj?.name || "your project"}.

${inv.title}
Amount Due: $${total}
Terms: ${inv.terms || "Due on receipt"}

Please make checks payable to Penney Construction, Inc.

Thank you,`;

  // Preview mode: return the prefilled email for the compose dialog, send nothing.
  if (preview) {
    return NextResponse.json({
      success: true,
      to: toEmail,
      cc: RYAN_EMAIL,
      subject: defaultSubject,
      body: defaultBody,
      attachmentName: `Invoice ${inv.invoice_number} - ${proj?.name || "Project"}.pdf`,
    });
  }

  // Generate the PDF
  const xfHost = request.headers.get("x-forwarded-host");
  const origin = request.headers.get("origin") || (xfHost ? `https://${xfHost}` : "https://www.penneyconstruction.build");
  const pdfRes = await fetch(`${origin}/api/generate-client-invoice?invoiceId=${invoiceId}`, {
    headers: { cookie: request.headers.get("cookie") || "" },
  });

  let attachments: { filename: string; mimeType: string; content: string }[] | undefined;
  if (pdfRes.ok) {
    const pdfBuffer = Buffer.from(await pdfRes.arrayBuffer());
    attachments = [{
      filename: `Invoice ${inv.invoice_number} - ${proj?.name || "Project"}.pdf`.replace(/[^\x20-\x7E]/g, "_"),
      mimeType: "application/pdf",
      content: pdfBuffer.toString("base64"),
    }];
  } else {
    return NextResponse.json({ error: "Could not generate invoice PDF" }, { status: 500 });
  }

  const subject = (typeof overrideSubject === "string" && overrideSubject.trim()) ? overrideSubject.trim() : defaultSubject;
  const body = (typeof overrideBody === "string" && overrideBody.trim()) ? overrideBody : defaultBody;

  try {
    const sent = await sendEmail({
      to: toEmail,
      cc: testOnly ? undefined : RYAN_EMAIL,
      subject: testOnly ? `[TEST] ${subject}` : subject,
      body,
      attachments,
    });

    // A test send doesn't change invoice state — it's just a preview.
    if (!testOnly) {
      await supabase.from("client_invoices").update({
        sent_to_client_at: new Date().toISOString(),
        client_email: resolvedEmail,
        status: inv.status === "draft" ? "sent" : inv.status,
        updated_at: new Date().toISOString(),
      }).eq("id", invoiceId);

      await supabase.from("email_logs").insert({
        gmail_message_id: sent.id,
        direction: "outbound",
        category: "client_update",
        project_id: inv.project_id,
        created_by: user.id,
      });

      // QuickBooks is NOT touched on send — invoices only reach QuickBooks
      // through the explicit "Create in QuickBooks" button on the invoice row.
    }

    return NextResponse.json({
      success: true,
      message: testOnly
        ? `Test invoice sent to ${toEmail}`
        : `Invoice #${inv.invoice_number} sent to ${toEmail}`,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Send failed" }, { status: 500 });
  }
}
