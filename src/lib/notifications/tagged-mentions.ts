import { sendEmailWithAccessToken } from "@/lib/google/gmail";
import { getAccessTokenFromRefreshToken } from "@/lib/google/server-auth";
import { sendPushToUser } from "@/lib/push/send";
import { createAdminClient } from "@/lib/supabase/admin";

export type MentionSource =
  | "company_post"
  | "daily_log"
  | "project_update"
  | "feed_comment";

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

type SenderProfile = { id: string; google_refresh_token: string | null };

/**
 * Resolve a Gmail access token for notification emails WITHOUT touching
 * cookies — the acting user may not have Google connected (crew, impersonated
 * sessions), and this can run outside a request context. Prefer the actor's
 * own connected account (so the email comes from them), then fall back to any
 * teammate with a stored refresh token so the email still goes out.
 * Shared by mention notifications and schedule-phase notifications.
 */
export async function getServerGmailAccessToken(
  admin: ReturnType<typeof createAdminClient>,
  actorId: string,
): Promise<string | null> {
  const { data: senders } = await admin
    .from("profiles")
    .select("id, google_refresh_token")
    .not("google_refresh_token", "is", null);

  const ordered = [...((senders as SenderProfile[] | null) ?? [])].sort(
    (a, b) => Number(b.id === actorId) - Number(a.id === actorId),
  );

  for (const sender of ordered) {
    if (!sender.google_refresh_token) continue;
    const token = await getAccessTokenFromRefreshToken(
      sender.google_refresh_token,
    );
    if (token) return token;
  }
  return null;
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

  // One token for the whole fan-out — resolved server-side so the email
  // ALWAYS sends, even when the tagger never connected Google.
  const accessToken = await getServerGmailAccessToken(admin, actorId);
  if (!accessToken) {
    console.error(
      "[mention-notifications] No connected Google account available — mention emails skipped",
      { sourceType, sourceId },
    );
  }

  await Promise.allSettled(
    validProfiles.map(async (profile) => {
      await Promise.allSettled([
        sendPushToUser(admin, profile.id, {
          title,
          body: body.slice(0, 120),
          url,
          tag: `${sourceType}-${sourceId}`,
        }).catch((err) => {
          console.error("[mention-notifications] Push failed", {
            recipient: profile.id,
            sourceType,
            sourceId,
            error: err instanceof Error ? err.message : String(err),
          });
        }),
        accessToken && profile.email
          ? sendEmailWithAccessToken(
              {
                to: profile.email,
                subject: title,
                body: `Hi ${emailSafeText(profile.full_name?.split(" ")[0] || "there")},

${emailSafeText(actorName)} tagged you in a Penney Construction update:

${emailSafeText(body.slice(0, 500))}

Open the app to view it: ${emailSafeText(
                  `${process.env.APP_BASE_URL ?? "https://penney-construction-mf6m.vercel.app"}${url}`,
                )}`,
              },
              accessToken,
            ).catch((err) => {
              console.error("[mention-notifications] Email failed", {
                recipient: profile.email,
                sourceType,
                sourceId,
                error: err instanceof Error ? err.message : String(err),
              });
            })
          : Promise.resolve(),
      ]);
    }),
  );
}
