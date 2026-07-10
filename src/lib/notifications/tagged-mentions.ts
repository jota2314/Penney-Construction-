import { sendEmail } from "@/lib/google/gmail";
import { sendPushToUser } from "@/lib/push/send";
import { createAdminClient } from "@/lib/supabase/admin";

export type MentionSource = "company_post" | "daily_log" | "project_update";

type NotifyTaggedProfilesInput = {
  actorId: string;
  actorName: string;
  recipientProfileIds: string[];
  sourceType: MentionSource;
  sourceId: string;
  title: string;
  body: string;
  url: string;
};

function emailSafeText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/**
 * Persist the mention first, then fan out push and email as best-effort
 * delivery channels. A missing VAPID key or Google token never blocks a post.
 */
export async function notifyTaggedProfiles({
  actorId,
  actorName,
  recipientProfileIds,
  sourceType,
  sourceId,
  title,
  body,
  url,
}: NotifyTaggedProfilesInput): Promise<void> {
  const recipientIds = Array.from(new Set(recipientProfileIds)).filter(
    (profileId) => profileId !== actorId,
  );
  if (recipientIds.length === 0) return;

  const admin = createAdminClient();
  const { data: profiles } = await admin
    .from("profiles")
    .select("id, email, full_name")
    .in("id", recipientIds);

  const validProfiles = profiles ?? [];
  if (validProfiles.length === 0) return;

  const notifications = validProfiles.map((profile) => ({
    recipient_profile_id: profile.id,
    actor_profile_id: actorId,
    kind: "mention",
    title,
    body: body.slice(0, 500),
    url,
    source_type: sourceType,
    source_id: sourceId,
  }));

  const { error: notificationError } = await admin
    .from("app_notifications")
    .upsert(notifications, {
      onConflict: "recipient_profile_id,source_type,source_id",
      ignoreDuplicates: true,
    });
  if (notificationError) {
    console.error("[mention-notifications] Could not persist notifications", {
      sourceType,
      sourceId,
      error: notificationError.message,
    });
  }

  await Promise.allSettled(
    validProfiles.map(async (profile) => {
      await Promise.allSettled([
        sendPushToUser(admin, profile.id, {
          title,
          body: body.slice(0, 120),
          url,
          tag: `${sourceType}-${sourceId}`,
        }),
        profile.email
          ? sendEmail({
              to: profile.email,
              subject: title,
              body: `Hi ${emailSafeText(profile.full_name?.split(" ")[0] || "there")},

${emailSafeText(actorName)} tagged you in a Penney Construction update:

${emailSafeText(body.slice(0, 500))}

Open the app to view it: ${emailSafeText(
                `${process.env.APP_BASE_URL ?? ""}${url}`,
              )}`,
            })
          : Promise.resolve(),
      ]);
    }),
  );
}
