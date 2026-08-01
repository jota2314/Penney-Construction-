// What goes out the moment a client signs: the executed contract back to the
// client, and a short permit note to Nicole. Two separate emails on purpose —
// the client's copy should read like a contract copy, not an internal handoff.

import { sendEmailWithAccessToken } from "@/lib/google/gmail";
import { getAccessTokenFromRefreshToken } from "@/lib/google/server-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import type { DB } from "@/lib/contracts/contract-lock";

const RYAN_EMAIL = "rpenney@penneyconstructioninc.com";
const JORGE_EMAIL = "jbetancur@penneyconstructioninc.com";
const NICOLE_EMAIL = "nsmith@penneyconstructioninc.com";

/**
 * The only people who hear about a signed contract. An explicit list, not a
 * role query — role-based recipients quietly pulled in Bill, Shannon and
 * Howie, who do not need a ping per signature.
 */
const OFFICE_EMAILS: string[] = [JORGE_EMAIL, RYAN_EMAIL, NICOLE_EMAIL];

const money = (v: number) =>
  `$${Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Contract mail always goes out from Jorge's Penney address.
 *
 * It used to resolve to "any teammate with a Google token", which meant a
 * client could receive their executed contract from a field carpenter's
 * mailbox. Clients should see one consistent sender. Everyone else is a
 * fallback only for when that mailbox has no working token.
 */
async function resolveSenderToken(
  admin: ReturnType<typeof createAdminClient>,
): Promise<{ token: string; email: string } | null> {
  const { data: profiles } = await admin
    .from("profiles")
    .select("id, email, role, google_refresh_token")
    .not("google_refresh_token", "is", null);

  const candidates = profiles ?? [];
  const ordered = [
    candidates.find((p) => p.email === JORGE_EMAIL),
    candidates.find((p) => p.email === RYAN_EMAIL),
    ...candidates.filter((p) => ["owner", "precon_manager"].includes(p.role ?? "")),
  ].filter((p): p is NonNullable<typeof p> => !!p);

  const seen = new Set<string>();
  for (const p of ordered) {
    if (seen.has(p.id) || !p.google_refresh_token) continue;
    seen.add(p.id);
    const token = await getAccessTokenFromRefreshToken(p.google_refresh_token);
    if (token) return { token, email: p.email as string };
  }
  return null;
}

interface PermitScope {
  summary?: string;
  narrative?: string;
  structural?: string;
  plumbing?: string;
  electrical?: string;
  mechanical?: string;
  site_demo?: string;
}

/** Best-effort: a permit lookup failing must never hold up the contract copy. */
async function fetchPermitScope(
  supabase: DB,
  projectId: string,
  origin: string,
  town: string,
): Promise<PermitScope | null> {
  try {
    const { data: keyRow } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "proposal_pdf_service_key")
      .maybeSingle();
    const serviceKey = String(keyRow?.value ?? "");
    if (!serviceKey) return null;

    const res = await fetch(`${origin}/api/generate-permit-description`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-service-key": serviceKey },
      body: JSON.stringify({ projectId, town }),
    });
    if (!res.ok) return null;
    const json = await res.json();
    return (json?.fields ?? json) as PermitScope;
  } catch {
    return null;
  }
}

/**
 * email_logs has NOT NULL subject/from_email/to_email, and `category` is the
 * email_category ENUM (client_update | sub_outreach | internal | quote |
 * follow_up | other) — not free text. Anything else fails the insert.
 */
async function logEmail(
  supabase: DB,
  args: { projectId: string; subject: string; from: string; to: string; category?: "client_update" | "internal" },
) {
  const { error } = await supabase.from("email_logs").insert({
    direction: "outbound",
    category: args.category ?? "client_update",
    project_id: args.projectId,
    subject: args.subject,
    from_email: args.from,
    to_email: args.to,
  });
  if (error) console.error("[executed-contract] email_logs insert failed:", error.message);
}

export interface ExecutedContractResult {
  clientCopySent: boolean;
  permitNoteSent: boolean;
  sentFrom?: string;
  error?: string;
}

/**
 * Send the executed contract to the client and the permit note to Nicole.
 */
export async function sendExecutedContractEmail(
  supabase: DB,
  projectId: string,
  origin: string,
): Promise<ExecutedContractResult> {
  const { data: project } = await supabase
    .from("projects")
    .select("id, name, project_number, address, city, state, zip, contract_locked_amount, contract_client_signature, contract_client_signed_at, contract_client_ip, contract_signed_pdf_path, contract_client_email, customers(first_name, last_name, email)")
    .eq("id", projectId)
    .single();
  if (!project) return { clientCopySent: false, permitNoteSent: false, error: "Project not found" };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const custArr = project.customers as any;
  const cust = Array.isArray(custArr) ? custArr[0] : custArr;
  const clientEmail = cust?.email || project.contract_client_email;

  const admin = createAdminClient();
  const sender = await resolveSenderToken(admin);
  if (!sender) {
    return { clientCopySent: false, permitNoteSent: false, error: "No connected mailbox to send from" };
  }

  const total = Number(project.contract_locked_amount ?? 0);
  const jobLabel = `${project.project_number ? project.project_number + " " : ""}${project.name}`;
  const jobAddress = [project.address, project.city, project.state, project.zip]
    .filter(Boolean)
    .join(", ");
  const signedOn = project.contract_client_signed_at
    ? new Date(project.contract_client_signed_at).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : "today";

  // The signed PDF snapshotted at signature time — this is the client's copy.
  let attachments: { filename: string; mimeType: string; content: string }[] | undefined;
  if (project.contract_signed_pdf_path) {
    const { data: file, error: dlError } = await supabase.storage
      .from("email-attachments")
      .download(project.contract_signed_pdf_path);
    if (dlError) console.error("[executed-contract] signed PDF download failed:", dlError.message);
    if (file) {
      const buf = Buffer.from(await file.arrayBuffer());
      attachments = [
        {
          filename: `Signed Contract - ${project.project_number || project.name}.pdf`,
          mimeType: "application/pdf",
          content: buf.toString("base64"),
        },
      ];
    }
  }

  const result: ExecutedContractResult = {
    clientCopySent: false,
    permitNoteSent: false,
    sentFrom: sender.email,
  };

  // ── 1. The client's copy: their signed contract, nothing else. ──
  // No CC — the office gets its own internal email below, so copying them
  // here just doubles every signature into four inboxes.
  if (clientEmail) {
    const subject = `Signed Contract — ${project.name} | Penney Construction`;
    try {
      await sendEmailWithAccessToken(
        {
          to: clientEmail,
          subject,
          body: `Hi ${cust?.first_name || "there"},

