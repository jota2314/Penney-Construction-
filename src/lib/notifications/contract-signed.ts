import { sendPushToUser } from "@/lib/push/send";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Who hears about a signed contract: Jorge, Ryan, Nicole. Nobody else.
 *
 * This used to notify by ROLE (owner / precon_manager / office_admin), which
 * quietly swept in Bill, Shannon and Howie — none of whom need a ping every
 * time a client signs. An explicit list is the point.
 */
export const CONTRACT_NOTIFY_EMAILS = [
  "jbetancur@penneyconstructioninc.com",
  "rpenney@penneyconstructioninc.com",
  "nsmith@penneyconstructioninc.com",
] as const;

type ContractSignatureInput = {
  projectId: string;
  projectName: string;
  /** The name the client typed on the signature line. */
  signerName: string;
};

/**
 * In-app bell + push for a signed contract.
 *
 * No email leg: sendExecutedContractEmail already sends the three of them one
 * internal email with the same news plus the permit scope. Two emails per
 * signature was noise.
 */
export async function notifyTeamOfContractSignature({
  projectId,
  projectName,
  signerName,
}: ContractSignatureInput): Promise<void> {
  const admin = createAdminClient();

  const { data: profiles } = await admin
    .from("profiles")
    .select("id, email, full_name")
    .in("email", CONTRACT_NOTIFY_EMAILS as unknown as string[]);

  const recipients = profiles ?? [];
  if (recipients.length === 0) return;

  const title = `${signerName} signed the contract`;
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
  if (error) console.error("[contract-signed] could not persist notifications:", error.message);

  await Promise.allSettled(
    recipients.map((p) =>
      sendPushToUser(admin, p.id, {
        title,
        body: body.slice(0, 120),
        url,
        tag: `contract_signed-${projectId}`,
      }).catch((err) => console.error("[contract-signed] push failed:", err)),
    ),
  );
}
