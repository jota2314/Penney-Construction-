import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendEmail } from "@/lib/google/gmail";
import { ensureDefaultPaymentSchedule, resolveContractTotal } from "@/lib/contracts/contract-lock";
import { z } from "zod";

export const runtime = "nodejs";

const RYAN_EMAIL = "rpenney@penneyconstructioninc.com";
const requestSchema = z.object({
  projectId: z.string().uuid(),
  clientEmail: z.string().email().optional(),
  testOnly: z.boolean().optional(),
});

/**
 * Send the contract to the client for online signature — PDF attachment +
 * a /contract/[token] link. Mirrors send-change-order. Always CCs Ryan.
 *
 * Persists the thirds payment schedule first when the project has none:
 * generate-contract has always printed that split without saving it, so the
 * client could end up holding a schedule the app had no record of.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "A valid projectId is required" }, { status: 400 });
  }
  const { projectId, clientEmail: overrideEmail, testOnly } = parsed.data;

  const { data: project } = await supabase
    .from("projects")
    .select("id, name, project_number, contract_token, contract_status, contract_client_signed_at, customers(first_name, last_name, email)")
    .eq("id", projectId)
    .single();

  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  if (project.contract_client_signed_at) {
    return NextResponse.json({ error: "The client has already signed this contract" }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const custArr = project.customers as any;
  const cust = Array.isArray(custArr) ? custArr[0] : custArr;
  const clientName = cust?.first_name || "there";
  const resolvedEmail = overrideEmail || cust?.email;

  if (!resolvedEmail && !testOnly) {
    return NextResponse.json(
      { error: "No email on file for this customer. Add their email first." },
      { status: 400 },
    );
  }

  // Save the schedule the PDF is about to print.
  const seed = await ensureDefaultPaymentSchedule(supabase, projectId);
  if (seed.error) return NextResponse.json({ error: seed.error }, { status: 500 });

  const { total } = await resolveContractTotal(supabase, projectId);
  if (!total || total <= 0) {
    return NextResponse.json(
      { error: "This project has no priced estimate to build a contract from." },
      { status: 400 },
    );
  }

  const forwardedHost = request.headers.get("x-forwarded-host");
  const origin =
    request.headers.get("origin") ||
    (forwardedHost
      ? `https://${forwardedHost}`
      : "https://penney-construction-mf6m.vercel.app");

  const pdfRes = await fetch(`${origin}/api/generate-contract?projectId=${projectId}`, {
    headers: { cookie: request.headers.get("cookie") || "" },
  });
  if (!pdfRes.ok) {
    return NextResponse.json(
      { error: `Could not generate the contract PDF (${pdfRes.status})` },
      { status: 500 },
    );
  }
  const pdfBuffer = Buffer.from(await pdfRes.arrayBuffer());
  const attachments = [{
    filename: `Contract - ${project.project_number || project.name}.pdf`,
    mimeType: "application/pdf",
    content: pdfBuffer.toString("base64"),
  }];

  const signUrl = `${origin}/contract/${project.contract_token}`;
  const to = testOnly ? (user.email as string) : resolvedEmail;

  const subject = `${testOnly ? "[TEST] " : ""}Construction Contract — ${project.name || "Your project"} | Penney Construction`;

  const body = `Hi ${clientName},

Attached is the construction contract for ${project.name || "your project"}.

Contract price: $${Math.round(total).toLocaleString()}

Please review the attached PDF, then sign online here:

${signUrl}

The payment schedule is on page 1 of the contract. Once you sign, Ryan countersigns and we get the permit process started.

If you have any questions, reply to this email or call Jorge at (978) 473-0183.

Thank you,`;

  try {
    const sent = await sendEmail({
      to,
      cc: testOnly ? undefined : RYAN_EMAIL,
      subject,
      body,
      attachments,
    });

    if (testOnly) {
      return NextResponse.json({ success: true, message: `Test contract sent to ${to}`, signUrl });
    }

    await supabase.from("projects").update({
      contract_sent_to_client_at: new Date().toISOString(),
      contract_client_email: resolvedEmail,
      contract_status: "sent",
      updated_at: new Date().toISOString(),
    }).eq("id", projectId);

    await supabase.from("email_logs").insert({
      gmail_message_id: sent.id,
      direction: "outbound",
      category: "contract",
      project_id: projectId,
      created_by: user.id,
    });

    return NextResponse.json({
      success: true,
      message: `Contract sent to ${resolvedEmail}${seed.seeded ? " (thirds payment schedule saved)" : ""}`,
      signUrl,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Send failed" },
      { status: 500 },
    );
  }
}
