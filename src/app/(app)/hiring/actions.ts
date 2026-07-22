"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getUser } from "@/lib/auth/get-user";

const VALID_STATUSES = new Set([
  "new",
  "reviewing",
  "interview",
  "offer",
  "rejected",
]);

export async function updateApplication(
  id: string,
  patch: { status?: string; notes?: string }
): Promise<{ success: boolean; error?: string }> {
  const viewer = await getUser();
  if (!viewer) {
    return { success: false, error: "Not authenticated" };
  }

  if (patch.status !== undefined && !VALID_STATUSES.has(patch.status)) {
    return { success: false, error: "Invalid status" };
  }

  const update: Record<string, unknown> = {
    reviewed_by: viewer.profile?.full_name || viewer.email,
    reviewed_at: new Date().toISOString(),
  };
  if (patch.status !== undefined) update.status = patch.status;
  if (patch.notes !== undefined) update.notes = patch.notes;

  const supabase = await createClient();
  const { error } = await supabase
    .from("job_applications")
    .update(update)
    .eq("id", id);

  if (error) {
    console.error("updateApplication error:", error);
    return { success: false, error: "Could not save changes" };
  }

  revalidatePath("/hiring");
  return { success: true };
}