Thank you. The contract for ${project.name} is signed by both parties and a fully executed copy is attached for your records.

Contract price: ${money(total)}
Signed ${signedOn} by ${project.contract_client_signature || "the owner"}

We will invoice each payment as the job reaches that stage. Next on our side is the building permit, and we will be in touch about scheduling.

Any questions, reply here or call Jorge at (978) 473-0183.

Thank you,`,
          attachments,
        },
        sender.token,
      );
      result.clientCopySent = true;
      await logEmail(supabase, { projectId, subject, from: sender.email, to: clientEmail });
    } catch (e) {
      result.error = e instanceof Error ? e.message : String(e);
      console.error("[executed-contract] client copy failed:", result.error);
    }
  } else {
    result.error = "No client email on file";
  }

  // ── 2. One internal email: Jorge, Ryan, Nicole. Nobody else. ──
  // Signature news and the permit scope in a single message, so a signature
  // costs the office one email instead of two.
  const scope = await fetchPermitScope(supabase, projectId, origin, project.city || "");

  // The deposit is the first milestone. By the time this runs,
  // lockContractAndPremakeInvoices has frozen every percent into dollars and
  // drafted one invoice per row, so this is a real number Nicole can bill.
  const { data: depositRow } = await supabase
    .from("project_payment_milestones")
    .select("amount")
    .eq("project_id", projectId)
    .order("sort_order")
    .limit(1)
    .maybeSingle();
  const depositAmount = depositRow?.amount != null ? Number(depositRow.amount) : null;

  // Permit portals take the job description as ONE field, and the office only
  // needs 2-3 plain sentences — not a trade-by-trade breakdown. The narrative
  // is written to stand on its own; fall back to the one-line summary.
  const permitParagraph = (scope?.narrative || scope?.summary || "").trim();
  const permitDescription = permitParagraph
    ? permitParagraph.replace(/\s+/g, " ").replace(/\.+$/, "") + "."
    : null;

  const internalBody = [
    `${project.contract_client_signature || "The client"} signed ${jobLabel}.`,
    ``,
    `Contract price: ${money(total)} (locked)`,
    `Address: ${jobAddress || "(not on file)"}`,
    `Signed: ${signedOn}`,
    `The fully executed contract is attached.`,
    ``,
    `NICOLE — three things:`,
    depositAmount != null
      ? `1. Send the deposit invoice, ${money(depositAmount)}. It is already drafted in the app under Invoices.`
      : `1. Send the deposit invoice. The payment-schedule invoices are drafted in the app under Invoices.`,
    `2. Create the project in QuickBooks. Copy the name below exactly — if it does not match, the app cannot link to it and the job's numbers end up split across two records.`,
    `3. Pull the building permit. The description below is ready to copy and paste.`,
    ``,
    // QuickBooks has no Projects API — projects are UI-only, so this step
    // cannot be automated. What CAN be automated is the link: the push does a
    // find-or-create on DisplayName, so as long as Nicole names it exactly
    // this, we attach to her record instead of creating a duplicate
    // sub-customer. Hence the name being spelled out for copy-paste.
    `QUICKBOOKS PROJECT NAME`,
    jobLabel,
    ``,
    `PERMIT DESCRIPTION`,
    permitDescription ??
      `Permit scope did not generate — pull it from the project's Permit Scope card.`,
  ]
    .filter((l) => l !== null)
    .join("\n");

  const internalSubject = `Signed — ${jobLabel}`;
  // Nicole owns both actions, so she is the To. Jorge and Ryan are copied.
  // This used to filter the sender out of the recipient list — and since
  // contract mail always sends from Jorge's mailbox by design, that meant
  // Jorge never received a single one of these. Gmail delivers a
  // self-addressed copy to the Inbox, so keeping him on is correct.
  const internalCc = OFFICE_EMAILS.filter((e) => e !== NICOLE_EMAIL);
  try {
    await sendEmailWithAccessToken(
      {
        to: NICOLE_EMAIL,
        cc: internalCc.join(", "),
        subject: internalSubject,
        body: internalBody,
        attachments,
      },
      sender.token,
    );
    result.permitNoteSent = true;
    await logEmail(supabase, {
      projectId,
      subject: internalSubject,
      from: sender.email,
      to: [NICOLE_EMAIL, ...internalCc].join(", "),
      category: "internal",
    });
  } catch (e) {
    console.error("[executed-contract] internal note failed:", e);
  }

  return result;
}
