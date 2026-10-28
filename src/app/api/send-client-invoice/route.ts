import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendEmail } from "@/lib/google/gmail";

export const runtime = "nodejs";

const RYAN_EMAIL = "rpenney@penneyconstructioninc.com";
const NICOLE_EMAIL = "nsmith@penneyconstructioninc.com";
const DEFAULT_CC = `${RYAN_EMAIL}, ${NICOLE_EMAIL}`;

/**
 * Send a client invoice with PDF attachment. CCs Ryan and Nicole by default
 * (editable per send via the compose dialog's cc field). Auto-resolves the
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
    cc: overrideCc,
    reminder,
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
  if (reminder && (!inv.sent_to_client_at || inv.status === "draft")) {
    return NextResponse.json({ error: "This invoice hasn't been sent yet. Send it first." }, { status: 400 });
  }
  if (reminder && inv.status === "paid") {
    return NextResponse.json({ error: "This invoice is already marked paid." }, { status: 400 });
  }

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

  // To the penny: a $35,870.40 invoice must not read $35,870 in the email.
  const dollars = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const total = dollars(Number(inv.amount) || 0);
  const invoiceSubject = `Invoice #${inv.invoice_number} — ${proj?.name || "Project"} | Penney Construction`;
  const invoiceBody = `Hi ${clientName},

Please find attached Invoice #${inv.invoice_number} for ${proj?.name || "your project"}.

${inv.title}
Amount Due: $${total}
Terms: ${inv.terms || "Due on receipt"}

Please make checks payable to Penney Construction, Inc.

Thank you,`;

  // A reminder re-attaches the same PDF and asks for what is still open.
  const sentOn = inv.sent_to_client_at
    ? new Date(inv.sent_to_client_at).toLocaleDateString("en-US", { timeZone: "America/New_York", month: "long", day: "numeric" })
    : null;
  const stillDue = dollars(Math.max(0, (Number(inv.amount) || 0) - (Number(inv.paid_amount) || 0)));
  const reminderSubject = `Reminder: Invoice #${inv.invoice_number}, ${proj?.name || "Project"} | Penney Construction`;
  const reminderBody = `Hi ${clientName},

Just a friendly reminder about Invoice #${inv.invoice_number} for ${proj?.name || "your project"}${sentOn ? `, sent ${sentOn}` : ""}. I attached it again.

Amount Due: $${stillDue}

Please make checks payable to Penney Construction, Inc.

Thank you,`;

  const defaultSubject = reminder ? reminderSubject : invoiceSubject;
  const defaultBody = reminder ? reminderBody : invoiceBody;

  // Preview mode: return the prefilled email for the compose dialog, send nothing.
  if (preview) {
    return NextResponse.json({
      success: true,
      to: toEmail,
      cc: DEFAULT_CC,
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
  const ccList = (typeof overrideCc === "string" && overrideCc.trim()) ? overrideCc.trim() : DEFAULT_CC;

  try {
    const sent = await sendEmail({
      to: toEmail,
      cc: testOnly ? undefined : ccList,
      subject: testOnly ? `[TEST] ${subject}` : subject,
      body,
      attachments,
    });

    // A test send doesn't change invoice state — it's just a preview. A
    // reminder doesn't either: the original send date is what Collections
    // counts the wait from.
    if (!testOnly) {
      if (!reminder) {
        await supabase.from("client_invoices").update({
          sent_to_client_at: new Date().toISOString(),
          client_email: resolvedEmail,
          status: inv.status === "draft" ? "sent" : inv.status,
          updated_at: new Date().toISOString(),
        }).eq("id", invoiceId);
      }

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
        : reminder
          ? `Reminder for Invoice #${inv.invoice_number} sent to ${toEmail}`
          : `Invoice #${inv.invoice_number} sent to ${toEmail}`,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Send failed" }, { status: 500 });
  }
}
