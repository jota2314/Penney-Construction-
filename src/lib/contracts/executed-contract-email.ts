// The email that goes out the moment a client signs: the fully executed
// contract to the client, copied to the office, with the permit scope inline
// so Nicole can start the permit application without chasing anyone.

import { sendEmailWithAccessToken } from "@/lib/google/gmail";
import { getAccessTokenFromRefreshToken } from "@/lib/google/server-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import type { DB } from "@/lib/contracts/contract-lock";

const RYAN_EMAIL = "rpenney@penneyconstructioninc.com";
const JORGE_EMAIL = "jbetancur@penneyconstructioninc.com";
const NICOLE_EMAIL = "nsmith@penneyconstructioninc.com";

const money = (v: number) =>
  `$${Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Resolve which mailbox a client-facing contract goes out from.
 *
 * This must never be "whoever happens to be first in the table" — most of the
 * team has a Google token, field crew included, and a client receiving their
 * executed contract from a carpenter's address looks broken. Preference order:
 * whoever sent the contract, then the project's estimator, then Ryan, then any
 * owner or precon. Field and office roles are never a fallback here.
 */
async function resolveSenderToken(
  admin: ReturnType<typeof createAdminClient>,
  projectId: string,
): Promise<{ token: string; email: string | null } | null> {
  const { data: project } = await admin
    .from("projects")
    .select("contract_countersigned_by, assigned_estimator, created_by")
    .eq("id", projectId)
    .single();

  const { data: profiles } = await admin
    .from("profiles")
    .select("id, email, role, google_refresh_token")
    .not("google_refresh_token", "is", null);

  const candidates = profiles ?? [];
  const byId = (id: string | null | undefined) =>
    id ? candidates.find((p) => p.id === id) : undefined;

  const ordered = [
    byId(project?.contract_countersigned_by),
    byId(project?.assigned_estimator),
    byId(project?.created_by),
    candidates.find((p) => p.email === RYAN_EMAIL),
    ...candidates.filter((p) => ["owner", "precon_manager"].includes(p.role ?? "")),
  ].filter((p): p is NonNullable<typeof p> => !!p);

  const seen = new Set<string>();
  for (const p of ordered) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    if (!p.google_refresh_token) continue;
    const token = await getAccessTokenFromRefreshToken(p.google_refresh_token);
    if (token) return { token, email: p.email };
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

/**
 * Ask the permit-description generator for this job's scope. Best-effort:
 * a failure here must never stop the executed contract from going out, so
 * the email just omits the permit block and says so.
 */
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

function permitBlock(scope: PermitScope | null, town: string): string {
  if (!scope) {
    return `PERMIT SCOPE
Could not auto-generate the permit description for this job. Pull it from the
project's Permit Scope card in the app before filing.`;
  }
  const line = (label: string, v?: string) =>
    v && v.trim() && v.trim().toLowerCase() !== "none" ? `${label}: ${v.trim()}` : null;

  return [
    "PERMIT SCOPE (for the building department application)",
    town ? `Town: ${town}` : null,
    scope.summary ? `Work description: ${scope.summary}` : null,
    scope.narrative ? `\n${scope.narrative}` : null,
    "",
    line("Structural", scope.structural),
    line("Plumbing", scope.plumbing),
    line("Electrical", scope.electrical),
    line("Mechanical / gas", scope.mechanical),
    line("Demolition / site", scope.site_demo),
  ]
    .filter((l) => l !== null)
    .join("\n");
}

/**
 * Send the fully executed contract. To the client, copied to Ryan, Jorge and
 * Nicole — Nicole's copy carries the permit scope so the permit process
 * starts off this email rather than a follow-up conversation.
 */
export async function sendExecutedContractEmail(
  supabase: DB,
  projectId: string,
  origin: string,
): Promise<{ sent: boolean; error?: string }> {
  const { data: project } = await supabase
    .from("projects")
    .select("id, name, project_number, address, city, state, zip, contract_locked_amount, contract_client_signature, contract_client_signed_at, contract_signed_pdf_path, contract_client_email, customers(first_name, last_name, email)")
    .eq("id", projectId)
    .single();
  if (!project) return { sent: false, error: "Project not found" };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const custArr = project.customers as any;
  const cust = Array.isArray(custArr) ? custArr[0] : custArr;
  const clientEmail = cust?.email || project.contract_client_email;
  if (!clientEmail) return { sent: false, error: "No client email on file" };

  const { data: milestones } = await supabase
    .from("project_payment_milestones")
    .select("label, amount, sort_order")
    .eq("project_id", projectId)
    .order("sort_order");

  const total = Number(project.contract_locked_amount ?? 0);
  const town = project.city || "";
  const jobAddress = [project.address, project.city, project.state, project.zip]
    .filter(Boolean)
    .join(", ");

  const scope = await fetchPermitScope(supabase, projectId, origin, town);

  // The signed PDF was snapshotted to storage at signature time.
  let attachments: { filename: string; mimeType: string; content: string }[] | undefined;
  if (project.contract_signed_pdf_path) {
    const { data: file } = await supabase.storage
      .from("email-attachments")
      .download(project.contract_signed_pdf_path);
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

  const scheduleLines = (milestones ?? [])
    .map((m, i) => `  ${i + 1}. ${m.label} — ${money(Number(m.amount ?? 0))}`)
    .join("\n");

  const clientFirst = cust?.first_name || "there";
  const signedOn = project.contract_client_signed_at
    ? new Date(project.contract_client_signed_at).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : "today";

  const body = `Hi ${clientFirst},

Thank you — the contract for ${project.name} is signed by both parties. A fully executed copy is attached for your records.

Contract price: ${money(total)}
Signed: ${signedOn} by ${project.contract_client_signature || "the owner"}

PAYMENT SCHEDULE
${scheduleLines || "  (see the attached contract)"}

We will invoice each payment as the job reaches that stage. Next step on our side is the building permit; we will be in touch about scheduling.

If you have any questions, reply here or call Jorge at (978) 473-0183.

Thank you,

---------------------------------------------
INTERNAL — ${project.project_number || ""} ${project.name}
Job address: ${jobAddress || "(not on file)"}

Nicole: contract is executed, please start the permit application.

${permitBlock(scope, town)}
---------------------------------------------`;

  const admin = createAdminClient();
  const sender = await resolveSenderToken(admin, projectId);
  if (!sender) return { sent: false, error: "No connected Google account to send from" };

  // Whoever we send as is already a recipient; don't CC them their own email.
  const cc = [RYAN_EMAIL, JORGE_EMAIL, NICOLE_EMAIL].filter((e) => e !== sender.email);

  try {
    await sendEmailWithAccessToken(
      {
        to: clientEmail,
        cc: cc.join(", "),
        subject: `Signed Contract — ${project.name} | Penney Construction`,
        body,
        attachments,
      },
      sender.token,
    );
  } catch (e) {
    return { sent: false, error: e instanceof Error ? e.message : String(e) };
  }

  await supabase.from("email_logs").insert({
    direction: "outbound",
    category: "contract",
    project_id: projectId,
  });

  return { sent: true };
}
