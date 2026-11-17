"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { canAssignProjectManager, canBeProjectManager } from "@/lib/auth/team-access";
import { notifyProjectManagerAssigned } from "@/lib/notifications/pm-assignment-notify";

export async function assignProjectManager(projectId: string, profileId: string | null) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };
  const { data: actor } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (!canAssignProjectManager(actor?.role)) return { error: "You cannot change project manager assignments." };
  if (profileId) {
    const { data: manager } = await supabase.from("profiles").select("role").eq("id", profileId).maybeSingle();
    if (!canBeProjectManager(manager?.role)) return { error: "Choose a project manager, owner, or preconstruction manager." };
  }
  const { data: before } = await supabase.from("projects").select("assigned_pm").eq("id", projectId).maybeSingle();
  const { data, error } = await supabase.from("projects").update({ assigned_pm: profileId }).eq("id", projectId).select("id").maybeSingle();
  if (error) return { error: error.message };
  if (!data) return { error: "Project not found or access denied." };
  // Email the newly assigned PM a rundown of the job. Best-effort: never throws.
  if (profileId && profileId !== before?.assigned_pm) {
    await notifyProjectManagerAssigned({ projectId, pmProfileId: profileId, actorId: user.id });
  }
  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/projects");
  revalidatePath("/team", "layout");
  revalidatePath("/board");
  return { error: null };
}
