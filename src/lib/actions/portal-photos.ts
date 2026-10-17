"use server";

import { getUser } from "@/lib/auth/get-user";
import { createAdminClient } from "@/lib/supabase/admin";

// Hide a daily log's photos from the homeowner's portal, or show them again.
//
// Sub photos are shared with the homeowner by default (only the photos cross
// over, never the log text or who posted). The office's one-tap Hide on the
// project's Portal tab lands here: it stamps daily_logs.client_hidden_at/by,
// and the client portal loader skips any log with client_hidden_at set.
// Nothing is deleted; Show clears the stamp.

const OFFICE_ROLES: readonly string[] = ["owner", "precon_manager", "project_manager", "office_admin"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function setLogClientHidden(
  logId: string,
  hidden: boolean,
): Promise<{ hiddenAt?: string | null; error?: string }> {
  const user = await getUser();
  if (!user) return { error: "Sign in again to change this." };
  if (!user.profile || !OFFICE_ROLES.includes(user.profile.role)) {
    return { error: "Only the office can change what the homeowner sees." };
  }
  if (typeof logId !== "string" || !UUID_RE.test(logId) || typeof hidden !== "boolean") {
    return { error: "That post couldn't be found." };
  }

  const admin = createAdminClient();
  const { data: log, error: readError } = await admin
    .from("daily_logs")
    .select("id, client_hidden_at")
    .eq("id", logId)
    .maybeSingle();
  if (readError) return { error: readError.message };
  if (!log) return { error: "That post couldn't be found." };

  // Already the way they want it: keep the original stamp (who hid it, when).
  const current = (log.client_hidden_at as string | null) ?? null;
  if (hidden === !!current) return { hiddenAt: current };

  const hiddenAt = hidden ? new Date().toISOString() : null;
  const { error } = await admin
    .from("daily_logs")
    .update({ client_hidden_at: hiddenAt, client_hidden_by: hidden ? user.id : null })
    .eq("id", logId);
  if (error) return { error: error.message };
  return { hiddenAt };
}
