"use server";

import { revalidatePath } from "next/cache";
import { getUser } from "@/lib/auth/get-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { canManageSiteSigns } from "@/lib/sub-portal/site-code";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type MarkSignPostedResult =
  | { ok: true; postedAt: string | null; postedBy: string | null }
  | { ok: false; error: string };

/**
 * The "Sign is up" tick on the job sign pages: stamps
 * projects.site_sign_posted_at/by so the office (and the Job Board) can see
 * which live jobs have a QR sign on site. `posted: false` clears it (the
 * sign blew away, or it was ticked by mistake).
 *
 * Office roles only; field logins are refused. The write uses the admin
 * client after the role check, like the other v3 office actions.
 */
export async function markSignPosted(projectId: string, posted = true): Promise<MarkSignPostedResult> {
  const user = await getUser();
  if (!user) return { ok: false, error: "Sign in first." };
  if (!canManageSiteSigns(user.profile?.role)) {
    return { ok: false, error: "Only the office can mark job signs." };
  }
  if (!UUID_RE.test(projectId)) return { ok: false, error: "That job wasn't found." };

  // The person who actually tapped, even while viewing as someone else.
  const by = user.realProfile ?? user.profile;
  const admin = createAdminClient();
  const patch = posted
    ? { site_sign_posted_at: new Date().toISOString(), site_sign_posted_by: by?.id ?? null }
    : { site_sign_posted_at: null, site_sign_posted_by: null };

  const { data, error } = await admin
    .from("projects")
    .update(patch)
    .eq("id", projectId)
    .select("id, site_sign_posted_at")
    .maybeSingle();
  if (error) {
    console.error("[site-signs] markSignPosted failed", error.message);
    return { ok: false, error: "Couldn't save that. Try again." };
  }
  if (!data) return { ok: false, error: "That job wasn't found." };

  revalidatePath("/job-qr/all");
  revalidatePath(`/job-qr/${projectId}`);
  return {
    ok: true,
    postedAt: (data as { site_sign_posted_at: string | null }).site_sign_posted_at,
    postedBy: posted ? (by?.full_name ?? null) : null,
  };
}
