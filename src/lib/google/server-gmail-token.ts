import { getAccessTokenFromRefreshToken } from "@/lib/google/server-auth";
import { createAdminClient } from "@/lib/supabase/admin";

type SenderProfile = { id: string; google_refresh_token: string | null };

/**
 * Resolve a Gmail access token WITHOUT touching cookies — the acting user may
 * not have Google connected in this browser (crew, impersonated sessions, an
 * expired cookie on the office iPad), and this can run outside a request
 * context. Prefer the actor's own connected account (so the email comes from
 * them), then fall back to any teammate with a stored refresh token so the
 * email still goes out.
 * Shared by notification fan-out and by sendEmail()'s cookie fallback.
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
    const token = await getAccessTokenFromRefreshToken(sender.google_refresh_token);
    if (token) return token;
  }
  return null;
}
