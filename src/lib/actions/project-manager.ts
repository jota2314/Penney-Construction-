"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { canAssignProjectManager, canBeProjectManager } from "@/lib/auth/team-access";

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
  const { data, error } = await supabase.from("projects").update({ assigned_pm: profileId }).eq("id", projectId).select("id").maybeSingle();
  if (error) return { error: error.message };
  if (!data) return { error: "Project not found or access denied." };
  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/projects");
  revalidatePath("/team", "layout");
  revalidatePath("/board");
  return { error: null };
}
