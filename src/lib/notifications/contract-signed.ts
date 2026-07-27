import { sendEmailWithAccessToken } from "@/lib/google/gmail";
import { getAccessTokenFromRefreshToken } from "@/lib/google/server-auth";
import { sendPushToUser } from "@/lib/push/send";
import { createAdminClient } from "@/lib/supabase/admin";

const JORGE_EMAIL = "jbetancur@penneyconstructioninc.com";
const RYAN_EMAIL = "rpenney@penneyconstructioninc.com";

/**
 * Contract mail sends from Jorge's Penney address, not "whoever happens to
 * have a Google token" — that fallback is why signature alerts were arriving
 * from Shannon.
 */
async function resolveNotifierToken(
  admin: ReturnType<typeof createAdminClient>,
): Promise<string | null> {
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

  for (const p of ordered) {
    if (!p.google_refresh_token) continue;
    const token = await getAccessTokenFromRefreshToken(p.google_refresh_token);
    if (token) return token;
  }
  return null;
}

type ContractSignatureInput = {
  projectId: string;
  projectName: string;
  /** The name the client typed on the signature line. */
  signerName: string;
};

/**
 * Tell the office a client just signed a contract.
 *
 * Change-order approvals notify nobody — the team only finds out next time
 * somebody opens the Finances tab. A signed contract gates permitting, the
 * deposit invoice, and the countersignature, so it gets a real ping.
 *
 * actor_profile_id is null: the actor is the client, who has no profile.
 */
export async function notifyTeamOfContractSignature({
  projectId,
  projectName,
  signerName,
}: ContractSignatureInput): Promise<void> {
  const admin = createAdminClient();

  const { data: profiles } = await admin
    .from("profiles")
    .select("id, email, full_name, role")
    .in("role", ["owner", "precon_manager", "office_admin"]);

  const recipients = profiles ?? [];
  if (recipients.length === 0) return;

  const title = `${signerName} signed the contract`;
  // Signing now executes the contract on its own — Penney signs at send time.
  // The old copy told the office to countersign, which no longer exists.
  const body = `${projectName} — signed and executed. The contract price is locked and the payment-schedule invoices are drafted.`;
  const url = `/projects/${projectId}?tab=finances`;

  const { error } = await admin.from("app_notifications").upsert(
    recipients.map((p) => ({
      recipient_profile_id: p.id,
      actor_profile_id: null,
      kind: "post",
      title,
      body,
      url,
      source_type: "contract_signed",
      source_id: projectId,
    })),
    { onConflict: "recipient_profile_id,source_type,source_id", ignoreDuplicates: true },
  );
  if (error) {
    console.error("[contract-signed] Could not persist notifications", error.message);
  }

  const accessToken = await resolveNotifierToken(admin);
  const appBaseUrl = process.env.APP_BASE_URL ?? "https://penney-construction-mf6m.vercel.app";

  await Promise.allSettled(
    recipients.map(async (p) =>
      Promise.allSettled([
        sendPushToUser(admin, p.id, {
          title,
          body: body.slice(0, 120),
          url,
          tag: `contract_signed-${projectId}`,
        }).catch((err) => console.error("[contract-signed] Push failed", err)),
        accessToken && p.email
          ? sendEmailWithAccessToken(
              {
                to: p.email,
                subject: title,
                body: `Hi ${p.full_name?.split(" ")[0] || "there"},

${signerName} signed the contract for ${projectName}. It is fully executed — the price is locked and the payment-schedule invoices are drafted and ready to send.

${appBaseUrl}${url}`,
              },
              accessToken,
            ).catch((err) => console.error("[contract-signed] Email failed", err))
          : Promise.resolve(),
      ]),
    ),
  );
}
